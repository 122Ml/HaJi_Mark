package rag

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/122Ml/HaJi_Mark/backend/internal/store"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Profile struct {
	ID              string `json:"id"`
	Label           string `json:"label"`
	Kind            string `json:"kind"`
	Protocol        string `json:"protocol"`
	BaseURLEnv      string `json:"base_url_env"`
	KeyEnv          string `json:"key_env"`
	Model           string `json:"model"`
	Dimensions      int    `json:"dimensions"`
	SendDimensions  bool   `json:"send_dimensions"`
	BatchSize       int    `json:"batch_size"`
	InputRate       int64  `json:"input_micro_cny_per_token"`
	OutputRate      int64  `json:"output_micro_cny_per_token"`
	ImageTokenLimit int    `json:"image_token_limit,omitempty"`
	Thinking        string `json:"thinking,omitempty"`
}
type Models struct {
	DB       *pgxpool.Pool
	Profiles []Profile
	Client   *http.Client
}

func LoadModels(db *pgxpool.Pool) (*Models, error) {
	path := os.Getenv("MODEL_PROFILES_PATH")
	if path == "" {
		path = "config/models.json"
	}
	raw, e := os.ReadFile(path)
	if e != nil {
		return nil, e
	}
	m := &Models{DB: db, Client: &http.Client{Timeout: 90 * time.Second}}
	if e = json.Unmarshal(raw, &m.Profiles); e != nil {
		return nil, e
	}
	seen := map[string]bool{}
	for _, p := range m.Profiles {
		if p.Thinking != "" && p.Thinking != "enabled" && p.Thinking != "disabled" {
			return nil, errors.New("invalid thinking setting")
		}
		if p.ID == "" || seen[p.ID] || p.Protocol != "openai" || (p.Kind != "chat" && p.Kind != "embedding" && p.Kind != "vision") || (p.Kind == "vision" && (p.ImageTokenLimit < 1 || p.ImageTokenLimit > 100000)) || p.InputRate <= 0 || p.OutputRate < 0 || p.BatchSize < 1 || p.BatchSize > 100 || (p.Kind == "embedding" && (p.Dimensions < 1 || p.Dimensions > 16000)) {
			return nil, errors.New("invalid model profile")
		}
		seen[p.ID] = true
	}
	return m, nil
}
func Enabled() bool { return os.Getenv("RAG_ENABLED") == "true" }
func (m *Models) Profile(id, kind string) (Profile, error) {
	for _, p := range m.Profiles {
		if p.Kind == kind && (id == "" || id == p.ID) && os.Getenv(p.KeyEnv) != "" && os.Getenv(p.BaseURLEnv) != "" {
			return p, nil
		}
	}
	return Profile{}, errors.New("未配置可用模型，请检查服务端接口和密钥")
}
func (m *Models) Public() []map[string]any {
	out := []map[string]any{}
	for _, p := range m.Profiles {
		out = append(out, map[string]any{"id": p.ID, "label": p.Label, "kind": p.Kind, "model": p.Model, "dimensions": p.Dimensions, "available": Enabled() && os.Getenv(p.KeyEnv) != "" && os.Getenv(p.BaseURLEnv) != ""})
	}
	return out
}
func Hash(s string) string { v := sha256.Sum256([]byte(s)); return hex.EncodeToString(v[:]) }
func (p Profile) Fingerprint() string {
	return Hash(p.ID + "|" + p.Model + "|" + os.Getenv(p.BaseURLEnv) + fmt.Sprint(p.Dimensions, p.SendDimensions) + "|structure-v1")
}

type usage struct {
	Prompt     int64 `json:"prompt_tokens"`
	Completion int64 `json:"completion_tokens"`
	Total      int64 `json:"total_tokens"`
}

func (m *Models) call(ctx context.Context, course, actor, purpose string, p Profile, path string, payload any, inputBytes, maxOutput int, out any) error {
	if !Enabled() {
		return errors.New("本地RAG未启用")
	}
	if inputBytes > 180000 {
		return errors.New("模型输入过长，请缩小资料或问题范围")
	}
	// Configured rates are conservative accounting estimates, not provider invoices.
	reserve := int64(inputBytes+100)*p.InputRate + int64(maxOutput)*p.OutputRate
	if reserve < 1000 {
		reserve = 1000
	}
	tx, e := m.DB.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	q := store.New(tx)
	if _, e = q.ReserveModelBudget(ctx, reserve); e != nil {
		return errors.New("本次50元联调预算不足，调用未发出")
	}
	id := uuid.NewString()
	if e = q.CreateModelCall(ctx, store.CreateModelCallParams{ID: id, CourseID: course, ActorID: actor, ProfileID: p.ID, Purpose: purpose, ReservedMicroCny: reserve}); e != nil {
		return e
	}
	if e = tx.Commit(ctx); e != nil {
		return e
	}
	started := time.Now()
	state, code := "unknown", "request_failed"
	charge := reserve
	u := usage{}
	defer func() {
		settleCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		t, err := m.DB.Begin(settleCtx)
		if err != nil {
			return
		}
		defer t.Rollback(settleCtx)
		sq := store.New(t)
		if _, err = sq.FinishModelCall(settleCtx, store.FinishModelCallParams{ID: id, State: state, ChargedMicroCny: charge, InputTokens: u.Prompt, OutputTokens: u.Completion, DurationMs: time.Since(started).Milliseconds(), ErrorCode: code}); err != nil {
			return
		}
		if err = sq.SettleModelBudget(settleCtx, store.SettleModelBudgetParams{ReservedMicroCny: reserve, SpentMicroCny: charge}); err == nil {
			_ = t.Commit(settleCtx)
		}
	}()
	raw, _ := json.Marshal(payload)
	req, e := http.NewRequestWithContext(ctx, "POST", strings.TrimRight(os.Getenv(p.BaseURLEnv), "/")+path, bytes.NewReader(raw))
	if e != nil {
		return errors.New("模型接口配置无效")
	}
	req.Header.Set("Authorization", "Bearer "+os.Getenv(p.KeyEnv))
	req.Header.Set("Content-Type", "application/json")
	resp, e := m.Client.Do(req)
	if e != nil {
		return errors.New("模型连接失败或超时；未知调用保留预算，不自动重试")
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		code = fmt.Sprintf("http_%d", resp.StatusCode)
		return fmt.Errorf("模型服务返回HTTP %d，请检查服务端配置及额度", resp.StatusCode)
	}
	data, e := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if e != nil {
		return errors.New("模型响应读取失败")
	}
	var meta struct {
		Usage usage `json:"usage"`
	}
	if json.Unmarshal(data, &meta) == nil {
		u = meta.Usage
		if u.Prompt == 0 && u.Total > 0 {
			u.Prompt = u.Total
		}
		if u.Prompt > 0 {
			charge = u.Prompt*p.InputRate + u.Completion*p.OutputRate
			if charge > reserve {
				charge = reserve
			}
		}
	}
	if e = json.Unmarshal(data, out); e != nil {
		code = "invalid_json"
		return errors.New("模型响应不是有效JSON")
	}
	state, code = "completed", ""
	return nil
}
func (m *Models) Embed(ctx context.Context, course, actor string, p Profile, inputs []string) ([][]float64, error) {
	if len(inputs) == 0 || len(inputs) > p.BatchSize {
		return nil, errors.New("向量批次大小无效")
	}
	n := 0
	for _, s := range inputs {
		n += len(s)
	}
	body := map[string]any{"model": p.Model, "input": inputs, "encoding_format": "float"}
	if p.SendDimensions {
		body["dimensions"] = p.Dimensions
	}
	var out struct {
		Data []struct {
			Index     int       `json:"index"`
			Embedding []float64 `json:"embedding"`
		} `json:"data"`
	}
	if e := m.call(ctx, course, actor, "embedding", p, "/embeddings", body, n, 0, &out); e != nil {
		return nil, e
	}
	if len(out.Data) != len(inputs) {
		return nil, errors.New("向量数量与输入不一致")
	}
	vectors := make([][]float64, len(inputs))
	for _, v := range out.Data {
		if v.Index < 0 || v.Index >= len(inputs) || vectors[v.Index] != nil || len(v.Embedding) != p.Dimensions {
			return nil, errors.New("向量顺序或维度无效")
		}
		norm := 0.
		for _, x := range v.Embedding {
			if math.IsNaN(x) || math.IsInf(x, 0) {
				return nil, errors.New("向量包含非有限数")
			}
			norm += x * x
		}
		if norm == 0 {
			return nil, errors.New("模型返回零向量")
		}
		vectors[v.Index] = v.Embedding
	}
	return vectors, nil
}
func (m *Models) Chat(ctx context.Context, course, actor, purpose, profile, system, input string, jsonOutput bool) (string, error) {
	p, e := m.Profile(profile, "chat")
	if e != nil {
		return "", e
	}
	maxOutput := 2400
	if purpose == "paper_split" {
		maxOutput = 8000
	}
	body := map[string]any{"model": p.Model, "messages": []map[string]string{{"role": "system", "content": system}, {"role": "user", "content": input}}, "max_tokens": maxOutput}
	if p.Thinking != "" {
		body["thinking"] = map[string]string{"type": p.Thinking}
	}
	if jsonOutput {
		body["response_format"] = map[string]string{"type": "json_object"}
	}
	var out struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
			Finish string `json:"finish_reason"`
		} `json:"choices"`
	}
	if e = m.call(ctx, course, actor, purpose, p, "/chat/completions", body, len(input)+len(system), maxOutput, &out); e != nil {
		return "", e
	}
	if len(out.Choices) != 1 || strings.TrimSpace(out.Choices[0].Message.Content) == "" || out.Choices[0].Finish == "length" {
		return "", errors.New("模型响应为空或被截断，请缩小输入后重试")
	}
	return out.Choices[0].Message.Content, nil
}

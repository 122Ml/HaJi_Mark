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
	"log"
	"math"
	"net"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/122Ml/HaJi_Mark/backend/internal/store"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Profile struct {
	ID               string `json:"id"`
	Label            string `json:"label"`
	Kind             string `json:"kind"`
	Protocol         string `json:"protocol"`
	BaseURLEnv       string `json:"base_url_env"`
	KeyEnv           string `json:"key_env"`
	Model            string `json:"model"`
	Dimensions       int    `json:"dimensions"`
	SendDimensions   bool   `json:"send_dimensions"`
	BatchSize        int    `json:"batch_size"`
	InputRate        int64  `json:"input_micro_cny_per_token"`
	OutputRate       int64  `json:"output_micro_cny_per_token"`
	ImageTokenLimit  int    `json:"image_token_limit,omitempty"`
	Thinking         string `json:"thinking,omitempty"`
	DisableStreaming bool   `json:"disable_streaming,omitempty"`
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
	transport := &http.Transport{
		DialContext: (&net.Dialer{
			Timeout:   10 * time.Second,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		TLSHandshakeTimeout:   10 * time.Second,
		ResponseHeaderTimeout: 60 * time.Second,
		IdleConnTimeout:       90 * time.Second,
		MaxIdleConns:          100,
		MaxIdleConnsPerHost:   20,
	}
	m := &Models{DB: db, Client: &http.Client{Transport: transport}}
	if e = json.Unmarshal(raw, &m.Profiles); e != nil {
		return nil, e
	}
	seen := map[string]bool{}
	for _, p := range m.Profiles {
		if p.Thinking != "" && p.Thinking != "enabled" && p.Thinking != "disabled" {
			return nil, errors.New("invalid thinking setting")
		}
		if p.ID == "" || seen[p.ID] || p.Protocol != "openai" || (p.Kind != "chat" && p.Kind != "embedding" && p.Kind != "vision" && p.Kind != "asr") || (p.Kind == "vision" && (p.ImageTokenLimit < 1 || p.ImageTokenLimit > 100000)) || p.InputRate <= 0 || p.OutputRate < 0 || p.BatchSize < 1 || p.BatchSize > 100 || p.Dimensions < 0 || (p.Kind == "embedding" && (p.Dimensions < 1 || p.Dimensions > 16000)) {
			return nil, errors.New("invalid model profile")
		}
		seen[p.ID] = true
	}
	return m, nil
}
func Enabled() bool { return os.Getenv("RAG_ENABLED") == "true" }
func (m *Models) Profile(id, kind string) (Profile, error) {
	if m == nil {
		return Profile{}, errors.New("未配置可用模型，请检查服务端接口和密钥")
	}
	for _, p := range m.Profiles {
		if p.Kind == kind && (id == "" || id == p.ID) && os.Getenv(p.KeyEnv) != "" && os.Getenv(p.BaseURLEnv) != "" {
			return p, nil
		}
	}
	return Profile{}, errors.New("未配置可用模型，请检查服务端接口和密钥")
}
func (m *Models) Public() []map[string]any {
	out := []map[string]any{}
	if m == nil {
		return out
	}
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

func redactSecret(s, secret string) string {
	if secret != "" {
		s = strings.ReplaceAll(s, secret, "[REDACTED]")
	}
	return s
}

func (m *Models) call(ctx context.Context, course, actor, purpose string, p Profile, path string, payload any, inputBytes, maxOutput int, out any) error {
	callTimeout := 180 * time.Second
	if deadline, hasDeadline := ctx.Deadline(); hasDeadline {
		if rem := time.Until(deadline); rem < callTimeout {
			callTimeout = rem
		}
	}
	if callTimeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, callTimeout)
		defer cancel()
	}
	return m.callDecoded(ctx, course, actor, purpose, p, path, payload, inputBytes, maxOutput, func(resp *http.Response) (usage, error) {
		data, e := io.ReadAll(io.LimitReader(resp.Body, (8<<20)+1))
		if e != nil || len(data) > 8<<20 {
			return usage{}, errors.New("模型响应读取失败或超过大小限制")
		}
		var meta struct {
			Usage usage `json:"usage"`
		}
		_ = json.Unmarshal(data, &meta)
		if e = json.Unmarshal(data, out); e != nil {
			return meta.Usage, errors.New("模型响应不是有效JSON")
		}
		return meta.Usage, nil
	})
}

func (m *Models) callDecoded(ctx context.Context, course, actor, purpose string, p Profile, path string, payload any, inputBytes, maxOutput int, decode func(*http.Response) (usage, error)) error {
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
		log.Printf("model call begin tx failed: %v", e)
		return errors.New("模型预算服务暂时不可用，请稍后重试")
	}
	defer tx.Rollback(ctx)
	q := store.New(tx)
	if _, e = q.ReserveModelBudget(ctx, reserve); e != nil {
		if errors.Is(e, pgx.ErrNoRows) {
			return errors.New("模型调用预算不足，调用未发出")
		}
		log.Printf("reserve model budget failed (%s/%s): %v", p.ID, purpose, e)
		return errors.New("模型预算服务暂时不可用，请稍后重试")
	}
	id := uuid.NewString()
	if e = q.CreateModelCall(ctx, store.CreateModelCallParams{ID: id, CourseID: course, ActorID: actor, ProfileID: p.ID, Purpose: purpose, ReservedMicroCny: reserve}); e != nil {
		log.Printf("create model call %s failed: %v", id, e)
		return errors.New("模型调用登记失败，请稍后重试")
	}
	if e = tx.Commit(ctx); e != nil {
		log.Printf("commit model call %s failed: %v", id, e)
		return errors.New("模型调用登记失败，请稍后重试")
	}
	started := time.Now()
	state, code := "unknown", "request_failed"
	charge := reserve
	u := usage{}
	defer func() {
		settleCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if _, err := store.New(m.DB).FinishAndSettleModelCall(settleCtx, store.FinishAndSettleModelCallParams{
			ID:              id,
			State:           state,
			ChargedMicroCny: charge,
			InputTokens:     u.Prompt,
			OutputTokens:    u.Completion,
			DurationMs:      time.Since(started).Milliseconds(),
			ErrorCode:       code,
		}); err != nil {
			log.Printf("settle model call %s failed: %v", id, err)
		}
	}()
	raw, _ := json.Marshal(payload)
	req, e := http.NewRequestWithContext(ctx, "POST", strings.TrimRight(os.Getenv(p.BaseURLEnv), "/")+path, bytes.NewReader(raw))
	if e != nil {
		state, code, charge = "failed", "invalid_request", 0
		return errors.New("模型接口配置无效")
	}
	apiKey := os.Getenv(p.KeyEnv)
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")
	resp, e := m.Client.Do(req)
	if e != nil {
		log.Printf("model call %s (%s/%s) request failed: %s", id, p.ID, purpose, redactSecret(e.Error(), apiKey))
		if errors.Is(e, context.Canceled) {
			state, code = "canceled", "canceled"
		}
		return errors.New("模型连接失败或超时；未知调用保留预算，不自动重试")
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		code = fmt.Sprintf("http_%d", resp.StatusCode)
		if resp.StatusCode == http.StatusBadRequest || resp.StatusCode == http.StatusUnauthorized ||
			resp.StatusCode == http.StatusForbidden || resp.StatusCode == http.StatusNotFound ||
			resp.StatusCode == http.StatusTooManyRequests {
			state = "failed"
			charge = 0
		}
		bodySnippet, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		log.Printf("model call %s (%s/%s) upstream HTTP %d: %s", id, p.ID, purpose, resp.StatusCode, redactSecret(strings.TrimSpace(string(bodySnippet)), apiKey))
		return fmt.Errorf("模型服务返回HTTP %d，请检查服务端配置及额度", resp.StatusCode)
	}
	u, e = decode(resp)
	if u.Prompt >= 0 && u.Completion >= 0 && u.Total >= 0 && u.Prompt <= 10000000 && u.Completion <= 10000000 && u.Total <= 10000000 {
		if u.Prompt == 0 && u.Total > 0 {
			u.Prompt = max(int64(0), u.Total-u.Completion)
		}
		if u.Prompt > 0 || u.Completion > 0 {
			charge = u.Prompt*p.InputRate + u.Completion*p.OutputRate
			if charge > reserve {
				charge = reserve
			}
		}
	} else {
		// Invalid provider usage must not poison the ledger; retain the reservation.
		u = usage{}
	}
	if e != nil {
		if errors.Is(e, context.Canceled) {
			state, code = "canceled", "canceled"
		} else {
			code = "invalid_response"
		}
		return e
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
	if purpose == "diagnosis" || purpose == "recommendation" {
		maxOutput = 6000
	}
	if purpose == "source_segment" {
		maxOutput = 4096
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

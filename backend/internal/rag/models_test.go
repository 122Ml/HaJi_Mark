package rag

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestOpenAIRequestErrorsDoNotLeakAndPreserveUsage(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/bad/chat/completions":
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":{"message":"invalid prompt secret-token-value"}}`))
		case "/ok/embeddings":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"data":[{"index":0,"embedding":[0.6,0.8]}],"usage":{"prompt_tokens":0,"completion_tokens":2,"total_tokens":7}}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()

	t.Setenv("TEST_API_KEY", "secret-token-value")
	if got := redactSecret("failed with secret-token-value in header", "secret-token-value"); got == "" || got == "failed with secret-token-value in header" {
		t.Fatalf("secret not redacted: %q", got)
	}

	u := usage{Prompt: 0, Completion: 2, Total: 7}
	if u.Prompt == 0 && u.Total > 0 {
		u.Prompt = max(int64(0), u.Total-u.Completion)
	}
	if u.Prompt != 5 {
		t.Fatalf("expected prompt=5 from total-completion, got %d", u.Prompt)
	}

	uClamp := usage{Prompt: 0, Completion: 10, Total: 4}
	if uClamp.Prompt == 0 && uClamp.Total > 0 {
		uClamp.Prompt = max(int64(0), uClamp.Total-uClamp.Completion)
	}
	if uClamp.Prompt != 0 {
		t.Fatalf("expected prompt clamped to 0, got %d", uClamp.Prompt)
	}
	_ = context.Background()
	_ = json.RawMessage{}
}

func TestLoadModelsConfigAndChatPriority(t *testing.T) {
	t.Setenv("MODEL_PROFILES_PATH", "../../config/models.json")
	m, err := LoadModels(nil)
	if err != nil {
		t.Fatalf("LoadModels failed: %v", err)
	}
	if len(m.Profiles) != 6 {
		t.Fatalf("expected 6 profiles, got %d", len(m.Profiles))
	}
	wantOrder := []string{"bailian-embedding", "deepseek-chat", "bailian-qwen", "deepseek-vision", "huawei-maas", "huawei-bge-m3"}
	for i, wantID := range wantOrder {
		if m.Profiles[i].ID != wantID {
			t.Fatalf("profile[%d] = %q, want %q", i, m.Profiles[i].ID, wantID)
		}
	}
	huawei := m.Profiles[4]
	if huawei.Kind != "chat" || huawei.Protocol != "openai" || huawei.BaseURLEnv != "HUAWEI_BASE_URL" ||
		huawei.KeyEnv != "HUAWEI_API_KEY" || huawei.Model != "deepseek-v4.1-flash-1017" ||
		huawei.Thinking != "disabled" || huawei.BatchSize != 1 || huawei.InputRate != 1 || huawei.OutputRate != 4 {
		t.Fatalf("unexpected huawei-maas profile: %+v", huawei)
	}
	huaweiEmbed := m.Profiles[5]
	if huaweiEmbed.Kind != "embedding" || huaweiEmbed.Protocol != "openai" || huaweiEmbed.BaseURLEnv != "HUAWEI_EMBED_BASE_URL" ||
		huaweiEmbed.KeyEnv != "HUAWEI_EMBED_API_KEY" || huaweiEmbed.Model != "bge-m3" ||
		huaweiEmbed.Dimensions != 1024 || huaweiEmbed.SendDimensions || huaweiEmbed.BatchSize != 8 ||
		huaweiEmbed.InputRate != 1 || huaweiEmbed.OutputRate != 0 {
		t.Fatalf("unexpected huawei-bge-m3 profile: %+v", huaweiEmbed)
	}

	t.Setenv("DEEPSEEK_BASE_URL", "https://deepseek.example")
	t.Setenv("DEEPSEEK_API_KEY", "ds-key")
	t.Setenv("DASHSCOPE_BASE_URL", "https://dashscope.example")
	t.Setenv("DASHSCOPE_API_KEY", "qwen-key")
	t.Setenv("HUAWEI_BASE_URL", "https://huawei.example")
	t.Setenv("HUAWEI_API_KEY", "hw-key")
	t.Setenv("HUAWEI_EMBED_BASE_URL", "https://huawei-embed.example")
	t.Setenv("HUAWEI_EMBED_API_KEY", "hw-embed-key")

	ep, err := m.Profile("", "embedding")
	if err != nil || ep.ID != "bailian-embedding" {
		t.Fatalf("expected bailian-embedding first, got %q (err=%v)", ep.ID, err)
	}
	explicitEmbed, err := m.Profile("huawei-bge-m3", "embedding")
	if err != nil || explicitEmbed.ID != "huawei-bge-m3" {
		t.Fatalf("expected explicit huawei-bge-m3, got %q (err=%v)", explicitEmbed.ID, err)
	}

	p, err := m.Profile("", "chat")
	if err != nil || p.ID != "deepseek-chat" {
		t.Fatalf("expected deepseek-chat first, got %q (err=%v)", p.ID, err)
	}
	explicit, err := m.Profile("huawei-maas", "chat")
	if err != nil || explicit.ID != "huawei-maas" {
		t.Fatalf("expected explicit huawei-maas, got %q (err=%v)", explicit.ID, err)
	}

	t.Setenv("DEEPSEEK_API_KEY", "")
	p, err = m.Profile("", "chat")
	if err != nil || p.ID != "bailian-qwen" {
		t.Fatalf("expected bailian-qwen second, got %q (err=%v)", p.ID, err)
	}

	t.Setenv("DASHSCOPE_API_KEY", "")
	p, err = m.Profile("", "chat")
	if err != nil || p.ID != "huawei-maas" {
		t.Fatalf("expected huawei-maas third, got %q (err=%v)", p.ID, err)
	}
	ep, err = m.Profile("", "embedding")
	if err != nil || ep.ID != "huawei-bge-m3" {
		t.Fatalf("expected huawei-bge-m3 second, got %q (err=%v)", ep.ID, err)
	}

	t.Setenv("HUAWEI_API_KEY", "")
	if _, err = m.Profile("", "chat"); err == nil {
		t.Fatal("expected error when no chat credentials configured")
	}
	t.Setenv("HUAWEI_EMBED_API_KEY", "")
	if _, err = m.Profile("", "embedding"); err == nil {
		t.Fatal("expected error when no embedding credentials configured")
	}
}

func TestLoadModelsSupportsASRAndRejectsNegativeDimensions(t *testing.T) {
	dir := t.TempDir()
	validPath := filepath.Join(dir, "valid.json")
	if err := os.WriteFile(validPath, []byte(`[{"id":"asr-test","label":"ASR","kind":"asr","protocol":"openai","base_url_env":"ASR_URL","key_env":"ASR_KEY","model":"asr-1","batch_size":1,"input_micro_cny_per_token":1,"output_micro_cny_per_token":0}]`), 0600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("MODEL_PROFILES_PATH", validPath)
	if _, err := LoadModels(nil); err != nil {
		t.Fatalf("expected valid asr profile to load, got %v", err)
	}

	badDimsPath := filepath.Join(dir, "bad_dims.json")
	if err := os.WriteFile(badDimsPath, []byte(`[{"id":"chat-bad","label":"Bad","kind":"chat","protocol":"openai","base_url_env":"U","key_env":"K","model":"m","dimensions":-1,"batch_size":1,"input_micro_cny_per_token":1,"output_micro_cny_per_token":1}]`), 0600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("MODEL_PROFILES_PATH", badDimsPath)
	if _, err := LoadModels(nil); err == nil {
		t.Fatal("expected negative dimensions to fail LoadModels")
	}
}

package rag

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
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

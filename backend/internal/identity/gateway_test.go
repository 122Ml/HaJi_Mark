package identity

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func TestGatewayPathTraversalAndAgentBypassBlocked(t *testing.T) {
	called := false
	gw := Gateway{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		if r.Method == http.MethodGet && r.Header.Get("Content-Type") != "" {
			t.Errorf("unexpected Content-Type on empty contentType: %q", r.Header.Get("Content-Type"))
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	})}

	blocked := []string{
		"",
		"/api/v1/me",
		"/api/v1/learning/courses/c1/agent/conversations",
		"/api/v1/learning/courses/c1/%61gent/conversations",
		"/api/v1/learning/courses/c1/../other",
		"/api/v1/learning/courses/c1/%2e%2e/other",
		"/api/v1/learning/courses/c1/%2E%2E/other",
		"/api/v1/learning/courses/c1/foo%2f..%2fagent",
		"/api/v1/learning/courses/c1//resources",
		"/api/v1/learning/courses/c1\\resources",
		"/api/v1/learning/courses/c1/%252e%252e/agent",
		"/api/v1/learning/courses/c1/foo%23bar",
		"/api/v1/learning/courses/c1/foo%3fbar=1",
		"http://evil.example/api/v1/learning/courses/c1/resources",
		"/api/v1/learning/courses/c1/resources\r\nX-Injected: 1",
		"/api/v1/learning/courses/c1/resources#frag",
	}
	for _, p := range blocked {
		called = false
		if _, err := gw.Invoke(context.Background(), "hash", http.MethodGet, p, "", nil); err == nil {
			t.Errorf("expected path %q to be rejected", p)
		}
		if called {
			t.Errorf("handler should not have been invoked for rejected path %q", p)
		}
	}

	if _, err := gw.Invoke(context.Background(), "hash", http.MethodTrace, "/api/v1/learning/courses/c1/resources", "", nil); err == nil {
		t.Fatal("unsupported HTTP method TRACE was allowed")
	}

	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/", nil)
	if ref := SessionReference(c); ref != "" {
		t.Fatalf("missing cookie must return empty reference, got %q", ref)
	}

	called = false
	res, err := gw.Invoke(context.Background(), "hash", http.MethodGet, "/api/v1/learning/courses/c1/resources?limit=10", "", nil)
	if err != nil {
		t.Fatalf("valid path failed: %v", err)
	}
	if !called || res.Status != http.StatusOK {
		t.Fatalf("unexpected response: called=%v status=%d", called, res.Status)
	}
}

func TestLoginLimiterEvictsInsteadOfGlobalDoS(t *testing.T) {
	l := newRateLimiter(30, time.Minute, 16)
	now := time.Now()
	for i := 0; i < 32; i++ {
		if !l.allow(fmt.Sprintf("attacker-%d", i), now.Add(time.Duration(i)*time.Millisecond)) {
			t.Fatalf("flood key %d unexpectedly rejected", i)
		}
	}
	if !l.allow("legitimate-user", now.Add(50*time.Millisecond)) {
		t.Fatal("legitimate user was DoS-blocked when limiter map reached capacity")
	}
}

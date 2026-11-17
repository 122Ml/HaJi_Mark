package identity

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// A reference is not an HTTP credential. Only this package can attach one to an
// in-process request. RequireSession still checks the live database session.
type sessionReferenceKey struct{}
type sessionReference struct{ hash string }

func SessionReference(c *gin.Context) string {
	if ref, ok := c.Request.Context().Value(sessionReferenceKey{}).(sessionReference); ok {
		return ref.hash
	}
	raw, _ := c.Cookie(CookieName)
	return hashToken(raw)
}

type Gateway struct{ Handler http.Handler }
type BusinessResponse struct {
	Status int
	Body   []byte
}
type boundedResponse struct {
	header   http.Header
	code     int
	data     bytes.Buffer
	overflow bool
}

func (w *boundedResponse) Header() http.Header { return w.header }
func (w *boundedResponse) WriteHeader(code int) {
	if w.code == 0 {
		w.code = code
	}
}
func (w *boundedResponse) Write(b []byte) (int, error) {
	if w.code == 0 {
		w.code = 200
	}
	if w.data.Len()+len(b) > 2<<20 {
		w.overflow = true
		return 0, errors.New("business result too large")
	}
	return w.data.Write(b)
}

// Invoke uses the mounted business routes, including session, course, role,
// ownership and transaction checks. It never replays cookies or adds an admin.
func (g Gateway) Invoke(ctx context.Context, sessionHash, method, path, contentType string, body io.Reader) (BusinessResponse, error) {
	if !strings.HasPrefix(path, "/api/v1/learning/courses/") || strings.Contains(path, "/agent/") || strings.ContainsAny(path, "\r\n") {
		return BusinessResponse{}, errors.New("工具目标不允许")
	}
	ctx = context.WithValue(ctx, sessionReferenceKey{}, sessionReference{hash: sessionHash})
	req, err := http.NewRequestWithContext(ctx, method, path, body)
	if err != nil {
		return BusinessResponse{}, err
	}
	req.Header.Set("Content-Type", contentType)
	w := &boundedResponse{header: make(http.Header)}
	g.Handler.ServeHTTP(w, req)
	if w.overflow {
		return BusinessResponse{}, errors.New("结果过大，请缩小查询范围")
	}
	return BusinessResponse{Status: w.code, Body: w.data.Bytes()}, nil
}

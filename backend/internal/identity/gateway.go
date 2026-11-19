package identity

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"net/url"
	stdpath "path"
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

func validateGatewayPath(raw string) (string, error) {
	if raw == "" || strings.ContainsAny(raw, "\r\n\x00\\") {
		return "", errors.New("工具目标不允许")
	}
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "" || u.Host != "" || u.User != nil || u.Fragment != "" {
		return "", errors.New("工具目标不允许")
	}
	rawPathPart := u.EscapedPath()
	lowerEscaped := strings.ToLower(rawPathPart)
	if strings.Contains(lowerEscaped, "..") || strings.Contains(lowerEscaped, "//") ||
		strings.Contains(lowerEscaped, "%2e") || strings.Contains(lowerEscaped, "%2f") ||
		strings.Contains(lowerEscaped, "%5c") || strings.Contains(lowerEscaped, "%00") {
		return "", errors.New("工具目标不允许")
	}
	cleaned := stdpath.Clean(u.Path)
	if !strings.HasPrefix(cleaned, "/api/v1/learning/courses/") {
		return "", errors.New("工具目标不允许")
	}
	for _, seg := range strings.Split(cleaned, "/") {
		if seg == "agent" || seg == ".." || seg == "." {
			return "", errors.New("工具目标不允许")
		}
	}
	if u.RawQuery != "" {
		return cleaned + "?" + u.RawQuery, nil
	}
	return cleaned, nil
}

// Invoke uses the mounted business routes, including session, course, role,
// ownership and transaction checks. It never replays cookies or adds an admin.
func (g Gateway) Invoke(ctx context.Context, sessionHash, method, path, contentType string, body io.Reader) (BusinessResponse, error) {
	safePath, err := validateGatewayPath(path)
	if err != nil {
		return BusinessResponse{}, err
	}
	ctx = context.WithValue(ctx, sessionReferenceKey{}, sessionReference{hash: sessionHash})
	req, err := http.NewRequestWithContext(ctx, method, safePath, body)
	if err != nil {
		return BusinessResponse{}, err
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	w := &boundedResponse{header: make(http.Header)}
	g.Handler.ServeHTTP(w, req)
	if w.overflow {
		return BusinessResponse{}, errors.New("结果过大，请缩小查询范围")
	}
	return BusinessResponse{Status: w.code, Body: w.data.Bytes()}, nil
}

package server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestUnavailableDependenciesDoNotReportReady(t *testing.T) {
	router := New(nil, nil)
	for _, tc := range []struct {
		path   string
		status int
		body   string
	}{
		{"/api/v1/health/live", http.StatusOK, `"status":"ok"`},
		{"/api/v1/health/ready", http.StatusServiceUnavailable, `"database":false`},
		{"/api/v1/courses", http.StatusServiceUnavailable, "service_unavailable"},
		{"/api/v1/grading/jobs", http.StatusNotFound, "404"},
	} {
		w := httptest.NewRecorder()
		router.ServeHTTP(w, httptest.NewRequest(http.MethodGet, tc.path, nil))
		if w.Code != tc.status || !strings.Contains(w.Body.String(), tc.body) {
			t.Errorf("%s: status=%d body=%s", tc.path, w.Code, w.Body.String())
		}
	}
}

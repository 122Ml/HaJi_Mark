package identity

import (
	"sync"
	"time"
)

type loginWindow struct {
	count   int
	expires time.Time
}
type loginLimiter struct {
	mu      sync.Mutex
	windows map[string]loginWindow
}

func newLoginLimiter() *loginLimiter { return &loginLimiter{windows: map[string]loginWindow{}} }
func (l *loginLimiter) allow(key string, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	for k, w := range l.windows {
		if !now.Before(w.expires) {
			delete(l.windows, k)
		}
	}
	w, ok := l.windows[key]
	if !ok {
		if len(l.windows) >= 10000 {
			return false
		}
		w = loginWindow{expires: now.Add(time.Minute)}
	}
	if w.count >= 30 {
		return false
	}
	w.count++
	l.windows[key] = w
	return true
}

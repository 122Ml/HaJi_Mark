package identity

import (
	"math"
	"sync"
	"time"
)

type loginWindow struct {
	count   int
	expires time.Time
}
type loginLimiter struct {
	mu      sync.Mutex
	limit   int
	window  time.Duration
	maxKeys int
	windows map[string]loginWindow
}

func newLoginLimiter() *loginLimiter {
	return newRateLimiter(30, time.Minute, 10000)
}

func newRateLimiter(limit int, window time.Duration, maxKeys int) *loginLimiter {
	return &loginLimiter{
		limit:   limit,
		window:  window,
		maxKeys: maxKeys,
		windows: map[string]loginWindow{},
	}
}

func (l *loginLimiter) allow(key string, now time.Time) bool {
	ok, _ := l.allowWithRetry(key, now)
	return ok
}

func (l *loginLimiter) allowWithRetry(key string, now time.Time) (bool, int) {
	l.mu.Lock()
	defer l.mu.Unlock()
	for k, w := range l.windows {
		if !now.Before(w.expires) {
			delete(l.windows, k)
		}
	}
	w, ok := l.windows[key]
	if !ok {
		if len(l.windows) >= l.maxKeys {
			// Evict earliest-expiring entry so random-key floods cannot lock out legitimate users.
			var oldestKey string
			var oldestExp time.Time
			for k, candidate := range l.windows {
				if oldestKey == "" || candidate.expires.Before(oldestExp) {
					oldestKey = k
					oldestExp = candidate.expires
				}
			}
			if oldestKey != "" {
				delete(l.windows, oldestKey)
			}
		}
		w = loginWindow{expires: now.Add(l.window)}
	}
	if w.count >= l.limit {
		retry := int(math.Ceil(w.expires.Sub(now).Seconds()))
		if retry < 1 {
			retry = 1
		}
		return false, retry
	}
	w.count++
	l.windows[key] = w
	return true, 0
}

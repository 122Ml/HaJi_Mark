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
	mu          sync.Mutex
	limit       int
	window      time.Duration
	maxKeys     int
	lastSweep   time.Time
	windows     map[string]loginWindow
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

func (l *loginLimiter) sweepExpiredLocked(now time.Time) {
	if now.Sub(l.lastSweep) < l.window/4 {
		return
	}
	l.lastSweep = now
	for k, w := range l.windows {
		if !now.Before(w.expires) {
			delete(l.windows, k)
		}
	}
}

func (l *loginLimiter) allow(key string, now time.Time) bool {
	ok, _ := l.allowWithRetry(key, now)
	return ok
}

func (l *loginLimiter) allowWithRetry(key string, now time.Time) (bool, int) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.sweepExpiredLocked(now)
	w, ok := l.windows[key]
	if ok && !now.Before(w.expires) {
		delete(l.windows, key)
		ok = false
	}
	if !ok {
		if len(l.windows) >= l.maxKeys {
			// Bounded sample eviction keeps lock contention O(1) while shedding flood keys.
			var oldestKey string
			var oldestExp time.Time
			seen := 0
			for k, candidate := range l.windows {
				if oldestKey == "" || candidate.expires.Before(oldestExp) {
					oldestKey = k
					oldestExp = candidate.expires
				}
				seen++
				if seen >= 64 {
					break
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

// Check returns whether the key is currently below the failure limit without incrementing.
func (l *loginLimiter) checkWithRetry(key string, now time.Time) (bool, int) {
	l.mu.Lock()
	defer l.mu.Unlock()
	w, ok := l.windows[key]
	if !ok || !now.Before(w.expires) {
		if ok {
			delete(l.windows, key)
		}
		return true, 0
	}
	if w.count >= l.limit {
		retry := int(math.Ceil(w.expires.Sub(now).Seconds()))
		if retry < 1 {
			retry = 1
		}
		return false, retry
	}
	return true, 0
}

func (l *loginLimiter) reset(key string) {
	l.mu.Lock()
	delete(l.windows, key)
	l.mu.Unlock()
}

package identity

import (
	"testing"
	"time"
)

func TestLoginLimitExpiresAndSeparatesClients(t *testing.T) {
	l := newLoginLimiter()
	now := time.Now()
	for i := 0; i < 30; i++ {
		if !l.allow("a", now) {
			t.Fatalf("request %d rejected too soon", i)
		}
	}
	if l.allow("a", now) {
		t.Fatal("unbounded login attempts")
	}
	if !l.allow("b", now) {
		t.Fatal("unrelated client blocked")
	}
	if !l.allow("a", now.Add(time.Minute)) {
		t.Fatal("window did not expire")
	}
	if ok, retry := l.checkWithRetry("c", now); !ok || retry != 0 {
		t.Fatalf("fresh key check failed: ok=%v retry=%d", ok, retry)
	}
	for i := 0; i < 30; i++ {
		l.allow("c", now)
	}
	if ok, retry := l.checkWithRetry("c", now); ok || retry < 1 {
		t.Fatalf("exhausted key check expected false+retry>0, got ok=%v retry=%d", ok, retry)
	}
	l.reset("c")
	if ok, _ := l.checkWithRetry("c", now); !ok {
		t.Fatal("reset key should be allowed again")
	}
}

func TestLoginLimiterSweepCooldownAtCapacity(t *testing.T) {
	l := newRateLimiter(30, time.Minute, 3)
	now := time.Now()
	l.allow("k1", now)
	l.allow("k2", now)
	l.allow("k3", now)
	prevSweep := l.lastSweep
	// Within window/4 cooldown, hitting maxKeys must evict in O(1) without re-sweeping.
	l.allow("k4", now.Add(5*time.Second))
	if !l.lastSweep.Equal(prevSweep) {
		t.Fatalf("expected sweep cooldown to hold at capacity: prev=%v got=%v", prevSweep, l.lastSweep)
	}
	if len(l.windows) != 3 {
		t.Fatalf("expected bounded map size 3, got %d", len(l.windows))
	}
	// After window/4 elapses, sweep runs again and expires old keys.
	l.allow("k5", now.Add(65*time.Second))
	if len(l.windows) != 1 {
		t.Fatalf("expected expired keys swept after cooldown, got %d", len(l.windows))
	}
}

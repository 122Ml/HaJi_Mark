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

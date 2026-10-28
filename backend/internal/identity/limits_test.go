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
}

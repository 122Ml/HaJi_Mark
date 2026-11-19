package platform

import (
	"testing"
)

func TestValidateTrustedProxies(t *testing.T) {
	got, err := ValidateTrustedProxies("")
	if err != nil || len(got) != 0 {
		t.Fatalf("empty proxies unexpected: got=%v err=%v", got, err)
	}
	got, err = ValidateTrustedProxies("127.0.0.1, 10.0.0.0/8, ::1 , 172.16.0.0/12")
	if err != nil || len(got) != 4 {
		t.Fatalf("valid proxies failed: got=%v err=%v", got, err)
	}
	for _, bad := range []string{"not-an-ip", "127.0.0.1,999.999.999.999", "10.0.0.0/99"} {
		if _, err := ValidateTrustedProxies(bad); err == nil {
			t.Errorf("invalid proxy %q was accepted", bad)
		}
	}
}

func TestLoadConfigStrict(t *testing.T) {
	t.Setenv("PUBLIC_ORIGIN", " https://Example.COM/// ")
	t.Setenv("SESSION_COOKIE_SECURE", "")
	t.Setenv("WORKER_CONCURRENCY", "6")
	t.Setenv("TRUSTED_PROXIES", "172.18.0.0/16")

	cfg, err := LoadConfigStrict()
	if err != nil {
		t.Fatalf("valid strict config failed: %v", err)
	}
	if cfg.PublicOrigin != "https://Example.COM" || !cfg.SecureSessionCookie || cfg.WorkerConcurrency != 6 || len(cfg.TrustedProxies) != 1 {
		t.Fatalf("unexpected parsed config: %+v", cfg)
	}

	t.Setenv("SESSION_COOKIE_SECURE", "not-a-bool")
	cfg, err = LoadConfigStrict()
	if err != nil || !cfg.SecureSessionCookie {
		t.Fatalf("invalid bool should fail closed to true: cfg=%+v err=%v", cfg, err)
	}

	t.Setenv("TRUSTED_PROXIES", "invalid-cidr")
	if _, err := LoadConfigStrict(); err == nil {
		t.Fatal("invalid TRUSTED_PROXIES must return error")
	}
}

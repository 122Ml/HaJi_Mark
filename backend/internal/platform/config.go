package platform

import (
	"fmt"
	"log/slog"
	"net/netip"
	"os"
	"strconv"
	"strings"
)

type Config struct {
	HTTPAddr, DatabaseURL, RedisAddr string
	PublicOrigin                     string
	SecureSessionCookie              bool
	WorkerConcurrency                int
	TrustedProxies                   []string
}

func ValidateTrustedProxies(raw string) ([]string, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil, nil
	}
	var proxies []string
	for _, part := range strings.Split(trimmed, ",") {
		p := strings.TrimSpace(part)
		if p == "" {
			continue
		}
		if _, err := netip.ParsePrefix(p); err == nil {
			proxies = append(proxies, p)
			continue
		}
		if _, err := netip.ParseAddr(p); err == nil {
			proxies = append(proxies, p)
			continue
		}
		return nil, fmt.Errorf("invalid TRUSTED_PROXIES entry %q", p)
	}
	return proxies, nil
}

func LoadConfig() Config {
	cfg, err := LoadConfigStrict()
	if err != nil {
		slog.Warn("platform config warning", "error", err)
	}
	return cfg
}

func LoadConfigStrict() (Config, error) {
	publicOrigin := strings.TrimRight(strings.TrimSpace(os.Getenv("PUBLIC_ORIGIN")), "/")
	secureCookie := strings.HasPrefix(strings.ToLower(publicOrigin), "https://")
	if raw := strings.TrimSpace(os.Getenv("SESSION_COOKIE_SECURE")); raw != "" {
		if parsed, err := strconv.ParseBool(raw); err == nil {
			secureCookie = parsed
		} else {
			secureCookie = true // fail closed on invalid boolean values
		}
	}
	concurrency := 4
	if raw := strings.TrimSpace(os.Getenv("WORKER_CONCURRENCY")); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n >= 1 && n <= 64 {
			concurrency = n
		}
	}
	proxies, err := ValidateTrustedProxies(os.Getenv("TRUSTED_PROXIES"))
	if err != nil {
		return Config{}, err
	}
	if publicOrigin != "" && len(proxies) == 0 {
		slog.Warn("PUBLIC_ORIGIN is set without TRUSTED_PROXIES; client IP rate limiting may collapse to proxy IP")
	}
	return Config{
		HTTPAddr:            value("HTTP_ADDR", ":8080"),
		DatabaseURL:         os.Getenv("DATABASE_URL"),
		RedisAddr:           value("REDIS_ADDR", "redis:6379"),
		PublicOrigin:        publicOrigin,
		SecureSessionCookie: secureCookie,
		WorkerConcurrency:   concurrency,
		TrustedProxies:      proxies,
	}, nil
}

func value(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

package platform

import (
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

func LoadConfig() Config {
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
	var proxies []string
	if raw := strings.TrimSpace(os.Getenv("TRUSTED_PROXIES")); raw != "" {
		for _, part := range strings.Split(raw, ",") {
			if p := strings.TrimSpace(part); p != "" {
				proxies = append(proxies, p)
			}
		}
	}
	return Config{
		HTTPAddr:            value("HTTP_ADDR", ":8080"),
		DatabaseURL:         os.Getenv("DATABASE_URL"),
		RedisAddr:           value("REDIS_ADDR", "redis:6379"),
		PublicOrigin:        publicOrigin,
		SecureSessionCookie: secureCookie,
		WorkerConcurrency:   concurrency,
		TrustedProxies:      proxies,
	}
}

func value(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

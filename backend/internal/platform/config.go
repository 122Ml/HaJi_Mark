package platform

import "os"

type Config struct{ HTTPAddr, DatabaseURL, RedisAddr string }

func LoadConfig() Config {
	return Config{
		HTTPAddr:    value("HTTP_ADDR", ":8080"),
		DatabaseURL: os.Getenv("DATABASE_URL"),
		RedisAddr:   value("REDIS_ADDR", "redis:6379"),
	}
}

func value(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

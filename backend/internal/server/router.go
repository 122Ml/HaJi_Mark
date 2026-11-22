package server

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"log/slog"
	"net/http"
	"os"
	"regexp"
	"sync"
	"time"

	"github.com/122Ml/HaJi_Mark/backend/internal/agent"
	"github.com/122Ml/HaJi_Mark/backend/internal/course"
	"github.com/122Ml/HaJi_Mark/backend/internal/identity"
	"github.com/122Ml/HaJi_Mark/backend/internal/learning"
	"github.com/122Ml/HaJi_Mark/backend/internal/platform"
	"github.com/122Ml/HaJi_Mark/backend/internal/rag"
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

func New(db *pgxpool.Pool, cache *redis.Client, secureCookie bool) *gin.Engine {
	return NewWithContext(nil, db, cache, secureCookie)
}

func NewWithContext(ctx context.Context, db *pgxpool.Pool, cache *redis.Client, secureCookie bool) *gin.Engine {
	cfg := platform.LoadConfig()
	cfg.SecureSessionCookie = secureCookie
	r, _ := NewApp(ctx, db, cache, cfg)
	return r
}

var validRequestIDPattern = regexp.MustCompile(`^[A-Za-z0-9._-]{1,64}$`)

func requestID() string {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		return ""
	}
	return hex.EncodeToString(b[:])
}

func NewApp(ctx context.Context, db *pgxpool.Pool, cache *redis.Client, cfg platform.Config) (*gin.Engine, func(context.Context)) {
	r := gin.New()
	if err := r.SetTrustedProxies(cfg.TrustedProxies); err != nil {
		slog.Error("set trusted proxies failed", "error", err)
	}
	r.Use(gin.Recovery(), func(c *gin.Context) {
		start := time.Now()
		rid := c.GetHeader("X-Request-ID")
		if !validRequestIDPattern.MatchString(rid) {
			rid = requestID()
		}
		if rid != "" {
			c.Header("X-Request-ID", rid)
		}
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("X-Frame-Options", "DENY")
		c.Header("Referrer-Policy", "same-origin")
		c.Header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
		c.Next()
		path := c.FullPath()
		status := c.Writer.Status()
		if (path == "/api/v1/health/live" || path == "/api/v1/health/ready") && status == http.StatusOK {
			return
		}
		slog.Info("http_request",
			"request_id", rid,
			"method", c.Request.Method,
			"path", path,
			"status", status,
			"latency_ms", time.Since(start).Milliseconds(),
		)
	})
	var modelsErr error
	var models *rag.Models
	if rag.Enabled() && db != nil {
		loaded, err := rag.LoadModels(db)
		if err != nil {
			modelsErr = err
			slog.Error("load model profiles failed", "error", err)
		} else {
			models = loaded
		}
	}
	r.GET("/api/v1/health/live", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})
	r.GET("/api/v1/health/ready", func(c *gin.Context) {
		pingCtx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
		defer cancel()
		databaseOK := db != nil && db.Ping(pingCtx) == nil
		redisOK := cache != nil && cache.Ping(pingCtx).Err() == nil
		modelsOK := modelsErr == nil
		status := http.StatusOK
		if !databaseOK || !redisOK || !modelsOK {
			status = http.StatusServiceUnavailable
		}
		c.JSON(status, gin.H{"database": databaseOK, "redis": redisOK, "models": modelsOK})
	})
	course.Register(r.Group("/api/v1"), db)
	auth := identity.NewWithOrigin(db, cfg.SecureSessionCookie, cfg.PublicOrigin)
	auth.Register(r.Group("/api/v1"))
	auth.RegisterContext(r.Group("/api/v1"))
	learningCloser := learning.RegisterWithModels(r.Group("/api/v1"), db, auth, models)
	var agentModels *rag.Models
	if os.Getenv("AGENT_ENABLED") == "true" {
		agentModels = models
	}
	harness := agent.New(db, agentModels, identity.Gateway{Handler: r})
	harness.Register(r.Group("/api/v1"), auth)
	var bg sync.WaitGroup
	if ctx != nil && db != nil {
		bg.Add(1)
		go func() {
			defer bg.Done()
			auth.StartReaper(ctx)
		}()
	}
	if ctx != nil && agentModels != nil {
		if _, err := agentModels.Profile("", "chat"); err == nil {
			bg.Add(1)
			go func() {
				defer bg.Done()
				harness.Serve(ctx)
			}()
		}
	}
	waitBg := func(waitCtx context.Context) {
		done := make(chan struct{})
		go func() {
			bg.Wait()
			close(done)
		}()
		select {
		case <-done:
		case <-waitCtx.Done():
		}
		if learningCloser != nil {
			learningCloser()
		}
	}
	return r, waitBg
}

package server

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"log"
	"net/http"
	"os"
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
		log.Printf("set trusted proxies: %v", err)
	}
	r.Use(gin.Logger(), gin.Recovery(), func(c *gin.Context) {
		rid := c.GetHeader("X-Request-ID")
		if rid == "" || len(rid) > 64 {
			rid = requestID()
		}
		if rid != "" {
			c.Header("X-Request-ID", rid)
		}
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("X-Frame-Options", "DENY")
		c.Header("Referrer-Policy", "same-origin")
		c.Next()
	})
	r.GET("/api/v1/health/live", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})
	r.GET("/api/v1/health/ready", func(c *gin.Context) {
		pingCtx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
		defer cancel()
		databaseOK := db != nil && db.Ping(pingCtx) == nil
		redisOK := cache != nil && cache.Ping(pingCtx).Err() == nil
		status := http.StatusOK
		if !databaseOK || !redisOK {
			status = http.StatusServiceUnavailable
		}
		c.JSON(status, gin.H{"database": databaseOK, "redis": redisOK})
	})
	course.Register(r.Group("/api/v1"), db)
	auth := identity.New(db, cfg.SecureSessionCookie)
	auth.Register(r.Group("/api/v1"))
	auth.RegisterContext(r.Group("/api/v1"))
	var models *rag.Models
	if rag.Enabled() && db != nil {
		loaded, err := rag.LoadModels(db)
		if err != nil {
			log.Printf("load model profiles failed: %v", err)
		} else {
			models = loaded
		}
	}
	learning.RegisterWithModels(r.Group("/api/v1"), db, auth, models)
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
		bg.Add(1)
		go func() {
			defer bg.Done()
			harness.Serve(ctx)
		}()
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
	}
	return r, waitBg
}

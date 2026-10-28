package server

import (
	"context"
	"net/http"
	"time"

	"github.com/122Ml/HaJi_Mark/backend/internal/course"
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

func New(db *pgxpool.Pool, cache *redis.Client) *gin.Engine {
	r := gin.New()
	r.Use(gin.Logger(), gin.Recovery())
	r.GET("/api/v1/health/live", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})
	r.GET("/api/v1/health/ready", func(c *gin.Context) {
		ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
		defer cancel()
		databaseOK := db != nil && db.Ping(ctx) == nil
		redisOK := cache != nil && cache.Ping(ctx).Err() == nil
		status := http.StatusOK
		if !databaseOK || !redisOK {
			status = http.StatusServiceUnavailable
		}
		c.JSON(status, gin.H{"database": databaseOK, "redis": redisOK})
	})
	course.Register(r.Group("/api/v1"), db)
	return r
}

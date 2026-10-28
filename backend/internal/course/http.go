package course

import (
	"context"
	"net/http"
	"time"

	"github.com/122Ml/HaJi_Mark/backend/internal/store"
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

func Register(r *gin.RouterGroup, db *pgxpool.Pool) {
	// Sprint 0 public catalogue: published metadata only, no learner data or answer keys.
	r.GET("/courses", func(c *gin.Context) {
		if db == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": gin.H{"code": "service_unavailable", "message": "课程数据库暂不可用"}})
			return
		}
		ctx, cancel := context.WithTimeout(c.Request.Context(), 3*time.Second)
		defer cancel()
		courses, err := store.New(db).ListPublishedCourses(ctx)
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": gin.H{"code": "service_unavailable", "message": "课程查询失败，请稍后重试"}})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": courses})
	})
}

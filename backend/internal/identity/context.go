package identity

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// These routes exercise the middleware without pretending course publishing or
// submissions are implemented. Other modules reuse the same middleware chain.
func (h *Handler) RegisterContext(api *gin.RouterGroup) {
	for _, role := range []string{"student", "teacher"} {
		group := api.Group("/"+role+"/courses/:courseID", h.RequireSession(), RequireRole(role), h.RequireCourse("courseID"))
		group.GET("/context", h.courseContext)
		group.POST("/access-check", h.RequireCSRF(), func(c *gin.Context) {
			c.JSON(http.StatusOK, gin.H{"data": gin.H{"course_id": c.Param("courseID"), "actor_id": Current(c).ID, "authorized": true, "persisted": false, "purpose": "authorization_example"}})
		})
	}
	student := api.Group("/student/users/:studentID", h.RequireSession(), RequireSelf("studentID"))
	student.GET("/context", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"data": Current(c)}) })
}

func (h *Handler) courseContext(c *gin.Context) {
	row, err := h.queries.GetCourseContext(c.Request.Context(), c.Param("courseID"))
	if err != nil {
		Fail(c, http.StatusServiceUnavailable, "service_unavailable", "课程查询失败")
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": row})
}

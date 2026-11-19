package learning

import (
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/122Ml/HaJi_Mark/backend/internal/identity"
	"github.com/122Ml/HaJi_Mark/backend/internal/rag"
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
)

// A resource scope reads only the authorized, immutable learning text. It never
// expands a partial publication into the complete original source.
func (h *Handler) scopedSearch(c *gin.Context, query, purpose, resourceID string) ([]rag.Hit, string, error) {
	if resourceID == "" {
		if h.rag == nil {
			return nil, "", fmt.Errorf("课程检索尚未启用；可以选择当前已发布学习资料进行文内检索")
		}
		return h.rag.Search(c.Request.Context(), c.Param("courseID"), identity.Current(c).ID, query, purpose, teacher(c))
	}
	r, err := h.q.GetBusinessResource(c.Request.Context(), resourceID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, "", fmt.Errorf("当前学习资料不存在、尚未发布或无权访问")
		}
		return nil, "", err
	}
	if r.CourseID != c.Param("courseID") || r.Status != "published" {
		return nil, "", fmt.Errorf("当前学习资料不存在、尚未发布或无权访问")
	}
	text := []rune(r.Content)
	tokens := rag.Tokens(query)
	lowerQuery := strings.ToLower(strings.TrimSpace(query))
	hits := []rag.Hit{}
	locator, _ := json.Marshal(map[string]string{"location": r.Locator})
	for start := 0; start < len(text); start += 800 {
		end := min(start+1000, len(text))
		body := string(text[start:end])
		lowerBody := strings.ToLower(body)
		score := 0
		for _, token := range tokens {
			if strings.Contains(lowerBody, token) {
				score++
			}
		}
		if score == 0 && lowerQuery != "" && strings.Contains(lowerBody, lowerQuery) {
			score = 1
		}
		if score > 0 {
			hits = append(hits, rag.Hit{
				ID:          fmt.Sprintf("resource:%s:%d", r.ID, start),
				ResourceID:  r.ID,
				FragmentIDs: []string{},
				Title:       r.Title,
				Body:        body,
				Locator:     locator,
				Score:       float64(score),
			})
		}
		if end == len(text) {
			break
		}
	}
	sort.SliceStable(hits, func(i, j int) bool { return hits[i].Score > hits[j].Score })
	if len(hits) > 6 {
		hits = hits[:6]
	}
	chars := 0
	selected := make([]rag.Hit, 0, len(hits))
	for _, hit := range hits {
		n := len([]rune(hit.Body))
		if chars+n > 4000 {
			continue
		}
		chars += n
		selected = append(selected, hit)
	}
	return selected, "resource_keyword", nil
}

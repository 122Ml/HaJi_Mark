package learning

import (
	"strings"

	"github.com/122Ml/HaJi_Mark/backend/internal/identity"
	"github.com/122Ml/HaJi_Mark/backend/internal/store"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func (h *Handler) renameCourse(c *gin.Context) {
	var in struct {
		Title string `json:"title"`
	}
	if !bind(c, &in) {
		return
	}
	in.Title = strings.TrimSpace(in.Title)
	if !validText(in.Title, 200) {
		invalid(c, "请填写课程名称（不超过200字节）")
		return
	}
	v, e := h.q.RenameBusinessCourse(c.Request.Context(), store.RenameBusinessCourseParams{ID: c.Param("courseID"), Title: in.Title})
	result(c, v, e)
}
func (h *Handler) importCurriculum(c *gin.Context) {
	var in struct {
		Chapters []struct {
			Title    string `json:"title"`
			Sections []struct {
				Title  string   `json:"title"`
				Points []string `json:"points"`
			} `json:"sections"`
		} `json:"chapters"`
	}
	if !bind(c, &in) {
		return
	}
	if len(in.Chapters) == 0 || len(in.Chapters) > 50 {
		invalid(c, "目录须包含1到50个章节")
		return
	}
	count := 0
	for i := range in.Chapters {
		in.Chapters[i].Title = strings.TrimSpace(in.Chapters[i].Title)
		if !validText(in.Chapters[i].Title, 500) || len(in.Chapters[i].Sections) > 100 {
			invalid(c, "章节内容无效")
			return
		}
		count++
		for j := range in.Chapters[i].Sections {
			in.Chapters[i].Sections[j].Title = strings.TrimSpace(in.Chapters[i].Sections[j].Title)
			if !validText(in.Chapters[i].Sections[j].Title, 500) || len(in.Chapters[i].Sections[j].Points) > 100 {
				invalid(c, "小节内容无效")
				return
			}
			count++
			for k := range in.Chapters[i].Sections[j].Points {
				in.Chapters[i].Sections[j].Points[k] = strings.TrimSpace(in.Chapters[i].Sections[j].Points[k])
				if !validText(in.Chapters[i].Sections[j].Points[k], 500) {
					invalid(c, "知识点名称无效")
					return
				}
				count++
			}
		}
	}
	if count > 1000 {
		invalid(c, "一次目录导入最多1000个节点")
		return
	}
	ctx := c.Request.Context()
	tx, e := h.db.Begin(ctx)
	if e != nil {
		result(c, nil, e)
		return
	}
	defer tx.Rollback(ctx)
	q := h.q.WithTx(tx)
	if _, e = q.LockBusinessCourse(ctx, c.Param("courseID")); e != nil {
		result(c, nil, e)
		return
	}
	old, e := q.ListBusinessPoints(ctx, c.Param("courseID"))
	if e != nil {
		result(c, nil, e)
		return
	}
	if len(old) > 0 {
		identity.Fail(c, 409, "curriculum_exists", "仅空课程可导入目录，已有内容请逐项维护")
		return
	}
	position := int32(0)
	add := func(title, kind, parent string) (string, error) {
		id := uuid.NewString()
		_, e := q.AddBusinessPoint(ctx, store.AddBusinessPointParams{ID: id, CourseID: c.Param("courseID"), Title: title, Kind: kind, ParentID: text(parent), Position: position})
		position++
		return id, e
	}
	for _, chapter := range in.Chapters {
		chapterID, e := add(chapter.Title, "chapter", "")
		if e != nil {
			result(c, nil, e)
			return
		}
		for _, section := range chapter.Sections {
			sectionID, e := add(section.Title, "section", chapterID)
			if e != nil {
				result(c, nil, e)
				return
			}
			for _, point := range section.Points {
				if _, e = add(point, "point", sectionID); e != nil {
					result(c, nil, e)
					return
				}
			}
		}
	}
	e = tx.Commit(ctx)
	result(c, gin.H{"imported": count}, e)
}

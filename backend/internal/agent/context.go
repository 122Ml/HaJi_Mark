package agent

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strings"

	"github.com/122Ml/HaJi_Mark/backend/internal/identity"
	"github.com/gin-gonic/gin"
)

type businessContext struct {
	Kind string `json:"kind"`
	ID   string `json:"id"`
}

// Only a reference is attached. Business data still passes through authorized tools.
func (s *Service) verifyContext(c *gin.Context, ref *businessContext) (string, bool, error) {
	if ref == nil {
		return "", false, nil
	}
	if len(ref.ID) == 0 || len(ref.ID) > 100 || strings.ContainsRune(ref.ID, '\x00') || !safeID.MatchString(ref.ID) {
		return "", false, fmt.Errorf("业务对象编号无效")
	}
	id := url.PathEscape(ref.ID)
	path, list, learner := "", false, false
	switch ref.Kind {
	case "source":
		path = "/sources/" + id
	case "resource":
		path, list = "/resources", true
	case "knowledge":
		path, list = "/knowledge", true
	case "question":
		path = "/question-bank/versions/" + id
	case "assignment":
		path = "/assignments/" + id
	case "submission":
		path, learner = "/submissions/"+id, true
	case "diagnosis":
		path, learner = "/intelligence/"+id, true
	case "intervention":
		path, list, learner = "/interventions", true, true
	default:
		return "", false, fmt.Errorf("不支持的业务上下文")
	}
	readPath := path
	if list {
		path += "?id=" + url.QueryEscape(ref.ID)
	}
	response, err := s.Gateway.Invoke(c.Request.Context(), identity.SessionReference(c), "GET", "/api/v1/learning/courses/"+c.Param("courseID")+path, "application/json", nil)
	if err != nil || response.Status != 200 {
		return "", false, fmt.Errorf("当前业务对象不可访问，请刷新后核对")
	}
	var body struct {
		Data json.RawMessage `json:"data"`
	}
	if json.Unmarshal(response.Body, &body) != nil {
		return "", false, fmt.Errorf("业务上下文回执无效")
	}
	if list {
		var rows []struct {
			ID string `json:"id"`
		}
		if json.Unmarshal(body.Data, &rows) != nil {
			return "", false, fmt.Errorf("业务上下文列表无效")
		}
		found := false
		for _, row := range rows {
			if row.ID == ref.ID {
				found = true
				break
			}
		}
		if !found {
			return "", false, fmt.Errorf("当前业务对象不可访问，请刷新后核对")
		}
	}
	verified := map[string]string{"kind": ref.Kind, "id": ref.ID, "course_id": c.Param("courseID"), "read_path": readPath}
	return "\n当前业务对象（服务端已核验访问权限；仅作为定位，操作前须读取当前版本）：" + string(raw(verified)), learner, nil
}

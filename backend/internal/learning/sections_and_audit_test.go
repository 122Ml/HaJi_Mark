package learning_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/122Ml/HaJi_Mark/backend/internal/server"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

func TestSectionsCrudAndHardeningAudit(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		if os.Getenv("REQUIRE_INTEGRATION_TESTS") == "1" {
			t.Fatal("TEST_DATABASE_URL must be set when REQUIRE_INTEGRATION_TESTS=1")
		}
		t.Skip("TEST_DATABASE_URL is not set")
	}
	t.Setenv("RAG_ENABLED", "true")
	t.Setenv("MODEL_PROFILES_PATH", "../../config/models.json")
	t.Setenv("MATERIALS_DIR", t.TempDir())
	t.Setenv("PUBLIC_ORIGIN", "")
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	schema := fmt.Sprintf("learning_crud_%d", time.Now().UnixNano())
	if _, err = admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	defer admin.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE")
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema + ",public"
	db, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	migrations, err := filepath.Glob("../../db/migrations/*.sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range migrations {
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		up := strings.Split(strings.Split(string(data), "-- +goose Up")[1], "-- +goose Down")[0]
		if _, err = db.Exec(ctx, up); err != nil {
			t.Fatalf("migration %s failed: %v", path, err)
		}
	}

	hash, err := bcrypt.GenerateFromPassword([]byte("crud-test-password"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	for _, u := range []struct{ id, role string }{{"teacher", "teacher"}, {"student", "student"}, {"extra", "student"}} {
		if _, err = db.Exec(ctx, `INSERT INTO users(id,username,display_name,role,password_hash) VALUES($1,$1,$1,$2,$3)`, u.id, u.role, string(hash)); err != nil {
			t.Fatal(err)
		}
	}
	if _, err = db.Exec(ctx, `INSERT INTO courses(id,title,teacher_id,status) VALUES('course','CRUD Course','teacher','published'); INSERT INTO enrollments(course_id,student_id) VALUES('course','student'),('course','extra')`); err != nil {
		t.Fatal(err)
	}

	router := server.New(db, nil, false)
	type actor struct {
		cookie *http.Cookie
		csrf   string
	}
	request := func(a actor, method, path string, body any) *httptest.ResponseRecorder {
		var reader *strings.Reader
		if body != nil {
			data, _ := json.Marshal(body)
			reader = strings.NewReader(string(data))
		} else {
			reader = strings.NewReader("")
		}
		req := httptest.NewRequest(method, "http://localhost:18080/api/v1"+path, reader)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", "http://localhost:18080")
		req.Header.Set("X-CSRF-Token", a.csrf)
		if a.cookie != nil {
			req.AddCookie(a.cookie)
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		return w
	}
	login := func(username string) actor {
		w := request(actor{}, http.MethodPost, "/sessions", map[string]string{"username": username, "password": "crud-test-password"})
		if w.Code != http.StatusOK {
			t.Fatalf("login %s failed: %d %s", username, w.Code, w.Body.String())
		}
		var out struct {
			Data struct {
				CSRF string `json:"csrf_token"`
			} `json:"data"`
		}
		_ = json.Unmarshal(w.Body.Bytes(), &out)
		return actor{cookie: w.Result().Cookies()[0], csrf: out.Data.CSRF}
	}
	teacher := login("teacher")
	student := login("student")
	base := "/learning/courses/course"

	// 1. Hierarchical point checks + CRUD update/delete + removeMember + course archive/restore.
	w := request(teacher, http.MethodPost, base+"/points", map[string]any{"title": "孤立小节", "kind": "section", "position": 0})
	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("orphan root section expected 422, got %d: %s", w.Code, w.Body.String())
	}
	w = request(teacher, http.MethodPost, base+"/points", map[string]any{"title": "第一章", "kind": "chapter", "position": 1})
	if w.Code != http.StatusOK {
		t.Fatalf("create chapter failed: %d", w.Code)
	}
	var ch struct{ Data struct{ ID string `json:"id"` } `json:"data"` }
	_ = json.Unmarshal(w.Body.Bytes(), &ch)

	w = request(teacher, http.MethodPost, base+"/points", map[string]any{"title": "第1节", "kind": "section", "parent_id": ch.Data.ID, "position": 1})
	if w.Code != http.StatusOK {
		t.Fatalf("create section failed: %d %s", w.Code, w.Body.String())
	}
	var sec struct{ Data struct{ ID string `json:"id"` } `json:"data"` }
	_ = json.Unmarshal(w.Body.Bytes(), &sec)

	w = request(teacher, http.MethodPost, base+"/points", map[string]any{"title": "知识点B", "kind": "point", "parent_id": sec.Data.ID, "position": 2})
	if w.Code != http.StatusOK {
		t.Fatalf("create point B failed: %d", w.Code)
	}
	var ptB struct{ Data struct{ ID string `json:"id"` } `json:"data"` }
	_ = json.Unmarshal(w.Body.Bytes(), &ptB)

	// Unused chapter delete fails with 409 because section references it; unused point update & delete succeed.
	w = request(teacher, http.MethodDelete, base+"/points/"+ch.Data.ID, nil)
	if w.Code != http.StatusConflict {
		t.Fatalf("deleting parent chapter expected 409, got %d", w.Code)
	}
	w = request(teacher, http.MethodPut, base+"/points/"+ptB.Data.ID, map[string]any{"title": "知识点B（更新）", "description": "说明"})
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), "知识点B（更新）") {
		t.Fatalf("update point failed: %d %s", w.Code, w.Body.String())
	}

	// Draft resource edit & archive.
	w = request(teacher, http.MethodPost, base+"/resources", map[string]any{"title": "初稿资料", "content": "初稿正文", "source_note": "自编", "locator": "p1", "knowledge_point_id": ptB.Data.ID})
	if w.Code != http.StatusOK {
		t.Fatalf("create resource failed: %d", w.Code)
	}
	var res struct{ Data struct{ ID string `json:"id"` } `json:"data"` }
	_ = json.Unmarshal(w.Body.Bytes(), &res)
	w = request(teacher, http.MethodPut, base+"/resources/"+res.Data.ID, map[string]any{"title": "修改后初稿", "content": "修改后正文", "source_note": "自编", "locator": "p2", "knowledge_point_id": ptB.Data.ID})
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), "修改后初稿") {
		t.Fatalf("update draft resource failed: %d %s", w.Code, w.Body.String())
	}
	w = request(teacher, http.MethodPost, base+"/resources/"+res.Data.ID+"/archive", map[string]any{})
	if w.Code != http.StatusOK {
		t.Fatalf("archive resource failed: %d %s", w.Code, w.Body.String())
	}

	// Interactions persist evidence_refs.
	w = request(student, http.MethodPost, base+"/interactions", map[string]any{"kind": "question", "title": "带证据提问", "content": "为什么这样做", "evidence_refs": []map[string]string{{"title": "参考资料"}}})
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), "参考资料") {
		t.Fatalf("interaction evidence_refs lost: %d %s", w.Code, w.Body.String())
	}

	// Deterministic path + total_points.
	w = request(student, http.MethodPost, base+"/path", map[string]any{})
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"total_points":1`) {
		t.Fatalf("planPath expected total_points:1, got %d: %s", w.Code, w.Body.String())
	}

	// Quiz attempt cap = 1 unless assigned intervention exists.
	w = request(teacher, http.MethodPost, base+"/assignments", map[string]any{"title": "单次客观测验", "type": "quiz", "questions": []map[string]any{{"prompt": "1+1=?", "max_score": 5, "rubric": "标准答案", "options": []string{"2", "3"}, "correct_answer": "2"}}})
	if w.Code != http.StatusOK {
		t.Fatalf("create quiz failed: %d %s", w.Code, w.Body.String())
	}
	var quiz struct{ Data struct{ ID string `json:"id"` } `json:"data"` }
	_ = json.Unmarshal(w.Body.Bytes(), &quiz)
	_ = request(teacher, http.MethodPost, base+"/assignments/"+quiz.Data.ID+"/state", map[string]any{"state": "published"})
	w = request(student, http.MethodGet, base+"/assignments/"+quiz.Data.ID, nil)
	var quizDetail struct{ Data struct{ Questions []struct{ ID string `json:"id"` } `json:"questions"` } `json:"data"` }
	_ = json.Unmarshal(w.Body.Bytes(), &quizDetail)
	qID := quizDetail.Data.Questions[0].ID

	if w := request(student, http.MethodPost, base+"/assignments/"+quiz.Data.ID+"/submissions", map[string]any{"question_id": qID, "answer_text": "3", "request_id": "quiz-try-1"}); w.Code != http.StatusOK {
		t.Fatalf("first quiz attempt failed: %d %s", w.Code, w.Body.String())
	}
	if w := request(student, http.MethodPost, base+"/assignments/"+quiz.Data.ID+"/submissions", map[string]any{"question_id": qID, "answer_text": "2", "request_id": "quiz-try-2"}); w.Code != http.StatusConflict {
		t.Fatalf("second quiz attempt without intervention expected 409, got %d: %s", w.Code, w.Body.String())
	}

	// Assign intervention targeting this quiz -> unlocks remedial retry!
	w = request(teacher, http.MethodPost, base+"/interventions", map[string]any{"student_id": "student", "title": "重做测验", "description": "请重做", "assignment_id": quiz.Data.ID})
	if w.Code != http.StatusOK {
		t.Fatalf("create intervention failed: %d", w.Code)
	}
	var iv struct{ Data struct{ ID string `json:"id"` } `json:"data"` }
	_ = json.Unmarshal(w.Body.Bytes(), &iv)
	if w := request(teacher, http.MethodPost, base+"/interventions/"+iv.Data.ID+"/state", map[string]any{"state": "assigned"}); w.Code != http.StatusOK {
		t.Fatalf("assign intervention failed: %d %s", w.Code, w.Body.String())
	}
	if w := request(student, http.MethodPost, base+"/assignments/"+quiz.Data.ID+"/submissions", map[string]any{"question_id": qID, "answer_text": "2", "request_id": "quiz-try-3"}); w.Code != http.StatusOK {
		t.Fatalf("remedial quiz retry expected 200, got %d: %s", w.Code, w.Body.String())
	}

	// Remove extra member & unused point/topic CRUD.
	w = request(teacher, http.MethodPost, base+"/points", map[string]any{"title": "临时知识点", "kind": "point", "position": 9})
	if w.Code != http.StatusOK {
		t.Fatalf("create unused point failed: %d", w.Code)
	}
	var unusedPt struct{ Data struct{ ID string `json:"id"` } `json:"data"` }
	_ = json.Unmarshal(w.Body.Bytes(), &unusedPt)
	if w := request(teacher, http.MethodDelete, base+"/points/"+unusedPt.Data.ID, nil); w.Code != http.StatusOK {
		t.Fatalf("delete unused point failed: %d %s", w.Code, w.Body.String())
	}

	w = request(teacher, http.MethodPost, base+"/topics", map[string]any{"title": "待删除专题", "description": "desc", "active": true})
	if w.Code != http.StatusOK {
		t.Fatalf("create topic failed: %d %s", w.Code, w.Body.String())
	}
	var topic struct{ Data struct{ ID string `json:"id"` } `json:"data"` }
	_ = json.Unmarshal(w.Body.Bytes(), &topic)
	if w := request(teacher, http.MethodDelete, base+"/topics/"+topic.Data.ID, nil); w.Code != http.StatusOK {
		t.Fatalf("deleteTopic failed: %d %s", w.Code, w.Body.String())
	}

	// Content sections adopt -> accept -> carry-forward on fragment edit -> bulk publish.
	if _, err = db.Exec(ctx, `
		INSERT INTO material_sources(id,course_id,created_by,title,filename,media_type,storage_path,source_note,sha256,parse_state,parse_revision)
		VALUES('sec-src','course','teacher','讲义','doc.txt','text/plain','sec-src.txt','教师讲义','sha-sec','ready',1);
		INSERT INTO material_fragments(id,source_id,revision,position,heading,body,locator,quality)
		VALUES('frag-1','sec-src',1,0,'节一','正文一','{"page":1}','ready'),
		      ('frag-2','sec-src',1,1,'节二','正文二','{"page":2}','ready');
		INSERT INTO processing_jobs(id,course_id,created_by,kind,state,input,output)
		VALUES('seg-job','course','teacher','source_segment','succeeded','{"source_id":"sec-src","parse_revision":1}',
		       '{"segments":[{"title":"第一部分","relation":"point","fragment_ids":["frag-1"],"knowledge_point_id":"`+ptB.Data.ID+`","reason":"切分1"},{"title":"第二部分","relation":"sequence","fragment_ids":["frag-2"],"knowledge_point_id":"","reason":"切分2"}]}');
	`); err != nil {
		t.Fatalf("seed section fixture failed: %v", err)
	}
	if w := request(teacher, http.MethodPost, base+"/sources/sec-src/sections/adopt", map[string]any{"job_id": "seg-job"}); w.Code != http.StatusOK {
		t.Fatalf("sections/adopt failed: %d %s", w.Code, w.Body.String())
	}
	if w := request(teacher, http.MethodPost, base+"/sources/sec-src/sections/state", map[string]any{"state": "accepted"}); w.Code != http.StatusOK {
		t.Fatalf("sections/state accepted failed: %d %s", w.Code, w.Body.String())
	}
	// Repeat accept should 409 because sections are already accepted.
	if w := request(teacher, http.MethodPost, base+"/sources/sec-src/sections/state", map[string]any{"state": "accepted"}); w.Code != http.StatusConflict {
		t.Fatalf("repeat sections/state accepted expected 409, got %d: %s", w.Code, w.Body.String())
	}
	// Editing fragments bumps parse_revision=2 and must carry forward accepted sections with remapped fragment IDs!
	if w := request(teacher, http.MethodPut, base+"/sources/sec-src/fragments", map[string]any{
		"revision": 1,
		"fragments": []map[string]any{
			{"id": "frag-1", "heading": "节一修订", "body": "正文一修订", "quality": "ready"},
			{"id": "frag-2", "heading": "节二修订", "body": "正文二修订", "quality": "ready"},
		},
	}); w.Code != http.StatusOK {
		t.Fatalf("correctFragments failed: %d %s", w.Code, w.Body.String())
	}
	if w := request(teacher, http.MethodPost, base+"/sources/sec-src/sections/publish", map[string]any{}); w.Code != http.StatusOK || !strings.Contains(w.Body.String(), "正文一修订") {
		t.Fatalf("sections/publish after fragment edit failed: %d %s", w.Code, w.Body.String())
	}
	if w := request(teacher, http.MethodPost, base+"/sources/sec-src/sections/publish", map[string]any{}); w.Code != http.StatusConflict || !strings.Contains(w.Body.String(), "state_conflict") {
		t.Fatalf("replay sections/publish expected 409 state_conflict, got %d: %s", w.Code, w.Body.String())
	}

	// Bank-linked draft assignment: update title & remove bank-linked question must succeed without bank rubric blocking PUT /assignments/:id.
	w = request(teacher, http.MethodPost, base+"/question-bank", map[string]any{"title": "题库测试题", "prompt": "题库测试题干", "type": "subjective", "max_score": 10})
	if w.Code != http.StatusOK {
		t.Fatalf("create bank question failed: %d %s", w.Code, w.Body.String())
	}
	var bankQ struct{ Data struct{ ID string `json:"id"` } `json:"data"` }
	_ = json.Unmarshal(w.Body.Bytes(), &bankQ)
	if w := request(teacher, http.MethodPost, base+"/question-bank/versions/"+bankQ.Data.ID+"/confirm", map[string]any{}); w.Code != http.StatusOK {
		t.Fatalf("confirm bank question failed: %d %s", w.Code, w.Body.String())
	}
	w = request(teacher, http.MethodPost, base+"/question-bank/versions/"+bankQ.Data.ID+"/rubrics", map[string]any{
		"criteria": []map[string]any{{"id": "D1", "title": "要点", "rule": "按要点给分", "max_score": 10}},
	})
	if w.Code != http.StatusOK {
		t.Fatalf("create bank rubric failed: %d %s", w.Code, w.Body.String())
	}
	var bankRubric struct{ Data struct{ ID string `json:"id"` } `json:"data"` }
	_ = json.Unmarshal(w.Body.Bytes(), &bankRubric)
	if w := request(teacher, http.MethodPost, base+"/rubrics/"+bankRubric.Data.ID+"/confirm", map[string]any{}); w.Code != http.StatusOK {
		t.Fatalf("confirm bank rubric failed: %d %s", w.Code, w.Body.String())
	}
	w = request(teacher, http.MethodPost, base+"/assignments", map[string]any{
		"title": "草稿题库作业",
		"type":  "subjective",
		"questions": []map[string]any{
			{"bank_question_version_id": bankQ.Data.ID, "bound_rubric_id": bankRubric.Data.ID},
		},
	})
	if w.Code != http.StatusOK {
		t.Fatalf("create draft bank assignment failed: %d %s", w.Code, w.Body.String())
	}
	var bankAssign struct{ Data struct{ ID string `json:"id"` } `json:"data"` }
	_ = json.Unmarshal(w.Body.Bytes(), &bankAssign)
	w = request(teacher, http.MethodGet, base+"/assignments/"+bankAssign.Data.ID, nil)
	if w.Code != http.StatusOK {
		t.Fatalf("get draft bank assignment failed: %d %s", w.Code, w.Body.String())
	}
	var bankAssignDetail struct {
		Data struct {
			Questions []struct {
				ID string `json:"id"`
			} `json:"questions"`
		} `json:"data"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &bankAssignDetail)
	if len(bankAssignDetail.Data.Questions) != 1 {
		t.Fatalf("expected 1 bank-linked question, got %d", len(bankAssignDetail.Data.Questions))
	}
	bankAssignQID := bankAssignDetail.Data.Questions[0].ID
	if w := request(teacher, http.MethodPut, base+"/assignments/"+bankAssign.Data.ID, map[string]any{
		"title": "草稿题库作业（改名）",
		"type":  "subjective",
		"questions": []map[string]any{
			{"id": bankAssignQID, "bank_question_version_id": bankQ.Data.ID, "bound_rubric_id": bankRubric.Data.ID},
		},
	}); w.Code != http.StatusOK || !strings.Contains(w.Body.String(), "草稿题库作业（改名）") {
		t.Fatalf("update draft bank assignment title expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if w := request(teacher, http.MethodPut, base+"/assignments/"+bankAssign.Data.ID, map[string]any{
		"title": "草稿题库作业（移除题库题）",
		"type":  "subjective",
		"questions": []map[string]any{
			{"prompt": "自编替代题", "max_score": 10, "rubric": "自编评分标准"},
		},
	}); w.Code != http.StatusOK {
		t.Fatalf("remove bank-linked question from draft assignment expected 200, got %d: %s", w.Code, w.Body.String())
	}

	// Remove extra member & course state archive -> restore to published.
	if w := request(teacher, http.MethodDelete, base+"/members/extra", nil); w.Code != http.StatusOK {
		t.Fatalf("removeMember failed: %d %s", w.Code, w.Body.String())
	}
	if w := request(teacher, http.MethodDelete, base+"/members/extra", nil); w.Code != http.StatusNotFound {
		t.Fatalf("duplicate removeMember expected 404, got %d", w.Code)
	}

	// Course state archive -> restore to published.
	if w := request(teacher, http.MethodPost, base+"/state", map[string]any{"state": "archived"}); w.Code != http.StatusOK {
		t.Fatalf("archive course failed: %d %s", w.Code, w.Body.String())
	}
	if w := request(teacher, http.MethodPost, base+"/state", map[string]any{"state": "published"}); w.Code != http.StatusOK {
		t.Fatalf("restore course failed: %d %s", w.Code, w.Body.String())
	}
}

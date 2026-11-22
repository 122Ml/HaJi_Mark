package learning_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"math"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/122Ml/HaJi_Mark/backend/internal/rag"
	"github.com/122Ml/HaJi_Mark/backend/internal/server"
	"github.com/122Ml/HaJi_Mark/backend/internal/store"
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
	var ch struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &ch)

	w = request(teacher, http.MethodPost, base+"/points", map[string]any{"title": "第1节", "kind": "section", "parent_id": ch.Data.ID, "position": 1})
	if w.Code != http.StatusOK {
		t.Fatalf("create section failed: %d %s", w.Code, w.Body.String())
	}
	var sec struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &sec)

	w = request(teacher, http.MethodPost, base+"/points", map[string]any{"title": "知识点B", "kind": "point", "parent_id": sec.Data.ID, "position": 2})
	if w.Code != http.StatusOK {
		t.Fatalf("create point B failed: %d", w.Code)
	}
	var ptB struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
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
	var res struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
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
	var quiz struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &quiz)
	_ = request(teacher, http.MethodPost, base+"/assignments/"+quiz.Data.ID+"/state", map[string]any{"state": "published"})
	w = request(student, http.MethodGet, base+"/assignments/"+quiz.Data.ID, nil)
	var quizDetail struct {
		Data struct {
			Questions []struct {
				ID string `json:"id"`
			} `json:"questions"`
		} `json:"data"`
	}
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
	var iv struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
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
	var unusedPt struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &unusedPt)
	if w := request(teacher, http.MethodDelete, base+"/points/"+unusedPt.Data.ID, nil); w.Code != http.StatusOK {
		t.Fatalf("delete unused point failed: %d %s", w.Code, w.Body.String())
	}

	w = request(teacher, http.MethodPost, base+"/topics", map[string]any{"title": "待删除专题", "description": "desc", "active": true})
	if w.Code != http.StatusOK {
		t.Fatalf("create topic failed: %d %s", w.Code, w.Body.String())
	}
	var topic struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
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
	var bankQ struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
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
	var bankRubric struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
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
	var bankAssign struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
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

	// Video upload validation, streaming playback, paper_split guard, and section timecodes.
	t.Setenv("DEEPSEEK_BASE_URL", "https://deepseek.example")
	t.Setenv("DEEPSEEK_API_KEY", "test-key")
	type uploadPart struct {
		name string
		data []byte
	}
	upload := func(a actor, files []uploadPart, note string) *httptest.ResponseRecorder {
		var buf bytes.Buffer
		mw := multipart.NewWriter(&buf)
		_ = mw.WriteField("source_note", note)
		for _, f := range files {
			pw, err := mw.CreateFormFile("files", f.name)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := pw.Write(f.data); err != nil {
				t.Fatal(err)
			}
		}
		_ = mw.Close()
		req := httptest.NewRequest(http.MethodPost, "http://localhost:18080/api/v1"+base+"/sources", &buf)
		req.Header.Set("Content-Type", mw.FormDataContentType())
		req.Header.Set("Origin", "http://localhost:18080")
		req.Header.Set("X-CSRF-Token", a.csrf)
		req.AddCookie(a.cookie)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		return w
	}

	mp4Bytes := append([]byte{0x00, 0x00, 0x00, 0x18, 'f', 't', 'y', 'p', 'i', 's', 'o', 'm'}, []byte("0123456789abcdef")...)
	movBytes := []byte{0x00, 0x00, 0x00, 0x14, 'm', 'o', 'o', 'v', 0x00, 0x00, 0x00, 0x08}
	webmBytes := []byte{0x1A, 0x45, 0xDF, 0xA3, 0x9F, 0x42, 0x86, 0x81}

	if w := upload(teacher, []uploadPart{{name: "fake.mp4", data: []byte("%PDF-1.7 spoofed mp4")}}, "测试来源"); w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("spoofed mp4 expected 422, got %d: %s", w.Code, w.Body.String())
	}
	if w := upload(teacher, []uploadPart{{name: "empty.mp4", data: nil}}, "测试来源"); w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("empty mp4 expected 422, got %d: %s", w.Code, w.Body.String())
	}
	if w := upload(teacher, []uploadPart{{name: "bad.mkv", data: []byte("not-ebml-data")}}, "测试来源"); w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("spoofed mkv expected 422, got %d: %s", w.Code, w.Body.String())
	}
	if w := upload(teacher, []uploadPart{{name: "a.mp4", data: mp4Bytes}, {name: "b.txt", data: []byte("mixed doc")}}, "混合测试"); w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("video+doc mix expected 422, got %d: %s", w.Code, w.Body.String())
	}
	if w := upload(teacher, []uploadPart{{name: "b.txt", data: []byte("doc first")}, {name: "a.mp4", data: mp4Bytes}}, "反向混合测试"); w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("doc+video mix expected 422, got %d: %s", w.Code, w.Body.String())
	}
	if w := upload(teacher, []uploadPart{{name: "v1.mp4", data: mp4Bytes}, {name: "v2.mov", data: movBytes}}, "双视频测试"); w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("two videos expected 422, got %d: %s", w.Code, w.Body.String())
	}
	oversizedPDF := append([]byte("%PDF-1.7 "), bytes.Repeat([]byte("a"), 30<<20)...)
	if w := upload(teacher, []uploadPart{{name: "huge.pdf", data: oversizedPDF}}, "超大PDF"); w.Code != http.StatusUnprocessableEntity {
		t.Fatalf(">30MiB PDF expected 422, got %d: %s", w.Code, w.Body.String())
	}

	// Valid video uploads (.mp4, .mov, .webm).
	w = upload(teacher, []uploadPart{{name: "lecture.mp4", data: mp4Bytes}}, "课程录像")
	if w.Code != http.StatusOK {
		t.Fatalf("valid mp4 upload failed: %d %s", w.Code, w.Body.String())
	}
	var uploadedJobs []struct {
		Input struct {
			SourceID string `json:"source_id"`
		} `json:"input"`
	}
	var uploadResp struct {
		Data json.RawMessage `json:"data"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &uploadResp)
	_ = json.Unmarshal(uploadResp.Data, &uploadedJobs)
	if len(uploadedJobs) != 1 || uploadedJobs[0].Input.SourceID == "" {
		t.Fatalf("unexpected upload response: %s", w.Body.String())
	}
	vidID := uploadedJobs[0].Input.SourceID

	if w := upload(teacher, []uploadPart{{name: "clip.mov", data: movBytes}}, "MOV录像"); w.Code != http.StatusOK {
		t.Fatalf("valid mov upload failed: %d %s", w.Code, w.Body.String())
	}
	if w := upload(teacher, []uploadPart{{name: "clip.webm", data: webmBytes}}, "WebM录像"); w.Code != http.StatusOK {
		t.Fatalf("valid webm upload failed: %d %s", w.Code, w.Body.String())
	}

	// Non-video source cannot be streamed inline.
	if w := request(teacher, http.MethodGet, base+"/sources/sec-src/stream", nil); w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("stream on non-video expected 422, got %d: %s", w.Code, w.Body.String())
	}

	// Teacher can stream uploaded video (including Range 206) and download with explicit video Content-Type; student blocked before publish.
	if w := request(teacher, http.MethodGet, base+"/sources/"+vidID+"/stream", nil); w.Code != http.StatusOK ||
		w.Header().Get("Content-Type") != "video/mp4" ||
		w.Header().Get("Content-Disposition") != "inline" ||
		w.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("teacher stream failed: %d headers=%v body=%s", w.Code, w.Header(), w.Body.String())
	}
	rangeReq := httptest.NewRequest(http.MethodGet, "http://localhost:18080/api/v1"+base+"/sources/"+vidID+"/stream", nil)
	rangeReq.Header.Set("Range", "bytes=0-7")
	rangeReq.AddCookie(teacher.cookie)
	rangeW := httptest.NewRecorder()
	router.ServeHTTP(rangeW, rangeReq)
	if rangeW.Code != http.StatusPartialContent || !bytes.Equal(rangeW.Body.Bytes(), mp4Bytes[:8]) || !strings.HasPrefix(rangeW.Header().Get("Content-Range"), "bytes 0-7/") {
		t.Fatalf("range 206 stream failed: %d headers=%v len=%d", rangeW.Code, rangeW.Header(), rangeW.Body.Len())
	}
	if w := request(teacher, http.MethodGet, base+"/sources/"+vidID+"/download", nil); w.Code != http.StatusOK || w.Header().Get("Content-Type") != "video/mp4" {
		t.Fatalf("teacher video download failed: %d headers=%v", w.Code, w.Header())
	}
	if w := request(student, http.MethodGet, base+"/sources/"+vidID+"/stream", nil); w.Code != http.StatusForbidden {
		t.Fatalf("unpublished video stream for student expected 403, got %d", w.Code)
	}

	// Mark video ready with two timed fragments; verify paper_split is blocked in create, retry, and WorkflowDraft.
	vidJobInput := fmt.Sprintf(`{"source_id":%q,"parse_revision":1}`, vidID)
	if _, err = db.Exec(ctx, `UPDATE material_sources SET parse_state='ready', parse_revision=1 WHERE id=$1`, vidID); err != nil {
		t.Fatalf("mark video ready failed: %v", err)
	}
	if _, err = db.Exec(ctx, `
		INSERT INTO material_fragments(id,source_id,revision,position,heading,body,locator,quality)
		VALUES('vfrag-1',$1,1,0,'片段一','讲解概念A','{"time_start_ms":0,"time_end_ms":12000}','ready'),
		      ('vfrag-2',$1,1,1,'片段二','讲解概念B','{"time_start_ms":12000,"time_end_ms":28000}','ready')
	`, vidID); err != nil {
		t.Fatalf("seed video fragments failed: %v", err)
	}
	if _, err = db.Exec(ctx, `
		INSERT INTO processing_jobs(id,course_id,created_by,kind,state,input)
		VALUES('vid-split-old','course','teacher','paper_split','failed',$1)
	`, vidJobInput); err != nil {
		t.Fatalf("seed video paper_split job failed: %v", err)
	}
	if w := request(teacher, http.MethodPost, base+"/jobs", map[string]any{"kind": "paper_split", "source_id": vidID}); w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("paper_split on video create expected 422, got %d: %s", w.Code, w.Body.String())
	}
	if w := request(teacher, http.MethodPost, base+"/jobs/vid-split-old/retry", map[string]any{}); w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("paper_split on video retry expected 422, got %d: %s", w.Code, w.Body.String())
	}
	loadedModels, err := rag.LoadModels(db)
	if err != nil {
		t.Fatal(err)
	}
	ragSvc := rag.New(loadedModels)
	defer ragSvc.Close()
	if _, err := ragSvc.WorkflowDraft(ctx, store.ProcessingJob{Kind: "paper_split", CourseID: "course", CreatedBy: "teacher"}, rag.JobInput{SourceID: vidID, ParseRevision: 1}); err == nil || !strings.Contains(err.Error(), "视频") {
		t.Fatalf("expected WorkflowDraft to reject video paper_split, got %v", err)
	}

	var secFragIDs []string
	fragRows, err := db.Query(ctx, `SELECT id FROM material_fragments WHERE source_id='sec-src' AND revision=2 ORDER BY position`)
	if err != nil {
		t.Fatal(err)
	}
	for fragRows.Next() {
		var fid string
		if err := fragRows.Scan(&fid); err != nil {
			t.Fatal(err)
		}
		secFragIDs = append(secFragIDs, fid)
	}
	fragRows.Close()
	if len(secFragIDs) != 2 {
		t.Fatalf("expected 2 revision-2 fragments for sec-src, got %d", len(secFragIDs))
	}
	docSegOut, _ := json.Marshal(map[string]any{
		"segments": []map[string]any{{
			"title":              "文档尝试带时间",
			"relation":           "sequence",
			"fragment_ids":       secFragIDs,
			"knowledge_point_id": "",
			"time_start_ms":      100,
			"time_end_ms":        500,
			"reason":             "doc",
		}},
	})

	// adoptSegments rejects (1000,0) and int32 overflow with 422 (not 503), derives video timecodes, and enforces 0,0 on non-video.
	if _, err = db.Exec(ctx, `
		INSERT INTO processing_jobs(id,course_id,created_by,kind,state,input,output)
		VALUES
		  ('vseg-bad-span','course','teacher','source_segment','succeeded',$1,'{"segments":[{"title":"坏区间","relation":"sequence","fragment_ids":["vfrag-1","vfrag-2"],"knowledge_point_id":"","time_start_ms":1000,"time_end_ms":0,"reason":"bad"}]}'),
		  ('vseg-overflow','course','teacher','source_segment','succeeded',$1,$2),
		  ('vseg-ok','course','teacher','source_segment','succeeded',$1,'{"segments":[{"title":"第一段","relation":"sequence","fragment_ids":["vfrag-1"],"knowledge_point_id":"","time_start_ms":0,"time_end_ms":0,"reason":"段落1"},{"title":"第二段","relation":"point","fragment_ids":["vfrag-2"],"knowledge_point_id":"`+ptB.Data.ID+`","time_start_ms":0,"time_end_ms":0,"reason":"段落2"}]}'),
		  ('doc-seg-nonzero','course','teacher','source_segment','succeeded','{"source_id":"sec-src","parse_revision":2}',$3)
	`, vidJobInput, fmt.Sprintf(`{"segments":[{"title":"溢出","relation":"sequence","fragment_ids":["vfrag-1","vfrag-2"],"knowledge_point_id":"","time_start_ms":0,"time_end_ms":%d,"reason":"overflow"}]}`, int64(math.MaxInt32)+1), string(docSegOut)); err != nil {
		t.Fatalf("seed segment jobs failed: %v", err)
	}
	if w := request(teacher, http.MethodPost, base+"/sources/"+vidID+"/sections/adopt", map[string]any{"job_id": "vseg-bad-span"}); w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("adopt (1000,0) expected 422, got %d: %s", w.Code, w.Body.String())
	}
	if w := request(teacher, http.MethodPost, base+"/sources/"+vidID+"/sections/adopt", map[string]any{"job_id": "vseg-overflow"}); w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("adopt overflow expected 422, got %d: %s", w.Code, w.Body.String())
	}

	// Non-video source enforces 0,0 even if job output carried non-zero timecodes (after rejecting accepted sections first).
	if w := request(teacher, http.MethodPost, base+"/sources/sec-src/sections/state", map[string]any{"state": "rejected"}); w.Code != http.StatusOK {
		t.Fatalf("reject sec-src sections failed: %d %s", w.Code, w.Body.String())
	}
	w = request(teacher, http.MethodPost, base+"/sources/sec-src/sections/adopt", map[string]any{"job_id": "doc-seg-nonzero"})
	if w.Code != http.StatusOK {
		t.Fatalf("adopt non-video segments failed: %d %s", w.Code, w.Body.String())
	}
	var docSectionsResp struct {
		Data []store.ContentSection `json:"data"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &docSectionsResp)
	if len(docSectionsResp.Data) != 1 || docSectionsResp.Data[0].TimeStartMs != 0 || docSectionsResp.Data[0].TimeEndMs != 0 {
		t.Fatalf("non-video section expected 0,0 timecodes, got %+v", docSectionsResp.Data)
	}

	// Video adopt derives [0,12000] and [12000,28000] from fragment locators.
	w = request(teacher, http.MethodPost, base+"/sources/"+vidID+"/sections/adopt", map[string]any{"job_id": "vseg-ok"})
	if w.Code != http.StatusOK {
		t.Fatalf("adopt video segments failed: %d %s", w.Code, w.Body.String())
	}
	var vidSectionsResp struct {
		Data []store.ContentSection `json:"data"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &vidSectionsResp)
	if len(vidSectionsResp.Data) != 2 ||
		vidSectionsResp.Data[0].TimeStartMs != 0 || vidSectionsResp.Data[0].TimeEndMs != 12000 ||
		vidSectionsResp.Data[1].TimeStartMs != 12000 || vidSectionsResp.Data[1].TimeEndMs != 28000 {
		t.Fatalf("expected derived video section timecodes, got %+v", vidSectionsResp.Data)
	}
	sec0 := vidSectionsResp.Data[0]

	// updateSection: validates time span, updates row & edit_version, returns 409 on stale edit_version or accepted state.
	if w := request(teacher, http.MethodPut, base+"/sources/"+vidID+"/sections/"+sec0.ID, map[string]any{
		"title": "坏时间", "relation": "sequence", "knowledge_point_id": "", "time_start_ms": 1000, "time_end_ms": 0, "reason": "bad", "edit_version": sec0.EditVersion,
	}); w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("updateSection (1000,0) expected 422, got %d: %s", w.Code, w.Body.String())
	}
	if w := request(teacher, http.MethodPut, base+"/sources/"+vidID+"/sections/"+sec0.ID, map[string]any{
		"title": "溢出时间", "relation": "sequence", "knowledge_point_id": "", "time_start_ms": 0, "time_end_ms": int64(math.MaxInt32) + 1, "reason": "bad", "edit_version": sec0.EditVersion,
	}); w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("updateSection overflow expected 422, got %d: %s", w.Code, w.Body.String())
	}
	w = request(teacher, http.MethodPut, base+"/sources/"+vidID+"/sections/"+sec0.ID, map[string]any{
		"title": "第一段（修订）", "relation": "point", "knowledge_point_id": ptB.Data.ID, "time_start_ms": 1000, "time_end_ms": 11000, "reason": "精修时间段", "edit_version": sec0.EditVersion,
	})
	if w.Code != http.StatusOK {
		t.Fatalf("updateSection failed: %d %s", w.Code, w.Body.String())
	}
	var updatedSecResp struct {
		Data store.ContentSection `json:"data"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &updatedSecResp)
	if updatedSecResp.Data.Title != "第一段（修订）" || updatedSecResp.Data.TimeStartMs != 1000 || updatedSecResp.Data.TimeEndMs != 11000 || updatedSecResp.Data.EditVersion != sec0.EditVersion+1 {
		t.Fatalf("unexpected updated section: %+v", updatedSecResp.Data)
	}
	if w := request(teacher, http.MethodPut, base+"/sources/"+vidID+"/sections/"+sec0.ID, map[string]any{
		"title": "过时版本", "relation": "sequence", "knowledge_point_id": "", "time_start_ms": 0, "time_end_ms": 5000, "reason": "stale", "edit_version": sec0.EditVersion,
	}); w.Code != http.StatusConflict {
		t.Fatalf("stale updateSection expected 409, got %d: %s", w.Code, w.Body.String())
	}

	// Accept sections -> accepted section cannot be edited via PUT -> fragment edit carries forward timecodes -> sectionsPublish enables student /stream while keeping /download 403.
	if w := request(teacher, http.MethodPost, base+"/sources/"+vidID+"/sections/state", map[string]any{"state": "accepted"}); w.Code != http.StatusOK {
		t.Fatalf("accept video sections failed: %d %s", w.Code, w.Body.String())
	}
	if w := request(teacher, http.MethodPut, base+"/sources/"+vidID+"/sections/"+sec0.ID, map[string]any{
		"title": "已接受锁定", "relation": "sequence", "knowledge_point_id": "", "time_start_ms": 0, "time_end_ms": 5000, "reason": "locked", "edit_version": updatedSecResp.Data.EditVersion,
	}); w.Code != http.StatusConflict {
		t.Fatalf("update accepted section expected 409, got %d: %s", w.Code, w.Body.String())
	}
	if w := request(teacher, http.MethodPut, base+"/sources/"+vidID+"/fragments", map[string]any{
		"revision": 1,
		"fragments": []map[string]any{
			{"id": "vfrag-1", "heading": "片段一修订", "body": "讲解概念A修订", "quality": "ready"},
			{"id": "vfrag-2", "heading": "片段二修订", "body": "讲解概念B修订", "quality": "ready"},
		},
	}); w.Code != http.StatusOK {
		t.Fatalf("correctFragments on video failed: %d %s", w.Code, w.Body.String())
	}
	w = request(teacher, http.MethodGet, base+"/sources/"+vidID+"/sections", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("get carried-forward video sections failed: %d %s", w.Code, w.Body.String())
	}
	vidSectionsResp.Data = nil
	_ = json.Unmarshal(w.Body.Bytes(), &vidSectionsResp)
	if len(vidSectionsResp.Data) != 2 || vidSectionsResp.Data[0].TimeStartMs != 1000 || vidSectionsResp.Data[0].TimeEndMs != 11000 || vidSectionsResp.Data[1].TimeStartMs != 12000 || vidSectionsResp.Data[1].TimeEndMs != 28000 {
		t.Fatalf("carryForwardContentSections lost timecodes: %+v", vidSectionsResp.Data)
	}
	if w := request(teacher, http.MethodPost, base+"/sources/"+vidID+"/sections/publish", map[string]any{}); w.Code != http.StatusOK {
		t.Fatalf("video sections/publish failed: %d %s", w.Code, w.Body.String())
	}
	if w := request(teacher, http.MethodPost, base+"/sources/"+vidID+"/sections/publish", map[string]any{}); w.Code != http.StatusConflict {
		t.Fatalf("replay video sections/publish expected 409, got %d: %s", w.Code, w.Body.String())
	}
	if w := request(student, http.MethodGet, base+"/sources/"+vidID+"/stream", nil); w.Code != http.StatusOK || w.Header().Get("Content-Type") != "video/mp4" {
		t.Fatalf("student stream after sectionsPublish expected 200, got %d: %s", w.Code, w.Body.String())
	}
	stuRangeReq := httptest.NewRequest(http.MethodGet, "http://localhost:18080/api/v1"+base+"/sources/"+vidID+"/stream", nil)
	stuRangeReq.Header.Set("Range", "bytes=0-7")
	stuRangeReq.AddCookie(student.cookie)
	stuRangeW := httptest.NewRecorder()
	router.ServeHTTP(stuRangeW, stuRangeReq)
	if stuRangeW.Code != http.StatusPartialContent || !bytes.Equal(stuRangeW.Body.Bytes(), mp4Bytes[:8]) {
		t.Fatalf("student range 206 stream failed: %d", stuRangeW.Code)
	}
	if w := request(student, http.MethodGet, base+"/sources/"+vidID+"/download", nil); w.Code != http.StatusForbidden {
		t.Fatalf("student download after FullSource=false sectionsPublish expected 403, got %d", w.Code)
	}

	// GET /knowledge-points/:pointID/clips: returns only accepted sections from active latest revision; forbids students; excludes archived sources.
	if w := request(student, http.MethodGet, base+"/knowledge-points/"+ptB.Data.ID+"/clips", nil); w.Code != http.StatusForbidden {
		t.Fatalf("student pointClips expected 403, got %d", w.Code)
	}
	w = request(teacher, http.MethodGet, base+"/knowledge-points/"+ptB.Data.ID+"/clips", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("teacher pointClips failed: %d %s", w.Code, w.Body.String())
	}
	var clipsResp struct {
		Data []store.ListSectionsByPointRow `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &clipsResp); err != nil {
		t.Fatalf("unmarshal pointClips failed: %v", err)
	}
	if len(clipsResp.Data) != 2 ||
		clipsResp.Data[0].SourceID != vidID || clipsResp.Data[0].TimeStartMs != 1000 || clipsResp.Data[0].TimeEndMs != 11000 ||
		clipsResp.Data[1].SourceID != vidID || clipsResp.Data[1].TimeStartMs != 12000 || clipsResp.Data[1].TimeEndMs != 28000 {
		t.Fatalf("expected 2 latest-revision accepted clips for point, got %+v", clipsResp.Data)
	}
	if w := request(teacher, http.MethodPost, base+"/sources/"+vidID+"/archive", map[string]any{}); w.Code != http.StatusOK {
		t.Fatalf("archive video source failed: %d %s", w.Code, w.Body.String())
	}
	w = request(teacher, http.MethodGet, base+"/knowledge-points/"+ptB.Data.ID+"/clips", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("pointClips after archive failed: %d %s", w.Code, w.Body.String())
	}
	clipsResp.Data = nil
	_ = json.Unmarshal(w.Body.Bytes(), &clipsResp)
	if len(clipsResp.Data) != 0 {
		t.Fatalf("expected archived source clips to be excluded, got %+v", clipsResp.Data)
	}
}

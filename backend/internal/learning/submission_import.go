package learning

import (
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/122Ml/HaJi_Mark/backend/internal/identity"
	"github.com/122Ml/HaJi_Mark/backend/internal/store"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type importInput struct {
	QuestionID  string `json:"question_id"`
	CSV         string `json:"csv"`
	PreviewHash string `json:"preview_hash"`
	RequestID   string `json:"request_id"`
}
type importRow struct {
	Row         int    `json:"row"`
	Username    string `json:"username"`
	Answer      string `json:"answer_text"`
	StudentID   string `json:"student_id"`
	StudentName string `json:"student_name"`
	NextAttempt int32  `json:"next_attempt"`
	Error       string `json:"error"`
}

func readAnswerCSV(content string) ([]importRow, error) {
	if len(content) > 512<<10 || !utf8.ValidString(content) {
		return nil, errors.New("请使用不超过512KiB的UTF-8 CSV文件")
	}
	content = strings.TrimPrefix(content, "\ufeff")
	reader := csv.NewReader(strings.NewReader(content))
	header, err := reader.Read()
	if err != nil || len(header) != 2 || strings.TrimSpace(header[0]) != "username" || strings.TrimSpace(header[1]) != "answer_text" {
		return nil, errors.New("CSV首行必须为username,answer_text；多行答案请使用CSV双引号包裹")
	}
	rows := []importRow{}
	seen := map[string]bool{}
	for {
		start := reader.InputOffset()
		record, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			var parseErr *csv.ParseError
			if errors.As(err, &parseErr) {
				return nil, fmt.Errorf("第%d行第%d列CSV格式有误，请检查引号或列数是否符合username,answer_text两列格式", parseErr.Line, parseErr.Column)
			}
			return nil, errors.New("CSV格式错误，请核对文件内容")
		}
		line, _ := reader.FieldPos(0)
		// encoding/csv normalizes quoted CRLF to LF. Decode the validated raw
		// answer field separately so an imported submission retains its bytes.
		raw := strings.TrimLeft(content[start:reader.InputOffset()], "\r\n")
		quoted, separator := false, 0
		for i, ch := range raw {
			if ch == '"' {
				quoted = !quoted
			}
			if ch == ',' && !quoted {
				separator = i
				break
			}
		}
		answer := strings.TrimSuffix(strings.TrimSuffix(raw[separator+1:], "\n"), "\r")
		if strings.HasPrefix(answer, "\"") {
			answer = strings.ReplaceAll(answer[1:len(answer)-1], "\"\"", "\"")
		}
		row := importRow{Row: line, Username: strings.TrimSpace(record[0]), Answer: answer}
		if row.Username == "" {
			row.Error = "缺少学生用户名"
		} else if seen[row.Username] {
			row.Error = "同一批次中学生重复"
		} else if blank(row.Answer) {
			row.Error = "空白答案不导入，请保留为未提交"
		} else if strings.ContainsRune(row.Answer, 0) {
			row.Error = "答案含NUL控制字符，请核对文件编码"
		} else if len(row.Answer) > 200000 {
			row.Error = "单份答案不能超过200000字节"
		}
		seen[row.Username] = true
		rows = append(rows, row)
		if len(rows) > 200 {
			return nil, errors.New("每批最多导入200份答案")
		}
	}
	if len(rows) == 0 {
		return nil, errors.New("CSV没有答案行")
	}
	return rows, nil
}

func (h *Handler) submissionImports(c *gin.Context) {
	a, ok := h.assignmentRecord(c, c.Param("id"))
	if !ok {
		return
	}
	v, e := h.q.ListSubmissionImports(c.Request.Context(), a.ID)
	if e == nil && v == nil {
		v = []store.ListSubmissionImportsRow{}
	}
	result(c, v, e)
}

func (h *Handler) importSubmissions(c *gin.Context) {
	if c.Param("operation") != "preview" && c.Param("operation") != "confirm" {
		invalid(c, "不支持的导入操作")
		return
	}
	var in importInput
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4<<20)
	if err := c.ShouldBindJSON(&in); err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			identity.Fail(c, http.StatusRequestEntityTooLarge, "payload_too_large", "导入请求体过大（上限4MiB）")
			return
		}
		identity.Fail(c, 400, "invalid_input", "导入请求格式不正确")
		return
	}
	rows, err := readAnswerCSV(in.CSV)
	if err != nil {
		invalid(c, err.Error())
		return
	}
	a, ok := h.assignmentRecord(c, c.Param("id"))
	if !ok {
		return
	}
	inputJSON, err := json.Marshal(struct {
		QuestionID string
		CSV        string
	}{in.QuestionID, in.CSV})
	if err != nil {
		result(c, nil, err)
		return
	}
	inputHash := hashAnswer(string(inputJSON))
	ctx := c.Request.Context()
	commit := c.Param("operation") == "confirm"
	q := h.q
	var tx pgx.Tx
	if commit {
		if !validText(in.RequestID, 128) {
			invalid(c, "缺少有效请求号")
			return
		}
		var e error
		tx, e = h.db.Begin(ctx)
		if e != nil {
			result(c, nil, e)
			return
		}
		defer tx.Rollback(ctx)
		q = h.q.WithTx(tx)
		if _, e = q.LockBusinessAssignment(ctx, a.ID); e != nil {
			result(c, nil, e)
			return
		}
		a, e = q.GetBusinessAssignment(ctx, a.ID)
		if e != nil {
			result(c, nil, e)
			return
		}
		old, err := q.GetSubmissionImportByRequest(ctx, store.GetSubmissionImportByRequestParams{ImportedBy: identity.Current(c).ID, RequestID: in.RequestID})
		if err == nil {
			if old.InputHash != inputHash || old.AssignmentID != a.ID {
				identity.Fail(c, 409, "request_conflict", "相同请求号不能改变导入内容")
				return
			}
			items, err := q.ListSubmissionImportItems(ctx, old.ID)
			result(c, gin.H{"batch": old, "submissions": items}, err)
			return
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			result(c, nil, err)
			return
		}
	}
	if a.Status != "published" || a.DueAt.Valid && time.Now().After(a.DueAt.Time) {
		identity.Fail(c, 409, "assignment_closed", "仅可导入已发布且未截止的作业；关闭或逾期作业的补录规则尚未开放")
		return
	}
	question, e := q.GetBusinessQuestion(ctx, in.QuestionID)
	if e != nil {
		result(c, nil, e)
		return
	}
	if question.AssignmentID != a.ID {
		identity.Fail(c, 403, "forbidden", "题目不属于当前作业")
		return
	}
	if question.Type == "quiz" {
		invalid(c, "批量导入仅支持主观题和代码文本，客观题仍走固定规则测验")
		return
	}
	members, e := q.ListBusinessMembers(ctx, a.CourseID)
	if e != nil {
		result(c, nil, e)
		return
	}
	byName := map[string]store.ListBusinessMembersRow{}
	for _, m := range members {
		if m.Username.Valid {
			byName[m.Username.String] = m
		}
	}
	studentIDs := make([]string, 0, len(rows))
	seenStudent := map[string]bool{}
	for i := range rows {
		m, exists := byName[rows[i].Username]
		if !exists {
			if rows[i].Error == "" {
				rows[i].Error = "当前课程没有该学生，请先核对用户名或选课名单"
			}
			continue
		}
		rows[i].StudentID, rows[i].StudentName = m.ID, m.DisplayName
		if !seenStudent[m.ID] {
			seenStudent[m.ID] = true
			studentIDs = append(studentIDs, m.ID)
		}
	}
	nextAttempts := map[string]int32{}
	if len(studentIDs) > 0 {
		attemptRows, err := q.NextSubmissionAttemptsForQuestion(ctx, store.NextSubmissionAttemptsForQuestionParams{
			QuestionID: question.ID,
			StudentIds: studentIDs,
		})
		if err != nil {
			result(c, nil, err)
			return
		}
		for _, ar := range attemptRows {
			nextAttempts[ar.StudentID] = ar.NextAttempt
		}
	}
	valid := true
	for i := range rows {
		if rows[i].StudentID != "" {
			if next, ok := nextAttempts[rows[i].StudentID]; ok {
				rows[i].NextAttempt = next
			} else {
				rows[i].NextAttempt = 1
			}
		}
		if rows[i].Error != "" {
			valid = false
		}
	}
	snapshot, err := json.Marshal(struct {
		Version  int32
		Question string
		Rows     []importRow
	}{a.Version, question.ID, rows})
	if err != nil {
		result(c, nil, err)
		return
	}
	previewHash := hashAnswer(string(snapshot))
	if !commit {
		result(c, gin.H{"rows": rows, "valid": valid, "preview_hash": previewHash, "assignment_version": a.Version}, nil)
		return
	}
	if !valid {
		invalid(c, "导入行存在问题，请修正后重新核对；本批次未写入任何答案")
		return
	}
	if in.PreviewHash != previewHash {
		identity.Fail(c, 409, "preview_changed", "名单、作答次数或输入已变化，请重新预览核对后确认")
		return
	}
	batch, e := q.CreateSubmissionImport(ctx, store.CreateSubmissionImportParams{ID: uuid.NewString(), CourseID: a.CourseID, AssignmentID: a.ID, QuestionID: question.ID, ImportedBy: identity.Current(c).ID, RequestID: in.RequestID, InputHash: inputHash})
	if e != nil {
		if isPgCode(e, "23505") {
			identity.Fail(c, 409, "request_conflict", "相同请求号不能改变导入内容")
			return
		}
		result(c, nil, e)
		return
	}
	submissions := []store.Submission{}
	for _, row := range rows {
		s, err := q.CreateBusinessSubmission(ctx, store.CreateBusinessSubmissionParams{ID: uuid.NewString(), CourseID: a.CourseID, AssignmentID: a.ID, AssignmentVersion: a.Version, QuestionID: question.ID, StudentID: row.StudentID, Attempt: row.NextAttempt, AnswerText: row.Answer, AnswerSha256: hashAnswer(row.Answer), RequestID: "import:" + batch.ID + ":" + row.StudentID})
		if err != nil {
			result(c, nil, err)
			return
		}
		if e = q.AddSubmissionImportItem(ctx, store.AddSubmissionImportItemParams{BatchID: batch.ID, SubmissionID: s.ID, RowNumber: int32(row.Row)}); e != nil {
			result(c, nil, e)
			return
		}
		if e = q.AddImportedSubmissionEvent(ctx, store.AddImportedSubmissionEventParams{ID: uuid.NewString(), CourseID: a.CourseID, ActorID: identity.Current(c).ID, SubmissionID: text(s.ID), RequestID: "import:" + s.ID, ObjectVersion: a.Version, OccurredAt: s.SubmittedAt}); e != nil {
			result(c, nil, e)
			return
		}
		submissions = append(submissions, s)
	}
	result(c, gin.H{"batch": batch, "submissions": submissions}, tx.Commit(ctx))
}

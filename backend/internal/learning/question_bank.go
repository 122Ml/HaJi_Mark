package learning

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"strings"

	"github.com/122Ml/HaJi_Mark/backend/internal/identity"
	"github.com/122Ml/HaJi_Mark/backend/internal/rag"
	"github.com/122Ml/HaJi_Mark/backend/internal/store"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

func (h *Handler) registerQuestionBank(g *gin.RouterGroup, auth *identity.Handler) {
	t := g.Group("/question-bank", identity.RequireRole("teacher"))
	t.GET("", h.questionBank)
	t.POST("", auth.RequireCSRF(), h.saveBankQuestion)
	t.GET("/:bankID", h.bankDetail)
	t.GET("/versions/:versionID", func(c *gin.Context) {
		if v, ok := h.bankVersion(c, c.Param("versionID")); ok {
			result(c, v, nil)
		}
	})
	t.GET("/versions/:versionID/provenance", h.bankProvenance)
	t.POST("/:bankID/versions", auth.RequireCSRF(), h.saveBankQuestion)
	t.POST("/:bankID/archive", auth.RequireCSRF(), h.archiveBank)
	t.POST("/versions/:versionID/confirm", auth.RequireCSRF(), h.confirmBankQuestion)
	t.POST("/versions/:versionID/reference/confirm", auth.RequireCSRF(), h.confirmBankReference)
	t.GET("/versions/:versionID/rubrics", h.bankRubrics)
	t.POST("/versions/:versionID/rubrics", auth.RequireCSRF(), h.createBankRubric)
	t.POST("/jobs", auth.RequireCSRF(), h.createBankJob)
	t.POST("/evidence", auth.RequireCSRF(), h.bankEvidence)
}

func (h *Handler) bankProvenance(c *gin.Context) {
	v, ok := h.bankVersion(c, c.Param("versionID"))
	if !ok {
		return
	}
	d, e := h.q.BankProvenance(c.Request.Context(), store.BankProvenanceParams{CourseID: c.Param("courseID"), ObjectID: v.ID})
	if e != nil {
		result(c, nil, e)
		return
	}
	a, e := h.q.BankAssets(c.Request.Context(), v.ID)
	result(c, gin.H{"decisions": d, "assets": a}, e)
}

func (h *Handler) questionBank(c *gin.Context) {
	v, e := h.q.ListQuestionBank(c.Request.Context(), c.Param("courseID"))
	result(c, v, e)
}
func (h *Handler) bankVersionWithBank(c *gin.Context, id string) (store.BankQuestionVersion, store.QuestionBank, bool) {
	v, e := h.q.GetBankQuestionVersion(c.Request.Context(), id)
	var b store.QuestionBank
	if e != nil {
		result(c, nil, e)
		return v, b, false
	}
	b, e = h.q.GetQuestionBank(c.Request.Context(), store.GetQuestionBankParams{ID: v.BankID, CourseID: c.Param("courseID")})
	if e != nil {
		if errors.Is(e, pgx.ErrNoRows) {
			identity.Fail(c, 403, "forbidden", "题目不属于当前课程")
			return v, b, false
		}
		result(c, nil, e)
		return v, b, false
	}
	return v, b, true
}
func (h *Handler) bankVersion(c *gin.Context, id string) (store.BankQuestionVersion, bool) {
	v, _, ok := h.bankVersionWithBank(c, id)
	return v, ok
}
func (h *Handler) bankDetail(c *gin.Context) {
	ctx := c.Request.Context()
	b, e := h.q.GetQuestionBank(ctx, store.GetQuestionBankParams{ID: c.Param("bankID"), CourseID: c.Param("courseID")})
	if e != nil {
		result(c, nil, e)
		return
	}
	versions, e := h.q.ListBankQuestionVersions(ctx, b.ID)
	if e != nil {
		result(c, nil, e)
		return
	}
	uses, e := h.q.ListBankUses(ctx, b.ID)
	result(c, gin.H{"entry": b, "versions": versions, "uses": uses}, e)
}

type bankQuestionInput struct {
	Title            string      `json:"title"`
	Prompt           string      `json:"prompt"`
	Type             string      `json:"type"`
	MaxScore         int32       `json:"max_score"`
	Requirements     string      `json:"requirements"`
	ReferenceAnswer  string      `json:"reference_answer"`
	Options          []string    `json:"options"`
	CorrectAnswer    string      `json:"correct_answer"`
	KnowledgePointID string      `json:"knowledge_point_id"`
	EvidenceIDs      []string    `json:"evidence_ids"`
	Criteria         []criterion `json:"criteria"`
	AIJobID          string      `json:"ai_job_id"`
	BaseVersionID    string      `json:"base_version_id"`
}

func (h *Handler) saveBankQuestion(c *gin.Context) {
	var in bankQuestionInput
	if !bind(c, &in) {
		return
	}
	if in.Type == "" {
		in.Type = "subjective"
	}
	if !validText(in.Title, 500) || !validText(in.Prompt, 30000) || in.MaxScore < 1 || in.MaxScore > 10000 || len(in.Requirements) > 12000 || len(in.ReferenceAnswer) > 30000 || (in.Type != "subjective" && in.Type != "code" && in.Type != "quiz") {
		invalid(c, "请填写题目名称、题干、题型和1至10000的整数满分")
		return
	}
	if in.Type == "quiz" {
		seen := map[string]bool{}
		found := false
		for _, o := range in.Options {
			if !validText(o, 1000) || seen[o] {
				invalid(c, "选项不能为空或重复")
				return
			}
			seen[o] = true
			if o == in.CorrectAnswer {
				found = true
			}
		}
		if len(in.Options) < 2 || len(in.Options) > 8 || !found {
			invalid(c, "客观题须有2至8个选项且正确答案属于选项")
			return
		}
	} else {
		in.Options = []string{}
		in.CorrectAnswer = ""
	}
	ctx := c.Request.Context()
	tx, e := h.db.Begin(ctx)
	if e != nil {
		result(c, nil, e)
		return
	}
	defer tx.Rollback(ctx)
	q := h.q.WithTx(tx)
	if in.AIJobID != "" {
		j, err := q.GetProcessingJob(ctx, store.GetProcessingJobParams{ID: in.AIJobID, CourseID: c.Param("courseID")})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				invalid(c, "出题草稿来源无效")
				return
			}
			result(c, nil, err)
			return
		}
		if j.Kind != "question_generate" || j.State != "succeeded" {
			invalid(c, "出题草稿来源无效")
			return
		}
	}
	if in.KnowledgePointID != "" {
		p, e := q.GetKnowledgePoint(ctx, in.KnowledgePointID)
		if e != nil {
			if errors.Is(e, pgx.ErrNoRows) {
				invalid(c, "知识点不属于本课程")
				return
			}
			result(c, nil, e)
			return
		}
		if p.CourseID != c.Param("courseID") || p.Kind != "point" {
			invalid(c, "只能关联本课程内的叶子知识点")
			return
		}
	}
	refs, e := rag.ResolveEvidence(ctx, q, c.Param("courseID"), in.EvidenceIDs)
	if e != nil {
		ragError(c, e)
		return
	}
	if len(in.Criteria) > 0 {
		if in.Type == "quiz" {
			invalid(c, "客观题不使用逐点标准")
			return
		}
		if e = rag.ValidateCriteria(in.Criteria, in.MaxScore, refs); e != nil {
			ragError(c, e)
			return
		}
	}
	bankID := c.Param("bankID")
	if bankID == "" {
		bankID = uuid.NewString()
		if _, e = q.CreateQuestionBank(ctx, store.CreateQuestionBankParams{ID: bankID, CourseID: c.Param("courseID"), CreatedBy: identity.Current(c).ID}); e != nil {
			result(c, nil, e)
			return
		}
	}
	b, e := q.LockQuestionBank(ctx, store.LockQuestionBankParams{ID: bankID, CourseID: c.Param("courseID")})
	if e != nil {
		result(c, nil, e)
		return
	}
	if b.Archived {
		invalid(c, "题目已停用，请先恢复")
		return
	}
	raw, _ := json.Marshal(refs)
	v, e := q.CreateBankQuestionVersion(ctx, store.CreateBankQuestionVersionParams{ID: uuid.NewString(), BankID: b.ID, Title: in.Title, Prompt: in.Prompt, Type: in.Type, MaxScore: in.MaxScore, Requirements: in.Requirements, ReferenceAnswer: in.ReferenceAnswer, Options: nonNilStrings(in.Options), CorrectAnswer: in.CorrectAnswer, KnowledgePointID: text(in.KnowledgePointID), EvidenceRefs: raw, CreatedBy: identity.Current(c).ID})
	if e != nil {
		result(c, nil, e)
		return
	}
	if len(in.Criteria) > 0 {
		criteria, _ := json.Marshal(in.Criteria)
		if _, e = q.CreateBankRubric(ctx, store.CreateBankRubricParams{ID: uuid.NewString(), BankQuestionVersionID: text(v.ID), Criteria: criteria, EvidenceRefs: raw, CreatedBy: identity.Current(c).ID}); e != nil {
			result(c, nil, e)
			return
		}
	}
	if in.AIJobID != "" {
		if _, e = recordDecision(ctx, q, c.Param("courseID"), identity.Current(c).ID, "question_adopt", v.ID, "教师编辑后保存AI题目草稿", map[string]any{"job_id": in.AIJobID, "evidence_ids": in.EvidenceIDs}, v); e != nil {
			result(c, nil, e)
			return
		}
	}
	if c.Param("bankID") != "" {
		sourceVersionID := ""
		if in.BaseVersionID != "" {
			baseVer, err := q.GetBankQuestionVersion(ctx, in.BaseVersionID)
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					invalid(c, "基线版本不存在")
					return
				}
				result(c, nil, err)
				return
			}
			if baseVer.BankID != v.BankID {
				invalid(c, "基线版本不属于当前题目")
				return
			}
			sourceVersionID = baseVer.ID
		} else {
			versions, err := q.ListBankQuestionVersions(ctx, v.BankID)
			if err != nil {
				result(c, nil, err)
				return
			}
			if len(versions) > 1 {
				sourceVersionID = versions[1].ID
			}
		}
		if sourceVersionID != "" {
			assets, err := q.BankAssets(ctx, sourceVersionID)
			if err != nil {
				result(c, nil, err)
				return
			}
			for _, a := range assets {
				if err = q.LinkBankAsset(ctx, store.LinkBankAssetParams{VersionID: v.ID, AssetID: a.ID}); err != nil {
					result(c, nil, err)
					return
				}
			}
		}
	}
	result(c, v, tx.Commit(ctx))
}

func (h *Handler) bankEvidence(c *gin.Context) {
	var in struct {
		Query       string `json:"query"`
		SourceID    string `json:"source_id"`
		KnowledgeID string `json:"knowledge_id"`
	}
	if !bind(c, &in) {
		return
	}
	if len(in.Query) > 4000 || strings.ContainsRune(in.Query, '\x00') {
		invalid(c, "检索词不能超过4000字节")
		return
	}
	ctx := c.Request.Context()
	course := c.Param("courseID")
	if in.SourceID != "" || in.KnowledgeID != "" {
		ids, e := h.q.ListBankEvidenceScope(ctx, store.ListBankEvidenceScopeParams{CourseID: course, SourceID: in.SourceID, KnowledgeID: in.KnowledgeID})
		if e != nil {
			result(c, nil, e)
			return
		}
		hits := []rag.Hit{}
		if len(ids) > 0 {
			rows, err := h.db.Query(ctx, `SELECT c.id,c.source_id,c.knowledge_id,c.resource_id,c.fragment_ids,c.title,c.heading,c.body,c.locator
FROM retrieval_chunks c
LEFT JOIN material_sources s ON s.id=c.source_id
LEFT JOIN knowledge_entries k ON k.id=c.knowledge_id
LEFT JOIN resources r ON r.id=c.resource_id
WHERE c.id=ANY($1::text[]) AND c.course_id=$2 AND c.active
AND ((s.state='active') OR
 (k.state='confirmed' AND k.use_for_grading AND NOT EXISTS(
  SELECT 1 FROM jsonb_array_elements(k.evidence) ev LEFT JOIN material_sources ms ON ms.id=ev->>'source_id'
  WHERE ms.id IS NULL OR ms.state<>'active' OR NOT ms.allow_derived)) OR
 (r.status='published' AND r.source_id IS NULL))
ORDER BY c.id`, ids, course)
			if err != nil {
				result(c, nil, err)
				return
			}
			defer rows.Close()
			lowerQ := strings.ToLower(strings.TrimSpace(in.Query))
			tokens := []string{}
			if lowerQ != "" {
				tokens = rag.Tokens(in.Query)
			}
			for rows.Next() {
				var (
					id, title, heading, body       string
					sourceID, knowledgeID, resID   pgtype.Text
					fragmentIDs                    []string
					locator                        json.RawMessage
				)
				if err := rows.Scan(&id, &sourceID, &knowledgeID, &resID, &fragmentIDs, &title, &heading, &body, &locator); err != nil {
					result(c, nil, err)
					return
				}
				score := 0.0
				if lowerQ != "" {
					haystack := strings.ToLower(title + " " + heading + " " + body)
					matched := 0
					for _, tok := range tokens {
						if strings.Contains(haystack, tok) {
							matched++
						}
					}
					if matched == 0 && strings.Contains(haystack, lowerQ) {
						matched = 1
					}
					if matched == 0 {
						continue
					}
					score = float64(matched)
				}
				hits = append(hits, rag.Hit{
					ID:          id,
					SourceID:    sourceID.String,
					KnowledgeID: knowledgeID.String,
					ResourceID:  resID.String,
					FragmentIDs: nonNilStrings(fragmentIDs),
					Title:       title,
					Heading:     heading,
					Body:        body,
					Locator:     locator,
					Score:       score,
				})
			}
			if err := rows.Err(); err != nil {
				result(c, nil, err)
				return
			}
			if lowerQ != "" {
				sort.SliceStable(hits, func(i, j int) bool { return hits[i].Score > hits[j].Score })
			}
		}
		result(c, gin.H{"hits": hits, "mode": "scope"}, nil)
		return
	}
	if h.rag == nil {
		identity.Fail(c, 503, "rag_not_configured", "检索尚未启用，可手工维护题目和标准")
		return
	}
	if !validText(in.Query, 4000) {
		invalid(c, "请输入检索词或选择来源范围")
		return
	}
	hits, mode, e := h.rag.Search(ctx, course, identity.Current(c).ID, in.Query, "grading", true)
	if e != nil {
		ragError(c, e)
		return
	}
	result(c, gin.H{"hits": hits, "mode": mode}, nil)
}

func (h *Handler) archiveBank(c *gin.Context) {
	var in struct {
		Archived bool `json:"archived"`
	}
	if !bind(c, &in) {
		return
	}
	v, e := h.q.ArchiveQuestionBank(c.Request.Context(), store.ArchiveQuestionBankParams{ID: c.Param("bankID"), CourseID: c.Param("courseID"), Archived: in.Archived})
	result(c, v, e)
}

func (h *Handler) confirmBankQuestion(c *gin.Context)  { h.confirmBankPart(c, false) }
func (h *Handler) confirmBankReference(c *gin.Context) { h.confirmBankPart(c, true) }
func (h *Handler) confirmBankPart(c *gin.Context, reference bool) {
	v, ok := h.bankVersion(c, c.Param("versionID"))
	if !ok {
		return
	}
	if (reference && v.ReferenceState != "draft") || (!reference && v.State != "draft") {
		identity.Fail(c, 409, "state_conflict", "该内容已确认，修改请另建版本")
		return
	}
	if reference && strings.TrimSpace(v.ReferenceAnswer) == "" {
		invalid(c, "没有参考解答可确认")
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
	b, e := q.LockQuestionBank(ctx, store.LockQuestionBankParams{ID: v.BankID, CourseID: c.Param("courseID")})
	if e != nil {
		result(c, nil, e)
		return
	}
	if b.Archived {
		invalid(c, "题目已停用")
		return
	}
	ids, e := rag.EvidenceIDs(v.EvidenceRefs)
	if e == nil {
		_, e = rag.ResolveEvidence(ctx, q, c.Param("courseID"), ids)
	}
	if e != nil {
		ragError(c, e)
		return
	}
	if reference {
		v, e = q.ConfirmBankReference(ctx, v.ID)
	} else {
		v, e = q.ConfirmBankQuestion(ctx, v.ID)
	}
	if errors.Is(e, pgx.ErrNoRows) {
		identity.Fail(c, 409, "state_conflict", "内容状态已改变，请刷新")
		return
	}
	if e != nil {
		result(c, nil, e)
		return
	}
	result(c, v, tx.Commit(ctx))
}

func (h *Handler) bankRubrics(c *gin.Context) {
	v, ok := h.bankVersion(c, c.Param("versionID"))
	if !ok {
		return
	}
	rows, e := h.q.ListBankRubrics(c.Request.Context(), text(v.ID))
	result(c, rows, e)
}
func (h *Handler) createBankRubric(c *gin.Context) {
	var in struct {
		Criteria    []criterion `json:"criteria"`
		EvidenceIDs []string    `json:"evidence_ids"`
		AIJobID     string      `json:"ai_job_id"`
	}
	if !bind(c, &in) {
		return
	}
	v, ok := h.bankVersion(c, c.Param("versionID"))
	if !ok {
		return
	}
	if v.Type == "quiz" {
		invalid(c, "客观题使用教师确认的答案规则")
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
	b, e := q.LockQuestionBank(ctx, store.LockQuestionBankParams{ID: v.BankID, CourseID: c.Param("courseID")})
	if e != nil {
		result(c, nil, e)
		return
	}
	if b.Archived {
		invalid(c, "题目已停用")
		return
	}
	refs, e := rag.ResolveEvidence(ctx, q, c.Param("courseID"), in.EvidenceIDs)
	if e != nil {
		ragError(c, e)
		return
	}
	if e = rag.ValidateCriteria(in.Criteria, v.MaxScore, refs); e != nil {
		ragError(c, e)
		return
	}
	if in.AIJobID != "" {
		j, e := q.GetProcessingJob(ctx, store.GetProcessingJobParams{ID: in.AIJobID, CourseID: c.Param("courseID")})
		if e != nil {
			result(c, nil, e)
			return
		}
		var input rag.JobInput
		if json.Unmarshal(j.Input, &input) != nil || j.State != "succeeded" || (j.Kind != "bank_rubric" && j.Kind != "question_generate") || (j.Kind == "bank_rubric" && input.QuestionID != v.ID) {
			invalid(c, "AI草稿与当前题目版本不匹配")
			return
		}
	}
	raw, _ := json.Marshal(in.Criteria)
	evidence, _ := json.Marshal(refs)
	r, e := q.CreateBankRubric(ctx, store.CreateBankRubricParams{ID: uuid.NewString(), BankQuestionVersionID: text(v.ID), Criteria: raw, EvidenceRefs: evidence, CreatedBy: identity.Current(c).ID})
	if e != nil {
		result(c, nil, e)
		return
	}
	if in.AIJobID != "" {
		if _, e = recordDecision(ctx, q, c.Param("courseID"), identity.Current(c).ID, "rubric_adopt", r.ID, "教师核对后保存AI标准草稿", map[string]any{"job_id": in.AIJobID, "question_version_id": v.ID}, r); e != nil {
			result(c, nil, e)
			return
		}
	}
	result(c, r, tx.Commit(ctx))
}

// A published assignment uses exactly this confirmed version pair. Legacy
// questions continue using their original per-question rubric ownership.
func (h *Handler) bankSelection(ctx context.Context, q *store.Queries, course, versionID, rubricID string) (store.BankQuestionVersion, store.RubricVersion, error) {
	v, e := q.GetBankQuestionVersion(ctx, versionID)
	var r store.RubricVersion
	if e != nil {
		return v, r, e
	}
	b, e := q.LockQuestionBank(ctx, store.LockQuestionBankParams{ID: v.BankID, CourseID: course})
	if e != nil {
		return v, r, errors.New("题目不属于本课程")
	}
	if b.Archived || v.State != "confirmed" {
		return v, r, errors.New("请选择未停用的已确认题目版本")
	}
	if v.ReferenceAnswer != "" && v.ReferenceState != "confirmed" {
		return v, r, errors.New("请先审定该版本的参考解答")
	}
	refs, e := rag.EvidenceIDs(v.EvidenceRefs)
	if e == nil {
		_, e = rag.ResolveEvidence(ctx, q, course, refs)
	}
	if e != nil {
		return v, r, e
	}
	if v.Type == "quiz" {
		if rubricID != "" {
			return v, r, errors.New("客观题使用答案规则，无需逐点标准")
		}
		return v, r, nil
	}
	r, e = q.GetRubricVersion(ctx, rubricID)
	if e != nil {
		return v, r, e
	}
	if r.State != "confirmed" || r.BankQuestionVersionID.String != v.ID {
		return v, r, errors.New("标准必须为该题目版本的确认标准")
	}
	ids, e := rag.EvidenceIDs(r.EvidenceRefs)
	var hits []rag.Hit
	if e == nil {
		hits, e = rag.ResolveEvidence(ctx, q, course, ids)
	}
	if e != nil {
		return v, r, e
	}
	var criteria []criterion
	if e = json.Unmarshal(r.Criteria, &criteria); e != nil {
		return v, r, e
	}
	e = rag.ValidateCriteria(criteria, v.MaxScore, hits)
	return v, r, e
}
func rubricMatches(question store.Question, r store.RubricVersion) bool {
	if r.State != "confirmed" {
		return false
	}
	if question.BankQuestionVersionID.Valid {
		return question.BoundRubricID.String == r.ID && r.BankQuestionVersionID.String == question.BankQuestionVersionID.String
	}
	return r.QuestionID.Valid && r.QuestionID.String == question.ID
}

func (h *Handler) createBankJob(c *gin.Context) {
	if h.rag == nil {
		identity.Fail(c, 503, "rag_not_configured", "模型尚未启用，仍可手工维护题库")
		return
	}
	var req struct {
		Kind         string   `json:"kind"`
		QuestionID   string   `json:"question_id"`
		ProfileID    string   `json:"profile_id"`
		Requirements string   `json:"requirements"`
		MaxScore     int32    `json:"max_score"`
		Count        int      `json:"count"`
		EvidenceIDs  []string `json:"evidence_ids"`
	}
	if !bind(c, &req) {
		return
	}
	if req.Kind != "question_generate" && req.Kind != "question_analyze" && req.Kind != "bank_rubric" {
		invalid(c, "题库任务类型无效")
		return
	}
	if _, e := h.rag.Models.Profile(req.ProfileID, "chat"); e != nil {
		ragError(c, e)
		return
	}
	ctx := c.Request.Context()
	in := rag.JobInput{ProfileID: req.ProfileID, QuestionID: req.QuestionID, Requirements: req.Requirements, MaxScore: req.MaxScore, Count: req.Count}
	if req.Kind == "question_generate" {
		if !validText(req.Requirements, 12000) || req.MaxScore < 1 || req.MaxScore > 10000 || req.Count < 1 || req.Count > 3 || len(req.EvidenceIDs) == 0 {
			invalid(c, "请填写出题要求、满分、1至3题及至少一条依据")
			return
		}
		in.QuestionID = ""
	} else {
		v, b, ok := h.bankVersionWithBank(c, req.QuestionID)
		if !ok {
			return
		}
		if v.Type == "quiz" && req.Kind == "bank_rubric" {
			invalid(c, "客观题使用答案规则")
			return
		}
		if b.Archived {
			invalid(c, "题目已停用")
			return
		}
		in.Prompt = v.Prompt
		in.MaxScore = v.MaxScore
		in.Requirements = v.Requirements
		if v.ReferenceAnswer != "" {
			if v.ReferenceState != "confirmed" {
				invalid(c, "请先审定参考解答，或另建不含参考解答的版本")
				return
			}
			in.ReferenceAnswer = v.ReferenceAnswer
		}
	}
	refs, e := rag.ResolveEvidence(ctx, h.q, c.Param("courseID"), req.EvidenceIDs)
	if e != nil {
		ragError(c, e)
		return
	}
	in.EvidenceRefs, _ = json.Marshal(refs)
	j, e := h.rag.CreateJob(ctx, c.Param("courseID"), identity.Current(c).ID, req.Kind, in)
	result(c, j, e)
}

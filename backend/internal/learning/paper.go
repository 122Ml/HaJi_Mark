package learning

import (
	"encoding/json"
	"errors"

	"github.com/122Ml/HaJi_Mark/backend/internal/identity"
	"github.com/122Ml/HaJi_Mark/backend/internal/rag"
	"github.com/122Ml/HaJi_Mark/backend/internal/store"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func (h *Handler) adoptPaper(c *gin.Context) {
	var in struct {
		JobID string `json:"job_id"`
		rag.PaperOutput
	}
	if !bind(c, &in) {
		return
	}
	j, input, e := h.draftJob(c, in.JobID, "paper_split")
	if e != nil {
		ragError(c, e)
		return
	}
	if input.SourceID != c.Param("sourceID") {
		invalid(c, "拆题任务与原卷不匹配")
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
	src, e := q.LockMaterialSource(ctx, store.LockMaterialSourceParams{ID: input.SourceID, CourseID: j.CourseID})
	if e != nil {
		result(c, nil, e)
		return
	}
	if old, err := q.DecisionByJob(ctx, store.DecisionByJobParams{CourseID: j.CourseID, Kind: "paper_adopt", JobID: j.ID}); err == nil {
		result(c, json.RawMessage(old.Output), nil)
		return
	} else if !errors.Is(err, pgx.ErrNoRows) {
		result(c, nil, err)
		return
	}
	if src.ParseRevision != input.ParseRevision || src.State != "active" {
		identity.Fail(c, 409, "stale_revision", "拆题来源版本已改变，请重新核对")
		return
	}
	fs, e := q.ListMaterialFragments(ctx, store.ListMaterialFragmentsParams{SourceID: src.ID, Revision: src.ParseRevision})
	if e != nil {
		result(c, nil, e)
		return
	}
	assets, e := q.ListMaterialAssets(ctx, src.ID)
	if e != nil {
		result(c, nil, e)
		return
	}
	if e = rag.ValidatePaper(in.PaperOutput, fs, assets); e != nil {
		ragError(c, e)
		return
	}
	revisions, e := q.AssetRevisions(ctx, src.ID)
	if e != nil {
		result(c, nil, e)
		return
	}
	assetByID := make(map[string]store.MaterialAsset, len(assets))
	for _, a := range assets {
		assetByID[a.ID] = a
	}
	confirmedAssets := map[string]bool{}
	for _, r := range revisions {
		if r.State == "confirmed" {
			confirmedAssets[r.AssetID] = true
		}
	}
	versions := []store.BankQuestionVersion{}
	for _, v := range in.Questions {
		options := []string{}
		correctAnswer := ""
		if v.Type == "quiz" {
			seen := map[string]bool{}
			found := false
			for _, o := range v.Options {
				if !validText(o, 1000) || seen[o] {
					invalid(c, "单选题选项为空或重复")
					return
				}
				seen[o] = true
				found = found || o == v.CorrectAnswer
			}
			if len(v.Options) < 2 || len(v.Options) > 8 || !found {
				invalid(c, "请先补全单选题选项及正确答案，并将补录来源标为教师")
				return
			}
			options = v.Options
			correctAnswer = v.CorrectAnswer
		}
		b, e := q.CreateQuestionBank(ctx, store.CreateQuestionBankParams{ID: uuid.NewString(), CourseID: j.CourseID, CreatedBy: identity.Current(c).ID})
		if e != nil {
			result(c, nil, e)
			return
		}
		version, e := q.CreateBankQuestionVersion(ctx, store.CreateBankQuestionVersionParams{ID: uuid.NewString(), BankID: b.ID, Title: v.Title, Prompt: v.Prompt, Type: v.Type, MaxScore: v.MaxScore, ReferenceAnswer: v.ReferenceAnswer, Options: options, CorrectAnswer: correctAnswer, EvidenceRefs: []byte("[]"), CreatedBy: identity.Current(c).ID})
		if e != nil {
			result(c, nil, e)
			return
		}
		seenAssets := map[string]bool{}
		for _, aid := range v.AssetIDs {
			if seenAssets[aid] {
				continue
			}
			seenAssets[aid] = true
			a, ok := assetByID[aid]
			if !ok {
				invalid(c, "题图资产不属于当前原卷")
				return
			}
			if a.Kind == "page" || !confirmedAssets[aid] {
				invalid(c, "整页预览不可作为题图；请裁剪题目区域并核对图像")
				return
			}
			if e = q.LinkBankAsset(ctx, store.LinkBankAssetParams{VersionID: version.ID, AssetID: aid}); e != nil {
				result(c, nil, e)
				return
			}
		}
		versions = append(versions, version)
	}
	output := gin.H{"versions": versions, "count": len(versions)}
	if _, e = recordDecision(ctx, q, j.CourseID, identity.Current(c).ID, "paper_adopt", src.ID, "教师校正拆分、合并、重排后入库", map[string]any{"job_id": j.ID, "source_revision": src.ParseRevision, "original": json.RawMessage(j.Output), "adopted": in.PaperOutput}, output); e != nil {
		result(c, nil, e)
		return
	}
	result(c, output, tx.Commit(ctx))
}

package rag

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"unicode"

	"github.com/122Ml/HaJi_Mark/backend/internal/store"
	"github.com/go-ego/gse"
	"github.com/jackc/pgx/v5/pgtype"
)

var tokenizer gse.Segmenter
var tokenOnce sync.Once

func Tokens(s string) []string {
	tokenOnce.Do(func() { _ = tokenizer.LoadDictEmbed("zh") })
	tokens := []string{}
	seen := map[string]bool{}
	for _, v := range tokenizer.CutSearch(strings.ToLower(s), true) {
		v = strings.TrimFunc(v, func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsNumber(r) })
		if v != "" && !seen[v] {
			seen[v] = true
			tokens = append(tokens, v)
		}
	}
	return tokens
}
func queryTokens(s string) string {
	out := []string{}
	for _, t := range Tokens(s) {
		out = append(out, "'"+strings.ReplaceAll(t, "'", "''")+"'")
		if len(out) >= 40 {
			break
		}
	}
	if len(out) == 0 {
		return "'__empty__'"
	}
	return strings.Join(out, " | ")
}

type Hit struct {
	ID          string          `json:"id"`
	SourceID    string          `json:"source_id,omitempty"`
	KnowledgeID string          `json:"knowledge_id,omitempty"`
	ResourceID  string          `json:"resource_id,omitempty"`
	FragmentIDs []string        `json:"fragment_ids"`
	Title       string          `json:"title"`
	Heading     string          `json:"heading"`
	Body        string          `json:"body"`
	Locator     json.RawMessage `json:"locator"`
	Score       float64         `json:"score"`
}
type Service struct {
	Models *Models
	Q      *store.Queries
}

func New(m *Models) *Service { return &Service{Models: m, Q: store.New(m.DB)} }
func (s *Service) Search(ctx context.Context, course, actor, query, purpose string, teacher bool) ([]Hit, string, error) {
	c, e := s.Q.GetBusinessCourse(ctx, course)
	if e != nil {
		return nil, "", e
	}
	merged := map[string]*Hit{}
	keywords, e := s.Q.KeywordSearch(ctx, store.KeywordSearchParams{CourseID: course, QueryTokens: queryTokens(query), Teacher: teacher, Purpose: purpose})
	if e != nil {
		return nil, "", e
	}
	for i, r := range keywords {
		merged[r.ID] = &Hit{ID: r.ID, SourceID: r.SourceID.String, KnowledgeID: r.KnowledgeID.String, ResourceID: r.ResourceID.String, FragmentIDs: r.FragmentIds, Title: r.Title, Heading: r.Heading, Body: r.Body, Locator: r.Locator, Score: 1. / float64(61+i)}
	}
	mode := "keyword"
	warning := ""
	if c.EmbeddingSpaceID.Valid {
		space, e := s.Q.GetEmbeddingSpace(ctx, c.EmbeddingSpaceID.String)
		if e != nil {
			return nil, "", e
		}
		p, e := s.Models.Profile(space.ProfileID, "embedding")
		if e == nil && p.Fingerprint() != space.Fingerprint {
			e = errors.New("向量配置已改变，请重建索引")
		}
		var vectors [][]float64
		if e == nil {
			vectors, e = s.Models.Embed(ctx, course, actor, p, []string{query})
		}
		if e == nil {
			raw, _ := json.Marshal(vectors[0])
			rows, err := s.Q.VectorSearch(ctx, store.VectorSearchParams{CourseID: course, SpaceID: space.ID, VectorText: string(raw), Teacher: teacher, Purpose: purpose})
			if err != nil {
				return nil, "", err
			}
			for i, r := range rows {
				if old := merged[r.ID]; old != nil {
					old.Score += 1. / float64(61+i)
				} else {
					merged[r.ID] = &Hit{ID: r.ID, SourceID: r.SourceID.String, KnowledgeID: r.KnowledgeID.String, ResourceID: r.ResourceID.String, FragmentIDs: r.FragmentIds, Title: r.Title, Heading: r.Heading, Body: r.Body, Locator: r.Locator, Score: 1. / float64(61+i)}
				}
			}
			mode = "hybrid"
		} else {
			warning = e.Error()
		}
	} else {
		warning = "尚无可用向量索引，仅使用关键词检索"
	}
	hits := []Hit{}
	for _, h := range merged {
		hits = append(hits, *h)
	}
	sort.Slice(hits, func(i, j int) bool {
		if hits[i].Score == hits[j].Score {
			return hits[i].ID < hits[j].ID
		}
		return hits[i].Score > hits[j].Score
	})
	if len(hits) > 6 {
		hits = hits[:6]
	}
	// Context upper bound in Unicode characters; citations retain exact stored text.
	chars := 0
	selected := []Hit{}
	for _, h := range hits {
		if chars+len([]rune(h.Body)) > 4000 {
			continue
		}
		chars += len([]rune(h.Body))
		selected = append(selected, h)
	}
	if warning != "" {
		mode += " · " + warning
	}
	return selected, mode, nil
}
func chunks(body string) []string {
	r := []rune(body)
	out := []string{}
	for len(r) > 0 {
		end := len(r)
		if end > 1000 {
			end = 800
			for i := end; i < 1200 && i < len(r); i++ {
				if strings.ContainsRune("。！？\n；", r[i]) {
					end = i + 1
					break
				}
			}
		}
		out = append(out, string(r[:end]))
		if end == len(r) {
			break
		}
		next := end
		if end >= 1200 {
			next = end - 80
		}
		r = r[next:]
	}
	return out
}
func (s *Service) putChunks(ctx context.Context, course, source, knowledge, resource, title, heading, body string, fragments []string, loc json.RawMessage) error {
	for i, b := range chunks(body) {
		id := Hash(strings.Join([]string{course, source, knowledge, resource, strings.Join(fragments, ","), title, heading, string(loc), fmt.Sprint(i), b}, "|"))
		if e := s.Q.PutRetrievalChunk(ctx, store.PutRetrievalChunkParams{ID: id, CourseID: course, SourceID: nullable(source), KnowledgeID: nullable(knowledge), ResourceID: nullable(resource), FragmentIds: fragments, Title: title, Heading: heading, Body: b, Locator: loc, InputHash: Hash(b), SearchTokens: strings.Join(Tokens(title+" "+heading+" "+b), " ")}); e != nil {
			return e
		}
	}
	return nil
}
func nullable(s string) pgtype.Text { return pgtype.Text{String: s, Valid: s != ""} }
func (s *Service) Index(ctx context.Context, j store.ProcessingJob, in JobInput) (any, error) {
	p, e := s.Models.Profile(in.ProfileID, "embedding")
	if e != nil {
		return nil, e
	}
	space, e := s.Q.PutEmbeddingSpace(ctx, store.PutEmbeddingSpaceParams{ID: Hash(p.Fingerprint())[:32], ProfileID: p.ID, Fingerprint: p.Fingerprint(), Model: p.Model, Dimensions: int32(p.Dimensions), ChunkerVersion: "structure-v1"})
	if e != nil {
		return nil, e
	}
	if e = s.Q.RetireObsoleteSourceChunks(ctx, j.CourseID); e != nil {
		return nil, e
	}
	sources, e := s.Q.ListMaterialSources(ctx, j.CourseID)
	if e != nil {
		return nil, e
	}
	for _, src := range sources {
		if src.State != "active" || src.ParseState != "ready" {
			continue
		}
		fs, err := s.Q.ListMaterialFragments(ctx, store.ListMaterialFragmentsParams{SourceID: src.ID, Revision: src.ParseRevision})
		if err != nil {
			return nil, err
		}
		for _, f := range fs {
			if f.Quality != "ready" {
				continue
			}
			if e = s.putChunks(ctx, j.CourseID, src.ID, "", "", src.Title, f.Heading, f.Body, []string{f.ID}, f.Locator); e != nil {
				return nil, e
			}
		}
	}
	knowledge, e := s.Q.ListIndexKnowledge(ctx, j.CourseID)
	if e != nil {
		return nil, e
	}
	for _, k := range knowledge {
		loc, _ := json.Marshal(map[string]any{"knowledge_version": k.Version})
		if e = s.putChunks(ctx, j.CourseID, "", k.ID, "", k.Title, k.Category, k.Body+"\n适用条件："+k.Conditions, []string{}, loc); e != nil {
			return nil, e
		}
	}
	resources, e := s.Q.ListLegacyIndexResources(ctx, j.CourseID)
	if e != nil {
		return nil, e
	}
	for _, r := range resources {
		loc, _ := json.Marshal(map[string]any{"resource_version": r.Version, "locator": r.Locator})
		if e = s.putChunks(ctx, j.CourseID, "", "", r.ID, r.Title, "", r.Content, []string{}, loc); e != nil {
			return nil, e
		}
	}
	pending, e := s.Q.MissingChunkEmbeddings(ctx, store.MissingChunkEmbeddingsParams{CourseID: j.CourseID, SpaceID: space.ID})
	if e != nil {
		return nil, e
	}
	for start := 0; start < len(pending); start += p.BatchSize {
		if e = ctx.Err(); e != nil {
			return nil, e
		}
		end := start + p.BatchSize
		if end > len(pending) {
			end = len(pending)
		}
		input := []string{}
		for _, c := range pending[start:end] {
			input = append(input, c.Title+"\n"+c.Heading+"\n"+c.Body)
		}
		vecs, err := s.Models.Embed(ctx, j.CourseID, j.CreatedBy, p, input)
		if err != nil {
			return nil, err
		}
		for i, v := range vecs {
			raw, _ := json.Marshal(v)
			if e = s.Q.PutChunkEmbedding(ctx, store.PutChunkEmbeddingParams{ChunkID: pending[start+i].ID, SpaceID: space.ID, Dimensions: int32(p.Dimensions), VectorText: string(raw)}); e != nil {
				return nil, e
			}
		}
		_ = s.Q.ProgressProcessingJob(ctx, store.ProgressProcessingJobParams{ID: j.ID, Progress: int32(end * 90 / len(pending))})
	}
	if e = ctx.Err(); e != nil {
		return nil, e
	}
	if e = s.Q.ActivateEmbeddingSpace(ctx, store.ActivateEmbeddingSpaceParams{ID: j.CourseID, EmbeddingSpaceID: nullable(space.ID)}); e != nil {
		return nil, e
	}
	return map[string]any{"space_id": space.ID, "embedded": len(pending), "status": "ready"}, nil
}

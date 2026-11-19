package rag

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"sort"
	"strings"
	"sync"
	"unicode"

	"github.com/122Ml/HaJi_Mark/backend/internal/store"
	"github.com/go-ego/gse"
	"github.com/hibiken/asynq"
	"github.com/jackc/pgx/v5/pgtype"
)

var tokenizer gse.Segmenter
var tokenOnce sync.Once

var searchStopWords = map[string]bool{
	"的": true, "了": true, "是": true, "在": true, "和": true, "与": true, "或": true,
	"及": true, "对": true, "为": true, "以": true, "把": true, "被": true, "将": true,
	"由": true, "从": true, "到": true, "中": true, "上": true, "下": true, "不": true,
	"也": true, "都": true, "就": true, "而": true, "但": true, "如": true, "这": true,
	"那": true, "其": true, "它": true, "他": true, "她": true, "我": true, "你": true,
	"们": true, "之": true, "所": true, "个": true, "一": true, "有": true, "无": true,
	"什么": true, "如何": true, "怎么": true, "哪些": true, "是否": true, "可以": true, "需要": true,
	"the": true, "and": true, "for": true, "are": true, "but": true, "not": true,
	"you": true, "all": true, "can": true, "had": true, "her": true, "was": true,
	"one": true, "our": true, "out": true, "is": true, "in": true, "to": true,
	"of": true, "a": true, "an": true, "at": true, "by": true, "on": true,
	"or": true, "as": true, "be": true, "it": true, "if": true, "do": true,
	"no": true, "so": true, "up": true, "we": true, "he": true, "me": true,
	"my": true, "this": true, "that": true, "with": true, "from": true, "what": true,
	"how": true, "why": true, "who": true, "when": true, "where": true,
}

func Tokens(s string) []string {
	tokenOnce.Do(func() {
		if err := tokenizer.LoadDictEmbed("zh"); err != nil {
			log.Printf("gse LoadDictEmbed failed: %v", err)
		}
	})
	tokens := []string{}
	seen := map[string]bool{}
	for _, v := range tokenizer.CutSearch(strings.ToLower(s), true) {
		v = strings.ReplaceAll(v, "\x00", "")
		v = strings.TrimFunc(v, func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsNumber(r) })
		if v != "" && !seen[v] {
			seen[v] = true
			tokens = append(tokens, v)
		}
	}
	return tokens
}

func escapeTSLexeme(t string) string {
	t = strings.ReplaceAll(t, "\x00", "")
	t = strings.ReplaceAll(t, `\`, `\\`)
	t = strings.ReplaceAll(t, `'`, `''`)
	return "'" + t + "'"
}

func queryTokens(s string) string {
	all := Tokens(s)
	filtered := make([]string, 0, len(all))
	for _, t := range all {
		if searchStopWords[t] {
			continue
		}
		filtered = append(filtered, t)
	}
	if len(filtered) == 0 {
		filtered = all
	}
	out := []string{}
	for _, t := range filtered {
		out = append(out, escapeTSLexeme(t))
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
	client *asynq.Client
}

func redisAddr() string {
	if addr := strings.TrimSpace(os.Getenv("REDIS_ADDR")); addr != "" {
		return addr
	}
	return "redis:6379"
}

func New(m *Models) *Service {
	var q *store.Queries
	if m != nil && m.DB != nil {
		q = store.New(m.DB)
	}
	return &Service{
		Models: m,
		Q:      q,
		client: asynq.NewClient(asynq.RedisClientOpt{Addr: redisAddr()}),
	}
}

func (s *Service) Enqueue(jobID string) {
	if s == nil || s.client == nil || jobID == "" {
		return
	}
	if err := enqueue(s.client, jobID); err != nil {
		log.Printf("RAG enqueue %s failed: %v", jobID, err)
	}
}

func (s *Service) Close() error {
	if s == nil || s.client == nil {
		return nil
	}
	return s.client.Close()
}
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
func isSentenceBreak(r []rune, i int) bool {
	switch r[i] {
	case '。', '！', '？', '\n', '；':
		return true
	case '.', '?', '!', ';':
		return i+1 == len(r) || unicode.IsSpace(r[i+1])
	}
	return false
}

func chunks(body string) []string {
	r := []rune(body)
	out := []string{}
	for len(r) > 0 {
		if len(r) <= 1000 {
			out = append(out, string(r))
			break
		}
		end := 800
		foundBreak := false
		limit := 1200
		if limit > len(r) {
			limit = len(r)
		}
		for i := 800; i < limit; i++ {
			if isSentenceBreak(r, i) {
				end = i + 1
				foundBreak = true
				break
			}
		}
		if !foundBreak {
			end = 1000
			if end > len(r) {
				end = len(r)
			}
		}
		out = append(out, string(r[:end]))
		if end >= len(r) {
			break
		}
		next := end
		if !foundBreak {
			next = end - 80
			if next <= 0 {
				next = end
			}
		}
		r = r[next:]
	}
	return out
}
func putChunksWithQueries(ctx context.Context, q *store.Queries, course, source, knowledge, resource, title, heading, body string, fragments []string, loc json.RawMessage) error {
	for i, b := range chunks(body) {
		id := Hash(strings.Join([]string{course, source, knowledge, resource, strings.Join(fragments, ","), title, heading, string(loc), fmt.Sprint(i), b}, "|"))
		if e := q.PutRetrievalChunk(ctx, store.PutRetrievalChunkParams{ID: id, CourseID: course, SourceID: nullable(source), KnowledgeID: nullable(knowledge), ResourceID: nullable(resource), FragmentIds: fragments, Title: title, Heading: heading, Body: b, Locator: loc, InputHash: Hash(b), SearchTokens: strings.Join(Tokens(title+" "+heading+" "+b), " ")}); e != nil {
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
	indexTx, e := s.Models.DB.Begin(ctx)
	if e != nil {
		return nil, e
	}
	defer indexTx.Rollback(ctx)
	iq := s.Q.WithTx(indexTx)
	if e = iq.RetireObsoleteSourceChunks(ctx, j.CourseID); e != nil {
		return nil, e
	}
	if e = iq.RetireObsoleteKnowledgeChunks(ctx, j.CourseID); e != nil {
		return nil, e
	}
	if e = iq.RetireObsoleteResourceChunks(ctx, j.CourseID); e != nil {
		return nil, e
	}
	sources, e := iq.ListMaterialSources(ctx, j.CourseID)
	if e != nil {
		return nil, e
	}
	for _, src := range sources {
		if src.State != "active" || src.ParseState != "ready" {
			continue
		}
		fs, err := iq.ListMaterialFragments(ctx, store.ListMaterialFragmentsParams{SourceID: src.ID, Revision: src.ParseRevision})
		if err != nil {
			return nil, err
		}
		for _, f := range fs {
			if f.Quality != "ready" {
				continue
			}
			if e = putChunksWithQueries(ctx, iq, j.CourseID, src.ID, "", "", src.Title, f.Heading, f.Body, []string{f.ID}, f.Locator); e != nil {
				return nil, e
			}
		}
	}
	knowledge, e := iq.ListIndexKnowledge(ctx, j.CourseID)
	if e != nil {
		return nil, e
	}
	for _, k := range knowledge {
		loc, _ := json.Marshal(map[string]any{"knowledge_version": k.Version})
		if e = putChunksWithQueries(ctx, iq, j.CourseID, "", k.ID, "", k.Title, k.Category, k.Body+"\n适用条件："+k.Conditions, []string{}, loc); e != nil {
			return nil, e
		}
	}
	resources, e := iq.ListLegacyIndexResources(ctx, j.CourseID)
	if e != nil {
		return nil, e
	}
	for _, r := range resources {
		loc, _ := json.Marshal(map[string]any{"resource_version": r.Version, "locator": r.Locator})
		if e = putChunksWithQueries(ctx, iq, j.CourseID, "", "", r.ID, r.Title, "", r.Content, []string{}, loc); e != nil {
			return nil, e
		}
	}
	if e = indexTx.Commit(ctx); e != nil {
		return nil, e
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
		if err := s.Q.ProgressProcessingJob(ctx, store.ProgressProcessingJobParams{ID: j.ID, Progress: int32(end * 90 / len(pending))}); err != nil {
			log.Printf("RAG index progress update %s failed: %v", j.ID, err)
		}
	}
	if e = ctx.Err(); e != nil {
		return nil, e
	}
	tx, e := s.Models.DB.Begin(ctx)
	if e != nil {
		return nil, e
	}
	defer tx.Rollback(ctx)
	q := s.Q.WithTx(tx)
	if e = lockRunningJob(ctx, q, j); e != nil {
		return nil, e
	}
	if e = q.ActivateEmbeddingSpace(ctx, store.ActivateEmbeddingSpaceParams{ID: j.CourseID, EmbeddingSpaceID: nullable(space.ID)}); e != nil {
		return nil, e
	}
	output := map[string]any{"space_id": space.ID, "embedded": len(pending), "status": "ready"}
	raw, _ := json.Marshal(output)
	if e = q.FinishProcessingJob(ctx, store.FinishProcessingJobParams{ID: j.ID, State: "succeeded", Output: raw}); e != nil {
		return nil, e
	}
	return output, tx.Commit(ctx)
}

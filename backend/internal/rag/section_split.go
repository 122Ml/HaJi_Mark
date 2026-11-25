package rag

import (
	"encoding/json"
	"errors"
	"strings"

	"github.com/122Ml/HaJi_Mark/backend/internal/store"
)

// SectionSplitInput is the minimal shape needed to resolve one proposed section.
type SectionSplitInput struct {
	Title       string
	FragmentIDs []string
	SplitQuotes []string
}

// SectionSpan is the rune range of a section inside its first and last fragment.
// EndChar is relative to the last fragment; 0 never survives resolution.
type SectionSpan struct {
	StartChar int32
	EndChar   int32
}

// ResolveSectionSpans validates that the proposed sections form a contiguous,
// order-preserving partition of frags and resolves in-fragment split offsets.
//
// A section may start in the middle of a fragment only by sharing that fragment
// with the previous section: its first fragment id must equal the previous
// section's last fragment id and it must carry exactly one unique quote.
func ResolveSectionSpans(rows []SectionSplitInput, frags []store.MaterialFragment) ([]SectionSpan, error) {
	if len(rows) == 0 {
		return nil, errors.New("切分方案缺少分段")
	}
	if len(frags) == 0 {
		return nil, errors.New("切分方案缺少片段")
	}
	body := make(map[string][]rune, len(frags))
	order := make(map[string]int, len(frags))
	hasTimecode := make(map[string]bool, len(frags))
	for i, f := range frags {
		body[f.ID] = []rune(f.Body)
		order[f.ID] = i
		hasTimecode[f.ID] = fragHasTimecode(f)
	}
	spans := make([]SectionSpan, len(rows))
	splitFrags := make(map[string]bool)
	cursor := 0
	prevLast := ""
	for i, r := range rows {
		if strings.TrimSpace(r.Title) == "" {
			return nil, errors.New("切分段缺少标题")
		}
		if len(r.FragmentIDs) == 0 {
			return nil, errors.New("切分段缺少片段")
		}
		if len(r.SplitQuotes) > 1 {
			return nil, errors.New("单个切分段最多一个切点引文")
		}
		quote := ""
		if len(r.SplitQuotes) == 1 {
			quote = strings.TrimSpace(r.SplitQuotes[0])
			if quote == "" || len([]byte(quote)) > 200 || strings.ContainsRune(quote, '\x00') {
				return nil, errors.New("切点引文为空、过长或含非法字符")
			}
		}
		if i == 0 && quote != "" {
			return nil, errors.New("首个切分段不能使用切点引文")
		}
		shared := i > 0 && r.FragmentIDs[0] == prevLast
		if shared && quote == "" {
			return nil, errors.New("同一片段被相邻两段共用时必须给出切点引文")
		}
		if !shared && quote != "" {
			return nil, errors.New("切点引文只能用在相邻两段共用的片段上")
		}
		if shared {
			if splitFrags[r.FragmentIDs[0]] {
				return nil, errors.New("单个片段最多拆分为两段，不支持三段及以上切分")
			}
			if _, ok := body[r.FragmentIDs[0]]; !ok {
				return nil, errors.New("切点片段不属于当前原件版本")
			}
			if hasTimecode[r.FragmentIDs[0]] {
				return nil, errors.New("视频片段不支持片段内切分")
			}
			idx, ok := uniqueQuoteIndex(body[r.FragmentIDs[0]], quote)
			if !ok {
				return nil, errors.New("切点引文未在该片段中原样且唯一出现")
			}
			if idx == 0 {
				return nil, errors.New("切点引文不能等于片段开头")
			}
			splitFrags[r.FragmentIDs[0]] = true
			spans[i].StartChar = int32(idx)
			spans[i-1].EndChar = int32(idx)
		}
		start := 0
		if shared {
			start = 1
		}
		for _, id := range r.FragmentIDs[start:] {
			idx, ok := order[id]
			if !ok || idx != cursor {
				return nil, errors.New("切分片段必须按原件顺序严格连续且不重复、不遗漏")
			}
			cursor++
		}
		last := r.FragmentIDs[len(r.FragmentIDs)-1]
		if spans[i].EndChar == 0 {
			spans[i].EndChar = int32(len(body[last]))
		}
		prevLast = last
	}
	if cursor != len(frags) {
		return nil, errors.New("切分必须覆盖全部片段，不遗漏")
	}
	for i := range spans {
		firstLen := int32(len(body[rows[i].FragmentIDs[0]]))
		lastLen := int32(len(body[rows[i].FragmentIDs[len(rows[i].FragmentIDs)-1]]))
		if len(rows[i].FragmentIDs) == 1 {
			if spans[i].StartChar < 0 || spans[i].EndChar <= spans[i].StartChar || spans[i].EndChar > firstLen {
				return nil, errors.New("切分区间为空或起止颠倒")
			}
			continue
		}
		if spans[i].StartChar < 0 || spans[i].StartChar >= firstLen || spans[i].EndChar <= 0 || spans[i].EndChar > lastLen {
			return nil, errors.New("切分区间为空或起止颠倒")
		}
	}
	return spans, nil
}

// uniqueQuoteIndex returns the rune offset of the only occurrence of quote.
func uniqueQuoteIndex(body []rune, quote string) (int, bool) {
	if quote == "" || len(body) == 0 {
		return 0, false
	}
	q := []rune(quote)
	if len(q) == 0 || len(q) > len(body) {
		return 0, false
	}
	first := -1
	for i := 0; i+len(q) <= len(body); i++ {
		if string(body[i:i+len(q)]) != quote {
			continue
		}
		if first >= 0 {
			return 0, false // ambiguous split point
		}
		first = i
	}
	if first < 0 {
		return 0, false
	}
	return first, true
}

func fragHasTimecode(f store.MaterialFragment) bool {
	var loc struct {
		TimeStartMs int64 `json:"time_start_ms"`
		TimeEndMs   int64 `json:"time_end_ms"`
	}
	if json.Unmarshal(f.Locator, &loc) != nil {
		return false
	}
	return loc.TimeEndMs > loc.TimeStartMs && loc.TimeStartMs >= 0
}

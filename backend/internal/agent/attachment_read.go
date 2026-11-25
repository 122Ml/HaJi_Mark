package agent

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/122Ml/HaJi_Mark/backend/internal/rag"
	"github.com/122Ml/HaJi_Mark/backend/internal/store"
	"golang.org/x/net/html"
)

const (
	defaultReadChars   = 16000
	maxReadChars       = 32000
	maxRawTextRead     = 4 << 20
	maxOfficeXMLRead   = 16 << 20
	pdfParseWaitMax    = 45 * time.Second
	pdfParsePollPeriod = 200 * time.Millisecond
)

var slideFilePattern = regexp.MustCompile(`^ppt/slides/slide(\d+)\.xml$`)

func (s *Service) readAttachment(ctx context.Context, _ store.AgentRun, conv store.AgentConversation, args map[string]any) (any, error) {
	attachmentID := getString(args, "attachment_id")
	a, err := s.Q.GetAgentAttachment(ctx, store.GetAgentAttachmentParams{ID: attachmentID, ConversationID: conv.ID})
	if err != nil || a.Kind != "upload" {
		return map[string]any{"error": "附件不存在或不属于本会话"}, nil
	}
	ext := strings.ToLower(filepath.Ext(a.StoragePath))
	if isImageExt(ext) {
		return map[string]any{"error": "图片附件已直接附带在多模态消息中，请直接查看图片内容"}, nil
	}
	fullPath, err := safeAttachmentPath(a.StoragePath)
	if err != nil {
		return map[string]any{"error": "附件路径无效"}, nil
	}
	info, err := os.Stat(fullPath)
	if err != nil || !info.Mode().IsRegular() || info.Size() < 1 || info.Size() > 30<<20 {
		return map[string]any{"error": "附件不存在或超出30MiB大小限制"}, nil
	}
	if err := verifyFileSHA256(fullPath, a.Sha256); err != nil {
		return map[string]any{"error": err.Error()}, nil
	}

	offset := 0
	if rawOff, ok := asInt(args["offset"]); ok && rawOff > 0 {
		offset = rawOff
	}
	limit := defaultReadChars
	if rawLimit, ok := asInt(args["limit"]); ok && rawLimit > 0 {
		limit = min(rawLimit, maxReadChars)
	}

	text, err := s.extractAttachmentText(ctx, fullPath, a.StoragePath, ext)
	if err != nil {
		return map[string]any{"error": err.Error()}, nil
	}

	runes := []rune(text)
	total := len(runes)
	if offset > total {
		offset = total
	}
	end := min(offset+limit, total)
	chunk := string(runes[offset:end])
	return map[string]any{
		"attachment_id":  a.ID,
		"filename":       a.Filename,
		"ext":            ext,
		"total_chars":    total,
		"offset":         offset,
		"returned_chars": end - offset,
		"truncated":      end < total,
		"content":        chunk,
	}, nil
}

func asInt(v any) (int, bool) {
	switch x := v.(type) {
	case int:
		return x, true
	case int64:
		return int(x), true
	case float64:
		return int(x), true
	default:
		return 0, false
	}
}

func verifyFileSHA256(fullPath, expected string) error {
	f, err := os.Open(fullPath)
	if err != nil {
		return errors.New("无法读取上传附件")
	}
	defer f.Close()
	hasher := sha256.New()
	n, err := io.Copy(hasher, io.LimitReader(f, (30<<20)+1))
	if err != nil {
		return errors.New("读取附件内容失败")
	}
	if n > 30<<20 || hex.EncodeToString(hasher.Sum(nil)) != expected {
		return errors.New("附件内容与上传记录不一致")
	}
	return nil
}

func writeAttachmentTextCache(target, content string) {
	tmp, err := os.CreateTemp(filepath.Dir(target), ".txtcache-*")
	if err != nil {
		return
	}
	tmpName := tmp.Name()
	cleanup := true
	defer func() {
		if cleanup {
			_ = os.Remove(tmpName)
		}
	}()
	if _, err := tmp.WriteString(content); err != nil {
		_ = tmp.Close()
		return
	}
	if err := tmp.Close(); err != nil {
		return
	}
	if os.Rename(tmpName, target) == nil {
		cleanup = false
	}
}

func (s *Service) extractAttachmentText(ctx context.Context, fullPath, storagePath, ext string) (string, error) {
	cachePath := fullPath + ".extracted.txt"
	if cached, err := os.ReadFile(cachePath); err == nil && len(cached) > 0 {
		return string(cached), nil
	}

	var (
		text string
		err  error
	)
	switch ext {
	case ".txt", ".md", ".csv":
		text, err = readPlainAttachmentText(fullPath)
	case ".html", ".htm":
		text, err = extractHTMLAttachmentText(fullPath)
	case ".docx":
		text, err = extractDOCXAttachmentText(fullPath)
	case ".pptx":
		text, err = extractPPTXAttachmentText(fullPath)
	case ".pdf":
		return s.extractPDFAttachmentText(ctx, fullPath, storagePath, ext)
	default:
		return "", errors.New("暂不支持直接读取该文件格式：" + ext)
	}
	if err != nil {
		return "", err
	}
	text = strings.TrimSpace(text)
	if text == "" {
		return "", errors.New("该文件内容为空或未提取到可读文本")
	}
	writeAttachmentTextCache(cachePath, text)
	return text, nil
}

func (s *Service) extractPDFAttachmentText(ctx context.Context, fullPath, storagePath, ext string) (string, error) {
	if strings.TrimSpace(s.RedisAddr) == "" {
		return "", errors.New("当前环境未连接PDF解析工作进程；教师可先使用 source_import 导入原件解析")
	}
	outPath := fullPath + ".extracted.txt"
	errPath := fullPath + ".extracted.err"
	_ = os.Remove(errPath)
	if err := rag.EnqueueAttachmentParse(s.RedisAddr, storagePath, ext); err != nil {
		return "", errors.New("提交PDF解析任务失败：" + err.Error())
	}

	deadline := time.Now().Add(pdfParseWaitMax)
	for {
		if b, err := os.ReadFile(outPath); err == nil && len(b) > 0 {
			return string(b), nil
		}
		if b, err := os.ReadFile(errPath); err == nil && len(strings.TrimSpace(string(b))) > 0 {
			return "", errors.New(strings.TrimSpace(string(b)))
		}
		if time.Now().After(deadline) {
			return "", errors.New("PDF解析超时；如果文件页数较多，教师可使用 source_import 导入课程原件库后台解析")
		}
		timer := time.NewTimer(pdfParsePollPeriod)
		select {
		case <-ctx.Done():
			timer.Stop()
			return "", errors.New("读取PDF附件已取消")
		case <-timer.C:
		}
	}
}

func readPlainAttachmentText(fullPath string) (string, error) {
	f, err := os.Open(fullPath)
	if err != nil {
		return "", errors.New("无法读取文本附件")
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, maxRawTextRead))
	if err != nil {
		return "", errors.New("读取文本附件失败")
	}
	s := string(data)
	if !utf8.ValidString(s) {
		s = strings.ToValidUTF8(s, "")
	}
	return strings.TrimPrefix(s, "\uFEFF"), nil
}

func extractHTMLAttachmentText(fullPath string) (string, error) {
	rawHTML, err := readPlainAttachmentText(fullPath)
	if err != nil {
		return "", err
	}
	doc, err := html.Parse(strings.NewReader(rawHTML))
	if err != nil {
		return "", errors.New("解析HTML附件失败")
	}
	var b strings.Builder
	var walk func(n *html.Node)
	walk = func(n *html.Node) {
		if n.Type == html.ElementNode {
			switch strings.ToLower(n.Data) {
			case "script", "style", "noscript":
				return
			case "br":
				b.WriteByte('\n')
			}
		}
		if n.Type == html.TextNode {
			txt := strings.TrimSpace(n.Data)
			if txt != "" {
				if b.Len() > 0 && !strings.HasSuffix(b.String(), "\n") {
					b.WriteByte(' ')
				}
				b.WriteString(txt)
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
		if n.Type == html.ElementNode {
			switch strings.ToLower(n.Data) {
			case "p", "div", "section", "article", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre":
				if b.Len() > 0 && !strings.HasSuffix(b.String(), "\n") {
					b.WriteByte('\n')
				}
			}
		}
	}
	walk(doc)
	return normalizeExtractedLines(b.String()), nil
}

func extractDOCXAttachmentText(fullPath string) (string, error) {
	r, err := zip.OpenReader(fullPath)
	if err != nil {
		return "", errors.New("无法打开DOCX文件（不是有效的压缩文档）")
	}
	defer r.Close()
	for _, f := range r.File {
		if f.Name == "word/document.xml" {
			rc, err := f.Open()
			if err != nil {
				return "", errors.New("读取DOCX正文失败")
			}
			txt, parseErr := extractOOXMLText(io.LimitReader(rc, maxOfficeXMLRead))
			_ = rc.Close()
			if parseErr != nil {
				return "", errors.New("解析DOCX正文失败")
			}
			return txt, nil
		}
	}
	return "", errors.New("DOCX文件缺少正文 word/document.xml")
}

func extractPPTXAttachmentText(fullPath string) (string, error) {
	r, err := zip.OpenReader(fullPath)
	if err != nil {
		return "", errors.New("无法打开PPTX文件（不是有效的压缩演示文稿）")
	}
	defer r.Close()

	type slideEntry struct {
		num  int
		file *zip.File
	}
	slides := make([]slideEntry, 0, 32)
	for _, f := range r.File {
		m := slideFilePattern.FindStringSubmatch(f.Name)
		if len(m) != 2 {
			continue
		}
		num, convErr := strconv.Atoi(m[1])
		if convErr != nil {
			continue
		}
		slides = append(slides, slideEntry{num: num, file: f})
	}
	if len(slides) == 0 {
		return "", errors.New("PPTX文件中未找到幻灯片正文")
	}
	sort.Slice(slides, func(i, j int) bool { return slides[i].num < slides[j].num })

	var b strings.Builder
	for _, s := range slides {
		rc, err := s.file.Open()
		if err != nil {
			continue
		}
		txt, parseErr := extractOOXMLText(io.LimitReader(rc, 4<<20))
		_ = rc.Close()
		if parseErr != nil || strings.TrimSpace(txt) == "" {
			continue
		}
		if b.Len() > 0 {
			b.WriteString("\n\n")
		}
		b.WriteString(fmt.Sprintf("[第 %d 页]\n", s.num))
		b.WriteString(strings.TrimSpace(txt))
	}
	return b.String(), nil
}

func extractOOXMLText(r io.Reader) (string, error) {
	dec := xml.NewDecoder(r)
	var b strings.Builder
	inText := false
	for {
		tok, err := dec.Token()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return "", err
		}
		switch t := tok.(type) {
		case xml.StartElement:
			switch t.Name.Local {
			case "t":
				inText = true
			case "br":
				b.WriteByte('\n')
			case "tab":
				b.WriteByte('\t')
			}
		case xml.EndElement:
			switch t.Name.Local {
			case "t":
				inText = false
			case "p":
				if b.Len() > 0 && !strings.HasSuffix(b.String(), "\n") {
					b.WriteByte('\n')
				}
			}
		case xml.CharData:
			if inText {
				b.Write(t)
			}
		}
	}
	return normalizeExtractedLines(b.String()), nil
}

func normalizeExtractedLines(s string) string {
	lines := strings.Split(strings.ReplaceAll(s, "\r\n", "\n"), "\n")
	out := make([]string, 0, len(lines))
	blank := false
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			if len(out) > 0 && !blank {
				out = append(out, "")
				blank = true
			}
			continue
		}
		out = append(out, trimmed)
		blank = false
	}
	return strings.TrimSpace(strings.Join(out, "\n"))
}

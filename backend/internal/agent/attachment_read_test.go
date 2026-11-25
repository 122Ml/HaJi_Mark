package agent

import (
	"archive/zip"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeZipFile(t *testing.T, target string, entries map[string]string) {
	t.Helper()
	f, err := os.Create(target)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	zw := zip.NewWriter(f)
	for name, body := range entries {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write([]byte(body)); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestExtractAttachmentFormats(t *testing.T) {
	tmp := t.TempDir()
	svc := &Service{}
	ctx := context.Background()

	// 1. Markdown / Plaintext
	mdPath := filepath.Join(tmp, "syllabus.md")
	if err := os.WriteFile(mdPath, []byte("\uFEFF# 第1章 导论\n\n软件工程与大模型协同"), 0600); err != nil {
		t.Fatal(err)
	}
	mdText, err := svc.extractAttachmentText(ctx, mdPath, "syllabus.md", ".md")
	if err != nil || !strings.Contains(mdText, "# 第1章 导论") || !strings.Contains(mdText, "软件工程与大模型协同") || strings.Contains(mdText, "\uFEFF") {
		t.Fatalf("markdown extract failed: text=%q err=%v", mdText, err)
	}

	// 2. HTML (scripts/styles stripped, text preserved)
	htmlPath := filepath.Join(tmp, "notes.html")
	rawHTML := `<html><head><style>body{color:red}</style><script>alert(1)</script></head><body><h1>需求工程</h1><p>可验证约束与状态流转</p></body></html>`
	if err := os.WriteFile(htmlPath, []byte(rawHTML), 0600); err != nil {
		t.Fatal(err)
	}
	htmlText, err := svc.extractAttachmentText(ctx, htmlPath, "notes.html", ".html")
	if err != nil || !strings.Contains(htmlText, "需求工程") || !strings.Contains(htmlText, "可验证约束与状态流转") || strings.Contains(htmlText, "alert(1)") || strings.Contains(htmlText, "color:red") {
		t.Fatalf("html extract failed: text=%q err=%v", htmlText, err)
	}

	// 3. Minimal DOCX
	docxPath := filepath.Join(tmp, "outline.docx")
	writeZipFile(t, docxPath, map[string]string{
		"word/document.xml": `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>第二章 智能测试</w:t></w:r></w:p><w:p><w:r><w:t>边界值分析方法</w:t></w:r></w:p></w:body></w:document>`,
	})
	docxText, err := svc.extractAttachmentText(ctx, docxPath, "outline.docx", ".docx")
	if err != nil || !strings.Contains(docxText, "第二章 智能测试") || !strings.Contains(docxText, "边界值分析方法") {
		t.Fatalf("docx extract failed: text=%q err=%v", docxText, err)
	}

	// 4. Minimal PPTX (numeric slide sort: slide1, slide2, slide10)
	pptxPath := filepath.Join(tmp, "slides.pptx")
	writeZipFile(t, pptxPath, map[string]string{
		"ppt/slides/slide10.xml": `<?xml version="1.0"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>第十页 总结</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
		"ppt/slides/slide1.xml":  `<?xml version="1.0"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>第一页 导言</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
		"ppt/slides/slide2.xml":  `<?xml version="1.0"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>第二页 架构</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
	})
	pptxText, err := svc.extractAttachmentText(ctx, pptxPath, "slides.pptx", ".pptx")
	if err != nil {
		t.Fatalf("pptx extract failed: %v", err)
	}
	i1 := strings.Index(pptxText, "[第 1 页]")
	i2 := strings.Index(pptxText, "[第 2 页]")
	i10 := strings.Index(pptxText, "[第 10 页]")
	if i1 < 0 || i2 < 0 || i10 < 0 || !(i1 < i2 && i2 < i10) {
		t.Fatalf("pptx numeric slide ordering wrong: %q", pptxText)
	}

	// Sidecar cache was created cleanly next to docxPath.
	if _, err := os.Stat(docxPath + ".extracted.txt"); err != nil {
		t.Fatalf("expected sidecar cache file: %v", err)
	}
}

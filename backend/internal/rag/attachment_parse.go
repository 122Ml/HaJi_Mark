package rag

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/hibiken/asynq"
)

const (
	attachmentParseTaskType   = "agent:parse_attachment"
	maxExtractedAttachmentLen = 2 << 20
)

type attachmentParsePayload struct {
	StoragePath string `json:"storage_path"`
	Ext         string `json:"ext"`
}

// EnqueueAttachmentParse dispatches an asynchronous attachment text extraction job to the Python worker.
func EnqueueAttachmentParse(redisAddr, storagePath, ext string) error {
	if strings.TrimSpace(redisAddr) == "" {
		return errors.New("未配置Redis地址，无法调度解析任务")
	}
	client := asynq.NewClient(asynq.RedisClientOpt{Addr: redisAddr})
	defer client.Close()
	body, err := json.Marshal(attachmentParsePayload{StoragePath: storagePath, Ext: ext})
	if err != nil {
		return err
	}
	_, err = client.Enqueue(
		asynq.NewTask(attachmentParseTaskType, body),
		asynq.Unique(30*time.Second),
		asynq.MaxRetry(0),
		asynq.Timeout(90*time.Second),
	)
	return err
}

func safeAgentAttachmentPath(storagePath string) (string, error) {
	if storagePath == "" || filepath.Base(storagePath) != storagePath || strings.ContainsAny(storagePath, `/\`) || storagePath == "." || storagePath == ".." || strings.ContainsRune(storagePath, '\x00') {
		return "", errors.New("附件路径无效")
	}
	base := filepath.Clean(filepath.Join(MaterialsDir(), "agent"))
	full := filepath.Clean(filepath.Join(base, storagePath))
	rel, err := filepath.Rel(base, full)
	if err != nil || rel == "." || rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) || filepath.IsAbs(rel) {
		return "", errors.New("附件路径越界")
	}
	return full, nil
}

func writeAtomicSidecar(target, content string) error {
	tmp, err := os.CreateTemp(filepath.Dir(target), ".extract-*")
	if err != nil {
		return err
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
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmpName, target); err != nil {
		return err
	}
	cleanup = false
	return nil
}

func trimUTF8Bytes(s string, maxBytes int) string {
	if len(s) <= maxBytes {
		return s
	}
	cut := maxBytes
	for cut > 0 && !utf8.RuneStart(s[cut]) {
		cut--
	}
	return s[:cut]
}

// ParseAttachment extracts readable text from an uploaded agent attachment sidecar cache.
func (s *Service) ParseAttachment(ctx context.Context, t *asynq.Task) error {
	var p attachmentParsePayload
	if err := json.Unmarshal(t.Payload(), &p); err != nil {
		return nil
	}
	fullPath, err := safeAgentAttachmentPath(p.StoragePath)
	if err != nil {
		return nil
	}
	outPath := fullPath + ".extracted.txt"
	errPath := fullPath + ".extracted.err"
	if info, statErr := os.Stat(outPath); statErr == nil && info.Mode().IsRegular() && info.Size() > 0 {
		_ = os.Remove(errPath)
		return nil
	}
	ext := strings.ToLower(strings.TrimSpace(p.Ext))
	if ext == "" {
		ext = strings.ToLower(filepath.Ext(fullPath))
	}
	script := os.Getenv("PARSER_SCRIPT")
	if script == "" {
		script = "tools/parser/parse.py"
	}
	command := exec.CommandContext(ctx, "python", script, fullPath, ext)
	var out, stderr bytes.Buffer
	command.Stdout = &out
	command.Stderr = &stderr
	configureParserCommand(command)
	runErr := command.Run()

	var parsed struct {
		Fragments []struct {
			Heading string `json:"heading"`
			Body    string `json:"body"`
		} `json:"fragments"`
		Error string `json:"error"`
	}
	if json.Unmarshal(out.Bytes(), &parsed) != nil || runErr != nil || len(parsed.Fragments) == 0 {
		if errText := strings.TrimSpace(stderr.String()); errText != "" {
			if len(errText) > 2048 {
				errText = errText[:2048]
			}
			log.Printf("RAG parse_attachment %s stderr: %s", p.StoragePath, errText)
		}
		msg := strings.TrimSpace(parsed.Error)
		if msg == "" {
			msg = "文件解析失败，请确认文件未加密或未损坏后重试"
		}
		_ = writeAtomicSidecar(errPath, msg)
		return nil
	}

	var b strings.Builder
	for _, frag := range parsed.Fragments {
		heading := strings.TrimSpace(frag.Heading)
		body := strings.TrimSpace(frag.Body)
		if heading == "" && body == "" {
			continue
		}
		if b.Len() > 0 {
			b.WriteString("\n\n")
		}
		if heading != "" {
			b.WriteString(heading)
			if body != "" {
				b.WriteString("\n")
			}
		}
		if body != "" {
			b.WriteString(body)
		}
		if b.Len() >= maxExtractedAttachmentLen {
			break
		}
	}
	text := strings.TrimSpace(trimUTF8Bytes(b.String(), maxExtractedAttachmentLen))
	if text == "" {
		_ = writeAtomicSidecar(errPath, "未能从该文件中提取到有效文字内容")
		return nil
	}
	if err := writeAtomicSidecar(outPath, text); err != nil {
		log.Printf("RAG parse_attachment write %s failed: %v", outPath, err)
		_ = writeAtomicSidecar(errPath, "解析结果写入缓存失败")
		return nil
	}
	_ = os.Remove(errPath)
	return nil
}

package rag

import (
	"bufio"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
)

// Only content snapshots leave the decoder. Tool arguments stay private until
// the complete response passes the same validation as a non-streaming call.
func decodeAgentResponse(resp *http.Response, emit func(string) error) (AgentMessage, string, usage, error) {
	var msg AgentMessage
	var u usage
	if !strings.HasPrefix(strings.ToLower(resp.Header.Get("Content-Type")), "text/event-stream") {
		var out struct {
			Choices []struct {
				Message AgentMessage `json:"message"`
				Finish  string       `json:"finish_reason"`
			} `json:"choices"`
			Usage usage `json:"usage"`
		}
		data, e := io.ReadAll(io.LimitReader(resp.Body, (8<<20)+1))
		if e != nil || len(data) > 8<<20 || json.Unmarshal(data, &out) != nil || len(out.Choices) != 1 {
			return msg, "", u, errors.New("模型未返回有效流或JSON回复")
		}
		msg = out.Choices[0].Message
		if emit != nil && msg.Content != "" {
			if e = emit(msg.Content); e != nil {
				return msg, "", out.Usage, e
			}
		}
		return msg, out.Choices[0].Finish, out.Usage, nil
	}
	scanner := bufio.NewScanner(io.LimitReader(resp.Body, (8<<20)+1))
	scanner.Buffer(make([]byte, 8192), 1<<20)
	calls := map[int]ToolCall{}
	finish := ""
	done := false
	total := 0
	for scanner.Scan() {
		line := scanner.Text()
		total += len(line) + 1
		if total > 8<<20 {
			return msg, finish, u, errors.New("模型流超过大小限制")
		}
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "[DONE]" {
			done = true
			break
		}
		if data == "" {
			continue
		}
		var event struct {
			Choices []struct {
				Index  int    `json:"index"`
				Finish string `json:"finish_reason"`
				Delta  struct {
					Content   string `json:"content"`
					Reasoning string `json:"reasoning_content"`
					ToolCalls []struct {
						Index    int    `json:"index"`
						ID       string `json:"id"`
						Type     string `json:"type"`
						Function struct {
							Name      string `json:"name"`
							Arguments string `json:"arguments"`
						} `json:"function"`
					} `json:"tool_calls"`
				} `json:"delta"`
			} `json:"choices"`
			Usage *usage          `json:"usage"`
			Error json.RawMessage `json:"error"`
		}
		if json.Unmarshal([]byte(data), &event) != nil || len(event.Error) > 0 && string(event.Error) != "null" {
			return msg, finish, u, errors.New("模型流事件无效")
		}
		if event.Usage != nil {
			u = *event.Usage
		}
		for _, c := range event.Choices {
			if c.Index != 0 || finish != "" {
				return msg, finish, u, errors.New("模型流顺序或候选数量无效")
			}
			msg.Content += c.Delta.Content
			msg.ReasoningContent += c.Delta.Reasoning
			if len(msg.Content) > 120000 || len(msg.ReasoningContent) > 300000 {
				return msg, finish, u, errors.New("模型输出过长")
			}
			if c.Delta.Content != "" && emit != nil {
				if e := emit(msg.Content); e != nil {
					return msg, finish, u, e
				}
			}
			for _, d := range c.Delta.ToolCalls {
				if d.Index < 0 || d.Index >= 8 {
					return msg, finish, u, errors.New("流式工具数量超限")
				}
				t := calls[d.Index]
				t.ID += d.ID
				if d.Type != "" {
					t.Type = d.Type
				}
				t.Function.Name += d.Function.Name
				t.Function.Arguments += d.Function.Arguments
				if len(t.Function.Arguments) > 120000 || len(t.ID) > 200 || len(t.Function.Name) > 200 {
					return msg, finish, u, errors.New("流式工具参数过长")
				}
				calls[d.Index] = t
			}
			if c.Finish != "" {
				finish = c.Finish
			}
		}
	}
	if scanner.Err() != nil || !done || (finish != "stop" && finish != "tool_calls") {
		return msg, finish, u, errors.New("模型流中断或截断，未执行工具；请核对后显式重试")
	}
	for i := 0; i < len(calls); i++ {
		t, ok := calls[i]
		if !ok {
			return msg, finish, u, errors.New("流式工具索引不连续")
		}
		msg.ToolCalls = append(msg.ToolCalls, t)
	}
	return msg, finish, u, nil
}

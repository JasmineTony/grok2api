package mcp

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"strings"
)

type Tool struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"inputSchema"`
}
type Server struct {
	Tools []Tool
	Call  func(string, map[string]any) (any, error)
}
type request struct {
	JSONRPC string         `json:"jsonrpc"`
	ID      any            `json:"id"`
	Method  string         `json:"method"`
	Params  map[string]any `json:"params"`
}
type response struct {
	JSONRPC string `json:"jsonrpc"`
	ID      any    `json:"id,omitempty"`
	Result  any    `json:"result,omitempty"`
	Error   any    `json:"error,omitempty"`
}

func ReadOnlyTools() []Tool {
	names := []string{"models.list", "accounts.health", "usage.summary", "errors.recent", "egress.health", "version.status", "config.validate"}
	out := make([]Tool, 0, len(names))
	for _, name := range names {
		out = append(out, Tool{Name: name, Description: "Read-only Grok2API operational summary; never returns credentials, request bodies, client keys, or proxy secrets.", InputSchema: map[string]any{"type": "object"}})
	}
	return out
}
func (s *Server) Serve(in io.Reader, out io.Writer) error {
	if s == nil {
		s = &Server{Tools: ReadOnlyTools()}
	}
	if len(s.Tools) == 0 {
		s.Tools = ReadOnlyTools()
	}
	scanner := bufio.NewScanner(in)
	encoder := json.NewEncoder(out)
	for scanner.Scan() {
		var req request
		if err := json.Unmarshal(scanner.Bytes(), &req); err != nil {
			continue
		}
		res := response{JSONRPC: "2.0", ID: req.ID}
		switch req.Method {
		case "initialize":
			res.Result = map[string]any{"protocolVersion": "2025-06-18", "capabilities": map[string]any{"tools": map[string]any{}}, "serverInfo": map[string]any{"name": "grok2api", "version": "1"}}
		case "tools/list":
			res.Result = map[string]any{"tools": s.Tools}
		case "tools/call":
			name, _ := req.Params["name"].(string)
			args, _ := req.Params["arguments"].(map[string]any)
			if s.Call == nil {
				res.Result = map[string]any{"content": []map[string]any{{"type": "text", "text": fmt.Sprintf("tool %s is read-only and has no data provider in this process", strings.TrimSpace(name))}}}
			} else {
				value, err := s.Call(name, args)
				if err != nil {
					res.Error = map[string]any{"code": -32000, "message": err.Error()}
				} else {
					data, _ := json.Marshal(value)
					res.Result = map[string]any{"content": []map[string]any{{"type": "text", "text": string(data)}}}
				}
			}
		default:
			res.Error = map[string]any{"code": -32601, "message": "method not found"}
		}
		if err := encoder.Encode(res); err != nil {
			return err
		}
	}
	return scanner.Err()
}

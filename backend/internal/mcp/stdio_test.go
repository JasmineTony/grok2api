package mcp

import (
	"bytes"
	"strings"
	"testing"
)

func TestReadOnlyStdioTools(t *testing.T) {
	var out bytes.Buffer
	input := strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"tools/list"}
`)
	if err := (&Server{}).Serve(input, &out); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), "config.validate") || strings.Contains(out.String(), "write") {
		t.Fatalf("unexpected MCP output: %s", out.String())
	}
}

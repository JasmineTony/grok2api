package protocolgolden

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestProtocolGoldenFixturesAreOfflineAndStable(t *testing.T) {
	_, file, _, _ := runtime.Caller(0)
	dir := filepath.Join(filepath.Dir(file), "../../../testdata/protocol")
	cases := []struct {
		name, input, golden string
		sse                 bool
	}{
		{name: "openai-responses", input: "openai-responses.json", golden: "openai-responses.json.golden"},
		{name: "openai-chat-completions", input: "openai-chat-completions.json", golden: "openai-chat-completions.json.golden"},
		{name: "openai-chat-tools", input: "openai-chat-tools.json", golden: "openai-chat-tools.json.golden"},
		{name: "anthropic-messages", input: "anthropic-messages.json", golden: "anthropic-messages.json.golden"},
		{name: "openai-image", input: "openai-image.json", golden: "openai-image.json.golden"},
		{name: "openai-video", input: "openai-video.json", golden: "openai-video.json.golden"},
		{name: "error-401", input: "error-401.json", golden: "error-401.json.golden"},
		{name: "error-403", input: "error-403.json", golden: "error-403.json.golden"},
		{name: "error-429", input: "error-429.json", golden: "error-429.json.golden"},
		{name: "usage-cache", input: "usage-cache.json", golden: "usage-cache.json.golden"},
		{name: "anthropic-sse", input: "anthropic-messages.sse", golden: "anthropic-messages.sse.golden", sse: true},
		{name: "openai-chat-sse", input: "openai-chat-stream.sse", golden: "openai-chat-stream.sse.golden", sse: true},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			input, err := os.ReadFile(filepath.Join(dir, test.input))
			if err != nil {
				t.Fatal(err)
			}
			var normalized []byte
			if test.sse {
				normalized, err = NormalizeSSE(input)
			} else {
				normalized, err = NormalizeJSON(input)
			}
			if err != nil {
				t.Fatal(err)
			}
			goldenPath := filepath.Join(dir, test.golden)
			if os.Getenv("UPDATE_GOLDEN") == "1" {
				if err := os.WriteFile(goldenPath, append(normalized, '\n'), 0o644); err != nil {
					t.Fatal(err)
				}
			}
			expected, err := os.ReadFile(goldenPath)
			if err != nil {
				t.Fatalf("missing golden %s; run UPDATE_GOLDEN=1 go test ./internal/transport/protocolgolden", goldenPath)
			}
			if string(normalized)+"\n" != string(expected) {
				t.Fatalf("golden mismatch for %s", test.input)
			}
		})
	}
}

func TestMalformedProtocolFixtureIsRejected(t *testing.T) {
	_, file, _, _ := runtime.Caller(0)
	path := filepath.Join(filepath.Dir(file), "../../../testdata/protocol/malformed-response.json")
	input, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := NormalizeJSON(input); err == nil {
		t.Fatal("malformed protocol response was accepted")
	}
}

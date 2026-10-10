package web

import (
	"encoding/json"
	"strings"
	"unicode/utf8"
)

type openAIRequest struct {
	Model              string          `json:"model"`
	Stream             bool            `json:"stream"`
	Input              json.RawMessage `json:"input"`
	Instructions       string          `json:"instructions"`
	PreviousResponseID string          `json:"previous_response_id"`
	Messages           []chatMessage   `json:"messages"`
	// Include is the xAI/OpenAI Responses include list (inline_citations / no_inline_citations).
	Include           []string        `json:"include"`
	Tools             json.RawMessage `json:"tools"`
	ToolChoice        json.RawMessage `json:"tool_choice"`
	ParallelToolCalls *bool           `json:"parallel_tool_calls"`
	ImageConfig       *struct {
		Count          *int   `json:"n"`
		ResponseFormat string `json:"response_format"`
		AspectRatio    string `json:"aspect_ratio"`
		Resolution     string `json:"resolution"`
	} `json:"image_config"`
}

type chatMessage struct {
	Type       string          `json:"type"`
	Role       string          `json:"role"`
	Content    json.RawMessage `json:"content"`
	ToolCalls  json.RawMessage `json:"tool_calls"`
	ToolCallID string          `json:"tool_call_id"`
	CallID     string          `json:"call_id"`
	Name       string          `json:"name"`
	Arguments  string          `json:"arguments"`
	Output     json.RawMessage `json:"output"`
}

type normalizedChatInput struct {
	Prompt      string
	Attachments []chatAttachmentInput
}

type chatAttachmentInput struct {
	Source   string
	Filename string
	Image    bool
}

// hostedSearchCall tracks one mgw web_search / x_search invocation for xAI Responses output items.
type hostedSearchCall struct {
	ID      string
	Kind    string // web_search | x_search
	Query   string
	Status  string // in_progress | completed
	Sources []map[string]any
}

// trackedTextBuilder keeps OpenAI citation offsets in Unicode characters
// without rescanning the complete response for every citation.
type trackedTextBuilder struct {
	builder    strings.Builder
	characters int
}

func (b *trackedTextBuilder) WriteString(value string) (int, error) {
	written, err := b.builder.WriteString(value)
	b.characters += utf8.RuneCountInString(value[:written])
	return written, err
}

func (b *trackedTextBuilder) Reset() {
	b.builder.Reset()
	b.characters = 0
}

func (b *trackedTextBuilder) String() string { return b.builder.String() }

func (b *trackedTextBuilder) Len() int { return b.builder.Len() }

func (b *trackedTextBuilder) CharacterLen() int { return b.characters }

type parsedChat struct {
	ResponseID     string
	ConversationID string
	ParentID       string
	Text           trackedTextBuilder
	upstreamText   strings.Builder
	Reasoning      strings.Builder
	Images         []string
	SearchSources  []map[string]any
	Annotations    []map[string]any
	// ResponseOutput is populated by the Responses streaming state machine so
	// response.completed reuses the exact item IDs and ordering emitted in SSE.
	ResponseOutput []any
	// HostedSearchCalls are ordered web_search_call / x_search_call items (xAI Responses).
	HostedSearchCalls []hostedSearchCall
	hostedSearchByID  map[string]int
	// InlineCitations mirrors xAI default-on [[N]](url) embedding.
	DisableInlineCitations bool
	sourceKeys             map[string]struct{}
	serverToolKeys         map[string]struct{}
	webSearchKeys          map[string]struct{}
	xSearchKeys            map[string]struct{}
	cardCache              map[string]map[string]any
	moderatedImages        map[string]struct{}
	citationIndex          map[string]int
	lastCitation           int
	ServerTools            int64
	WebSearchTools         int64
	XSearchTools           int64
	InputTokens            int64
	ToolCalls              []parsedToolCall
	Tools                  []any
	ToolChoice             any
	ParallelTools          bool
}

func (p *parsedChat) textCharacterLen() int {
	if p == nil {
		return 0
	}
	return p.Text.CharacterLen()
}

func (p *parsedChat) appendText(value string) {
	if p == nil || value == "" {
		return
	}
	p.Text.WriteString(value)
}

func (p *parsedChat) resetText(value string) {
	if p == nil {
		return
	}
	p.Text.Reset()
	p.Text.WriteString(value)
}

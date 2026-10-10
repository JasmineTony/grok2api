package inference

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/chenyme/grok2api/backend/internal/application/gateway"
	"github.com/chenyme/grok2api/backend/internal/domain/account"
	clientkeydomain "github.com/chenyme/grok2api/backend/internal/domain/clientkey"
	modeldomain "github.com/chenyme/grok2api/backend/internal/domain/model"
	neterror "github.com/chenyme/grok2api/backend/internal/pkg/neterror"
	"github.com/chenyme/grok2api/backend/internal/transport/http/middleware"
	"github.com/gin-gonic/gin"
	clientws "github.com/gorilla/websocket"
)

func newHelperTestContext() (*gin.Context, *httptest.ResponseRecorder) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	return context, recorder
}

// stream_copy.go 提取的重构辅助函数。
func TestAbortTrailerCodeMapsCauses(t *testing.T) {
	cases := []struct {
		name    string
		cause   error
		code    string
		message string
	}{
		{"idle timeout", neterror.ErrUpstreamStreamIdleTimeout, "upstream_stream_idle_timeout", "上游流式响应长时间无数据"},
		{"output loop", neterror.ErrUpstreamOutputLoop, "upstream_output_loop", "上游输出陷入循环"},
		{"incomplete", errUpstreamStreamIncomplete, "upstream_stream_incomplete", "上游流式响应未完整结束"},
		{"generic", errors.New("boom"), "upstream_stream_interrupted", "上游流式响应中断"},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			code, message := abortTrailerCode(testCase.cause)
			if code != testCase.code || message != testCase.message {
				t.Fatalf("unexpected mapping: %q / %q", code, message)
			}
		})
	}
}

func TestTransferLimitErrorWrapsSentinel(t *testing.T) {
	err := transferLimitError()
	if !errors.Is(err, errResponseTransferLimit) {
		t.Fatalf("expected sentinel wrapping, got %v", err)
	}
	if !strings.Contains(err.Error(), "MiB") {
		t.Fatalf("expected MiB hint, got %v", err)
	}
}

func TestWriteGuardedStreamChunkEnforcesTransferLimit(t *testing.T) {
	context, recorder := newHelperTestContext()
	transferred := 0
	if err := writeGuardedStreamChunk(context.Writer, nil, &transferred); err != nil || transferred != 0 {
		t.Fatalf("empty chunk must be a no-op: err=%v transferred=%d", err, transferred)
	}
	if err := writeGuardedStreamChunk(context.Writer, []byte("abc"), &transferred); err != nil || transferred != 3 {
		t.Fatalf("chunk must be forwarded: err=%v transferred=%d", err, transferred)
	}
	over := maxStreamResponseTransferBytes
	if err := writeGuardedStreamChunk(context.Writer, []byte("abc"), &over); !errors.Is(err, errResponseTransferLimit) {
		t.Fatalf("expected transfer limit violation, got %v", err)
	}
	if recorder.Body.String() != "abc" {
		t.Fatalf("unexpected body %q", recorder.Body.String())
	}
}

func TestWriteStreamAbortTrailerFramingPerProtocol(t *testing.T) {
	cases := []struct {
		protocol streamProtocol
		prefix   string
	}{
		{streamProtocolChat, "data: "},
		{streamProtocolResponses, "event: response.failed"},
		{streamProtocolAnthropic, "event: error"},
	}
	for _, testCase := range cases {
		context, recorder := newHelperTestContext()
		compat := &responsesCompatState{model: "grok-4"}
		writeStreamAbortTrailer(context.Writer, testCase.protocol, neterror.ErrUpstreamStreamIdleTimeout, responseMetadata{SequenceNumber: 4}, compat, 0)
		if body := recorder.Body.String(); !strings.HasPrefix(body, testCase.prefix) {
			t.Fatalf("protocol %v: unexpected trailer %q", testCase.protocol, body)
		}
	}
}

// video_handler.go 提取的重构辅助函数。
func TestParseVideoDurationDefaultsAndBounds(t *testing.T) {
	cases := []struct {
		raw     string
		value   int
		wantErr bool
	}{
		{``, 8, false},
		{`null`, 8, false},
		{`12`, 12, false},
		{`"3"`, 3, false},
		{`0`, 0, true},
		{`16`, 0, true},
		{`"abc"`, 0, true},
	}
	for _, testCase := range cases {
		value, err := parseVideoDuration(json.RawMessage(testCase.raw))
		if testCase.wantErr != (err != nil) || value != testCase.value {
			t.Fatalf("raw %q: value=%d err=%v", testCase.raw, value, err)
		}
	}
}

func TestVideoOperationForMapsKnownOperations(t *testing.T) {
	if op := videoOperationFor(gatewayVideoOperationEdit); op != "edit" {
		t.Fatalf("unexpected edit mapping %v", op)
	}
	if op := videoOperationFor(gatewayVideoOperationExtend); op != "extend" {
		t.Fatalf("unexpected extend mapping %v", op)
	}
	if op := videoOperationFor("unknown"); op != "generate" {
		t.Fatalf("unexpected default mapping %v", op)
	}
}

func TestParseVideoImageReferenceRequiresExactlyOneSource(t *testing.T) {
	context, recorder := newHelperTestContext()
	if _, ok := parseVideoImageReference(context, videoGenerationImage{}, "image"); ok {
		t.Fatal("missing url and file_id must be rejected")
	}
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("unexpected status %d", recorder.Code)
	}
	context, _ = newHelperTestContext()
	value, ok := parseVideoImageReference(context, videoGenerationImage{URL: " https://example.com/a.png "}, "image")
	if !ok || value != "https://example.com/a.png" {
		t.Fatalf("valid url must be trimmed and accepted: %q %v", value, ok)
	}
}

// image_handler.go 提取的重构辅助函数。
func TestParsePartialImagesBoundsAndStreamingConstraint(t *testing.T) {
	context, _ := newHelperTestContext()
	if value, ok := parsePartialImages(context, nil, false); !ok || value != 0 {
		t.Fatalf("nil partial_images must default to 0: %d %v", value, ok)
	}
	two := 2
	if value, ok := parsePartialImages(context, &two, true); !ok || value != 2 {
		t.Fatalf("streaming partial_images must pass: %d %v", value, ok)
	}
	four := 4
	if _, ok := parsePartialImages(context, &four, true); ok {
		t.Fatal("partial_images above 3 must be rejected")
	}
	one := 1
	if _, ok := parsePartialImages(context, &one, false); ok {
		t.Fatal("partial_images without streaming must be rejected")
	}
}

func TestNormalizeImageQualityAndCountGuards(t *testing.T) {
	context, recorder := newHelperTestContext()
	if quality, ok := normalizeImageQuality(context, " LOW "); !ok || quality != "low" {
		t.Fatalf("quality must be lower-cased: %q %v", quality, ok)
	}
	if _, ok := normalizeImageQuality(context, "high"); ok || recorder.Code != http.StatusBadRequest {
		t.Fatalf("unsupported quality must fail: status=%d", recorder.Code)
	}
	context, _ = newHelperTestContext()
	if !validateImageCount(context, 1) || !validateImageCount(context, 10) {
		t.Fatal("count within 1..10 must pass")
	}
	if validateImageCount(context, 0) || validateImageCount(context, 11) {
		t.Fatal("count outside 1..10 must fail")
	}
}

// voice_handler.go 提取的重构辅助函数。
func TestParseTTSOptionsRejectsInvalidValues(t *testing.T) {
	ok := ttsRequest{OutputFormat: json.RawMessage(`{"codec":"mp3"}`)}
	if _, _, _, err := parseTTSOptions(ok); err != nil {
		t.Fatalf("valid options must pass: %v", err)
	}
	slow := 0.1
	if _, _, _, err := parseTTSOptions(ttsRequest{Speed: &slow}); err == nil {
		t.Fatal("out-of-range speed must fail")
	}
	if _, _, _, err := parseTTSOptions(ttsRequest{OptimizeStreamingLatency: json.RawMessage(`5`)}); err == nil {
		t.Fatal("out-of-range optimize_streaming_latency must fail")
	}
}

func TestResolveSTTJSONOptionsMapsPayloadAndOpenAIUnsupported(t *testing.T) {
	payload := &sttJSONRequest{
		Model:      " grok-stt ",
		SampleRate: float64(16000),
		Format:     true,
		KeyTerms:   []string{"grok"},
	}
	var input gateway.STTInput
	if unsupported := resolveSTTJSONOptions(payload, &input, false); unsupported != "" {
		t.Fatalf("console mode must not flag unsupported parameters: %q", unsupported)
	}
	if input.PublicModel != "grok-stt" || input.SampleRate != "16000" || !input.Format {
		t.Fatalf("unexpected mapping %+v", input)
	}
	temperature := 0.5
	prompt := &sttJSONRequest{ResponseFormat: "json", Prompt: "ignore", Temperature: &temperature}
	var openAI gateway.STTInput
	if unsupported := resolveSTTJSONOptions(prompt, &openAI, true); unsupported != "temperature" {
		t.Fatalf("later unsupported parameters must win: %q", unsupported)
	}
}

func TestValidateOpenAISTTRequestNormalizesAndRejects(t *testing.T) {
	context, recorder := newHelperTestContext()
	input := gateway.STTInput{}
	if !validateOpenAISTTRequest(context, &input, "") || input.ResponseFormat != "json" {
		t.Fatalf("empty response_format must default to json: %+v", input)
	}
	context, recorder = newHelperTestContext()
	if validateOpenAISTTRequest(context, &input, "prompt") || recorder.Code != http.StatusBadRequest {
		t.Fatalf("unsupported parameter must fail: status=%d", recorder.Code)
	}
	context, recorder = newHelperTestContext()
	bad := gateway.STTInput{}
	bad.ResponseFormat = "srt"
	if validateOpenAISTTRequest(context, &bad, "") || recorder.Code != http.StatusBadRequest {
		t.Fatalf("unsupported response_format must fail: status=%d", recorder.Code)
	}
}

func TestSTTFormValueHandlesNilForm(t *testing.T) {
	get := sttFormValue(nil)
	if get("model") != "" {
		t.Fatal("nil form must yield empty values")
	}
}

// stream_inspector.go 提取的重构辅助函数。
func TestResponseInspectorInspectDataLineMergesMetadataInOrder(t *testing.T) {
	inspector := &responseInspector{protocol: streamProtocolResponses}
	inspector.inspectDataLine([]byte(`{"type":"response.created","response":{"id":"resp-1","model":"grok-4","sequence_number":3}}`))
	inspector.inspectDataLine([]byte(`{"type":"response.output_text.delta","delta":"hi"}`))
	if !inspector.metadata.Usage.OutputObserved {
		t.Fatal("generated delta must set OutputObserved")
	}
	if inspector.metadata.ResponseID != "resp-1" || inspector.metadata.Model != "grok-4" || inspector.metadata.SequenceNumber != 3 {
		t.Fatalf("metadata not merged: %+v", inspector.metadata)
	}
	inspector.inspectDataLine([]byte(`{"type":"response.completed","response":{"id":"resp-2","model":"grok-5","sequence_number":1}}`))
	if inspector.metadata.ResponseID != "resp-2" || inspector.metadata.Model != "grok-5" || inspector.metadata.SequenceNumber != 3 {
		t.Fatalf("id/model must overwrite and sequence_number must keep the max: %+v", inspector.metadata)
	}
}

func TestResponseInspectorInspectDataLineSkipsDonePayload(t *testing.T) {
	inspector := &responseInspector{protocol: streamProtocolChat}
	inspector.inspectDataLine([]byte("[DONE]"))
	if !inspector.terminalSuccess {
		t.Fatal("[DONE] must mark chat streams as terminal success")
	}
	if inspector.metadata.ResponseID != "" || inspector.metadata.Model != "" {
		t.Fatalf("[DONE] must not touch metadata: %+v", inspector.metadata)
	}
}

func TestResponseInspectorInspectHandlesOversizedAndDataLines(t *testing.T) {
	oversized := &responseInspector{protocol: streamProtocolChat}
	oversized.pending = append([]byte("data: "), make([]byte, maxStreamEventInspectionBytes+1)...)
	oversized.Inspect(nil)
	if len(oversized.pending) != 0 || !oversized.metadata.Usage.OutputObserved {
		t.Fatalf("oversized data line must be dropped and counted as output: len=%d observed=%t", len(oversized.pending), oversized.metadata.Usage.OutputObserved)
	}
	partial := &responseInspector{protocol: streamProtocolChat}
	partial.Inspect([]byte("data: {\"choi"))
	if string(partial.pending) != "data: {\"choi" {
		t.Fatalf("unterminated chunk must stay pending: %q", partial.pending)
	}
	partial.Inspect([]byte("ces\":[{\"delta\":{\"content\":\"x\"}}]}\n"))
	if len(partial.pending) != 0 || !partial.metadata.Usage.OutputObserved {
		t.Fatalf("completed line must be inspected: len=%d observed=%t", len(partial.pending), partial.metadata.Usage.OutputObserved)
	}
}

func TestContainsGeneratedDeltaDelegatesPerProtocol(t *testing.T) {
	cases := []struct {
		name     string
		protocol streamProtocol
		data     string
		want     bool
	}{
		{"responses text delta", streamProtocolResponses, `{"type":"response.output_text.delta","delta":"x"}`, true},
		{"responses empty delta", streamProtocolResponses, `{"type":"response.output_text.delta"}`, false},
		{"responses reasoning item", streamProtocolResponses, `{"type":"response.output_item.added","item":{"id":"rs-1","type":"reasoning"}}`, true},
		{"responses unidentified item", streamProtocolResponses, `{"type":"response.output_item.added","item":{"type":"reasoning"}}`, false},
		{"chat content", streamProtocolChat, `{"choices":[{"delta":{"content":"x"}}]}`, true},
		{"chat tool arguments", streamProtocolChat, `{"choices":[{"delta":{"tool_calls":[{"function":{"arguments":"{}"}}]}}]}`, true},
		{"chat silent", streamProtocolChat, `{"choices":[{"delta":{"role":"assistant"}}]}`, false},
		{"anthropic text", streamProtocolAnthropic, `{"type":"content_block_delta","delta":{"type":"text_delta","text":"x"}}`, true},
		{"anthropic thinking block", streamProtocolAnthropic, `{"type":"content_block_start","content_block":{"type":"thinking"}}`, true},
		{"anthropic ping", streamProtocolAnthropic, `{"type":"ping"}`, false},
		{"image protocol never counts", streamProtocolImage, `{"type":"image_generation.completed"}`, false},
		{"malformed json", streamProtocolChat, `{`, false},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := containsGeneratedDelta([]byte(testCase.data), testCase.protocol); got != testCase.want {
				t.Fatalf("containsGeneratedDelta(%s) = %t, want %t", testCase.data, got, testCase.want)
			}
		})
	}
}

// prompt_cache.go 提取的重构辅助函数。
func TestPromptCacheSeedFromHeadersPrecedence(t *testing.T) {
	headers := http.Header{}
	headers.Set("X-Session-Id", " proxy ")
	headers.Set("X-Conversation-Id", "conversation")
	if seed := promptCacheSeedFromHeaders(headers); seed != "proxy" {
		t.Fatalf("proxy session header must win by list order: %q", seed)
	}
	headers.Set("X-Claude-Code-Session-Id", "claude-session")
	if seed := promptCacheSeedFromHeaders(headers); seed != "claude:claude-session:agent:main" {
		t.Fatalf("claude session header must win: %q", seed)
	}
	if seed := promptCacheSeedFromHeaders(nil); seed != "" {
		t.Fatalf("nil headers must yield empty seed: %q", seed)
	}
}

func TestPromptCacheSeedFromPayloadPrecedence(t *testing.T) {
	payload := promptCacheSeedPayload{
		ConversationID:      "conversation",
		ConversationIDCamel: "conversationCamel",
		SessionID:           "session",
		SessionIDCamel:      "sessionCamel",
		Metadata: struct {
			SessionID      string `json:"session_id"`
			SessionIDCamel string `json:"sessionId"`
			UserID         string `json:"user_id"`
		}{SessionID: "meta-session"},
		ClientMetadata: map[string]json.RawMessage{
			"x-codex-window-id":     json.RawMessage(`"window-1"`),
			"x-codex-turn-metadata": json.RawMessage(`{"prompt_cache_key":"turn-key"}`),
		},
	}
	if seed := promptCacheSeedFromPayload(payload, nil); seed != "meta-session" {
		t.Fatalf("metadata.session_id must win: %q", seed)
	}
	payload.Metadata.SessionID = ""
	payload.Metadata.SessionIDCamel = ""
	if seed := promptCacheSeedFromPayload(payload, nil); seed != "turn-key" {
		t.Fatalf("codex turn metadata must be used before window id: %q", seed)
	}
	delete(payload.ClientMetadata, "x-codex-turn-metadata")
	if seed := promptCacheSeedFromPayload(payload, nil); seed != "codex:window:window-1" {
		t.Fatalf("codex window id must be prefixed: %q", seed)
	}
	payload.ClientMetadata = nil
	if seed := promptCacheSeedFromPayload(payload, nil); seed != "session" {
		t.Fatalf("plain session_id must be used last: %q", seed)
	}
}

func TestPromptCacheSeedFromPayloadFallsBackToConversationCamel(t *testing.T) {
	payload := promptCacheSeedPayload{ConversationIDCamel: " only-camel "}
	if seed := promptCacheSeedFromPayload(payload, nil); seed != "only-camel" {
		t.Fatalf("conversationId must be the final fallback: %q", seed)
	}
	if seed := promptCacheSeedFromPayload(promptCacheSeedPayload{}, nil); seed != "" {
		t.Fatalf("empty payload must yield empty seed: %q", seed)
	}
}

// codex_models.go 提取的重构辅助函数。
func TestCodexInputModalitiesAndApplyPatchTool(t *testing.T) {
	if got := codexInputModalities(true); len(got) != 2 || got[0] != "text" || got[1] != "image" {
		t.Fatalf("image-capable modalities = %#v", got)
	}
	if got := codexInputModalities(false); len(got) != 1 || got[0] != "text" {
		t.Fatalf("text-only modalities = %#v", got)
	}
	if tool := codexApplyPatchToolType(false); tool != nil {
		t.Fatalf("unsupported tools must not advertise apply_patch: %v", *tool)
	}
	tool := codexApplyPatchToolType(true)
	if tool == nil || *tool != "freeform" {
		t.Fatalf("supported tools must advertise freeform: %v", tool)
	}
}

func TestBuildCodexModelEntryDerivesFieldsFromRoute(t *testing.T) {
	item := modelListItem{ID: "grok-4.5", Provider: account.ProviderBuild, Capability: modeldomain.CapabilityResponses}
	entry := buildCodexModelEntry(item, 2)
	if entry.Slug != "grok-4.5" || entry.Priority != 3 {
		t.Fatalf("slug/priority = %q/%d", entry.Slug, entry.Priority)
	}
	if entry.ContextWindow != 500000 || entry.MaxContextWindow != 500000 {
		t.Fatalf("context window = %d/%d", entry.ContextWindow, entry.MaxContextWindow)
	}
	if entry.Visibility != "list" || entry.WebSearchToolType != "text" || entry.EffectiveContextWindowPercent != 95 {
		t.Fatalf("unexpected defaults: %#v", entry)
	}
	if entry.ApplyPatchToolType == nil || *entry.ApplyPatchToolType != "freeform" || !entry.SupportsParallelToolCalls {
		t.Fatalf("build responses route must support agent tools: %#v", entry)
	}
	if len(entry.InputModalities) != 2 || entry.InputModalities[1] != "image" {
		t.Fatalf("input modalities = %#v", entry.InputModalities)
	}
	media := buildCodexModelEntry(modelListItem{ID: "grok-imagine-image-lite", Provider: account.ProviderWeb, Capability: modeldomain.CapabilityImage}, 0)
	if media.Visibility != "hide" || media.Priority != 1 || media.ApplyPatchToolType != nil {
		t.Fatalf("media entry must hide and drop agent tools: %#v", media)
	}
}

// response_writer.go 提取的重构辅助函数。
func TestCopyErrorCodeKeepsPriorCodeWithoutCopyError(t *testing.T) {
	context, _ := newHelperTestContext()
	context.Request = httptest.NewRequest(http.MethodGet, "/", nil)
	if code := copyErrorCode(context, nil, "upstream_error"); code != "upstream_error" {
		t.Fatalf("nil copy error must preserve the prior code: %q", code)
	}
	if code := copyErrorCode(context, errResponseTransferLimit, "upstream_error"); code != "response_too_large" {
		t.Fatalf("copy error must be classified: %q", code)
	}
	if code := copyErrorCode(context, nil, ""); code != "" {
		t.Fatalf("empty code must stay empty: %q", code)
	}
}

func TestWriteEmptyUpstreamFailureMapsIdleAndEmptyResponses(t *testing.T) {
	context, recorder := newHelperTestContext()
	if code := writeEmptyUpstreamFailure(context, neterror.ErrUpstreamStreamIdleTimeout, false); code != "upstream_stream_idle_timeout" {
		t.Fatalf("idle timeout code = %q", code)
	}
	if recorder.Code != http.StatusGatewayTimeout {
		t.Fatalf("idle timeout status = %d", recorder.Code)
	}
	context, recorder = newHelperTestContext()
	if code := writeEmptyUpstreamFailure(context, neterror.ErrUpstreamResponseEmpty, true); code != "upstream_response_empty" {
		t.Fatalf("empty response code = %q", code)
	}
	if recorder.Code != http.StatusBadGateway || !strings.Contains(recorder.Body.String(), `"type":"api_error"`) {
		t.Fatalf("anthropic empty response must use api_error mapping: %d %s", recorder.Code, recorder.Body.String())
	}
	context, recorder = newHelperTestContext()
	if code := writeEmptyUpstreamFailure(context, errors.New("other"), false); code != "stream_interrupted" {
		t.Fatalf("unknown error code = %q", code)
	}
	if recorder.Code != http.StatusBadGateway {
		t.Fatalf("unknown error status = %d", recorder.Code)
	}
}

func TestWriteUpstreamErrorBodyClassifiesUpstreamError(t *testing.T) {
	body := []byte(`{"error":{"code":"invalid_request"}}`)
	wantCode, _ := gateway.ClassifyUpstreamHTTPError(http.StatusBadRequest, body)
	context, recorder := newHelperTestContext()
	result := &gateway.Result{
		StatusCode: http.StatusBadRequest,
		Header:     http.Header{"Content-Length": []string{"999"}},
		Body:       io.NopCloser(strings.NewReader(string(body))),
	}
	if code := writeUpstreamErrorBody(context, result, false); code != wantCode {
		t.Fatalf("upstream error code = %q, want %q", code, wantCode)
	}
	if recorder.Code != http.StatusBadRequest || recorder.Header().Get("Content-Length") != "" {
		t.Fatalf("upstream error response = %d/%q", recorder.Code, recorder.Header().Get("Content-Length"))
	}
}

func TestWriteUpstreamErrorBodyReadFailureKeepsAnthropicShape(t *testing.T) {
	context, recorder := newHelperTestContext()
	result := &gateway.Result{
		StatusCode: http.StatusBadGateway,
		Header:     http.Header{},
		Body:       io.NopCloser(&chunkErrorReader{data: []byte("ignored")}),
	}
	if code := writeUpstreamErrorBody(context, result, true); code != "upstream_error" {
		t.Fatalf("read failure code = %q", code)
	}
	if recorder.Code != http.StatusBadGateway || !strings.Contains(recorder.Body.String(), `"type":"api_error"`) {
		t.Fatalf("anthropic read failure shape = %d %s", recorder.Code, recorder.Body.String())
	}
}

func TestCopyProtocolBodyRecordsStreamFailureOnlyWhenDiagnosed(t *testing.T) {
	context, _ := newHelperTestContext()
	context.Request = httptest.NewRequest(http.MethodGet, "/", nil)
	handler := &Handler{}
	recorded := 0
	result := &gateway.Result{
		StatusCode:          http.StatusOK,
		Body:                io.NopCloser(strings.NewReader("")),
		RecordStreamFailure: func(gateway.StreamFailureDiagnostic) { recorded++ },
	}
	usage, responseID, errorCode := handler.copyProtocolBody(context, result, nil, true, streamProtocolChat, "", "upstream_error")
	if usage.Reported || responseID != "" || errorCode != "upstream_stream_incomplete" {
		t.Fatalf("stream body metadata = %+v %q %q", usage, responseID, errorCode)
	}
	if recorded != 0 {
		t.Fatalf("no diagnostic was produced, so nothing may be recorded: %d", recorded)
	}
}

func TestCopyProtocolBodyNonStreamClassifiesTransferLimit(t *testing.T) {
	context, _ := newHelperTestContext()
	context.Request = httptest.NewRequest(http.MethodGet, "/", nil)
	handler := &Handler{}
	result := &gateway.Result{StatusCode: http.StatusOK}
	oversized := strings.NewReader(strings.Repeat("a", maxJSONResponseTransferBytes+1))
	_, _, errorCode := handler.copyProtocolBody(context, result, oversized, false, streamProtocolResponses, "", "")
	if errorCode != "response_too_large" {
		t.Fatalf("non-stream transfer limit code = %q", errorCode)
	}
}

// voice_ws_handler.go 提取的重构辅助函数。
func TestPumpVoiceWebSocketsForwardsOneMessagePerDirection(t *testing.T) {
	readErr := errors.New("client read failed")
	clientCalls := 0
	clientRead := func() (int, []byte, error) {
		clientCalls++
		if clientCalls == 1 {
			return clientws.TextMessage, []byte("c1"), nil
		}
		return 0, nil, readErr
	}
	var forwardedToUpstream [][]byte
	upstreamWrite := func(messageType int, payload []byte) error {
		if messageType != clientws.TextMessage {
			t.Errorf("unexpected message type %d", messageType)
		}
		forwardedToUpstream = append(forwardedToUpstream, append([]byte(nil), payload...))
		return nil
	}
	upstreamCalls := 0
	upstreamRead := func() (int, []byte, error) {
		upstreamCalls++
		if upstreamCalls == 1 {
			return clientws.TextMessage, []byte("u1"), nil
		}
		return 0, nil, io.EOF
	}
	var forwardedToClient [][]byte
	clientWrite := func(_ int, payload []byte) error {
		forwardedToClient = append(forwardedToClient, append([]byte(nil), payload...))
		return nil
	}
	errCh := pumpVoiceWebSockets(clientRead, upstreamWrite, upstreamRead, clientWrite)
	first, second := <-errCh, <-errCh
	upstreamResult, clientResult := first, second
	if clientResult.upstreamSide {
		upstreamResult, clientResult = clientResult, upstreamResult
	}
	if !upstreamResult.upstreamSide || !errors.Is(upstreamResult.result.err, io.EOF) {
		t.Fatalf("upstream side must report EOF: %+v", upstreamResult)
	}
	if clientResult.upstreamSide || !errors.Is(clientResult.result.err, readErr) {
		t.Fatalf("client side must report the read failure: %+v", clientResult)
	}
	if len(forwardedToClient) != 1 || string(forwardedToClient[0]) != "u1" {
		t.Fatalf("upstream payload must be forwarded to the client once: %q", forwardedToClient)
	}
	if len(forwardedToUpstream) != 1 || string(forwardedToUpstream[0]) != "c1" {
		t.Fatalf("client payload must be forwarded upstream once: %q", forwardedToUpstream)
	}
}

func TestRecordStreamingSTTDurationKeepsMaximumConfirmedValue(t *testing.T) {
	var mu sync.Mutex
	outcome := gateway.VoiceWebSocketOutcome{}
	recordStreamingSTTDuration([]byte(`{"type":"transcript.done","duration":4.5}`), &mu, &outcome)
	recordStreamingSTTDuration([]byte(`{"type":"transcript.done","duration":2}`), &mu, &outcome)
	if outcome.AudioDurationSeconds != 4.5 {
		t.Fatalf("duration must keep the maximum: %v", outcome.AudioDurationSeconds)
	}
	recordStreamingSTTDuration([]byte(`{"type":"transcript.delta","duration":9}`), &mu, &outcome)
	recordStreamingSTTDuration([]byte(`{"type":"transcript.done","duration":-1}`), &mu, &outcome)
	recordStreamingSTTDuration([]byte(`{"type":"transcript.done","duration":0}`), &mu, &outcome)
	recordStreamingSTTDuration([]byte(`not-json`), &mu, &outcome)
	if outcome.AudioDurationSeconds != 4.5 {
		t.Fatalf("unconfirmed durations must not change the outcome: %v", outcome.AudioDurationSeconds)
	}
}

// responses_handler.go 提取的重构辅助函数。
func TestDecodeResponsesRequestValidatesAndForcesCompactStream(t *testing.T) {
	request, body, err := decodeResponsesRequest([]byte(`{"model":" grok-4 ","stream":true}`), false)
	if err != nil || !request.Stream || request.Model != " grok-4 " {
		t.Fatalf("valid request must pass unchanged: %+v %q %v", request, body, err)
	}
	if _, _, err := decodeResponsesRequest([]byte(`{"model":"  "}`), false); err == nil || err.Error() != "Responses 请求缺少有效 model" {
		t.Fatalf("missing model must be rejected with the original message: %v", err)
	}
	if _, _, err := decodeResponsesRequest([]byte(`not-json`), true); err == nil || err.Error() != "Responses 请求缺少有效 model" {
		t.Fatalf("malformed body must fail the model check first: %v", err)
	}
	request, body, err = decodeResponsesRequest([]byte(`{"model":"grok-4","stream":true}`), true)
	if err != nil || request.Stream {
		t.Fatalf("compact must force stream=false: %+v %v", request, err)
	}
	if !strings.Contains(string(body), `"stream":false`) {
		t.Fatalf("compact body must be rewritten: %s", body)
	}
}

func TestClientKeyFromContextRejectsMissingOrWrongType(t *testing.T) {
	context, recorder := newHelperTestContext()
	if _, ok := clientKeyFromContext(context); ok {
		t.Fatal("missing client key must be rejected")
	}
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("unexpected status %d", recorder.Code)
	}
	context, recorder = newHelperTestContext()
	context.Set(middleware.ClientKey, "not-a-key")
	if _, ok := clientKeyFromContext(context); ok || recorder.Code != http.StatusUnauthorized {
		t.Fatalf("wrong client key type must be rejected: status=%d", recorder.Code)
	}
	context, _ = newHelperTestContext()
	context.Set(middleware.ClientKey, clientkeydomain.Key{ID: 7})
	key, ok := clientKeyFromContext(context)
	if !ok || key.ID != 7 {
		t.Fatalf("valid client key must be returned: %+v %t", key, ok)
	}
}

func TestNewResponsesGatewayInputCopiesRequestSignals(t *testing.T) {
	context, _ := newHelperTestContext()
	context.Request = httptest.NewRequest(http.MethodPost, "/v1/responses?trace=1", nil)
	context.Request.Header.Set("x-grok-turn-idx", "3")
	context.Request.Header.Set("X-Session-Id", "seed-session")
	context.Set(middleware.RequestIDKey, "req-1")
	request := responsesRequest{Model: "grok-4", Stream: true, PromptCacheKey: "key-1", PreviousResponseID: "resp-0"}
	input := newResponsesGatewayInput(context, clientkeydomain.Key{ID: 9}, request, []byte(`{"model":"grok-4"}`))
	if input.RequestID != "req-1" || input.ClientKey.ID != 9 || input.PublicModel != "grok-4" {
		t.Fatalf("unexpected identity mapping: %+v", input)
	}
	if !input.Streaming || input.PromptCacheKey != "key-1" || input.PreviousResponseID != "resp-0" {
		t.Fatalf("unexpected request mapping: %+v", input)
	}
	if input.PromptCacheSeed != "seed-session" || input.GrokTurnIndex != "3" {
		t.Fatalf("unexpected signal mapping: %+v", input)
	}
	if input.Method != http.MethodPost || input.Path != "/v1/responses" {
		t.Fatalf("unexpected transport mapping: %+v", input)
	}
	if values := input.Headers["X-Session-Id"]; len(values) != 1 || values[0] != "seed-session" {
		t.Fatalf("headers must be cloned: %v", input.Headers)
	}
}

func TestOnceVoiceWebSocketCloserClosesOnceAndFinalizesLatestOutcome(t *testing.T) {
	var mu sync.Mutex
	outcome := gateway.VoiceWebSocketOutcome{}
	upstreamConn := &recordingVoiceWSConn{}
	session := &gateway.VoiceWebSocketSession{Conn: upstreamConn}
	finalized := 0
	var finalOutcome gateway.VoiceWebSocketOutcome
	session.Finalize = func(value gateway.VoiceWebSocketOutcome) {
		finalized++
		finalOutcome = value
	}
	clientCloses := 0
	closer := onceVoiceWebSocketCloser(voiceWSSessionCloser{
		closeConn: func() error { clientCloses++; return nil },
		session:   session, outcomeMu: &mu, outcome: &outcome,
	})
	closer()
	if clientCloses != 1 || upstreamConn.closes != 1 || finalized != 1 {
		t.Fatalf("first call must close both sides once: client=%d upstream=%d finalized=%d", clientCloses, upstreamConn.closes, finalized)
	}
	if finalOutcome.ErrorCode != "" {
		t.Fatalf("finalize must see the outcome captured at close time: %+v", finalOutcome)
	}
	// 之后的调用必须是 no-op：会话终结不可重复执行。
	closer()
	if clientCloses != 1 || upstreamConn.closes != 1 || finalized != 1 {
		t.Fatalf("repeat calls must be no-ops: client=%d upstream=%d finalized=%d", clientCloses, upstreamConn.closes, finalized)
	}
}

// recordingVoiceWSConn 记录 Close 次数的最小 VoiceWebSocketConn 替身。
type recordingVoiceWSConn struct {
	closes int
}

func (c *recordingVoiceWSConn) ReadMessage() (int, []byte, error) { return 0, nil, io.EOF }
func (c *recordingVoiceWSConn) WriteMessage(int, []byte) error    { return nil }
func (c *recordingVoiceWSConn) SetReadLimit(int64)                {}
func (c *recordingVoiceWSConn) Close() error                      { c.closes++; return nil }

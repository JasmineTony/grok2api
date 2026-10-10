package web

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/chenyme/grok2api/backend/internal/domain/account"
	"github.com/chenyme/grok2api/backend/internal/ports/provider"
)

// readExtractedErrorBody 读取 jsonProviderResponse 响应体中的 error 对象。
func readExtractedErrorBody(t *testing.T, response *provider.Response) map[string]any {
	t.Helper()
	if response == nil {
		t.Fatal("响应为 nil")
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("读取响应体失败: %v", err)
	}
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatalf("解析响应体失败: %v (%s)", err, raw)
	}
	errorValue, ok := payload["error"].(map[string]any)
	if !ok {
		t.Fatalf("响应缺少 error 对象: %s", raw)
	}
	return errorValue
}

func collectJSONFrames(t *testing.T, source string, maxObjectBytes int) []string {
	t.Helper()
	var frames []string
	if err := consumeJSONObjects(strings.NewReader(source), maxObjectBytes, func(frame []byte) error {
		frames = append(frames, string(frame))
		return nil
	}); err != nil {
		t.Fatalf("consumeJSONObjects 失败: %v", err)
	}
	return frames
}

func TestConsumeJSONObjectsSplitsFrames(t *testing.T) {
	source := "x" + `{"a":1}` + `{"b":{"c":"}"}}` + `{"d":"\""}` + "}"
	frames := collectJSONFrames(t, source, 1<<20)
	want := []string{`{"a":1}`, `{"b":{"c":"}"}}`, `{"d":"\""}`}
	if len(frames) != len(want) {
		t.Fatalf("帧数量 = %d, want %d (%v)", len(frames), len(want), frames)
	}
	for index := range want {
		if frames[index] != want[index] {
			t.Errorf("帧[%d] = %s, want %s", index, frames[index], want[index])
		}
	}
}

func TestConsumeJSONObjectsRejectsIncompleteFrame(t *testing.T) {
	err := consumeJSONObjects(strings.NewReader(`{"a":1`), 1<<20, func([]byte) error { return nil })
	if !errors.Is(err, io.ErrUnexpectedEOF) {
		t.Fatalf("err = %v, want io.ErrUnexpectedEOF", err)
	}
}

func TestConsumeJSONObjectsEnforcesFrameLimit(t *testing.T) {
	err := consumeJSONObjects(strings.NewReader(`{"a":"1234567890"}`), 8, func([]byte) error { return nil })
	if err == nil || !strings.Contains(err.Error(), "MiB") {
		t.Fatalf("err = %v, want 帧上限错误", err)
	}
}

func TestConsumeJSONObjectsPropagatesConsumerError(t *testing.T) {
	sentinel := errors.New("stop")
	err := consumeJSONObjects(strings.NewReader(`{"a":1}`), 1<<20, func([]byte) error { return sentinel })
	if !errors.Is(err, sentinel) {
		t.Fatalf("err = %v, want %v", err, sentinel)
	}
}

func TestConsumeJSONObjectsIgnoresUnbalancedTail(t *testing.T) {
	frames := collectJSONFrames(t, "no frames here }}  ", 1<<20)
	if len(frames) != 0 {
		t.Fatalf("帧 = %v, want 空", frames)
	}
}

func TestRejectUnsupportedForwardOperation(t *testing.T) {
	compact := rejectUnsupportedForwardOperation(provider.ResponseResourceRequest{Path: "/responses/compact", Method: http.MethodPost})
	if errorValue := readExtractedErrorBody(t, compact); errorValue["code"] != "unsupported_operation" {
		t.Fatalf("compact code = %v, want unsupported_operation", errorValue["code"])
	}
	if compact.StatusCode != http.StatusBadRequest {
		t.Fatalf("compact 状态码 = %d, want 400", compact.StatusCode)
	}
	get := rejectUnsupportedForwardOperation(provider.ResponseResourceRequest{Path: "/responses", Method: http.MethodGet})
	if get.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("非 POST 状态码 = %d, want 405", get.StatusCode)
	}
	if early := rejectUnsupportedForwardOperation(provider.ResponseResourceRequest{Path: "/responses", Method: http.MethodPost}); early != nil {
		t.Fatalf("合法 POST 不应被拒绝: %+v", early)
	}
}

func TestForwardChatUnsupportedModel(t *testing.T) {
	response := forwardChatUnsupportedModel()
	if response.StatusCode != http.StatusBadRequest {
		t.Fatalf("状态码 = %d, want 400", response.StatusCode)
	}
	if errorValue := readExtractedErrorBody(t, response); errorValue["message"] != "模型不支持文本对话" {
		t.Fatalf("message = %v", errorValue["message"])
	}
}

func TestInvalidForwardChatAttachmentResponse(t *testing.T) {
	cases := []struct {
		err  error
		code string
	}{
		{errInvalidChatAttachment, "invalid_attachment_input"},
		{errInvalidChatImage, "invalid_image_input"},
		{errInvalidChatFile, "invalid_attachment_input"},
		{fmt.Errorf("wrapped: %w", errInvalidChatImage), "invalid_image_input"},
	}
	for _, item := range cases {
		response := invalidForwardChatAttachmentResponse(item.err)
		if response == nil {
			t.Fatalf("%v 应映射为 400 响应", item.err)
		}
		if response.StatusCode != http.StatusBadRequest {
			t.Fatalf("%v 状态码 = %d, want 400", item.err, response.StatusCode)
		}
		if errorValue := readExtractedErrorBody(t, response); errorValue["code"] != item.code {
			t.Fatalf("%v code = %v, want %s", item.err, errorValue["code"], item.code)
		}
	}
	if response := invalidForwardChatAttachmentResponse(errors.New("其他故障")); response != nil {
		t.Fatalf("非入参错误应返回 nil, got %+v", response)
	}
}

func TestValidateGenerateImageRequestDefaults(t *testing.T) {
	options, early, err := validateGenerateImageRequest(provider.ImageGenerationRequest{ResponseFormat: "  B64_JSON "})
	if err != nil || early != nil {
		t.Fatalf("合法请求被拒绝: err=%v early=%+v", err, early)
	}
	if options.count != 1 || options.format != "b64_json" {
		t.Fatalf("options = %+v, want {count:1 format:b64_json}", options)
	}
	options, early, err = validateGenerateImageRequest(provider.ImageGenerationRequest{Count: 4})
	if err != nil || early != nil || options.count != 4 || options.format != "url" {
		t.Fatalf("options = %+v err=%v early=%+v", options, err, early)
	}
}

func TestValidateGenerateImageRequestRejections(t *testing.T) {
	cases := []struct {
		name    string
		request provider.ImageGenerationRequest
		code    string
		kind    string
	}{
		{"streaming 多图", provider.ImageGenerationRequest{Streaming: true, Count: 2}, "unsupported_parameter", "image_generation_user_error"},
		{"partial 上界", provider.ImageGenerationRequest{PartialImages: 4, Streaming: true}, "", "invalid_request_error"},
		{"partial 下界", provider.ImageGenerationRequest{PartialImages: -1}, "", "invalid_request_error"},
		{"partial 非流式", provider.ImageGenerationRequest{PartialImages: 1}, "", "invalid_request_error"},
		{"response_format", provider.ImageGenerationRequest{ResponseFormat: "png"}, "", "invalid_request_error"},
	}
	for _, item := range cases {
		options, early, err := validateGenerateImageRequest(item.request)
		if err != nil || early == nil {
			t.Fatalf("%s: err=%v early=%+v options=%+v", item.name, err, early, options)
		}
		if early.StatusCode != http.StatusBadRequest {
			t.Fatalf("%s 状态码 = %d, want 400", item.name, early.StatusCode)
		}
		errorValue := readExtractedErrorBody(t, early)
		if errorValue["type"] != item.kind {
			t.Fatalf("%s type = %v, want %s", item.name, errorValue["type"], item.kind)
		}
		if item.code != "" && errorValue["code"] != item.code {
			t.Fatalf("%s code = %v, want %s", item.name, errorValue["code"], item.code)
		}
	}
}

func TestValidateImageEditAttemptRejections(t *testing.T) {
	valid := []string{"https://example.test/a.png"}
	cases := []struct {
		name    string
		request provider.ImageEditRequest
	}{
		{"quality", provider.ImageEditRequest{ImageURLs: valid, Quality: "high"}},
		{"图片数量为 0", provider.ImageEditRequest{}},
		{"图片数量超过 8", provider.ImageEditRequest{ImageURLs: []string{"a", "b", "c", "d", "e", "f", "g", "h", "i"}}},
		{"n 不为 1", provider.ImageEditRequest{ImageURLs: valid, Count: 2}},
		{"partial 上界", provider.ImageEditRequest{ImageURLs: valid, PartialImages: 4, Streaming: true}},
		{"partial 非流式", provider.ImageEditRequest{ImageURLs: valid, PartialImages: 1}},
		{"resolution", provider.ImageEditRequest{ImageURLs: valid, Resolution: "2k"}},
		{"response_format", provider.ImageEditRequest{ImageURLs: valid, ResponseFormat: "webp"}},
	}
	for _, item := range cases {
		options, early, err := validateImageEditAttempt(item.request)
		if err != nil || early == nil {
			t.Fatalf("%s: err=%v early=%+v options=%+v", item.name, err, early, options)
		}
		if early.StatusCode != http.StatusBadRequest {
			t.Fatalf("%s 状态码 = %d, want 400", item.name, early.StatusCode)
		}
		if errorValue := readExtractedErrorBody(t, early); errorValue["type"] != "invalid_request_error" {
			t.Fatalf("%s type = %v", item.name, errorValue["type"])
		}
	}
}

func TestImageEditRejectedKeepsNilError(t *testing.T) {
	options, response, err := imageEditRejected("非法参数")
	if err != nil {
		t.Fatalf("err = %v, want nil", err)
	}
	if options != (imageEditOptions{}) {
		t.Fatalf("options = %+v, want 零值", options)
	}
	if errorValue := readExtractedErrorBody(t, response); errorValue["message"] != "非法参数" {
		t.Fatalf("message = %v", errorValue["message"])
	}
}

func TestDecodeGeneratedImageData(t *testing.T) {
	data, err := decodeGeneratedImageData(strings.NewReader(`{"data":[{"url":"https://example.test/a.png"}]}`))
	if err != nil || len(data) != 1 || data[0]["url"] != "https://example.test/a.png" {
		t.Fatalf("data = %v err = %v", data, err)
	}
	if _, err := decodeGeneratedImageData(strings.NewReader("{not json")); err == nil {
		t.Fatal("非法 JSON 应返回错误")
	}
}

func TestImageChatParsedFromGenerated(t *testing.T) {
	parsed, err := imageChatParsedFromGenerated([]map[string]any{
		{"url": "https://example.test/a.png"},
		{},
		{"b64_json": "QUJD"},
	}, "提示词")
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if parsed.ResponseID == "" || parsed.InputTokens != estimateTokens("提示词") {
		t.Fatalf("parsed = %+v", parsed)
	}
	text := parsed.Text.String()
	if !strings.Contains(text, "![image](https://example.test/a.png)") || !strings.Contains(text, "data:image/jpeg;base64,QUJD") {
		t.Fatalf("正文 = %q", text)
	}
	if _, err := imageChatParsedFromGenerated(nil, "提示词"); err == nil {
		t.Fatal("无图片应返回错误")
	}
}

func TestParseStreamingImageResponse(t *testing.T) {
	parsed := &parsedChat{}
	kind, delta, err := parseStreamingImageResponse(parsed, map[string]any{"imageUrl": "https://example.test/a.png", "isFinal": true})
	if err != nil || kind != "image" || !strings.Contains(delta, "example.test/a.png") {
		t.Fatalf("kind=%q delta=%q err=%v", kind, delta, err)
	}
	if len(parsed.Images) != 1 {
		t.Fatalf("Images = %v", parsed.Images)
	}
	kind, delta, err = parseStreamingImageResponse(&parsedChat{}, map[string]any{"url": "https://example.test/b.png", "progress": float64(100)})
	if err != nil || kind != "image" || !strings.Contains(delta, "example.test/b.png") {
		t.Fatalf("progress=100: kind=%q delta=%q err=%v", kind, delta, err)
	}
	kind, delta, err = parseStreamingImageResponse(&parsedChat{}, map[string]any{"imageUrl": "https://example.test/c.png", "moderated": true})
	if err != nil || kind != "" || delta != "" {
		t.Fatalf("moderated 应被丢弃: kind=%q delta=%q err=%v", kind, delta, err)
	}
	kind, delta, err = parseStreamingImageResponse(&parsedChat{}, map[string]any{"progress": float64(42)})
	if err != nil || kind != "" || delta != "" {
		t.Fatalf("无 URL 应被忽略: kind=%q delta=%q err=%v", kind, delta, err)
	}
}

func TestBuildImportedCredentialSeeds(t *testing.T) {
	seeds, err := buildImportedCredentialSeeds([]importEntry{
		{Token: "token-a", Tier: "SUPER"},
		{SSOToken: "token-a", Tier: "super"},
		{SSOToken: "token-b", Tier: "", Name: "  自定义  ", Email: " a@b.c "},
	})
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if len(seeds) != 2 {
		t.Fatalf("seeds = %d, want 2（重复 token 需去重）", len(seeds))
	}
	if seeds[0].WebTier != account.WebTierSuper || seeds[0].AuthType != account.AuthTypeSSO || seeds[0].Provider != account.ProviderWeb {
		t.Fatalf("seeds[0] = %+v", seeds[0])
	}
	if !strings.HasPrefix(seeds[0].SourceKey, "sso:") || seeds[0].AccessToken == "" {
		t.Fatalf("seeds[0] 凭据字段 = %+v", seeds[0])
	}
	if seeds[1].Name != "自定义" || seeds[1].Email != "a@b.c" || seeds[1].WebTier != account.WebTierAuto {
		t.Fatalf("seeds[1] = %+v", seeds[1])
	}
	if seeds[1].Name == "" {
		t.Fatal("seed 名称不能为空")
	}
}

func TestBuildImportedCredentialSeedsRejections(t *testing.T) {
	if _, err := buildImportedCredentialSeeds([]importEntry{{Tier: "auto"}}); err == nil {
		t.Fatal("缺少 sso_token 应返回错误")
	}
	if _, err := buildImportedCredentialSeeds([]importEntry{{SSOToken: "token-c", Tier: "vip"}}); err == nil {
		t.Fatal("非法 tier 应返回错误")
	}
	if seeds, err := buildImportedCredentialSeeds(nil); err != nil || len(seeds) != 0 {
		t.Fatalf("seeds = %v err = %v", seeds, err)
	}
}

func TestPrepareImagineConnectionPayloads(t *testing.T) {
	reset := imagineResetMessage()
	if reset["type"] != "conversation.item.create" {
		t.Fatalf("reset = %v", reset)
	}
	request := imagineRequestMessage("img-1", "提示词", "16:9", false, true, 2)
	if request["type"] != "conversation.item.create" {
		t.Fatalf("request = %v", request)
	}
	encoded, err := json.Marshal(request)
	if err != nil {
		t.Fatalf("marshal 失败: %v", err)
	}
	if !bytes.Contains(encoded, []byte(`"requestId":"img-1"`)) || !bytes.Contains(encoded, []byte(`"num_generations":2`)) {
		t.Fatalf("request 载荷 = %s", encoded)
	}
}

func TestDecodeSSOTokenPollResponse(t *testing.T) {
	token, pending, slowDown, err := decodeSSOTokenPollResponse(http.StatusOK, []byte(`{"access_token":"a","refresh_token":"r","id_token":"i","expires_in":0}`))
	if err != nil || pending || slowDown {
		t.Fatalf("token = %+v pending=%v slowDown=%v err=%v", token, pending, slowDown, err)
	}
	if token.AccessToken != "a" || token.RefreshToken != "r" || token.IDToken != "i" {
		t.Fatalf("token = %+v", token)
	}
	// expires_in 缺省必须回退为 3600 秒，避免过期时间落在当前时刻。
	if until := time.Until(token.ExpiresAt); until < 59*time.Minute || until > 61*time.Minute {
		t.Fatalf("ExpiresAt = %v (until=%v)", token.ExpiresAt, until)
	}
	if _, pending, _, err := decodeSSOTokenPollResponse(http.StatusBadRequest, []byte(`{"error":"authorization_pending"}`)); err != nil || !pending {
		t.Fatalf("authorization_pending: pending=%v err=%v", pending, err)
	}
	if _, _, slowDown, err := decodeSSOTokenPollResponse(http.StatusBadRequest, []byte(`{"error":"slow_down"}`)); err != nil || !slowDown {
		t.Fatalf("slow_down: slowDown=%v err=%v", slowDown, err)
	}
	if _, _, _, err := decodeSSOTokenPollResponse(http.StatusBadRequest, []byte(`{"error":"access_denied"}`)); !errors.Is(err, provider.ErrAuthorizationDenied) {
		t.Fatalf("access_denied err = %v", err)
	}
	if _, _, _, err := decodeSSOTokenPollResponse(http.StatusForbidden, []byte(`{"error":"invalid_grant"}`)); err == nil || !strings.Contains(err.Error(), "403") {
		t.Fatalf("4xx err = %v", err)
	}
	if _, _, _, err := decodeSSOTokenPollResponse(http.StatusOK, []byte(`{`)); err == nil || !strings.Contains(err.Error(), "解析 xAI OAuth Token") {
		t.Fatalf("非法 JSON err = %v", err)
	}
	// 2xx 但没有 access_token 不是成功响应，必须继续走错误分支。
	if _, _, _, err := decodeSSOTokenPollResponse(http.StatusOK, []byte(`{"expires_in":10}`)); err == nil {
		t.Fatalf("缺失 access_token 的 2xx 应返回错误")
	}
}

func TestDownloadVideoContentType(t *testing.T) {
	cases := []struct {
		header string
		want   string
	}{
		{"video/mp4", "video/mp4"},
		{"video/MP4; charset=binary", "video/mp4"},
		{"application/octet-stream", "video/mp4"},
		{"", "video/mp4"},
		{" text/html; charset=utf-8 ", ""},
		{"image/png", ""},
	}
	for _, item := range cases {
		header := http.Header{}
		if item.header != "" {
			header.Set("Content-Type", item.header)
		}
		if got := downloadVideoContentType(header); got != item.want {
			t.Errorf("Content-Type %q = %q, want %q", item.header, got, item.want)
		}
	}
}

func TestParseWebQuotaModeWindow(t *testing.T) {
	credential := account.Credential{ID: 7}
	window, err := parseWebQuotaModeWindow("grok-4", credential, []byte(`{"windowSizeSeconds":7200,"remainingQueries":-3,"totalQueries":40}`))
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if window.Mode != "grok-4" || window.AccountID != 7 || window.Total != 40 || window.Remaining != 0 || window.WindowSeconds != 7200 {
		t.Fatalf("window = %+v", window)
	}
	if window.ResetAt == nil || window.SyncedAt == nil || window.Source != account.QuotaSourceUpstream {
		t.Fatalf("window 时间与来源 = %+v", window)
	}
	// 缺少 windowSizeSeconds 时回退 7200 秒。
	window, err = parseWebQuotaModeWindow("grok-4", credential, []byte(`{"windowSizeSeconds":0,"remainingQueries":5,"totalQueries":40}`))
	if err != nil || window.WindowSeconds != 7200 {
		t.Fatalf("默认窗口 = %+v err = %v", window, err)
	}
	if _, err := parseWebQuotaModeWindow("grok-4", credential, []byte(`{"totalQueries":0}`)); err == nil {
		t.Fatal("totalQueries<=0 应返回错误")
	}
	if _, err := parseWebQuotaModeWindow("grok-4", credential, []byte(`{`)); err == nil {
		t.Fatal("非法 JSON 应返回错误")
	}
}

func TestResolveSSORedirectTarget(t *testing.T) {
	redirect := func(location string) *http.Response {
		response := &http.Response{Header: http.Header{}}
		if location != "" {
			response.Header.Set("Location", location)
		}
		return response
	}
	target, err := resolveSSORedirectTarget(redirect(" https://auth.x.ai/next "), "https://x.ai/start")
	if err != nil || target != "https://auth.x.ai/next" {
		t.Fatalf("target = %q err = %v", target, err)
	}
	// 相对 Location 必须基于当前 URL 解析。
	target, err = resolveSSORedirectTarget(redirect("/after"), "https://accounts.x.ai/before?q=1")
	if err != nil || target != "https://accounts.x.ai/after" {
		t.Fatalf("相对跳转 target = %q err = %v", target, err)
	}
	if target, err := resolveSSORedirectTarget(redirect(""), "https://x.ai/start"); err == nil || target != "https://x.ai/start" {
		t.Fatalf("缺少 Location target = %q err = %v", target, err)
	}
	// 不受信域名必须返回已解析的新 URL，调用方据此上报，不能回退成旧 URL。
	if target, err := resolveSSORedirectTarget(redirect("https://evil.test/steal"), "https://x.ai/start"); err == nil || target != "https://evil.test/steal" {
		t.Fatalf("非受信域名 target = %q err = %v", target, err)
	}
}

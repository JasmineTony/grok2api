package gateway

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	clientkeyapp "github.com/chenyme/grok2api/backend/internal/application/clientkey"
	accountdomain "github.com/chenyme/grok2api/backend/internal/domain/account"
	"github.com/chenyme/grok2api/backend/internal/domain/audit"
	"github.com/chenyme/grok2api/backend/internal/domain/clientkey"
	modeldomain "github.com/chenyme/grok2api/backend/internal/domain/model"
	"github.com/chenyme/grok2api/backend/internal/ports/provider"
)

// 本文件为 REV-2 分解后提取的辅助函数补充单元测试，覆盖正常、错误与边界输入。
func TestEstimateImagePricingMatchesOfficialTables(t *testing.T) {
	got, priced := estimateImagePricing(audit.OperationImage, "grok-imagine-image", "1024x1024", "high", 2, 0)
	want, wantPriced := audit.EstimateOfficialImageCost("grok-imagine-image", "1024x1024", "high", 2)
	if priced != wantPriced || got != want {
		t.Fatalf("image pricing = %+v (%v), want %+v (%v)", got, priced, want, wantPriced)
	}
	editGot, editPriced := estimateImagePricing(audit.OperationImageEdit, "grok-imagine-image", "1024x1024", "high", 1, 3)
	editWant, editWantPriced := audit.EstimateOfficialImageEditCost("grok-imagine-image", "1024x1024", "high", 1, 3)
	if editPriced != editWantPriced || editGot != editWant {
		t.Fatalf("image edit pricing = %+v (%v), want %+v (%v)", editGot, editPriced, editWant, editWantPriced)
	}
	if result, priced := estimateImagePricing(audit.OperationResponses, "grok-imagine-image", "", "", 1, 0); priced || result != (audit.PricingResult{}) {
		t.Fatalf("non-image operation must stay unpriced, got %+v priced=%v", result, priced)
	}
}

func TestImagePricingTiersDropConsoleOnlyFieldsForWebImagine(t *testing.T) {
	resolution, quality := imagePricingTiers(accountdomain.ProviderWeb, audit.OperationImage, "1080p", "high")
	if resolution != "" || quality != "" {
		t.Fatalf("web imagine tiers = %q/%q, want empty", resolution, quality)
	}
	resolution, quality = imagePricingTiers(accountdomain.ProviderWeb, audit.OperationImageEdit, "1080p", "high")
	if resolution != "1080p" || quality != "high" {
		t.Fatalf("web image edit tiers = %q/%q, want passthrough", resolution, quality)
	}
	resolution, quality = imagePricingTiers(accountdomain.ProviderConsole, audit.OperationImage, "1080p", "high")
	if resolution != "1080p" || quality != "high" {
		t.Fatalf("console tiers = %q/%q, want passthrough", resolution, quality)
	}
}

func TestSelectionFailureCodeReadsSelectionErrors(t *testing.T) {
	if got := selectionFailureCode(errors.New("boom")); got != "upstream_unavailable" {
		t.Fatalf("plain error code = %q", got)
	}
	selection := &SelectionUnavailableError{Reason: SelectionCooling}
	if got := selectionFailureCode(selection); got != selection.Code() {
		t.Fatalf("selection code = %q, want %q", got, selection.Code())
	}
	if got := selectionFailureCode(fmt.Errorf("wrapped: %w", selection)); got != selection.Code() {
		t.Fatalf("wrapped selection code = %q, want %q", got, selection.Code())
	}
}

func TestRetryExcludedAccountClearsLocalExclusion(t *testing.T) {
	excluded := map[uint64]bool{7: true, 9: true}
	retryExcludedAccount(excluded, nil, 7)
	if excluded[7] {
		t.Fatal("account 7 must be released for retry")
	}
	if !excluded[9] {
		t.Fatal("unrelated exclusions must be preserved")
	}
	retryExcludedAccount(nil, nil, 42)
}

func TestNewMediaAuditRecordAppliesImageEditInputCount(t *testing.T) {
	identity := mediaAuditIdentity{
		eventID: "evt", requestID: "req", key: clientkey.Key{ID: 5, Name: "key"},
		route:     modeldomain.Route{ID: 9, Provider: accountdomain.ProviderWeb, PublicID: "grok-imagine-image", UpstreamModel: "grok-imagine-image-1.0"},
		publicID:  "grok-imagine-image",
		operation: audit.OperationImageEdit, streaming: true, method: http.MethodPost, path: "/v1/images/edits",
		mediaInputImages: 4,
	}
	record := newMediaAuditRecord(context.Background(), identity)
	if record.EventID != "evt" || record.RequestID != "req" || record.ClientKeyID != 5 || record.ClientKeyName != "key" {
		t.Fatalf("record identity = %+v", record)
	}
	if record.ModelRouteID != 9 || record.Provider != string(accountdomain.ProviderWeb) || !record.Streaming || record.RequestMethod != http.MethodPost || record.RequestPath != "/v1/images/edits" {
		t.Fatalf("record route/method = %+v", record)
	}
	if record.MediaInputImages != 4 {
		t.Fatalf("image edit input images = %d, want 4", record.MediaInputImages)
	}
	identity.operation = audit.OperationImage
	identity.mediaInputImages = 4
	if got := newMediaAuditRecord(context.Background(), identity); got.MediaInputImages != 0 {
		t.Fatalf("non-edit media input images = %d, want 0", got.MediaInputImages)
	}
}

func TestDecodeMediaJSONObjectReadsKnownKeysAndSkipsUnknown(t *testing.T) {
	decoder := json.NewDecoder(strings.NewReader(`{"type":"message","text":"hello","junk":{"deep":[1,2,3]},"role":"user"}`))
	if _, err := decoder.Token(); err != nil {
		t.Fatalf("open object: %v", err)
	}
	object, err := decodeMediaJSONObject(decoder)
	if err != nil {
		t.Fatalf("decode object: %v", err)
	}
	if object.typeName != "message" || object.role != "user" {
		t.Fatalf("object = %+v", object)
	}
	if object.textBytes != int64(len("hello")) {
		t.Fatalf("text bytes = %d, want %d", object.textBytes, len("hello"))
	}
}

func TestDecodeMediaJSONObjectRejectsNonObjectInput(t *testing.T) {
	decoder := json.NewDecoder(strings.NewReader(`[1,2,3]`))
	if _, err := decodeMediaJSONObject(decoder); err == nil {
		t.Fatal("array input must fail: keys must be strings")
	}
	truncated := json.NewDecoder(strings.NewReader(`{"type":"message"`))
	if _, err := decodeMediaJSONObject(truncated); err == nil {
		t.Fatal("truncated object must fail")
	}
}

func TestMessageAnchorContentPrefersContentOverTextField(t *testing.T) {
	item := map[string]json.RawMessage{
		"content": json.RawMessage(`"from content"`),
		"text":    json.RawMessage(`"from text"`),
	}
	if got := messageAnchorContent(item); got != "from content" {
		t.Fatalf("content anchor = %q", got)
	}
	if got := messageAnchorContent(map[string]json.RawMessage{"text": json.RawMessage(`"  from text  "`)}); got != "from text" {
		t.Fatalf("text fallback anchor = %q", got)
	}
	if got := messageAnchorContent(nil); got != "" {
		t.Fatalf("empty anchor = %q", got)
	}
}

func TestMessageAnchorRoleNormalizesInput(t *testing.T) {
	typeName, role := messageAnchorRole(map[string]json.RawMessage{
		"type": json.RawMessage(`" message "`),
		"role": json.RawMessage(`" User "`),
	})
	if typeName != "message" || role != "user" {
		t.Fatalf("role = %q/%q", typeName, role)
	}
	if typeName, role := messageAnchorRole(nil); typeName != "" || role != "" {
		t.Fatalf("empty role = %q/%q", typeName, role)
	}
}

func TestSttWordListKeepsFieldNameAndSpeaker(t *testing.T) {
	speaker := 1
	words := sttWordList("text", []provider.STTWord{
		{Text: "hello", Start: 0.1, End: 0.4},
		{Text: "world", Start: 0.5, End: 0.9, Speaker: &speaker},
	})
	if len(words) != 2 {
		t.Fatalf("word count = %d", len(words))
	}
	if words[0]["text"] != "hello" || words[0]["start"] != 0.1 || words[0]["end"] != 0.4 {
		t.Fatalf("first word = %+v", words[0])
	}
	if _, ok := words[0]["speaker"]; ok {
		t.Fatal("word without speaker must not carry the field")
	}
	if words[1]["speaker"] != 1 {
		t.Fatalf("second word = %+v", words[1])
	}
	if _, ok := sttWordList("word", []provider.STTWord{{Text: "hi"}})[0]["word"]; !ok {
		t.Fatal("field name must follow the caller's official compatibility name")
	}
}

func TestSttChannelListNestsChannelWords(t *testing.T) {
	channels := sttChannelList([]provider.STTChannel{
		{Index: 0, Text: "a"},
		{Index: 1, Text: "b", Words: []provider.STTWord{{Text: "b1", Start: 1, End: 2}}},
	})
	if len(channels) != 2 {
		t.Fatalf("channel count = %d", len(channels))
	}
	if _, ok := channels[0]["words"]; ok {
		t.Fatal("channel without words must not carry the field")
	}
	words, ok := channels[1]["words"].([]map[string]any)
	if !ok || len(words) != 1 || words[0]["text"] != "b1" {
		t.Fatalf("channel words = %+v", channels[1]["words"])
	}
}

func TestFormatSTTResponseCoversOfficialFormats(t *testing.T) {
	result := provider.STTResult{
		Text:     "hello",
		Language: "en",
		Duration: 1.5,
		Words:    []provider.STTWord{{Text: "hello", Start: 0, End: 1.5}},
		Channels: []provider.STTChannel{{Index: 0, Text: "hello"}},
	}
	response := formatSTTResponse(result, "text")
	if response.StatusCode != http.StatusOK || response.Header.Get("Content-Type") != "text/plain; charset=utf-8" {
		t.Fatalf("text response = %+v", response)
	}
	if body := readAllBody(t, response.Body); body != "hello" {
		t.Fatalf("text body = %q", body)
	}
	if body := readAllBody(t, formatSTTResponse(result, "json").Body); body != `{"text":"hello"}` {
		t.Fatalf("json body = %q", body)
	}
	verbose := map[string]any{}
	if err := json.Unmarshal([]byte(readAllBody(t, formatSTTResponse(result, "verbose_json").Body)), &verbose); err != nil {
		t.Fatalf("verbose json: %v", err)
	}
	if verbose["task"] != "transcribe" || verbose["language"] != "en" {
		t.Fatalf("verbose payload = %+v", verbose)
	}
	raw := result
	raw.RawJSON = []byte(`{"raw":true}`)
	if body := readAllBody(t, formatSTTResponse(raw, "").Body); body != `{"raw":true}` {
		t.Fatalf("raw body = %q", body)
	}
	payload := map[string]any{}
	if err := json.Unmarshal([]byte(readAllBody(t, formatSTTResponse(result, "").Body)), &payload); err != nil {
		t.Fatalf("default payload: %v", err)
	}
	if payload["text"] != "hello" || payload["channels"] == nil {
		t.Fatalf("default payload = %+v", payload)
	}
}

func readAllBody(t *testing.T, body io.ReadCloser) string {
	t.Helper()
	defer body.Close()
	data, err := io.ReadAll(body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	return string(data)
}

func TestBufferQualityChunkAccumulatesUntilBudget(t *testing.T) {
	held := &bytes.Buffer{}
	state := &qualityScanState{}
	if deliver, _ := bufferQualityChunk(held, state, nil); deliver || held.Len() != 0 {
		t.Fatal("empty chunk must not deliver")
	}
	if deliver, verdict := bufferQualityChunk(held, state, []byte("data: {}\n\n")); deliver || verdict != QualityWait {
		t.Fatalf("small chunk verdict = %v", verdict)
	}
	if held.String() != "data: {}\n\n" {
		t.Fatalf("buffered = %q", held.String())
	}
	overflow := &bytes.Buffer{}
	overflow.Write(make([]byte, qualityHoldMaxBufferBytes))
	deliver, verdict := bufferQualityChunk(overflow, state, []byte("x"))
	if !deliver || verdict != QualityDeliver {
		t.Fatalf("overflow verdict = %v deliver=%v", verdict, deliver)
	}
	if overflow.Len() != qualityHoldMaxBufferBytes+1 {
		t.Fatalf("overflow buffer length = %d", overflow.Len())
	}
}

func TestConversationRouteSelectionReasonCoversEveryFailure(t *testing.T) {
	scope := clientkey.AccountScope{}
	selection := conversationRouteSelection{accountScope: scope}
	if !errors.Is(selection.reason(), ErrResponseAccountUnavailable) {
		t.Fatalf("ownership mismatch reason = %v", selection.reason())
	}
	selection.matchedOwnership = true
	var selectionErr *SelectionUnavailableError
	if err := selection.reason(); !errors.As(err, &selectionErr) || selectionErr.Reason != SelectionNoAccounts {
		t.Fatalf("scope mismatch reason = %v", err)
	}
	selection.scopeMatched = true
	if !errors.Is(selection.reason(), clientkeyapp.ErrModelNotAllowed) {
		t.Fatalf("permission mismatch reason = %v", selection.reason())
	}
	selection.allowed = true
	selection.storedResponseUnsupported = true
	if !errors.Is(selection.reason(), ErrResponseStateUnsupported) {
		t.Fatalf("stored response reason = %v", selection.reason())
	}
	selection.storedResponseUnsupported = false
	if !errors.Is(selection.reason(), ErrConversationUnsupported) {
		t.Fatalf("conversation reason = %v", selection.reason())
	}
}

func TestBuildAttemptProjectsTransportFields(t *testing.T) {
	recorder := newFailureAttemptRecorder(http.MethodPost, "/v1/responses?trace=1")
	startedAt := time.Now().Add(-25 * time.Millisecond)
	attempt := recorder.buildAttempt(accountdomain.Credential{ID: 3, Name: "acct"}, httpAttemptFields{
		source: audit.AttemptSourceTransport, stage: "dns_lookup",
		upstreamURL: "https://upstream.example/v1/responses?secret=1", startedAt: startedAt,
		transportError: "lookup failed",
	})
	if attempt.Source != audit.AttemptSourceTransport || attempt.Stage != "dns_lookup" {
		t.Fatalf("attempt = %+v", attempt)
	}
	if attempt.Method != http.MethodPost || attempt.RequestPath != "/v1/responses" {
		t.Fatalf("attempt method/path = %+v", attempt)
	}
	if attempt.UpstreamURL != "https://upstream.example/v1/responses" {
		t.Fatalf("upstream url = %q", attempt.UpstreamURL)
	}
	if attempt.AccountID == nil || *attempt.AccountID != 3 || attempt.AccountName != "acct" {
		t.Fatalf("attempt account = %+v", attempt)
	}
	if attempt.UpstreamStatusCode != nil || attempt.ResponseBody != nil || attempt.DurationMS < 20 {
		t.Fatalf("attempt diagnostics = %+v", attempt)
	}
}

func TestCaptureResponseFailureFieldsKeepsBodyAndStatus(t *testing.T) {
	recorder := newFailureAttemptRecorder(http.MethodPost, "/v1/responses")
	response := &provider.Response{
		StatusCode: http.StatusInternalServerError,
		Status:     "500 Internal Server Error",
		Header:     http.Header{"X-RateLimit-Limit": []string{"10"}},
		Body:       io.NopCloser(strings.NewReader("boom")),
	}
	fields, err := recorder.captureResponseFailureFields(response)
	if err != nil {
		t.Fatalf("capture fields: %v", err)
	}
	if fields.statusCode != http.StatusInternalServerError || fields.status != "500 Internal Server Error" {
		t.Fatalf("fields = %+v", fields)
	}
	if string(fields.body) != "boom" || fields.bodyTruncated {
		t.Fatalf("fields body = %q truncated=%v", fields.body, fields.bodyTruncated)
	}
	if len(fields.headers["X-Ratelimit-Limit"]) != 1 {
		t.Fatalf("fields headers = %+v", fields.headers)
	}
	if _, err := io.ReadAll(response.Body); err != nil {
		t.Fatalf("consumed prefix must be replayed to the response body: %v", err)
	}
}

func TestCandidateIndexAtResolvesSnapshotAndPositions(t *testing.T) {
	positions := []int{4, 7, 9}
	for position := range positions {
		if got := candidateIndexAt(positions, position); got != positions[position] {
			t.Fatalf("snapshot index at %d = %d, want %d", position, got, positions[position])
		}
	}
	if got := candidateIndexAt(nil, 2); got != 2 {
		t.Fatalf("nil snapshot index = %d, want identity 2", got)
	}
}

func TestCandidateScreeningUnavailableReasonReportsDominantCause(t *testing.T) {
	cases := []struct {
		name      string
		screening candidateScreening
		want      SelectionUnavailableReason
	}{
		{name: "empty pool", screening: candidateScreening{}, want: SelectionNoAccounts},
		{name: "unsupported model dominates", screening: candidateScreening{considered: 3, modelCooling: 1}, want: SelectionUnsupportedModel},
		{name: "model cooling beats cooling", screening: candidateScreening{considered: 3, supported: 2, cooling: 1, modelCooling: 2}, want: SelectionModelCooling},
		{name: "cooling beats quota", screening: candidateScreening{considered: 3, supported: 2, cooling: 1, quota: 5}, want: SelectionCooling},
		{name: "quota exhaustion", screening: candidateScreening{considered: 3, supported: 2, quota: 5}, want: SelectionQuotaExhausted},
		{name: "pending probe counts as quota", screening: candidateScreening{considered: 3, supported: 2, probeCandidates: []int{1}}, want: SelectionQuotaExhausted},
	}
	for _, testCase := range cases {
		if got := testCase.screening.unavailableReason(); got != testCase.want {
			t.Fatalf("%s: reason = %q, want %q", testCase.name, got, testCase.want)
		}
	}
}

func TestCandidateScreeningCoolingTracksEarliestRetry(t *testing.T) {
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	later := now.Add(5 * time.Minute)
	sooner := now.Add(2 * time.Minute)
	screening := candidateScreening{}
	screening.observeModelCooling(later, now)
	if screening.modelCooling != 1 || !screening.earliestRetry.Equal(later) {
		t.Fatalf("model cooling = %+v", screening)
	}
	screening.observeCooling(sooner, now)
	if screening.cooling != 1 || !screening.earliestRetry.Equal(sooner) {
		t.Fatalf("cooling must keep the earliest retry: %+v", screening)
	}
	screening.observeCooling(later.Add(time.Hour), now)
	if !screening.earliestRetry.Equal(sooner) || screening.cooling != 2 {
		t.Fatalf("later cooldown must not move the retry hint: %+v", screening)
	}
}

func TestSegmentedCandidateCohortsGroupsByRoutingIdentity(t *testing.T) {
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	values := make([]accountdomain.RoutingCandidate, 5)
	for index := range values {
		values[index] = accountdomain.RoutingCandidate{Credential: accountdomain.Credential{
			ID: uint64(index + 1), Provider: accountdomain.ProviderBuild, Priority: accountdomain.DefaultPriority,
		}}
	}
	values[4] = accountdomain.RoutingCandidate{Credential: accountdomain.Credential{
		ID: 5, Provider: accountdomain.ProviderBuild, Priority: accountdomain.DefaultPriority + 1,
	}}
	buckets := segmentedCandidateCohorts(values, nil, now, nil, false, 0, 2, segmentedWindowsBeforeFullFallback)
	if len(buckets) != 2 {
		t.Fatalf("cohort buckets = %d, want one per distinct priority", len(buckets))
	}
	if buckets[0].cohort.priority <= buckets[1].cohort.priority {
		t.Fatalf("higher priority cohort must come first: %d/%d", buckets[0].cohort.priority, buckets[1].cohort.priority)
	}
	if len(buckets[0].indexes) != 1 || len(buckets[1].indexes) != 4 {
		t.Fatalf("window budget allocation = %d/%d, want the small cohort to take one window of two slots and the rest to fit", len(buckets[0].indexes), len(buckets[1].indexes))
	}
	for _, bucket := range buckets {
		for _, index := range bucket.indexes {
			if values[index].Credential.Priority != bucket.cohort.priority {
				t.Fatalf("index %d priority %d must match cohort %d", index, values[index].Credential.Priority, bucket.cohort.priority)
			}
		}
	}
	if buckets := segmentedCandidateCohorts(values, nil, now, nil, false, 0, 0, 1); buckets != nil {
		t.Fatalf("zero window size must disable segmentation, got %#v", buckets)
	}
	if buckets := segmentedCandidateCohorts(values, nil, now, nil, false, 0, 2, 0); buckets != nil {
		t.Fatalf("zero window budget must disable segmentation, got %#v", buckets)
	}
}

func TestSegmentedCandidateCohortsHonoursExplicitIndexSnapshot(t *testing.T) {
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	values := make([]accountdomain.RoutingCandidate, 4)
	for index := range values {
		values[index] = accountdomain.RoutingCandidate{Credential: accountdomain.Credential{
			ID: uint64(index + 1), Provider: accountdomain.ProviderBuild, Priority: accountdomain.DefaultPriority,
		}}
	}
	buckets := segmentedCandidateCohorts(values, []int{1, 3}, now, nil, false, 0, 4, segmentedWindowsBeforeFullFallback)
	if len(buckets) != 1 || len(buckets[0].indexes) != 2 {
		t.Fatalf("snapshot cohorts = %#v", buckets)
	}
	if buckets[0].indexes[0] != 1 || buckets[0].indexes[1] != 3 {
		t.Fatalf("snapshot window = %v, want [1 3]", buckets[0].indexes)
	}
}

func TestSegmentedCohortOfKeepsUpstreamQuotaAuthority(t *testing.T) {
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	candidate := accountdomain.RoutingCandidate{
		Credential:  accountdomain.Credential{ID: 1, Provider: accountdomain.ProviderBuild, Priority: accountdomain.DefaultPriority},
		QuotaWindow: &accountdomain.QuotaWindow{Source: accountdomain.QuotaSourceUpstream, Remaining: 0},
		Billing:     &accountdomain.Billing{PrepaidBalance: 3, SyncedAt: now.Add(-time.Minute)},
	}
	cohort := segmentedCohortOf(candidate, now, nil, false)
	if !cohort.quotaKnown || cohort.quotaAvailable || !cohort.billingFresh {
		t.Fatalf("cohort = %+v", cohort)
	}
	candidate.QuotaWindow.Source = accountdomain.QuotaSourceEstimated
	cohort = segmentedCohortOf(candidate, now, nil, false)
	if cohort.quotaKnown || cohort.billingFresh == false {
		t.Fatalf("local quota window must stay unknown: %+v", cohort)
	}
	candidate.Billing.SyncedAt = now.Add(-time.Hour)
	if cohort := segmentedCohortOf(candidate, now, nil, false); cohort.billingFresh {
		t.Fatalf("stale billing must not be fresh: %+v", cohort)
	}
}

// closeCountingBody 记录 Close 调用次数，用于断言持有流读取泵的生命周期。
type closeCountingBody struct {
	closes int
}

func (body *closeCountingBody) Read(_ []byte) (int, error) { return 0, io.EOF }

func (body *closeCountingBody) Close() error {
	body.closes++
	return nil
}

func TestQualityIsDumpBeforeDeliveryAggregatesEveryFingerprint(t *testing.T) {
	// 终端态大额可见输出 + 1ms 刷新 = burst dump 指纹。
	burst := QualityStreamSignals{
		VisibleTokens: 16, Terminal: true, ReasoningTokens: defaultBurstMinReasoning,
		FirstVisible: true, VisibleFlushMS: defaultBurstFlushMS - 1,
	}
	if !qualityIsDumpBeforeDelivery(burst, defaultQualityMinOutput) {
		t.Fatal("burst dump fingerprint must be detected")
	}
	// 密文已达下限但无推理 delta、无 reasoning token = cipher drool 指纹。
	drool := QualityStreamSignals{HasThinking: true, EncryptedBytes: 65536, VisibleTokens: defaultCipherDroolVisible}
	if !qualityIsDumpBeforeDelivery(drool, defaultQualityMinOutput) {
		t.Fatal("cipher drool fingerprint must be detected")
	}
	if qualityIsDumpBeforeDelivery(QualityStreamSignals{}, defaultQualityMinOutput) {
		t.Fatal("empty signals must not match any dump fingerprint")
	}
}

func TestClassifySettledVisibleOutputCoversFloorBoundaries(t *testing.T) {
	cases := []struct {
		name     string
		output   int64
		minOut   int64
		expected QualityVerdict
	}{
		{name: "no output keeps waiting", output: 0, minOut: 8, expected: QualityWait},
		{name: "below floor delivers", output: 3, minOut: 8, expected: QualityDeliver},
		{name: "at floor withholds", output: 8, minOut: 8, expected: QualityWithhold},
		{name: "above floor withholds", output: 99, minOut: 8, expected: QualityWithhold},
	}
	for _, testCase := range cases {
		if got := classifySettledVisibleOutput(testCase.output, testCase.minOut); got != testCase.expected {
			t.Fatalf("%s: verdict = %v, want %v", testCase.name, got, testCase.expected)
		}
	}
}

func TestClassifyQualityHoldRoutesThinkingAndVisibleInputs(t *testing.T) {
	if got := ClassifyQualityHold(QualityStreamSignals{HasThinking: true, HasReasoningDelta: true}, 8); got != QualityDeliver {
		t.Fatalf("plaintext reasoning verdict = %v, want deliver", got)
	}
	if got := ClassifyQualityHold(QualityStreamSignals{HasThinking: true}, 8); got != QualityWait {
		t.Fatalf("cipher-only verdict = %v, want wait", got)
	}
	if got := ClassifyQualityHold(QualityStreamSignals{VisibleTokens: 64, Terminal: true}, 8); got != QualityWithhold {
		t.Fatalf("terminal visible verdict = %v, want withhold", got)
	}
	if got := ClassifyQualityHold(QualityStreamSignals{VisibleTokens: 4}, 0); got != QualityWait {
		t.Fatalf("default floor verdict = %v, want wait for an unfinished short stream", got)
	}
}

func TestHeldQualityResultReplaysBufferAndKeepsPumpOpen(t *testing.T) {
	body := &closeCountingBody{}
	pump := newQualityReadPump(body)
	t.Cleanup(func() { _ = pump.Close() })
	held := &bytes.Buffer{}
	held.WriteString("data: {}\n\n")

	outcome := asQualityPeekOutcome(heldQualityResult(held, pump, &qualityScanState{responseID: "resp_1"}, QualityDeliver))
	if outcome.err != nil || outcome.verdict != QualityDeliver || outcome.responseID != "resp_1" || outcome.usage.Reported {
		t.Fatalf("outcome = %+v", outcome)
	}
	if body.closes != 0 {
		t.Fatal("delivering a held prefix must keep the upstream pump open for the continuation read")
	}
	if payload, err := io.ReadAll(outcome.replay); err != nil || string(payload) != "data: {}\n\n" {
		t.Fatalf("replayed prefix = %q err=%v", payload, err)
	}
	_ = outcome.replay.Close()
}

func TestAsQualityPeekOutcomeCarriesEveryField(t *testing.T) {
	replay := io.NopCloser(strings.NewReader("x"))
	outcome := asQualityPeekOutcome(replay, QualityWithhold, Usage{Reported: true}, "resp_2", errQualityEmptyStream)
	if outcome.replay != replay || outcome.verdict != QualityWithhold || outcome.responseID != "resp_2" {
		t.Fatalf("outcome = %+v", outcome)
	}
	if !outcome.usage.Reported || outcome.err == nil {
		t.Fatalf("outcome payload = %+v", outcome)
	}
}

func TestVoiceQuotaModeOnlyResolvesWhenQuotaConsumed(t *testing.T) {
	service := &Service{}
	route := modeldomain.Route{Provider: accountdomain.ProviderWeb, UpstreamModel: "grok-4"}
	if got := service.voiceQuotaMode(route, false); got != "" {
		t.Fatalf("non-quota voice mode = %q, want empty", got)
	}
}

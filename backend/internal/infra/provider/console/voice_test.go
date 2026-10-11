package console

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"

	"github.com/chenyme/grok2api/backend/internal/ports/provider"
)

// consoleSTTMultipartFieldNames 按写入顺序返回 multipart 的 part 名称。
// 上游按字段顺序解析 STT 表单，顺序回归（例如 filler_words 提前）必须在这里失败。
func consoleSTTMultipartFieldNames(t *testing.T, body []byte, contentType string) []string {
	t.Helper()
	_, parameters, err := mime.ParseMediaType(contentType)
	if err != nil {
		t.Fatalf("解析 multipart content type %q: %v", contentType, err)
	}
	boundary := parameters["boundary"]
	if boundary == "" {
		t.Fatalf("multipart content type 缺少 boundary: %q", contentType)
	}
	reader := multipart.NewReader(bytes.NewReader(body), boundary)
	names := make([]string, 0, 16)
	for {
		part, err := reader.NextPart()
		if err == io.EOF {
			return names
		}
		if err != nil {
			t.Fatalf("读取第 %d 个 multipart part: %v", len(names), err)
		}
		names = append(names, part.FormName())
		_ = part.Close()
	}
}

// consoleSTTFieldOrderRequest 返回开启全部可选字段的 STT 请求，用于顺序断言。
func consoleSTTFieldOrderRequest(vadThreshold float64) provider.STTRequest {
	return provider.STTRequest{
		AudioFormat: "wav", SampleRate: "16000", Language: "en",
		Format: true, Multichannel: true, Channels: 2, Diarize: true,
		KeyTerms: []string{"alpha", "beta"}, FillerWords: true, VADThreshold: &vadThreshold,
		Model: "grok-stt",
	}
}

// consoleSTTFieldOrderExpected 是 voice.go 当前写入上游的真实字段顺序。
func consoleSTTFieldOrderExpected(hasURL, hasFile bool) []string {
	names := []string{
		"audio_format", "sample_rate", "language", "format", "multichannel", "channels",
		"diarize", "keyterm", "keyterm", "filler_words", "vad_threshold", "model",
	}
	if hasURL {
		names = append(names, "url")
	}
	if hasFile {
		names = append(names, "file")
	}
	return names
}

func TestConsoleSTTMultipartFieldOrderMatchesUpstreamContract(t *testing.T) {
	request := consoleSTTFieldOrderRequest(0.5)
	request.URL = "https://example.com/audio.wav"
	body, contentType, err := buildConsoleSTTMultipart(request, true, false)
	if err != nil {
		t.Fatal(err)
	}
	got := consoleSTTMultipartFieldNames(t, body, contentType)
	if want := consoleSTTFieldOrderExpected(true, false); !slices.Equal(got, want) {
		t.Fatalf("multipart 字段顺序 = %v, want %v", got, want)
	}
}

func TestConsoleSTTMultipartFilePartIsWrittenLast(t *testing.T) {
	request := consoleSTTFieldOrderRequest(0.5)
	request.FileName = "clip.wav"
	request.FileData = []byte("RIFF-console-audio")
	body, contentType, err := buildConsoleSTTMultipart(request, false, true)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(contentType, "multipart/form-data") {
		t.Fatalf("content type = %q, want multipart/form-data", contentType)
	}
	got := consoleSTTMultipartFieldNames(t, body, contentType)
	if want := consoleSTTFieldOrderExpected(false, true); !slices.Equal(got, want) {
		t.Fatalf("multipart 字段顺序 = %v, want %v", got, want)
	}
}

// TestTranscribeSpeechSendsMultipartFieldOrder 锁定真实 HTTP 线上字段顺序，
// 覆盖 TranscribeSpeech -> buildConsoleSTTMultipart -> DPoP multipart 转发全链路。
func TestTranscribeSpeechSendsMultipartFieldOrder(t *testing.T) {
	var body []byte
	var contentType string
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if serveTestDPoPToken(t, writer, request) {
			return
		}
		if request.URL.Path != "/v1/stt" || request.Method != http.MethodPost {
			http.NotFound(writer, request)
			return
		}
		verifyTestDPoPProof(t, request)
		contentType = request.Header.Get("Content-Type")
		read, err := io.ReadAll(request.Body)
		if err != nil {
			t.Errorf("读取 STT 请求体: %v", err)
		}
		body = read
		writer.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(writer, `{"text":"hello world","language":"en"}`)
	}))
	t.Cleanup(server.Close)

	adapter, credential := newConsoleTestAdapter(t, server.URL)
	request := consoleSTTFieldOrderRequest(0.5)
	request.Credential = credential
	request.URL = "https://example.com/audio.wav"
	result, err := adapter.TranscribeSpeech(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	if result.Text != "hello world" || result.Language != "en" {
		t.Fatalf("STT 结果 = %#v", result)
	}
	got := consoleSTTMultipartFieldNames(t, body, contentType)
	if want := consoleSTTFieldOrderExpected(true, false); !slices.Equal(got, want) {
		t.Fatalf("线上 multipart 字段顺序 = %v, want %v", got, want)
	}
}

func TestConsoleTTSJSONResponseParsingBranches(t *testing.T) {
	t.Run("json envelope", func(t *testing.T) {
		audio := []byte("console-tts-audio")
		data := []byte(`{"audio":"` + base64.StdEncoding.EncodeToString(audio) +
			`","content_type":"audio/wav","duration":1.5,"audio_timestamps":{"graph_chars":["a","b"],"graph_times":[{"start":0,"end":0.5},{"start":0.5,"end":1}]}}`)
		result, err := parseConsoleTTSJSONResponse(data, "application/json")
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(result.Audio, audio) || result.ContentType != "audio/wav" || result.Duration != 1.5 ||
			!result.JSONEnvelope || result.Base64Audio == "" {
			t.Fatalf("JSON envelope 结果 = %#v", result)
		}
		if result.Timestamps == nil || len(result.Timestamps.GraphChars) != 2 ||
			len(result.Timestamps.GraphTimes) != 2 || result.Timestamps.GraphTimes[1].End != 1 {
			t.Fatalf("timestamps = %#v", result.Timestamps)
		}
	})

	t.Run("non json content type falls back to raw audio", func(t *testing.T) {
		data := []byte("\x00\x01raw-console-audio")
		result, err := parseConsoleTTSJSONResponse(data, "audio/mpeg")
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(result.Audio, data) || result.ContentType != "audio/mpeg" || result.JSONEnvelope {
			t.Fatalf("原始音频回退结果 = %#v", result)
		}
	})

	t.Run("invalid base64 audio fails", func(t *testing.T) {
		_, err := parseConsoleTTSJSONResponse([]byte(`{"audio":"!!!not-base64!!!"}`), "application/json")
		if err == nil || !strings.Contains(err.Error(), "解码 Console TTS audio 失败") {
			t.Fatalf("base64 解码错误 = %v", err)
		}
	})
}

func TestConsoleTTSJSONResponseRejectsMalformedJSONEnvelope(t *testing.T) {
	_, err := parseConsoleTTSJSONResponse([]byte(`{"audio":`), "application/json")
	if err == nil || !strings.Contains(err.Error(), "解析 Console TTS JSON 响应失败") {
		t.Fatalf("JSON 解析错误 = %v", err)
	}
}

func TestSynthesizeSpeechParsesJSONEnvelopeResponse(t *testing.T) {
	audio := []byte("console-tts-audio")
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if serveTestDPoPToken(t, writer, request) {
			return
		}
		if request.URL.Path != "/v1/tts" || request.Method != http.MethodPost {
			http.NotFound(writer, request)
			return
		}
		verifyTestDPoPProof(t, request)
		var payload map[string]any
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Errorf("解码 TTS 请求体: %v", err)
		}
		if payload["text"] != "hello" || payload["language"] != "en" || payload["voice_id"] != "eve" || payload["speed"] != 1.25 {
			t.Errorf("TTS 请求体 = %#v", payload)
		}
		writer.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(writer).Encode(map[string]any{
			"audio": base64.StdEncoding.EncodeToString(audio), "content_type": "audio/wav", "duration": 2.5,
		})
	}))
	t.Cleanup(server.Close)

	adapter, credential := newConsoleTestAdapter(t, server.URL)
	result, err := adapter.SynthesizeSpeech(context.Background(), provider.TTSRequest{
		Credential: credential, Text: "hello", Language: "en", VoiceID: "eve", Speed: 1.25,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(result.Audio, audio) || result.ContentType != "audio/wav" || result.Duration != 2.5 || !result.JSONEnvelope {
		t.Fatalf("TTS 结果 = %#v", result)
	}
}

func TestSynthesizeSpeechReturnsRawAudioForNonJSONResponse(t *testing.T) {
	audio := []byte("\x00\x01raw-console-tts")
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if serveTestDPoPToken(t, writer, request) {
			return
		}
		if request.URL.Path != "/v1/tts" {
			http.NotFound(writer, request)
			return
		}
		verifyTestDPoPProof(t, request)
		writer.Header().Set("Content-Type", "audio/mpeg")
		_, _ = writer.Write(audio)
	}))
	t.Cleanup(server.Close)

	adapter, credential := newConsoleTestAdapter(t, server.URL)
	result, err := adapter.SynthesizeSpeech(context.Background(), provider.TTSRequest{
		Credential: credential, Text: "hello", Language: "en",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(result.Audio, audio) || result.ContentType != "audio/mpeg" || result.JSONEnvelope || result.Base64Audio != "" {
		t.Fatalf("原始音频结果 = %#v", result)
	}
}

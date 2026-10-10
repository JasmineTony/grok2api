package inference

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/chenyme/grok2api/backend/internal/application/gateway"
	"github.com/chenyme/grok2api/backend/internal/ports/provider"
	"github.com/gin-gonic/gin"
)

// OpenAI-compatible audio request shapes.
// https://platform.openai.com/docs/api-reference/audio
type openAISpeechRequest struct {
	Model          string   `json:"model"`
	Input          string   `json:"input"`
	Voice          string   `json:"voice"`
	ResponseFormat string   `json:"response_format"`
	Speed          *float64 `json:"speed"`
	// Optional Grok/Console extensions accepted without breaking OpenAI clients.
	Language                 string          `json:"language"`
	VoiceID                  string          `json:"voice_id"`
	OutputFormat             json.RawMessage `json:"output_format"`
	OptimizeStreamingLatency json.RawMessage `json:"optimize_streaming_latency"`
	TextNormalization        *bool           `json:"text_normalization"`
	WithTimestamps           *bool           `json:"with_timestamps"`
}

func (h *Handler) synthesizeOpenAISpeech(c *gin.Context) {
	h.handleOpenAISpeech(c)
}

// synthesizeOpenAIAudioTask keeps a compatibility path used by some OpenAI-style
// clients that post speech jobs to /v1/audio/tasks instead of /v1/audio/speech.
// Behavior matches /audio/speech: raw audio by default, JSON only when requested.
func (h *Handler) synthesizeOpenAIAudioTask(c *gin.Context) {
	h.handleOpenAISpeech(c)
}

func (h *Handler) handleOpenAISpeech(c *gin.Context) {
	request, ok := h.decodeOpenAISpeechRequest(c)
	if !ok {
		return
	}
	text := strings.TrimSpace(request.Input)
	if text == "" {
		writeOpenAIError(c, http.StatusBadRequest, "invalid_request", "input 不能为空")
		return
	}
	language := strings.TrimSpace(request.Language)
	if language == "" {
		// Console TTS requires language; default keeps OpenAI clients working.
		language = "en"
	}
	model := strings.TrimSpace(request.Model)
	if model == "" {
		model = "grok-voice-latest"
	}
	format, ok := parseOpenAISpeechFormat(c, request)
	if !ok {
		return
	}
	speed, optimize, ok := parseOpenAISpeechTuning(c, request)
	if !ok {
		return
	}
	clientKey, requestID, ok := requestIdentity(c)
	if !ok {
		return
	}
	input := openAISpeechInput(c, request, model, text, language, format, speed, optimize)
	input.RequestID = requestID
	input.ClientKey = clientKey
	result, err := h.gateway.SynthesizeSpeech(c.Request.Context(), input)
	if err != nil {
		writeGatewayError(c, err)
		return
	}
	h.writeMediaResult(c, result)
}

func (h *Handler) decodeOpenAISpeechRequest(c *gin.Context) (openAISpeechRequest, bool) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, h.maxBodyBytes)
	if !isJSONRequest(c) {
		writeOpenAIError(c, http.StatusUnsupportedMediaType, "invalid_request", "audio speech 仅支持 application/json")
		return openAISpeechRequest{}, false
	}
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		writeOpenAIError(c, http.StatusRequestEntityTooLarge, "request_too_large", "请求体超过限制")
		return openAISpeechRequest{}, false
	}
	var request openAISpeechRequest
	if err := decodeSingleJSON(bytes.NewReader(body), &request, false); err != nil {
		writeOpenAIError(c, http.StatusBadRequest, "invalid_request", "audio speech 请求无效")
		return openAISpeechRequest{}, false
	}
	return request, true
}

// parseOpenAISpeechFormat 解析 output_format，并在缺省时按 OpenAI response_format 映射编解码器。
func parseOpenAISpeechFormat(c *gin.Context, request openAISpeechRequest) (provider.TTSOutputFormat, bool) {
	format, err := parseTTSOutputFormat(request.OutputFormat)
	if err != nil {
		writeOpenAIError(c, http.StatusBadRequest, "invalid_parameter", err.Error())
		return provider.TTSOutputFormat{}, false
	}
	if format.Codec != "" {
		return format, true
	}
	if codec := mapOpenAIResponseFormat(request.ResponseFormat); codec != "" {
		format.Codec = codec
		return format, true
	}
	if strings.TrimSpace(request.ResponseFormat) != "" {
		writeOpenAIError(c, http.StatusBadRequest, "invalid_request", "response_format 不受支持")
		return provider.TTSOutputFormat{}, false
	}
	format.Codec = "mp3"
	return format, true
}

func parseOpenAISpeechTuning(c *gin.Context, request openAISpeechRequest) (float64, int, bool) {
	speed, err := parseTTSSpeed(request.Speed)
	if err != nil {
		writeOpenAIError(c, http.StatusBadRequest, "invalid_parameter", err.Error())
		return 0, 0, false
	}
	optimize, err := parseOptimizeStreamingLatency(request.OptimizeStreamingLatency)
	if err != nil {
		writeOpenAIError(c, http.StatusBadRequest, "invalid_parameter", err.Error())
		return 0, 0, false
	}
	return speed, optimize, true
}

// openAISpeechInput 组装修正后的 TTS 入参；voice 优先取 voice_id，其次 voice 并按 OpenAI 音色映射。
func openAISpeechInput(c *gin.Context, request openAISpeechRequest, model, text, language string, format provider.TTSOutputFormat, speed float64, optimize int) gateway.TTSInput {
	voiceID := firstNonEmpty(strings.TrimSpace(request.VoiceID), strings.TrimSpace(request.Voice))
	if mapped := mapOpenAIVoiceID(voiceID); mapped != "" {
		voiceID = mapped
	}
	input := gateway.TTSInput{
		PublicModel: model, Text: text, VoiceID: voiceID, Language: language,
		OutputFormat: format, Speed: speed, OptimizeStreamingLatency: optimize,
		Method: c.Request.Method, Path: c.Request.URL.Path, Headers: c.Request.Header.Clone(),
	}
	applyTTSRequestToggles(&input, request.TextNormalization, request.WithTimestamps)
	return input
}

func (h *Handler) transcribeOpenAIAudio(c *gin.Context) {
	h.transcribeSpeechRequest(c, true)
}

func mapOpenAIResponseFormat(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", "mp3":
		return "mp3"
	case "opus", "ogg":
		return "opus"
	case "aac":
		return "aac"
	case "flac":
		return "flac"
	case "wav", "wave":
		return "wav"
	case "pcm", "pcm16":
		return "pcm"
	default:
		return ""
	}
}

// mapOpenAIVoiceID keeps common OpenAI voice names usable against Console voices.
// Unknown values pass through so custom voice_id and built-in Grok ids still work.
func mapOpenAIVoiceID(voice string) string {
	switch strings.ToLower(strings.TrimSpace(voice)) {
	case "alloy", "verse":
		return "ara"
	case "echo", "ballad":
		return "eve"
	case "fable", "coral":
		return "sal"
	case "onyx", "ash":
		return "rex"
	case "nova", "sage":
		return "leo"
	case "shimmer", "marin":
		return "sia"
	default:
		return strings.TrimSpace(voice)
	}
}

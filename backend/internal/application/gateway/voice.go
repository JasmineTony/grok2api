package gateway

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	accountdomain "github.com/chenyme/grok2api/backend/internal/domain/account"
	"github.com/chenyme/grok2api/backend/internal/domain/audit"
	"github.com/chenyme/grok2api/backend/internal/domain/clientkey"
	modeldomain "github.com/chenyme/grok2api/backend/internal/domain/model"
	"github.com/chenyme/grok2api/backend/internal/ports/provider"
)

type TTSInput struct {
	RequestID                string
	ClientKey                clientkey.Key
	PublicModel              string
	Text                     string
	VoiceID                  string
	Language                 string
	OutputFormat             provider.TTSOutputFormat
	Speed                    float64
	OptimizeStreamingLatency int
	TextNormalization        bool
	WithTimestamps           bool
	Method                   string
	Path                     string
	Headers                  map[string][]string
}

type STTInput struct {
	RequestID    string
	ClientKey    clientkey.Key
	PublicModel  string
	FileName     string
	FileMIME     string
	FileData     []byte
	URL          string
	AudioFormat  string
	SampleRate   string
	Language     string
	Format       bool
	Multichannel bool
	Channels     int
	Diarize      bool
	KeyTerms     []string
	FillerWords  bool
	VADThreshold *float64
	// ResponseFormat is empty for the native Console-compatible response, or an
	// OpenAI-compatible format normalized by the HTTP transport.
	ResponseFormat string
	Method         string
	Path           string
	Headers        map[string][]string
}

type VoiceListInput struct {
	RequestID   string
	ClientKey   clientkey.Key
	PublicModel string
}

type VoiceIDInput struct {
	RequestID   string
	ClientKey   clientkey.Key
	PublicModel string
	VoiceID     string
}

type voiceProviderSupport func(accountdomain.Provider) bool

type voiceExecutionResult struct {
	response *provider.Response
	pricing  audit.PricingResult
}

func (s *Service) SynthesizeSpeech(ctx context.Context, input TTSInput) (*Result, error) {
	reservation, _ := audit.EstimateOfficialTTSCost(input.Text)
	return s.executeVoice(ctx, input.RequestID, input.ClientKey, input.PublicModel, audit.OperationTTS, modeldomain.CapabilityTTS, true, reservation, input.Method, input.Path, input.Headers, func(providerValue accountdomain.Provider) bool {
		_, ok := s.providers.TTS(providerValue)
		return ok
	}, func(executionCtx context.Context, providerValue accountdomain.Provider, credential accountdomain.Credential, upstream string) (voiceExecutionResult, error) {
		adapter, ok := s.providers.TTS(providerValue)
		if !ok {
			return voiceExecutionResult{}, ErrNoAvailableAccount
		}
		result, err := adapter.SynthesizeSpeech(executionCtx, provider.TTSRequest{
			Credential: credential, Model: upstream, Text: input.Text, VoiceID: input.VoiceID, Language: input.Language,
			OutputFormat: input.OutputFormat, Speed: input.Speed, OptimizeStreamingLatency: input.OptimizeStreamingLatency,
			TextNormalization: input.TextNormalization, WithTimestamps: input.WithTimestamps,
		})
		if err != nil {
			return voiceExecutionResult{}, err
		}
		if result.JSONEnvelope || input.WithTimestamps {
			payload := map[string]any{
				"audio":        firstNonEmpty(result.Base64Audio, base64.StdEncoding.EncodeToString(result.Audio)),
				"content_type": firstNonEmpty(result.ContentType, "audio/mpeg"),
				"duration":     result.Duration,
			}
			if result.Timestamps != nil {
				times := make([]map[string]any, 0, len(result.Timestamps.GraphTimes))
				for _, item := range result.Timestamps.GraphTimes {
					times = append(times, map[string]any{"start": item.Start, "end": item.End})
				}
				payload["audio_timestamps"] = map[string]any{"graph_chars": result.Timestamps.GraphChars, "graph_times": times}
			}
			return voiceExecutionResult{response: jsonVoiceResponse(http.StatusOK, payload), pricing: reservation}, nil
		}
		header := http.Header{}
		header.Set("Content-Type", firstNonEmpty(result.ContentType, "audio/mpeg"))
		header.Set("Content-Length", fmt.Sprintf("%d", len(result.Audio)))
		return voiceExecutionResult{response: &provider.Response{
			StatusCode: http.StatusOK,
			Status:     fmt.Sprintf("%d %s", http.StatusOK, http.StatusText(http.StatusOK)),
			Header:     header,
			Body:       io.NopCloser(bytes.NewReader(result.Audio)),
			QuotaUnits: 1,
		}, pricing: reservation}, nil
	})
}

func (s *Service) ListTTSVoices(ctx context.Context, input VoiceListInput) (*Result, error) {
	return s.executeVoice(ctx, input.RequestID, input.ClientKey, input.PublicModel, audit.OperationTTS, modeldomain.CapabilityTTS, false, audit.PricingResult{}, "", "", nil, func(providerValue accountdomain.Provider) bool {
		_, ok := s.providers.TTS(providerValue)
		return ok
	}, func(executionCtx context.Context, providerValue accountdomain.Provider, credential accountdomain.Credential, _ string) (voiceExecutionResult, error) {
		adapter, ok := s.providers.TTS(providerValue)
		if !ok {
			return voiceExecutionResult{}, ErrNoAvailableAccount
		}
		voices, err := adapter.ListTTSVoices(executionCtx, credential)
		if err != nil {
			return voiceExecutionResult{}, err
		}
		items := make([]map[string]any, 0, len(voices))
		for _, voice := range voices {
			item := map[string]any{"voice_id": voice.VoiceID, "name": voice.Name}
			if voice.Language != "" {
				item["language"] = voice.Language
			} else {
				item["language"] = nil
			}
			items = append(items, item)
		}
		response := jsonVoiceResponse(http.StatusOK, map[string]any{"voices": items})
		response.QuotaUnits = 0
		return voiceExecutionResult{response: response}, nil
	})
}

func (s *Service) GetTTSVoice(ctx context.Context, input VoiceIDInput) (*Result, error) {
	return s.executeVoice(ctx, input.RequestID, input.ClientKey, input.PublicModel, audit.OperationTTS, modeldomain.CapabilityTTS, false, audit.PricingResult{}, "", "", nil, func(providerValue accountdomain.Provider) bool {
		_, ok := s.providers.TTS(providerValue)
		return ok
	}, func(executionCtx context.Context, providerValue accountdomain.Provider, credential accountdomain.Credential, _ string) (voiceExecutionResult, error) {
		adapter, ok := s.providers.TTS(providerValue)
		if !ok {
			return voiceExecutionResult{}, ErrNoAvailableAccount
		}
		voice, err := adapter.GetTTSVoice(executionCtx, credential, input.VoiceID)
		if err != nil {
			return voiceExecutionResult{}, err
		}
		payload := map[string]any{"voice_id": voice.VoiceID, "name": voice.Name}
		if voice.Language != "" {
			payload["language"] = voice.Language
		} else {
			payload["language"] = nil
		}
		response := jsonVoiceResponse(http.StatusOK, payload)
		response.QuotaUnits = 0
		return voiceExecutionResult{response: response}, nil
	})
}

func (s *Service) TranscribeSpeech(ctx context.Context, input STTInput) (*Result, error) {
	return s.executeVoice(ctx, input.RequestID, input.ClientKey, input.PublicModel, audit.OperationSTT, modeldomain.CapabilitySTT, true, audit.PricingResult{}, input.Method, input.Path, input.Headers, func(providerValue accountdomain.Provider) bool {
		_, ok := s.providers.STT(providerValue)
		return ok
	}, func(executionCtx context.Context, providerValue accountdomain.Provider, credential accountdomain.Credential, upstream string) (voiceExecutionResult, error) {
		adapter, ok := s.providers.STT(providerValue)
		if !ok {
			return voiceExecutionResult{}, ErrNoAvailableAccount
		}
		result, err := adapter.TranscribeSpeech(executionCtx, provider.STTRequest{
			Credential: credential, Model: upstream, FileName: input.FileName, FileMIME: input.FileMIME, FileData: input.FileData,
			URL: input.URL, AudioFormat: input.AudioFormat, SampleRate: input.SampleRate, Language: input.Language, Format: input.Format,
			Multichannel: input.Multichannel, Channels: input.Channels, Diarize: input.Diarize, KeyTerms: input.KeyTerms,
			FillerWords: input.FillerWords, VADThreshold: input.VADThreshold,
		})
		if err != nil {
			return voiceExecutionResult{}, err
		}
		pricing, _ := audit.EstimateOfficialSTTCost(result.Duration, false)
		return voiceExecutionResult{response: formatSTTResponse(result, input.ResponseFormat), pricing: pricing}, nil
	})
}

// sttWordList 转换词条列表；field 决定官方兼容字段名（词条数组用 word，正文用 text）。
func sttWordList(field string, words []provider.STTWord) []map[string]any {
	items := make([]map[string]any, 0, len(words))
	for _, word := range words {
		item := map[string]any{field: word.Text, "start": word.Start, "end": word.End}
		if word.Speaker != nil {
			item["speaker"] = *word.Speaker
		}
		items = append(items, item)
	}
	return items
}

// sttChannelList 转换多声道结果，每个声道保留自己的词条列表。
func sttChannelList(channels []provider.STTChannel) []map[string]any {
	items := make([]map[string]any, 0, len(channels))
	for _, channel := range channels {
		item := map[string]any{"index": channel.Index, "text": channel.Text}
		if len(channel.Words) > 0 {
			item["words"] = sttWordList("text", channel.Words)
		}
		items = append(items, item)
	}
	return items
}

func formatSTTResponse(result provider.STTResult, responseFormat string) *provider.Response {
	switch responseFormat {
	case "text":
		data := []byte(result.Text)
		header := http.Header{}
		header.Set("Content-Type", "text/plain; charset=utf-8")
		header.Set("Content-Length", strconv.Itoa(len(data)))
		return &provider.Response{StatusCode: http.StatusOK, Status: "200 OK", Header: header, Body: io.NopCloser(bytes.NewReader(data)), QuotaUnits: 1}
	case "json":
		return jsonVoiceResponse(http.StatusOK, map[string]any{"text": result.Text})
	case "verbose_json":
		payload := map[string]any{"task": "transcribe", "text": result.Text, "language": result.Language, "duration": result.Duration}
		if len(result.Words) > 0 {
			payload["words"] = sttWordList("word", result.Words)
		}
		return jsonVoiceResponse(http.StatusOK, payload)
	}
	if len(result.RawJSON) > 0 {
		header := http.Header{}
		header.Set("Content-Type", "application/json")
		header.Set("Content-Length", strconv.Itoa(len(result.RawJSON)))
		return &provider.Response{StatusCode: http.StatusOK, Status: "200 OK", Header: header, Body: io.NopCloser(bytes.NewReader(result.RawJSON)), QuotaUnits: 1}
	}
	payload := map[string]any{"text": result.Text, "language": result.Language, "duration": result.Duration}
	if len(result.Words) > 0 {
		payload["words"] = sttWordList("text", result.Words)
	}
	if len(result.Channels) > 0 {
		payload["channels"] = sttChannelList(result.Channels)
	}
	return jsonVoiceResponse(http.StatusOK, payload)
}

func jsonVoiceResponse(status int, value any) *provider.Response {
	data, _ := json.Marshal(value)
	header := http.Header{}
	header.Set("Content-Type", "application/json")
	header.Set("Content-Length", fmt.Sprintf("%d", len(data)))
	return &provider.Response{
		StatusCode: status,
		Status:     fmt.Sprintf("%d %s", status, http.StatusText(status)),
		Header:     header,
		Body:       io.NopCloser(bytes.NewReader(data)),
		QuotaUnits: 1,
	}
}

func voiceErrorResponse(err error) (*provider.Response, error) {
	if status, ok := provider.ErrorHTTPStatus(err); ok {
		message, safe := provider.ErrorPublicMessage(err)
		if !safe {
			message = "上游语音服务返回错误"
		}
		response := jsonVoiceResponse(status, map[string]any{"error": map[string]any{"type": "upstream_error", "message": message}})
		if retryAfter := provider.ErrorRetryAfter(err); retryAfter > 0 {
			seconds := max(int64(1), int64((retryAfter+time.Second-1)/time.Second))
			response.Header.Set("Retry-After", strconv.FormatInt(seconds, 10))
		}
		return response, nil
	}
	return nil, err
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

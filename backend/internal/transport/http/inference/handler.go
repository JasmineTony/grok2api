package inference

import (
	"errors"
	"strings"
	"time"

	"github.com/chenyme/grok2api/backend/internal/application/gateway"
	modelapp "github.com/chenyme/grok2api/backend/internal/application/model"
	"github.com/gin-gonic/gin"
)

type Handler struct {
	gateway          *gateway.Service
	models           *modelapp.Service
	maxBodyBytes     int64
	publicAPIBaseURL string
	publicBaseURL    func() string
}

const (
	responseCopyBufferBytes         = 32 << 10
	maxJSONMetadataInspectionBytes  = 8 << 20
	maxStreamEventInspectionBytes   = 8 << 20
	maxStreamFailureDiagnosticBytes = 64 << 10
	maxCredentialErrorInspectBytes  = 64 << 10
	maxJSONResponseTransferBytes    = 128 << 20
	maxStreamResponseTransferBytes  = 256 << 20
	maxMediaResponseTransferBytes   = int64(2) << 30
	responseWriteTimeout            = 30 * time.Second
)

var (
	errResponseTransferLimit    = errors.New("响应超过代理安全上限")
	errUpstreamStreamIncomplete = errors.New("上游流在终止事件前结束")
	errUpstreamStreamFailed     = errors.New("上游流返回失败终止事件")
	errUpstreamStreamRead       = errors.New("读取上游流失败")
)

type streamProtocol uint8

const (
	streamProtocolResponses streamProtocol = iota
	streamProtocolChat
	streamProtocolAnthropic
	streamProtocolImage
)

const mediaTransferErrorTrailer = "X-Grok2API-Transfer-Error"

func NewHandler(gatewayService *gateway.Service, models *modelapp.Service, maxBodyBytes int64, publicAPIBaseURL ...string) *Handler {
	baseURL := ""
	if len(publicAPIBaseURL) > 0 {
		baseURL = strings.TrimRight(strings.TrimSpace(publicAPIBaseURL[0]), "/")
	}
	return &Handler{gateway: gatewayService, models: models, maxBodyBytes: maxBodyBytes, publicAPIBaseURL: baseURL}
}

// SetPublicAPIBaseURLResolver makes video content URLs follow hot-updated runtime settings.
// Set it before Register; request handling only reads the resolver.
func (h *Handler) SetPublicAPIBaseURLResolver(resolve func() string) *Handler {
	h.publicBaseURL = resolve
	return h
}

func (h *Handler) Register(router *gin.RouterGroup) {
	router.GET("/models", h.listModels)
	router.POST("/responses", h.createResponse)
	router.POST("/chat/completions", h.createChatCompletion)
	router.POST("/messages", h.createMessage)
	router.POST("/images/generations", h.generateImage)
	router.POST("/images/edits", h.editImage)
	router.POST("/videos/generations", h.generateVideo)
	router.POST("/videos/edits", h.editVideo)
	router.POST("/videos/extensions", h.extendVideo)
	router.GET("/videos/:requestId", h.getVideo)
	router.GET("/videos/:requestId/content", h.getVideoContent)
	router.POST("/tts", h.synthesizeSpeech)
	router.GET("/tts/voices", h.listTTSVoices)
	router.GET("/tts/voices/:voiceId", h.getTTSVoice)
	router.POST("/stt", h.transcribeSpeech)
	router.GET("/stt", h.proxySTTWebSocket)
	// OpenAI-compatible audio aliases for common client SDKs.
	router.POST("/audio/speech", h.synthesizeOpenAISpeech)
	router.POST("/audio/tasks", h.synthesizeOpenAIAudioTask)
	router.POST("/audio/transcriptions", h.transcribeOpenAIAudio)
	router.GET("/realtime", h.proxyRealtimeWebSocket)
	router.POST("/responses/compact", h.compactResponse)
	router.GET("/responses/:responseId", h.getResponse)
	router.DELETE("/responses/:responseId", h.deleteResponse)
}

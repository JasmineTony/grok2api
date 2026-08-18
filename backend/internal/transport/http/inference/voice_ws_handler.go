package inference

import (
	"encoding/json"
	"errors"
	"io"
	"math"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	upstreamws "github.com/bogdanfinn/websocket"
	"github.com/chenyme/grok2api/backend/internal/application/gateway"
	"github.com/gin-gonic/gin"
	clientws "github.com/gorilla/websocket"
)

const (
	voiceWSMessageLimit             = 16 << 20
	defaultVoiceWSIdleTimeout       = 2 * time.Minute
	defaultVoiceWSMessagesPerSecond = 100
	defaultVoiceWSMessageBurst      = 200
)

var (
	errStreamingSTTDurationLimit = errors.New("streaming STT duration exceeds reserved limit")
	errVoiceWSMessageRateLimit   = errors.New("voice websocket message rate limit exceeded")
)

var voiceWSUpgrader = clientws.Upgrader{
	ReadBufferSize:  32 << 10,
	WriteBufferSize: 32 << 10,
	CheckOrigin: func(request *http.Request) bool {
		origin := strings.TrimSpace(request.Header.Get("Origin"))
		if origin == "" {
			return true
		}
		parsed, err := url.Parse(origin)
		if err != nil || parsed.Host == "" {
			return false
		}
		return strings.EqualFold(parsed.Host, request.Host)
	},
	EnableCompression: true,
}

func (h *Handler) proxyRealtimeWebSocket(c *gin.Context) {
	h.proxyVoiceWebSocket(c, "/realtime")
}

func (h *Handler) proxySTTWebSocket(c *gin.Context) {
	if !clientws.IsWebSocketUpgrade(c.Request) {
		writeOpenAIError(c, http.StatusMethodNotAllowed, "invalid_request", "STT 流式接口需要 WebSocket Upgrade")
		return
	}
	h.proxyVoiceWebSocket(c, "/stt")
}

func (h *Handler) proxyVoiceWebSocket(c *gin.Context, pathValue string) {
	if !clientws.IsWebSocketUpgrade(c.Request) {
		writeOpenAIError(c, http.StatusBadRequest, "invalid_request", "请求不是有效的 WebSocket Upgrade")
		return
	}
	clientKey, requestID, ok := requestIdentity(c)
	if !ok {
		return
	}
	model := strings.TrimSpace(c.Query("model"))
	session, err := h.gateway.OpenVoiceWebSocket(c.Request.Context(), gateway.VoiceWebSocketInput{
		RequestID: requestID, ClientKey: clientKey, PublicModel: model, Path: pathValue,
	})
	if err != nil {
		writeGatewayError(c, err)
		return
	}

	clientConn, err := voiceWSUpgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		session.Finalize(gateway.VoiceWebSocketOutcome{ErrorCode: "client_upgrade_failed"})
		return
	}
	clientConn.SetReadLimit(voiceWSMessageLimit)
	session.Conn.SetReadLimit(voiceWSMessageLimit)

	var once sync.Once
	var outcomeMu sync.Mutex
	outcome := gateway.VoiceWebSocketOutcome{}
	closeAll := func() {
		once.Do(func() {
			_ = clientConn.Close()
			if session.Conn != nil {
				_ = session.Conn.Close()
			}
			outcomeMu.Lock()
			finalOutcome := outcome
			outcomeMu.Unlock()
			session.Finalize(finalOutcome)
		})
	}
	defer closeAll()

	activity := newVoiceWSActivity()
	clientLimiter := newVoiceWSMessageLimiter(h.voiceWSMessagesPerSecond, h.voiceWSMessageBurst)
	type pumpResult struct {
		upstreamSide bool
		result       voiceWSPumpResult
	}
	errCh := make(chan pumpResult, 2)
	go func() {
		errCh <- pumpResult{result: proxyVoiceWSPump(func() (int, []byte, error) {
			return clientConn.ReadMessage()
		}, session.Conn.WriteMessage, voiceWSPumpOptions{
			afterRead: activity.Touch,
			allow:     clientLimiter.Allow,
			limitErr:  errVoiceWSMessageRateLimit,
		})}
	}()
	go func() {
		errCh <- pumpResult{upstreamSide: true, result: proxyVoiceWSPump(func() (int, []byte, error) {
			messageType, payload, readErr := session.Conn.ReadMessage()
			if readErr == nil && pathValue == "/stt" {
				if duration, ok := streamingSTTDuration(payload); ok {
					outcomeMu.Lock()
					outcome.AudioDurationSeconds = max(outcome.AudioDurationSeconds, duration)
					limitExceeded := streamingSTTDurationLimitExceeded(duration, session.MaxAudioDurationSeconds)
					if limitExceeded {
						outcome.ErrorCode = "stt_duration_limit_exceeded"
					}
					outcomeMu.Unlock()
					if limitExceeded {
						return 0, nil, errStreamingSTTDurationLimit
					}
				}
			}
			return messageType, payload, readErr
		}, clientConn.WriteMessage, voiceWSPumpOptions{afterRead: activity.Touch})}
	}()
	idleTimer := time.NewTimer(h.voiceWSIdleTimeout)
	defer stopVoiceWSTimer(idleTimer)
	var first pumpResult
	for {
		select {
		case first = <-errCh:
			goto pumpFinished
		case <-idleTimer.C:
			idleFor := activity.IdleFor()
			if idleFor >= h.voiceWSIdleTimeout {
				outcomeMu.Lock()
				outcome.ErrorCode = "websocket_idle_timeout"
				outcomeMu.Unlock()
				return
			}
			idleTimer.Reset(h.voiceWSIdleTimeout - idleFor)
		}
	}

pumpFinished:
	if errors.Is(first.result.err, errVoiceWSMessageRateLimit) {
		outcomeMu.Lock()
		outcome.ErrorCode = "websocket_rate_limit_exceeded"
		outcomeMu.Unlock()
	} else if !isNormalVoiceWSClose(first.result.err) {
		outcomeMu.Lock()
		if outcome.ErrorCode == "" {
			if (first.upstreamSide && !first.result.writeFailed) || (!first.upstreamSide && first.result.writeFailed) {
				outcome.ErrorCode = "upstream_stream_interrupted"
				outcome.UpstreamFailed = true
			} else {
				outcome.ErrorCode = "client_stream_interrupted"
			}
		}
		outcomeMu.Unlock()
	}
}

func streamingSTTDuration(payload []byte) (float64, bool) {
	var event struct {
		Type     string  `json:"type"`
		Duration float64 `json:"duration"`
	}
	if err := json.Unmarshal(payload, &event); err != nil || strings.TrimSpace(event.Type) != "transcript.done" {
		return 0, false
	}
	if event.Duration <= 0 || math.IsNaN(event.Duration) || math.IsInf(event.Duration, 0) {
		return 0, false
	}
	return event.Duration, true
}

func streamingSTTDurationLimitExceeded(duration, limit float64) bool {
	return limit > 0 && duration > limit
}

type voiceWSPumpResult struct {
	err         error
	writeFailed bool
}

type voiceWSPumpOptions struct {
	afterRead func()
	allow     func() bool
	limitErr  error
}

func proxyVoiceWSPump(read func() (int, []byte, error), write func(int, []byte) error, options ...voiceWSPumpOptions) voiceWSPumpResult {
	var option voiceWSPumpOptions
	if len(options) > 0 {
		option = options[0]
	}
	for {
		messageType, payload, err := read()
		if err != nil {
			return voiceWSPumpResult{err: err}
		}
		if option.afterRead != nil {
			option.afterRead()
		}
		if option.allow != nil && !option.allow() {
			return voiceWSPumpResult{err: option.limitErr}
		}
		if err := write(messageType, payload); err != nil {
			return voiceWSPumpResult{err: err, writeFailed: true}
		}
	}
}

type voiceWSActivity struct {
	now  func() time.Time
	last atomic.Int64
}

func newVoiceWSActivity() *voiceWSActivity {
	activity := &voiceWSActivity{now: time.Now}
	activity.Touch()
	return activity
}

func (a *voiceWSActivity) Touch() {
	a.last.Store(a.now().UnixNano())
}

func (a *voiceWSActivity) IdleFor() time.Duration {
	return max(0, a.now().Sub(time.Unix(0, a.last.Load())))
}

type voiceWSMessageLimiter struct {
	mu     sync.Mutex
	now    func() time.Time
	rate   float64
	burst  float64
	tokens float64
	last   time.Time
}

func newVoiceWSMessageLimiter(messagesPerSecond, burst int) *voiceWSMessageLimiter {
	now := time.Now
	startedAt := now()
	return &voiceWSMessageLimiter{
		now: now, rate: float64(max(1, messagesPerSecond)), burst: float64(max(1, burst)),
		tokens: float64(max(1, burst)), last: startedAt,
	}
}

func (l *voiceWSMessageLimiter) Allow() bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	if elapsed := now.Sub(l.last).Seconds(); elapsed > 0 {
		l.tokens = min(l.burst, l.tokens+elapsed*l.rate)
		l.last = now
	}
	if l.tokens < 1 {
		return false
	}
	l.tokens--
	return true
}

func stopVoiceWSTimer(timer *time.Timer) {
	if timer == nil || !timer.Stop() {
		select {
		case <-timer.C:
		default:
		}
	}
}

func isNormalVoiceWSClose(err error) bool {
	if err == nil || err == io.EOF {
		return true
	}
	return clientws.IsCloseError(err, clientws.CloseNormalClosure, clientws.CloseGoingAway) ||
		upstreamws.IsCloseError(err, upstreamws.CloseNormalClosure, upstreamws.CloseGoingAway)
}

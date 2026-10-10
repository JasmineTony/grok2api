package inference

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"math"
	"net/http"
	"strings"
	"sync"

	upstreamws "github.com/bogdanfinn/websocket"
	"github.com/chenyme/grok2api/backend/internal/application/gateway"
	"github.com/gin-gonic/gin"
	clientws "github.com/gorilla/websocket"
)

const voiceWSMessageLimit = 16 << 20

// errVoiceWebSocketIdentity 仅用于区分"身份校验已写出响应"与真实上游错误，不对外暴露。
var errVoiceWebSocketIdentity = errors.New("语音 WebSocket 请求身份无效")

var voiceWSUpgrader = clientws.Upgrader{
	ReadBufferSize:  32 << 10,
	WriteBufferSize: 32 << 10,
	CheckOrigin: func(*http.Request) bool {
		return true
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
	model := strings.TrimSpace(c.Query("model"))
	session, err := h.openVoiceWebSocket(c, pathValue, model)
	if err != nil {
		return
	}
	clientConn, err := voiceWSUpgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		session.Finalize(gateway.VoiceWebSocketOutcome{ErrorCode: "client_upgrade_failed"})
		return
	}
	clientConn.SetReadLimit(voiceWSMessageLimit)
	session.Conn.SetReadLimit(voiceWSMessageLimit)

	var outcomeMu sync.Mutex
	outcome := gateway.VoiceWebSocketOutcome{}
	defer newVoiceWebSocketCloser(clientConn, session, &outcomeMu, &outcome)()

	errCh := pumpVoiceWebSocketSides(clientConn, session, pathValue, &outcomeMu, &outcome)
	errorCode, upstreamFailed, normal := waitVoiceWSOutcome(c.Request.Context(), errCh)
	if !normal {
		outcomeMu.Lock()
		outcome.ErrorCode = errorCode
		outcome.UpstreamFailed = upstreamFailed
		outcomeMu.Unlock()
	}
}

// openVoiceWebSocket 校验请求身份并向上游建立语音 WebSocket；失败时已写出错误响应。
func (h *Handler) openVoiceWebSocket(c *gin.Context, pathValue, model string) (*gateway.VoiceWebSocketSession, error) {
	clientKey, requestID, ok := requestIdentity(c)
	if !ok {
		return nil, errVoiceWebSocketIdentity
	}
	session, err := h.gateway.OpenVoiceWebSocket(c.Request.Context(), gateway.VoiceWebSocketInput{
		RequestID: requestID, ClientKey: clientKey, PublicModel: model, Path: pathValue,
	})
	if err != nil {
		writeGatewayError(c, err)
		return nil, err
	}
	return session, nil
}

// voiceWSSessionCloser 汇总一次语音 WebSocket 代理所需的可关闭资源；close 可替换以便覆盖。
type voiceWSSessionCloser struct {
	clientConn *clientws.Conn
	closeConn  func() error
	session    *gateway.VoiceWebSocketSession
	outcomeMu  *sync.Mutex
	outcome    *gateway.VoiceWebSocketOutcome
}

// newVoiceWebSocketCloser 返回只执行一次的清理函数：关闭两端连接，并按当时已记录的
// outcome 终结会话（释放账号租约与并发槽）。必须在 defer 中调用返回的函数。
func newVoiceWebSocketCloser(clientConn *clientws.Conn, session *gateway.VoiceWebSocketSession, outcomeMu *sync.Mutex, outcome *gateway.VoiceWebSocketOutcome) func() {
	return onceVoiceWebSocketCloser(voiceWSSessionCloser{
		clientConn: clientConn, closeConn: clientConn.Close,
		session: session, outcomeMu: outcomeMu, outcome: outcome,
	})
}

// onceVoiceWebSocketCloser 把清理动作包装为幂等调用。
func onceVoiceWebSocketCloser(closer voiceWSSessionCloser) func() {
	var once sync.Once
	return func() {
		once.Do(func() { closer.closeConn(); closer.finalize() })
	}
}

// finalize 按调用时刻的 outcome 关闭上游连接并终结会话。
func (c voiceWSSessionCloser) finalize() {
	if c.session.Conn != nil {
		_ = c.session.Conn.Close()
	}
	c.outcomeMu.Lock()
	finalOutcome := *c.outcome
	c.outcomeMu.Unlock()
	c.session.Finalize(finalOutcome)
}

// pumpVoiceWebSocketSides 双向并发转发 WebSocket 消息；上游 → 客户端方向顺带记录已确认音频时长。
// 两个 goroutine 各自向返回的缓冲通道（容量 2）写入一次结束结果。
func pumpVoiceWebSocketSides(clientConn *clientws.Conn, session *gateway.VoiceWebSocketSession, pathValue string, outcomeMu *sync.Mutex, outcome *gateway.VoiceWebSocketOutcome) chan pumpResult {
	upstreamRead := func() (int, []byte, error) {
		messageType, payload, readErr := session.Conn.ReadMessage()
		if readErr == nil && pathValue == "/stt" {
			recordStreamingSTTDuration(payload, outcomeMu, outcome)
		}
		return messageType, payload, readErr
	}
	return pumpVoiceWebSockets(clientConn.ReadMessage, session.Conn.WriteMessage, upstreamRead, clientConn.WriteMessage)
}

// pumpVoiceWebSockets 启动两个方向相反的 pump；读写函数可替换以便等价覆盖。
func pumpVoiceWebSockets(clientRead func() (int, []byte, error), upstreamWrite func(int, []byte) error, upstreamRead func() (int, []byte, error), clientWrite func(int, []byte) error) chan pumpResult {
	errCh := make(chan pumpResult, 2)
	go func() {
		errCh <- pumpResult{result: proxyVoiceWSPump(clientRead, upstreamWrite)}
	}()
	go func() {
		errCh <- pumpResult{upstreamSide: true, result: proxyVoiceWSPump(upstreamRead, clientWrite)}
	}()
	return errCh
}

// recordStreamingSTTDuration 仅把已确认的正时长按最大值合并；负值、NaN 与 Inf 不参与。
func recordStreamingSTTDuration(payload []byte, outcomeMu *sync.Mutex, outcome *gateway.VoiceWebSocketOutcome) {
	duration, ok := streamingSTTDuration(payload)
	if !ok {
		return
	}
	outcomeMu.Lock()
	outcome.AudioDurationSeconds = max(outcome.AudioDurationSeconds, duration)
	outcomeMu.Unlock()
}

// pumpResult 是单个代理 pump 的结束结果。
type pumpResult struct {
	upstreamSide bool
	result       voiceWSPumpResult
}

// waitVoiceWSOutcome 等待任一代理 pump 结束，或请求上下文先结束。
// 静默会话不会命中任何 pump 错误，只有这里主动观察上下文，才能让
// server.requestTimeout 约束已建立会话的存活时间，并回到 defer closeAll
// 释放账号租约、并发槽与上游连接。
// 返回 normal=true 表示会话正常关闭，无需记录错误码。
func waitVoiceWSOutcome(ctx context.Context, errCh <-chan pumpResult) (errorCode string, upstreamFailed bool, normal bool) {
	select {
	case first := <-errCh:
		if isNormalVoiceWSClose(first.result.err) {
			return "", false, true
		}
		if (first.upstreamSide && !first.result.writeFailed) || (!first.upstreamSide && first.result.writeFailed) {
			return "upstream_stream_interrupted", true, false
		}
		return "client_stream_interrupted", false, false
	case <-ctx.Done():
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return "request_timeout", false, false
		}
		return "client_stream_interrupted", false, false
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

type voiceWSPumpResult struct {
	err         error
	writeFailed bool
}

func proxyVoiceWSPump(read func() (int, []byte, error), write func(int, []byte) error) voiceWSPumpResult {
	for {
		messageType, payload, err := read()
		if err != nil {
			return voiceWSPumpResult{err: err}
		}
		if err := write(messageType, payload); err != nil {
			return voiceWSPumpResult{err: err, writeFailed: true}
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

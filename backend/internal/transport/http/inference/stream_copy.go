package inference

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"

	"github.com/chenyme/grok2api/backend/internal/application/gateway"
	"github.com/chenyme/grok2api/backend/internal/pkg/neterror"
	"github.com/gin-gonic/gin"
)

type responseMetadata struct {
	Usage                    gateway.Usage
	cacheCreationInputTokens int64
	ResponseID               string
	Model                    string
	SequenceNumber           int64
	StreamFailure            *gateway.StreamFailureDiagnostic
}

func copyStream(writer gin.ResponseWriter, source io.Reader, protocol streamProtocol, onFirstToken func()) (responseMetadata, error) {
	return copyStreamWithFallbackModel(writer, source, protocol, onFirstToken, "")
}

// streamCopyState 汇总一次流式转发中的检查器、协议状态与字节计数。
type streamCopyState struct {
	inspector    *responseInspector
	markerFilter *internalSSEMarkerFilter
	compat       *responsesCompatState
	received     int
	transferred  int
}

func copyStreamWithFallbackModel(writer gin.ResponseWriter, source io.Reader, protocol streamProtocol, onFirstToken func(), fallbackModel string) (responseMetadata, error) {
	markerFilter := internalSSEMarkerFilter{enabled: protocol == streamProtocolChat || protocol == streamProtocolAnthropic}
	var compat responsesCompatState
	compat.model = strings.TrimSpace(fallbackModel)
	state := &streamCopyState{
		inspector:    &responseInspector{protocol: protocol, onFirstToken: onFirstToken},
		markerFilter: &markerFilter,
		compat:       &compat,
	}
	buffer := make([]byte, responseCopyBufferBytes)
	for {
		n, readErr := source.Read(buffer)
		if n > 0 {
			if state.received+n > maxStreamResponseTransferBytes {
				return state.inspector.Metadata(), transferLimitError()
			}
			state.received += n
			chunk := transformStreamChunk(protocol, buffer[:n], state)
			if err := writeGuardedStreamChunk(writer, chunk, &state.transferred); err != nil {
				return state.inspector.Metadata(), err
			}
			state.inspector.markFirstTokenForwarded()
		}
		if readErr != nil {
			return finishStreamCopy(writer, protocol, readErr, state)
		}
	}
}

func transferLimitError() error {
	return fmt.Errorf("%w: 流式响应超过 %d MiB", errResponseTransferLimit, maxStreamResponseTransferBytes>>20)
}

// transformStreamChunk 按协议重写单个上游分片，并在与下游表示一致的时刻送入检查器。
func transformStreamChunk(protocol streamProtocol, chunk []byte, state *streamCopyState) []byte {
	if protocol == streamProtocolChat {
		// The internal reasoning marker is intentionally removed before
		// forwarding, but still counts as generation start.
		state.inspector.Inspect(chunk)
	}
	chunk = state.markerFilter.Filter(chunk, false)
	if protocol == streamProtocolResponses {
		chunk = rewriteResponsesStreamChunk(chunk, state.compat)
	}
	if protocol != streamProtocolChat {
		// Inspect the actual downstream representation so compatibility
		// fields such as generated item IDs participate in timing and
		// output-observed classification.
		state.inspector.Inspect(chunk)
	}
	return chunk
}

func writeStreamChunk(writer gin.ResponseWriter, chunk []byte) error {
	if len(chunk) == 0 {
		return nil
	}
	if err := setResponseWriteDeadline(writer); err != nil {
		return err
	}
	if _, err := writer.Write(chunk); err != nil {
		return err
	}
	writer.Flush()
	return nil
}

// writeGuardedStreamChunk 在流式传输上限内写出分片，并累加已传输字节数。
func writeGuardedStreamChunk(writer gin.ResponseWriter, chunk []byte, transferred *int) error {
	if len(chunk) == 0 {
		return nil
	}
	if *transferred+len(chunk) > maxStreamResponseTransferBytes {
		return transferLimitError()
	}
	if err := writeStreamChunk(writer, chunk); err != nil {
		return err
	}
	*transferred += len(chunk)
	return nil
}

// finishStreamCopy 冲刷过滤与兼容层尾部数据，并按终态写出中断说明与错误。
func finishStreamCopy(writer gin.ResponseWriter, protocol streamProtocol, readErr error, state *streamCopyState) (responseMetadata, error) {
	if tail := state.markerFilter.Filter(nil, true); len(tail) > 0 {
		if err := writeGuardedStreamChunk(writer, tail, &state.transferred); err != nil {
			return state.inspector.Metadata(), err
		}
	}
	if protocol == streamProtocolResponses {
		if tail := flushResponsesStreamTail(state.compat); len(tail) > 0 {
			state.inspector.Inspect(tail)
			if err := writeGuardedStreamChunk(writer, tail, &state.transferred); err != nil {
				return state.inspector.Metadata(), err
			}
		}
	}
	state.inspector.Finish()
	state.inspector.markFirstTokenForwarded()
	terminalErr := state.inspector.TerminalError()
	if terminalErr == nil || errors.Is(terminalErr, errUpstreamStreamFailed) {
		return state.inspector.Metadata(), terminalErr
	}
	if errors.Is(readErr, io.EOF) {
		writeStreamAbortTrailer(writer, protocol, terminalErr, state.inspector.Metadata(), state.compat, state.transferred)
		return state.inspector.Metadata(), terminalErr
	}
	writeStreamAbortTrailer(writer, protocol, readErr, state.inspector.Metadata(), state.compat, state.transferred)
	return state.inspector.Metadata(), fmt.Errorf("%w: %w", errUpstreamStreamRead, readErr)
}

func writeStreamAbortTrailer(writer gin.ResponseWriter, protocol streamProtocol, cause error, meta responseMetadata, compat *responsesCompatState, transferred int) {
	trailer := streamAbortTrailer(protocol, cause, meta, compat)
	if len(trailer) == 0 || transferred+len(trailer) > maxStreamResponseTransferBytes {
		return
	}
	if err := setResponseWriteDeadline(writer); err != nil {
		return
	}
	if _, err := writer.Write(trailer); err == nil {
		writer.Flush()
	}
}

func streamAbortTrailer(protocol streamProtocol, cause error, meta responseMetadata, compat *responsesCompatState) []byte {
	code, message := abortTrailerCode(cause)
	switch protocol {
	case streamProtocolChat:
		return chatAbortTrailer(code, message)
	case streamProtocolResponses:
		return responsesAbortTrailer(meta, compat, code, message)
	case streamProtocolAnthropic:
		return anthropicAbortTrailer(code, message)
	default:
		return nil
	}
}

// abortTrailerCode 把上游中断原因映射为对外错误码与文案。
func abortTrailerCode(cause error) (string, string) {
	switch {
	case errors.Is(cause, neterror.ErrUpstreamStreamIdleTimeout):
		return "upstream_stream_idle_timeout", "上游流式响应长时间无数据"
	case errors.Is(cause, neterror.ErrUpstreamOutputLoop):
		return "upstream_output_loop", "上游输出陷入循环"
	case errors.Is(cause, errUpstreamStreamIncomplete):
		return "upstream_stream_incomplete", "上游流式响应未完整结束"
	default:
		return "upstream_stream_interrupted", "上游流式响应中断"
	}
}

func chatAbortTrailer(code, message string) []byte {
	payload, err := json.Marshal(map[string]any{
		"type": "error",
		"error": map[string]any{
			"code":    code,
			"message": message,
			"type":    "server_error",
		},
	})
	if err != nil {
		return []byte("data: [DONE]\n\n")
	}
	return []byte("data: " + string(payload) + "\n\ndata: [DONE]\n\n")
}

// responsesAbortTrailer 以 response.failed 结束 Responses 流，避免客户端把中断当作不可重试的截断。
func responsesAbortTrailer(meta responseMetadata, compat *responsesCompatState, code, message string) []byte {
	if compat == nil {
		compat = &responsesCompatState{}
	}
	compat.rememberFromMeta(meta)
	id := compat.ensureID()
	// Grok TUI 0.2.93 treats any response.incomplete as fatal
	// max_tokens_truncation (not retryable), ignoring incomplete_details.reason.
	// Stream aborts are transport failures — emit response.failed so the
	// client can retry instead of killing the turn.
	model := strings.TrimSpace(meta.Model)
	if model == "" {
		model = strings.TrimSpace(compat.model)
	}
	response := map[string]any{
		"id":           id,
		"object":       "response",
		"created_at":   compat.createdAt,
		"completed_at": compat.createdAt,
		"status":       "failed",
		"model":        model,
		"output":       []any{},
		"error": map[string]any{
			"code":    "server_error",
			"message": code + ": " + message,
		},
	}
	event := map[string]any{
		"type":            "response.failed",
		"id":              id,
		"sequence_number": meta.SequenceNumber + 1,
		"response":        response,
	}
	sanitizeResponsesEvent(event, compat)
	payload, err := json.Marshal(event)
	if err != nil {
		return nil
	}
	return []byte("event: response.failed\ndata: " + string(payload) + "\n\n")
}

func anthropicAbortTrailer(code, message string) []byte {
	anthropicMessage := message
	if code == "upstream_output_loop" {
		anthropicMessage = code + ": " + message
	}
	payload, err := json.Marshal(map[string]any{
		"type":  "error",
		"error": map[string]any{"type": "api_error", "message": anthropicMessage},
	})
	if err != nil {
		return nil
	}
	return []byte("event: error\ndata: " + string(payload) + "\n\n")
}

type internalSSEMarkerFilter struct {
	enabled bool
	pending []byte
}

func (f *internalSSEMarkerFilter) Filter(chunk []byte, final bool) []byte {
	if !f.enabled {
		return chunk
	}
	f.pending = append(f.pending, chunk...)
	result := make([]byte, 0, len(f.pending))
	for {
		index, markerLength := nextInternalSSEMarker(f.pending)
		if index >= 0 {
			result = append(result, f.pending[:index]...)
			f.pending = f.pending[index+markerLength:]
			continue
		}
		if final {
			result = append(result, f.pending...)
			f.pending = nil
			return result
		}
		keep := 0
		for _, marker := range internalSSEMarkers {
			limit := min(len(f.pending), len(marker)-1)
			for size := limit; size > keep; size-- {
				if bytes.Equal(f.pending[len(f.pending)-size:], marker[:size]) {
					keep = size
					break
				}
			}
		}
		result = append(result, f.pending[:len(f.pending)-keep]...)
		f.pending = f.pending[len(f.pending)-keep:]
		return result
	}
}

func nextInternalSSEMarker(value []byte) (int, int) {
	index := -1
	length := 0
	for _, marker := range internalSSEMarkers {
		candidate := bytes.Index(value, marker)
		if candidate >= 0 && (index < 0 || candidate < index) {
			index = candidate
			length = len(marker)
		}
	}
	return index, length
}

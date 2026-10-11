package conversation

import (
	"encoding/json"
	"fmt"
	"io"

	"github.com/chenyme/grok2api/backend/internal/pkg/neterror"
)

func (t *streamRepeatTracker) trackEvent(typeName string, root map[string]json.RawMessage) error {
	var delta string
	switch typeName {
	case "response.output_text.delta":
		_ = json.Unmarshal(root["delta"], &delta)
		return t.trackContent(delta)
	case "response.reasoning_summary_text.delta":
		_ = json.Unmarshal(root["delta"], &delta)
		return t.trackReasoning(delta, "model reasoning summary loop detected")
	case "response.reasoning_text.delta":
		_ = json.Unmarshal(root["delta"], &delta)
		return t.trackReasoning(delta, "model reasoning loop detected")
	default:
		return nil
	}
}

func (t *streamRepeatTracker) trackContent(delta string) error {
	if delta == "" {
		return nil
	}
	if delta != t.lastContentDelta {
		t.lastContentDelta = delta
		t.contentRepeatCount = 1
		return nil
	}
	t.contentRepeatCount++
	if t.contentRepeatCount > contentDoomLoopThreshold {
		return fmt.Errorf("%w (repeated content delta %d times)", neterror.ErrUpstreamOutputLoop, t.contentRepeatCount)
	}
	return nil
}

func (t *streamRepeatTracker) trackReasoning(delta, message string) error {
	if delta == "" {
		return nil
	}
	if delta != t.lastReasonDelta {
		t.lastReasonDelta = delta
		t.reasonRepeatCount = 1
		return nil
	}
	t.reasonRepeatCount++
	if t.reasonRepeatCount > reasoningDoomLoopThreshold {
		return fmt.Errorf("%w: %s (repeated delta %d times)", neterror.ErrUpstreamOutputLoop, message, t.reasonRepeatCount)
	}
	return nil
}

// guardResponseStream 保持 native Responses SSE 的原始字节不变，同时在读取时
// 解析事件并在检测到循环时关闭上游。
func guardResponseStream(source io.ReadCloser) io.ReadCloser {
	reader, writer := io.Pipe()
	stream := newStreamPipeReadCloser(reader, source)
	go func() {
		defer stream.closeSource()
		tracker := streamRepeatTracker{}
		err := consumeSSE(io.TeeReader(source, writer), func(event string, data []byte) error {
			typeName, root, ok := parseSSEEvent(event, data)
			if !ok {
				return nil
			}
			return tracker.trackEvent(typeName, root)
		})
		_ = writer.CloseWithError(err)
	}()
	return stream
}

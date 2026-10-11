package conversation

import (
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"sync"
	"time"
)

const (
	maxDeferredSearchTextBytes = 8 << 20

	// contentDoomLoopThreshold 连续重复同一可见内容增量时终止流。真正的
	// 内容循环会消耗配额和客户端上下文，因此远低于推理上限；但仍需容纳
	// 合法重复：markdown 分隔线与表格边框会以相同单字符增量（"-"、"="、
	// "|"）连续输出。
	contentDoomLoopThreshold = 128

	// reasoningDoomLoopThreshold 高于内容阈值：high/xhigh 推理会大量重复
	// 同一短标记（"so"、"hmm"、"wait"、列表符号）。共用低阈值会过早终止
	// 有效的深度推理响应。
	reasoningDoomLoopThreshold = 256
)

// ConvertResponseStream 将 Responses SSE 转换为 Chat Completions 或 Anthropic Messages SSE。
func ConvertResponseStream(source io.ReadCloser, operation string) io.ReadCloser {
	return ConvertResponseStreamWithOptions(source, operation, ResponseOptions{})
}

// ConvertResponseStreamWithOptions 按下游协议选项生成 Chat 或 Anthropic SSE。
func ConvertResponseStreamWithOptions(source io.ReadCloser, operation string, options ResponseOptions) io.ReadCloser {
	if operation == OperationResponses {
		return guardResponseStream(source)
	}
	reader, writer := io.Pipe()
	stream := newStreamPipeReadCloser(reader, source)
	go func() {
		defer stream.closeSource()
		converter := newStreamConverter(writer, operation, options)
		err := consumeSSE(source, converter.handle)
		if err == nil {
			err = converter.finish()
		}
		_ = writer.CloseWithError(err)
	}()
	return stream
}

type streamConverter struct {
	writer                 io.Writer
	operation              string
	id                     string
	model                  string
	created                int64
	started                bool
	finished               bool
	textStarted            bool
	textIndex              int
	thinkingStarted        bool
	thinkingClosed         bool
	thinkingIndex          int
	thinkingItemID         string
	chatReasoningMark      bool
	nextIndex              int
	tools                  map[string]streamTool
	webSearch              []webSearchCall
	webSearchEmitted       map[string]bool
	deferSearchText        bool
	pendingSearchText      strings.Builder
	usage                  responseUsage
	options                ResponseOptions
	stopFilter             *anthropicStreamStopFilter
	stopSequence           string
	refused                bool
	reasoningEvidenceBytes int
	reasoningItems         map[string]*reasoningStreamState
	reasoningOrder         []string
	activeReasoningID      string
	repeatTracker          streamRepeatTracker
	// terminalEvent distinguishes a normal Responses terminal frame from a
	// transport EOF. EOF is still converted to the legacy downstream terminator
	// for compatibility, but it must not make a truncated tool turn replayable.
	terminalEvent bool
	outputItems   []responseItem
	outputItemIDs map[string]struct{}
}

// streamRepeatTracker 在协议转换、缓冲和 stop filter 之前跟踪上游增量，
// 避免任一下游路径绕过循环保护。
type streamRepeatTracker struct {
	lastContentDelta   string
	contentRepeatCount int
	lastReasonDelta    string
	reasonRepeatCount  int
}

// streamPipeReadCloser ensures a downstream cancellation immediately closes the
// upstream body, including while the forwarding goroutine is blocked in Read.
type streamPipeReadCloser struct {
	*io.PipeReader
	source    io.ReadCloser
	closeOnce sync.Once
	closeErr  error
}

func newStreamPipeReadCloser(reader *io.PipeReader, source io.ReadCloser) *streamPipeReadCloser {
	return &streamPipeReadCloser{PipeReader: reader, source: source}
}

func (r *streamPipeReadCloser) Close() error {
	readerErr := r.PipeReader.Close()
	sourceErr := r.closeSource()
	if readerErr != nil {
		return readerErr
	}
	return sourceErr
}

func (r *streamPipeReadCloser) closeSource() error {
	r.closeOnce.Do(func() {
		r.closeErr = r.source.Close()
	})
	return r.closeErr
}

type streamTool struct {
	Index     int
	ID        string
	Name      string
	Arguments string
	SentArgs  bool
	Closed    bool
}

type reasoningStreamState struct {
	chosen           string // "summary" or "raw"; first source wins
	done             bool
	anonymous        bool
	signatureEmitted bool
}

func newStreamConverter(writer io.Writer, operation string, options ResponseOptions) *streamConverter {
	return &streamConverter{
		writer: writer, operation: operation, created: time.Now().Unix(), tools: make(map[string]streamTool),
		webSearchEmitted: make(map[string]bool),
		outputItemIDs:    make(map[string]struct{}),
		reasoningItems:   make(map[string]*reasoningStreamState),
		deferSearchText:  operation == OperationMessages && options.AnthropicWebSearch,
		options:          options, stopFilter: newAnthropicStreamStopFilter(options.StopSequences),
	}
}

func (c *streamConverter) start() error {
	if c.started {
		return nil
	}
	c.started = true
	if c.id == "" {
		c.id = "resp_" + fmt.Sprint(time.Now().UnixNano())
	}
	if c.operation == OperationChat {
		return c.startChat()
	}
	return c.startMessages()
}

func (c *streamConverter) textDelta(delta string) error {
	if c.operation == OperationChat {
		return c.textDeltaChat(delta)
	}
	return c.textDeltaMessages(delta)
}

func (c *streamConverter) toolStart(item responseItem, outputIndex int) error {
	if c.operation == OperationMessages {
		return c.toolStartMessages(item)
	}
	return c.toolStartChat(item, outputIndex)
}

func (c *streamConverter) toolDelta(itemID, delta string) error {
	if c.operation == OperationChat {
		return c.toolDeltaChat(itemID, delta)
	}
	return c.toolDeltaMessages(itemID, delta)
}

func (c *streamConverter) toolArgumentsDone(itemID, arguments string) error {
	if c.operation == OperationChat {
		return c.toolArgumentsDoneChat(itemID, arguments)
	}
	return c.toolArgumentsDoneMessages(itemID, arguments)
}

func (c *streamConverter) done(status string) error {
	if c.finished {
		return nil
	}
	if err := c.start(); err != nil {
		return err
	}
	var err error
	if err := c.flushPendingReasoning(); err != nil {
		return err
	}
	if c.operation == OperationChat {
		err = c.doneChat(status)
	} else {
		err = c.doneMessages(status)
	}
	if err == nil && c.terminalEvent {
		// Commit only after the downstream terminal event was written. If the
		// upstream failed, the client abandoned the pipe, or the source ended
		// without a terminal Responses event, a partially observed tool turn must
		// not become replayable state.
		c.commitReasoningReplay()
	}
	return err
}

func (c *streamConverter) streamError(data []byte) error {
	if err := c.flushPendingReasoning(); err != nil {
		return err
	}
	c.finished = true
	if c.operation == OperationMessages {
		return c.streamErrorMessages(data)
	}
	return c.streamErrorChat(data)
}

func (c *streamConverter) finish() error {
	if c.finished {
		return nil
	}
	return c.done("")
}

func (c *streamConverter) writeData(value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	_, err = fmt.Fprintf(c.writer, "data: %s\n\n", data)
	return err
}

func (c *streamConverter) writeEvent(event string, value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	_, err = fmt.Fprintf(c.writer, "event: %s\ndata: %s\n\n", event, data)
	return err
}

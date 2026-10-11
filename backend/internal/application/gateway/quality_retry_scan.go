package gateway

import (
	"bytes"
	"io"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/chenyme/grok2api/backend/internal/domain/audit"
)

const (
	qualityProtocolChat                = "chat"
	qualityProtocolResponses           = "responses"
	qualityProtocolAnthropic           = "anthropic"
	qualityReasoningSSEComment         = ": grok2api-reasoning-start"
	qualityReasoningEvidenceSSEComment = ": grok2api-reasoning-evidence"
	qualityHoldMaxBufferBytes          = 4 << 20
)

type qualityScanState struct {
	protocol                        string
	pending                         []byte
	hasThinking                     bool
	reasoningStarted                bool
	visibleRunes                    int
	aggregateRunes                  int
	semanticOutput                  bool
	reasoningTokens                 int64
	outputTokens                    int64
	encryptedBytes                  int
	minEncryptedBytes               int
	encryptedBytesPerReasoningToken int
	usage                           Usage
	responseID                      string
	terminal                        bool
	holdExpired                     bool
	firstVisibleAt                  time.Time
}

type qualityReadResult struct {
	data []byte
	err  error
}

// qualityReadPump is the sole reader of the upstream body. It lets the hold
// timer win while an upstream Read is blocked, then remains the continuation
// reader for the response body after the held prefix is replayed.
type qualityReadPump struct {
	source    io.ReadCloser
	results   chan qualityReadResult
	done      chan struct{}
	closeOnce sync.Once
	pending   []byte
	finalErr  error
}

func newQualityReadPump(source io.ReadCloser) *qualityReadPump {
	pump := &qualityReadPump{
		source:  source,
		results: make(chan qualityReadResult),
		done:    make(chan struct{}),
	}
	go pump.run()
	return pump
}

func (p *qualityReadPump) run() {
	defer close(p.results)
	buf := make([]byte, 4096)
	for {
		n, err := p.source.Read(buf)
		if n == 0 && err == nil {
			continue
		}
		result := qualityReadResult{err: err}
		if n > 0 {
			result.data = append([]byte(nil), buf[:n]...)
		}
		select {
		case p.results <- result:
		case <-p.done:
			return
		}
		if err != nil {
			return
		}
	}
}

func (p *qualityReadPump) Read(dst []byte) (int, error) {
	for len(p.pending) == 0 {
		if p.finalErr != nil {
			return 0, p.finalErr
		}
		result, ok := <-p.results
		if !ok {
			p.finalErr = io.EOF
			return 0, io.EOF
		}
		p.pending = result.data
		p.finalErr = result.err
		if len(p.pending) == 0 && p.finalErr != nil {
			return 0, p.finalErr
		}
	}
	n := copy(dst, p.pending)
	p.pending = p.pending[n:]
	return n, nil
}

func (p *qualityReadPump) Close() error {
	var err error
	p.closeOnce.Do(func() {
		close(p.done)
		err = p.source.Close()
	})
	return err
}

func qualityProtocolForOperation(operation audit.Operation) string {
	switch operation {
	case audit.OperationChat:
		return qualityProtocolChat
	case audit.OperationMessages:
		return qualityProtocolAnthropic
	default:
		return qualityProtocolResponses
	}
}

func (s *qualityScanState) signals() QualityStreamSignals {
	// Visible tokens come only from streamed content deltas (chat content /
	// responses output_text / message items). Do not lift from
	// usage.output − usage.reasoning: chat often reports completion_tokens
	// that still include reasoning, which made dumps look like long answers.
	visibleRunes := max(s.visibleRunes, s.aggregateRunes)
	visible := int64((visibleRunes + 3) / 4)
	output := s.outputTokens
	if s.usage.Reported && s.usage.OutputTokens > output {
		output = s.usage.OutputTokens
	}
	// Usage.reasoning_tokens is not proof of thinking. 降智 accounts report
	// hundreds of reasoning tokens on completed while the stream never sent
	// reasoning_text / reasoning_summary deltas (TUI shows no thoughts).
	// A non-empty encrypted_content stub is also not thinking until it meets
	// the ciphertext floor (default 256 bytes, or 4 bytes per reasoning token).
	reasoningTokens := max(s.reasoningTokens, s.usage.ReasoningTokens)
	floor := encryptedThinkingFloor(s.minEncryptedBytes, s.encryptedBytesPerReasoningToken, reasoningTokens)
	hasThinking := s.hasThinking || int64(s.encryptedBytes) >= floor
	firstVisible := !s.firstVisibleAt.IsZero()
	var flushMS int64
	if firstVisible {
		flushMS = time.Since(s.firstVisibleAt).Milliseconds()
	}
	return QualityStreamSignals{
		HasThinking:       hasThinking,
		HasReasoningDelta: s.hasThinking,
		ReasoningStarted:  s.reasoningStarted || hasThinking,
		VisibleTokens:     visible,
		ReasoningTokens:   reasoningTokens,
		OutputTokens:      output,
		EncryptedBytes:    s.encryptedBytes,
		EncryptedFloor:    floor,
		UsageReported:     s.usage.Reported,
		FirstVisible:      firstVisible,
		VisibleFlushMS:    flushMS,
		Terminal:          s.terminal,
		HoldExpired:       s.holdExpired,
	}
}

// ObserveQualityChunk feeds one SSE chunk into the hold classifier state.
// This is the shipped scanner used by peekQualityStream.
func ObserveQualityChunk(state *qualityScanState, chunk []byte) {
	if state == nil || len(chunk) == 0 {
		return
	}
	state.pending = append(state.pending, chunk...)
	for {
		index := bytes.IndexByte(state.pending, '\n')
		if index < 0 {
			if len(state.pending) > 1<<20 {
				state.pending = nil
			}
			return
		}
		line := bytes.TrimSpace(state.pending[:index])
		state.pending = state.pending[index+1:]
		if len(line) == 0 {
			continue
		}
		if bytes.Equal(line, []byte(qualityReasoningSSEComment)) {
			// Timing stub only. 降智 still emits this, then usage.reasoning_tokens=0.
			state.reasoningStarted = true
			continue
		}
		if bytes.HasPrefix(line, []byte(qualityReasoningEvidenceSSEComment)) {
			// Protocol converters cannot expose encrypted_content in every public
			// JSON contract. This internal SSE comment preserves its byte length so
			// short stubs cannot bypass the ciphertext floor.
			state.reasoningStarted = true
			value := strings.TrimSpace(strings.TrimPrefix(string(line), qualityReasoningEvidenceSSEComment))
			if count, err := strconv.Atoi(value); err == nil && count > state.encryptedBytes {
				state.encryptedBytes = count
			}
			continue
		}
		if !bytes.HasPrefix(line, []byte("data:")) {
			continue
		}
		payload := bytes.TrimSpace(bytes.TrimPrefix(line, []byte("data:")))
		if bytes.Equal(payload, []byte("[DONE]")) {
			state.terminal = true
			continue
		}
		observeQualityPayload(state, payload)
	}
}

func observeQualityPayload(state *qualityScanState, payload []byte) {
	switch state.protocol {
	case qualityProtocolChat:
		observeQualityChat(state, payload)
	case qualityProtocolAnthropic:
		observeQualityAnthropic(state, payload)
	default:
		observeQualityResponses(state, payload)
	}
}

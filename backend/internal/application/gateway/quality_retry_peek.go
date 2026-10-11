package gateway

import (
	"bytes"
	"context"
	"io"
	"time"
)

func peekQualityStream(ctx context.Context, body io.ReadCloser, protocol string, cfg QualityRetryRuntime) (io.ReadCloser, QualityVerdict, Usage, string, error) {
	cfg = normalizeQualityRetry(cfg)
	if body == nil {
		return io.NopCloser(bytes.NewReader(nil)), QualityWait, Usage{}, "", errQualityEmptyStream
	}
	pump := newQualityReadPump(body)
	state := qualityScanState{
		protocol:                        protocol,
		minEncryptedBytes:               cfg.MinEncryptedBytes,
		encryptedBytesPerReasoningToken: cfg.EncryptedBytesPerReasoningToken,
	}
	var held bytes.Buffer
	holdTimer := time.NewTimer(cfg.HoldTimeout)
	defer holdTimer.Stop()
	for {
		sig := state.signals()
		if verdict := ClassifyQualityHold(sig, cfg.MinOutputTokens); verdict != QualityWait {
			return heldQualityResult(&held, pump, &state, verdict)
		}
		// A completed empty stream must rotate immediately. Waiting for idle
		// timeout after response.completed / [DONE] surfaces HTTP 200 with 0
		// tokens and makes Grok TUI retry for 50–120s.
		if sig.Terminal {
			return finishQualityPeek(&held, pump, &state, cfg)
		}
		outcome, done := awaitQualityPeekEvent(ctx, holdTimer, pump, &state, &held, sig, cfg)
		if done {
			return outcome.replay, outcome.verdict, outcome.usage, outcome.responseID, outcome.err
		}
	}
}

// qualityPeekOutcome 汇总持有期分帧判定的返回值，便于把 select 分支收敛为单一返回值。
type qualityPeekOutcome struct {
	replay     io.ReadCloser
	verdict    QualityVerdict
	usage      Usage
	responseID string
	err        error
}

// heldQualityResult 在判定结束后回放已缓冲分片并保留剩余读取泵。
func heldQualityResult(held *bytes.Buffer, pump *qualityReadPump, state *qualityScanState, verdict QualityVerdict) (io.ReadCloser, QualityVerdict, Usage, string, error) {
	return newPrefixReplay(held, pump), verdict, state.usage, state.responseID, nil
}

// awaitQualityPeekEvent 等待下一个持有期事件（取消、持有超时或上游分片）；done 为 true 时返回持有期终态。
// sig 是进入等待前的判定快照，与调用方同轮循环的判定保持一致。
func awaitQualityPeekEvent(ctx context.Context, holdTimer *time.Timer, pump *qualityReadPump, state *qualityScanState, held *bytes.Buffer, sig QualityStreamSignals, cfg QualityRetryRuntime) (qualityPeekOutcome, bool) {
	select {
	case <-ctx.Done():
		return asQualityPeekOutcome(abortQualityPeek(ctx, ctx.Err(), pump, held, state)), true
	case <-holdTimer.C:
		state.holdExpired = true
		sig.HoldExpired = true
		if verdict := ClassifyQualityHold(sig, cfg.MinOutputTokens); verdict != QualityWait {
			return asQualityPeekOutcome(heldQualityResult(held, pump, state, verdict)), true
		}
		return qualityPeekOutcome{}, false
	case read, ok := <-pump.results:
		if !ok {
			return asQualityPeekOutcome(finishQualityPeek(held, pump, state, cfg)), true
		}
		if deliver, verdict := bufferQualityChunk(held, state, read.data); deliver {
			return asQualityPeekOutcome(heldQualityResult(held, pump, state, verdict)), true
		}
		if read.err == io.EOF {
			return asQualityPeekOutcome(finishQualityPeek(held, pump, state, cfg)), true
		}
		if read.err != nil {
			return asQualityPeekOutcome(abortQualityPeek(ctx, read.err, pump, held, state)), true
		}
		return qualityPeekOutcome{}, false
	}
}

// asQualityPeekOutcome 把持有期终止路径的返回值收敛为单一判定结果。
func asQualityPeekOutcome(replay io.ReadCloser, verdict QualityVerdict, usage Usage, responseID string, err error) qualityPeekOutcome {
	return qualityPeekOutcome{replay: replay, verdict: verdict, usage: usage, responseID: responseID, err: err}
}

// bufferQualityChunk 累积并分析一个上游分片；超过缓冲上限时放行已缓冲内容。
func bufferQualityChunk(held *bytes.Buffer, state *qualityScanState, data []byte) (bool, QualityVerdict) {
	if len(data) == 0 {
		return false, QualityWait
	}
	if held.Len()+len(data) > qualityHoldMaxBufferBytes {
		_, _ = held.Write(data)
		return true, QualityDeliver
	}
	_, _ = held.Write(data)
	ObserveQualityChunk(state, data)
	return false, QualityWait
}

// abortQualityPeek 关闭读取泵并回放已缓冲内容，向上层暴露取消或读取失败。
func abortQualityPeek(ctx context.Context, cause error, pump *qualityReadPump, held *bytes.Buffer, state *qualityScanState) (io.ReadCloser, QualityVerdict, Usage, string, error) {
	_ = pump.Close()
	return io.NopCloser(bytes.NewReader(held.Bytes())), QualityWait, state.usage, state.responseID, qualityPeekAbortError(ctx, cause)
}

func finishQualityPeek(held *bytes.Buffer, pump *qualityReadPump, state *qualityScanState, cfg QualityRetryRuntime) (io.ReadCloser, QualityVerdict, Usage, string, error) {
	if state == nil {
		return io.NopCloser(bytes.NewReader(nil)), QualityWait, Usage{}, "", errQualityEmptyStream
	}
	if len(state.pending) > 0 {
		// Process a final valid SSE data line even when the upstream omitted its
		// trailing newline.
		ObserveQualityChunk(state, []byte{'\n'})
	}
	state.terminal = true
	signals := state.signals()
	if !signals.HasThinking && signals.ReasoningTokens <= 0 && signals.OutputTokens <= 0 && signals.VisibleTokens <= 0 {
		if state.semanticOutput {
			return newPrefixReplay(held, pump), QualityDeliver, state.usage, state.responseID, nil
		}
		return newPrefixReplay(held, pump), QualityWait, state.usage, state.responseID, errQualityEmptyStream
	}
	return newPrefixReplay(held, pump), ClassifyQualityHold(signals, cfg.MinOutputTokens), state.usage, state.responseID, nil
}

func newPrefixReplay(held *bytes.Buffer, rest io.ReadCloser) io.ReadCloser {
	if rest == nil {
		rest = io.NopCloser(bytes.NewReader(nil))
	}
	if held == nil || held.Len() == 0 {
		return rest
	}
	return &replayReadCloser{Reader: io.MultiReader(bytes.NewReader(held.Bytes()), rest), source: rest}
}

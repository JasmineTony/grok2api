package gateway

import (
	"context"
	neterrorpkg "github.com/chenyme/grok2api/backend/internal/pkg/neterror"
	"math"
	"strings"
)

// 质量拦截判定：加密推理下限、快速 flush / 突发 dump / cipher drool 识别与
// 重试决策（不读取上游流）。
func encryptedThinkingFloor(minBytes, bytesPerToken int, reasoningTokens int64) int64 {
	if minBytes <= 0 {
		minBytes = defaultMinEncryptedBytes
	}
	if bytesPerToken <= 0 {
		bytesPerToken = defaultEncryptedBytesPerReasoningToken
	}
	floor := int64(minBytes)
	if reasoningTokens > 0 {
		if reasoningTokens > math.MaxInt64/int64(bytesPerToken) {
			return math.MaxInt64
		}
		need := reasoningTokens * int64(bytesPerToken)
		if need > floor {
			floor = need
		}
	}
	return floor
}

func qualityFastFlush(sig QualityStreamSignals, limitMS int64) bool {
	return sig.FirstVisible && sig.VisibleFlushMS >= 0 && sig.VisibleFlushMS < limitMS
}

func qualityMeetsEncryptedFloor(sig QualityStreamSignals) bool {
	if sig.EncryptedBytes <= 0 {
		return false
	}
	floor := sig.EncryptedFloor
	if floor <= 0 {
		floor = encryptedThinkingFloor(0, 0, sig.ReasoningTokens)
	}
	return int64(sig.EncryptedBytes) >= floor
}

func qualityHasDumpBill(sig QualityStreamSignals) bool {
	return sig.ReasoningTokens >= defaultBurstMinReasoning || qualityMeetsEncryptedFloor(sig)
}

func qualityIsBurstDump(sig QualityStreamSignals, minOutput int64) bool {
	_ = minOutput
	if sig.HasReasoningDelta {
		return false
	}
	visible := sig.VisibleTokens
	heavyReasoning := sig.ReasoningTokens >= defaultBurstMinReasoning
	shortVisible := visible > 0 && visible < defaultBurstMaxVisible
	// Hold timed out, then a short greeting dumped with a large reasoning bill
	// (TUI "你好" after 30s / 954 thinking tokens).
	if sig.HoldExpired && shortVisible && heavyReasoning {
		return true
	}
	if qualityFastFlush(sig, defaultBurstFlushMS) && qualityHasDumpBill(sig) {
		return true
	}
	return false
}

// qualityIsFakeEncryptedDump is the 18190 / 18183 dump: ciphertext or a
// large reasoning bill, then the visible answer arrives in <2s. Visible
// token count is not a gate — vis<8 chat dumps were leaking on minOutput.
func qualityIsFakeEncryptedDump(sig QualityStreamSignals, minOutput int64) bool {
	_ = minOutput
	if sig.HasReasoningDelta {
		return false
	}
	if !qualityFastFlush(sig, defaultFakeEncFlushMS) {
		return false
	}
	return qualityHasDumpBill(sig)
}

// qualityIsFastReasoningRatioDump catches plaintext thinking that is still a
// 1ms dump: billed reasoning is ≥80% of output and the visible flush is <2s.
func qualityIsFastReasoningRatioDump(sig QualityStreamSignals) bool {
	if !sig.HasReasoningDelta {
		return false
	}
	if !qualityFastFlush(sig, defaultFakeEncFlushMS) {
		return false
	}
	output := sig.OutputTokens
	if output <= 0 {
		output = sig.VisibleTokens + sig.ReasoningTokens
	}
	if output <= 0 || sig.ReasoningTokens <= 0 {
		return false
	}
	return sig.ReasoningTokens*5 >= output*4
}

// qualityIsCipherDrool is the 128k TUI status-loop: ciphertext met the
// floor so HasThinking is true, but there is no plaintext reasoning and
// usage.reasoning_tokens is still 0 while visible text is already dumping.
func qualityIsCipherDrool(sig QualityStreamSignals, minOutput int64) bool {
	if minOutput <= 0 {
		minOutput = defaultQualityMinOutput
	}
	if sig.HasReasoningDelta || sig.ReasoningTokens > 0 {
		return false
	}
	if sig.EncryptedBytes <= 0 {
		return false
	}
	visible := sig.VisibleTokens
	if visible >= defaultCipherDroolVisible {
		return true
	}
	if sig.Terminal && visible >= minOutput {
		return true
	}
	return false
}

// ClassifyQualityHold decides whether a held stream may be forwarded.
// Dump detectors run first so plaintext thinking cannot veto a 1ms
// reasoning-ratio dump, and vis<minOutput cannot skip fake-enc/burst.
// Remaining plaintext deltas still deliver. Cipher-only HasThinking waits
// until visible text has streamed for 2s or the stream ends.
func ClassifyQualityHold(sig QualityStreamSignals, minOutput int64) QualityVerdict {
	if minOutput <= 0 {
		minOutput = defaultQualityMinOutput
	}
	if qualityIsBurstDump(sig, minOutput) || qualityIsCipherDrool(sig, minOutput) || qualityIsFakeEncryptedDump(sig, minOutput) || qualityIsFastReasoningRatioDump(sig) {
		return QualityWithhold
	}
	if sig.HasThinking {
		if sig.HasReasoningDelta {
			return QualityDeliver
		}
		// Cipher-only: do not release when encrypted_content first meets
		// the floor. Fake dumps send the blob, then the whole answer in
		// <2s; releasing early lets that dump bypass fake-enc. Wait until
		// visible text has streamed for 2s, or the stream ends.
		if sig.Terminal {
			return QualityDeliver
		}
		if sig.VisibleTokens >= minOutput && sig.FirstVisible && sig.VisibleFlushMS >= defaultFakeEncFlushMS {
			return QualityDeliver
		}
		return QualityWait
	}
	// Prefer observed/derived visible output. Total output includes reasoning
	// tokens, which are deliberately not trusted as quality evidence above. If
	// the stream exposed no visible count at all, retain OutputTokens as a
	// compatibility fallback for terminal usage-only responses.
	output := sig.VisibleTokens
	if output <= 0 {
		output = sig.OutputTokens
	}
	enough := output >= minOutput
	if sig.ReasoningStarted && !sig.Terminal && !sig.HoldExpired {
		return QualityWait
	}
	if sig.Terminal {
		if output <= 0 {
			return QualityWait
		}
		if enough {
			return QualityWithhold
		}
		return QualityDeliver
	}
	if enough {
		return QualityWithhold
	}
	if sig.HoldExpired {
		if output <= 0 {
			return QualityWait
		}
		if enough {
			return QualityWithhold
		}
		return QualityDeliver
	}
	return QualityWait
}

// qualityPeekAbortError prefers the idle-timeout cause over a plain
// context.Canceled so the attempt loop can retry instead of treating the
// abort as a client 499.
func qualityPeekAbortError(ctx context.Context, err error) error {
	if ctx != nil {
		if cause := context.Cause(ctx); neterrorpkg.IsUpstreamStreamIdleTimeout(cause) {
			return cause
		}
	}
	if neterrorpkg.IsUpstreamStreamIdleTimeout(err) {
		return err
	}
	if err != nil {
		return err
	}
	if ctx != nil {
		return ctx.Err()
	}
	return nil
}

// isClientRequestCancel reports a real client disconnect. Upstream idle
// timeouts cancel the same context and must not be classified as 499.
func isClientRequestCancel(ctx context.Context, err error) bool {
	return neterrorpkg.IsClientRequestCancel(ctx, err)
}

// DecideQualityRetry caps withhold recovery at maxAttempts (default 6:
// original + five extra accounts). The last withhold
// (attemptIndex == maxAttempts-1) is fail-open unless OnExhausted is fail_closed.
func DecideQualityRetry(verdict QualityVerdict, attemptIndex, maxAttempts int, onExhausted string) QualityRetryAction {
	if verdict != QualityWithhold {
		return QualityActionDeliver
	}
	if maxAttempts <= 0 {
		maxAttempts = defaultQualityMaxAttempts
	}
	if attemptIndex < 0 {
		attemptIndex = 0
	}
	if attemptIndex < maxAttempts-1 {
		return QualityActionRetry
	}
	// attemptIndex == maxAttempts-1 (or past it): do not retry again.
	if normalizeQualityExhaustionPolicy(onExhausted) == qualityRetryFailClosed {
		return QualityActionReject
	}
	return QualityActionDeliverLast
}

// BoundQualityRetry turns a Retry into DeliverLast/Reject when the routing
// loop has no remaining account slot, so the already-held body is not dropped
// on continue-into-exhausted-loop.
func BoundQualityRetry(action QualityRetryAction, hasNextRoutingAttempt bool, onExhausted string) QualityRetryAction {
	if action != QualityActionRetry || hasNextRoutingAttempt {
		return action
	}
	if normalizeQualityExhaustionPolicy(onExhausted) == qualityRetryFailClosed {
		return QualityActionReject
	}
	return QualityActionDeliverLast
}

func normalizeQualityExhaustionPolicy(value string) string {
	if strings.EqualFold(strings.TrimSpace(value), qualityRetryFailOpen) {
		return qualityRetryFailOpen
	}
	return qualityRetryFailClosed
}

package cli

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"strings"

	"github.com/chenyme/grok2api/backend/internal/ports/provider"
)

// recoveredAttempts 按真实调用顺序汇总被 fallback 与 reasoning recovery 隐藏的失败。
func recoveredAttempts(primary *provider.RecoveredAttempt, recovery reasoningRecoveryOutcome) []provider.RecoveredAttempt {
	attempts := append([]provider.RecoveredAttempt(nil), recovery.attempts...)
	if primary != nil {
		attempts = append([]provider.RecoveredAttempt{*primary}, attempts...)
	}
	return attempts
}

func (a *Adapter) shouldCaptureReplay(request provider.ResponseResourceRequest, resp *http.Response, replayKey string) bool {
	if a.replay == nil || !a.replay.Enabled() || resp == nil {
		return false
	}
	if request.Method != http.MethodPost || strings.TrimSpace(replayKey) == "" {
		return false
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return false
	}
	return true
}

func (a *Adapter) applyReasoningReplay(ctx context.Context, request provider.ResponseResourceRequest, body []byte, base string) ([]byte, string) {
	if a.replay == nil || !a.replay.Enabled() || request.Method != http.MethodPost {
		return body, ""
	}
	key := a.scopedReasoningReplayKey(request, base)
	if key == "" {
		return body, ""
	}
	if isCompactPath(request.Path) {
		// compact does not inject history, but a successful request still clears old replay in the same scope.
		return body, key
	}
	return a.replay.Apply(ctx, request.Model, key, body), key
}

func (a *Adapter) scopedReasoningReplayKey(request provider.ResponseResourceRequest, base string) string {
	seed := strings.TrimSpace(request.ReasoningReplayKey)
	if seed == "" {
		return ""
	}
	plane := "build"
	if fallback := a.fallbackBaseURL(); fallback != "" && strings.EqualFold(strings.TrimRight(base, "/"), fallback) {
		plane = "xai"
	}
	digest := sha256.Sum256([]byte(fmt.Sprintf("grok2api:reasoning-replay:v3:%s:%s", seed, plane)))
	return hex.EncodeToString(digest[:])
}

func (a *Adapter) conversationReasoningScope(request provider.ResponseResourceRequest, base string) string {
	seed := strings.TrimSpace(request.ReasoningReplayKey)
	model := strings.ToLower(strings.TrimSpace(request.Model))
	if seed == "" || model == "" {
		return ""
	}
	plane := "build"
	if fallback := a.fallbackBaseURL(); fallback != "" && strings.EqualFold(strings.TrimRight(base, "/"), fallback) {
		plane = "xai"
	}
	digest := sha256.Sum256([]byte(fmt.Sprintf("grok2api:conversation-reasoning:v1:%s:%s:%s", seed, model, plane)))
	return hex.EncodeToString(digest[:])
}

func isCompactPath(path string) bool {
	return strings.Contains(strings.ToLower(path), "compact")
}

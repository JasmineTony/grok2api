package gateway

import (
	"io"
	"strconv"
	"strings"

	accountdomain "github.com/chenyme/grok2api/backend/internal/domain/account"
	provider "github.com/chenyme/grok2api/backend/internal/ports/provider"
	http "net/http"
)

func readRetryableBody(body io.ReadCloser) ([]byte, error) {
	if body == nil {
		return nil, nil
	}
	defer body.Close()
	data, _, err := provider.ReadDiagnosticBody(body)
	return data, err
}

func parseFreeQuotaExhaustion(body []byte) (int64, int64, bool) {
	text := strings.ToLower(string(body))
	if !strings.Contains(text, "subscription:free-usage-exhausted") {
		return 0, 0, false
	}
	matches := freeQuotaUsagePattern.FindSubmatch(body)
	if len(matches) != 3 {
		return 0, 0, true
	}
	used, usedErr := strconv.ParseInt(string(matches[1]), 10, 64)
	limit, limitErr := strconv.ParseInt(string(matches[2]), 10, 64)
	if usedErr != nil || limitErr != nil {
		return 0, 0, true
	}
	return used, limit, true
}

type finalizingBody struct {
	io.ReadCloser
	finalize func()
}

func (b *finalizingBody) Close() error {
	err := b.ReadCloser.Close()
	if b.finalize != nil {
		b.finalize()
	}
	return err
}

// shouldStopForNonAccountFingerprint 仅对非账号归因故障累计指纹并在达到阈值后停止换号。
// 账号级失败（额度、鉴权、冷却等）继续轮询其它凭证。
// Team 模型限流只跳过当前号，不累计指纹、不提前结束整次请求。
// Grok Build 上无法归因的 403 例外：它既不写入冷却、也无法通过换号解决，逐号遍历只会
// 耗尽整个账号池（issue #1064），因此与其它非账号归因故障同口径设上限。
func shouldStopForNonAccountFingerprint(fingerprints map[string]int, failure *UpstreamFailure, provider accountdomain.Provider) bool {
	if failure == nil || failure.AccountScoped || failure.Fingerprint == "" {
		return false
	}
	if failure.HTTPStatus == http.StatusForbidden && !isUnknownBuildForbidden(failure, provider) {
		return false
	}
	if failure.Fingerprint == "429:team_model_rate_limit" {
		return false
	}
	fingerprints[failure.Fingerprint]++
	limit := nonAccountFailureFingerprintLimit
	if failure.Code == "upstream_stream_idle_timeout" || failure.Fingerprint == "upstream_stream_idle_timeout" || failure.Code == "upstream_stream_empty" || failure.Fingerprint == "upstream_stream_empty" {
		limit = streamIdleFailureFingerprintLimit
	}
	return fingerprints[failure.Fingerprint] >= limit
}

// isUnknownBuildForbidden 判断这是 Grok Build 上无法归因的 403：既不是账号级失效，
// 也不是在更早分支已被终止的请求级策略拒绝（DPoP、安全拒答、invalid_argument 等）。
// 这类响应此前既不冷却也不计指纹，导致每个请求都重新遍历整个账号池。
func isUnknownBuildForbidden(failure *UpstreamFailure, provider accountdomain.Provider) bool {
	if failure == nil || provider != accountdomain.ProviderBuild || failure.HTTPStatus != http.StatusForbidden {
		return false
	}
	return !failure.AccountBlocked && !failure.PermanentAccountDenial && !failure.CredentialRejected &&
		!failure.SpendingLimitBlocked && !failure.RequestScopedForbidden && !failure.SafetyRejection
}

func isRetryable(status int) bool {
	return status == 402 || status == 403 || status == 429 || status >= 500
}

func isReasoningRecoveryFailedResponse(response *provider.Response, upstreamProvider accountdomain.Provider) bool {
	return upstreamProvider == accountdomain.ProviderBuild && response != nil && response.ReasoningRecoveryFailed
}

func isRetryableResponse(response *provider.Response, upstreamProvider accountdomain.Provider) bool {
	if response == nil {
		return false
	}
	if response.StatusCode == http.StatusBadRequest && isReasoningRecoveryFailedResponse(response, upstreamProvider) {
		return true
	}
	if !isRetryable(response.StatusCode) {
		return false
	}
	// Account-scoped payment failures must always rotate accounts.
	// Upstream X-Should-Retry:false is only honored for non-account errors (e.g. 5xx history).
	if forcesAccountFailover(response.StatusCode, upstreamProvider) {
		return true
	}
	return !strings.EqualFold(strings.TrimSpace(response.Header.Get("X-Should-Retry")), "false")
}

// isTerminalRequestForbidden identifies request-level 403 responses that must
// be returned without account or egress side effects. Unknown 403 responses,
// including bare permission-denied, are never cooled down or counted as account
// failures; on Grok Build they are only bounded by the per-request non-account
// fingerprint limit so a single request cannot traverse the whole account pool.
// General request policy classification is Build-specific so Web and Console
// keep their browser/clearance recovery behavior. The exact Console DPoP rollout
// error is also terminal because changing account or egress cannot satisfy it.
func isTerminalRequestForbidden(upstreamProvider accountdomain.Provider, failure *UpstreamFailure) bool {
	if failure == nil {
		return false
	}
	return failure.SafetyRejection ||
		(upstreamProvider == accountdomain.ProviderBuild && failure.RequestScopedForbidden) ||
		(upstreamProvider == accountdomain.ProviderConsole && failure.RequestScopedForbidden && isDPoPProofRequired(failure.UpstreamCode))
}

// forcesAccountFailover keeps Build account-scoped billing, permission, and rate-limit
// failures on the account-rotation path so their state can be recorded before another
// account is selected. free-usage 429 and Team RPS 429 both need rotation even when
// upstream sets X-Should-Retry:false.
func forcesAccountFailover(status int, upstreamProvider accountdomain.Provider) bool {
	return upstreamProvider == accountdomain.ProviderBuild &&
		(status == http.StatusPaymentRequired || status == http.StatusForbidden || status == http.StatusTooManyRequests)
}

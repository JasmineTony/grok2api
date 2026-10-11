package console

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/chenyme/grok2api/backend/internal/domain/account"
	egressdomain "github.com/chenyme/grok2api/backend/internal/domain/egress"
	infraegress "github.com/chenyme/grok2api/backend/internal/infra/egress"
	"github.com/chenyme/grok2api/backend/internal/ports/provider"
)

const (
	consoleQuotaTimeout                = 30 * time.Second
	consolePredictedChatRecoveryWindow = 24 * time.Hour
)

func (a *Adapter) SyncQuota(ctx context.Context, credential account.Credential) (provider.QuotaSnapshot, error) {
	windows, syncedAt, err := a.syncConsoleQuotas(ctx, credential)
	if err != nil {
		return provider.QuotaSnapshot{}, err
	}
	return provider.QuotaSnapshot{Windows: windows, SyncedAt: syncedAt}, nil
}

func (a *Adapter) SyncQuotaMode(ctx context.Context, credential account.Credential, mode string) (account.QuotaWindow, error) {
	if !isConsoleQuotaMode(mode) {
		return account.QuotaWindow{}, fmt.Errorf("不支持的 Console 额度模式 %q", mode)
	}
	windows, _, err := a.syncConsoleQuotas(ctx, credential)
	if err != nil {
		return account.QuotaWindow{}, err
	}
	for _, window := range windows {
		if window.Mode == mode {
			return window, nil
		}
	}
	return account.QuotaWindow{}, fmt.Errorf("Console usage 响应缺少 %s 额度", consoleQuotaKind(mode))
}

func (a *Adapter) syncConsoleQuotas(ctx context.Context, credential account.Credential) ([]account.QuotaWindow, time.Time, error) {
	ssoToken, err := a.cipher.Decrypt(credential.EncryptedAccessToken)
	if err != nil {
		return nil, time.Time{}, err
	}
	requestCtx, cancel := context.WithTimeout(ctx, consoleQuotaTimeout)
	defer cancel()
	lease, err := a.egress.AcquireCredential(requestCtx, egressdomain.ScopeConsole, credential)
	if err != nil {
		return nil, time.Time{}, err
	}
	defer lease.Release()
	endpoint := consoleV1Endpoint(a.config().BaseURL, "/usage")
	response, err := a.doDPoPRequest(requestCtx, credential, ssoToken, lease, http.MethodGet, endpoint, nil, "application/json")
	if err != nil {
		a.egress.FeedbackForScope(context.WithoutCancel(ctx), egressdomain.ScopeConsole, lease.NodeID, 0, err)
		return nil, time.Time{}, err
	}
	data, truncated, readErr := provider.ReadDiagnosticBody(response.Body)
	_ = response.Body.Close()
	if readErr != nil {
		return nil, time.Time{}, readErr
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, time.Time{}, a.consoleUsageStatusError(ctx, response, lease, data, truncated)
	}
	a.egress.FeedbackForScope(context.WithoutCancel(ctx), egressdomain.ScopeConsole, lease.NodeID, response.StatusCode, nil)
	return parseConsoleQuotaWindows(data, credential.ID)
}

// consoleUsageStatusError classifies a failed Console usage response, keeping
// the egress feedback and clearance bookkeeping identical to a success path.
func (a *Adapter) consoleUsageStatusError(ctx context.Context, response *http.Response, lease *infraegress.Lease, data []byte, truncated bool) error {
	if response.StatusCode == http.StatusUnauthorized ||
		(response.StatusCode == http.StatusForbidden && provider.IsDefinitiveAccountBlockBody(data)) {
		return fmt.Errorf("%w: Console usage rejected", provider.ErrUnauthorized)
	}
	dpopRequired := response.StatusCode == http.StatusForbidden && provider.IsDPoPProofRequiredBody(data)
	if response.StatusCode == http.StatusForbidden && shouldInvalidateConsoleClearance(data) {
		lease.InvalidateClearance()
	}
	if !dpopRequired {
		a.egress.FeedbackForScope(context.WithoutCancel(ctx), egressdomain.ScopeConsole, lease.NodeID, response.StatusCode, nil)
	}
	suffix := ""
	if truncated {
		suffix = " (响应已截断)"
	}
	return fmt.Errorf("Console usage 接口返回 %d%s", response.StatusCode, suffix)
}

// parseConsoleQuotaWindows validates the Console usage payload and materializes
// the chat/image/video windows in a stable order.
func parseConsoleQuotaWindows(data []byte, credentialID uint64) ([]account.QuotaWindow, time.Time, error) {
	var payload struct {
		Quotas []struct {
			Kind           string `json:"kind"`
			Limit          int    `json:"limit"`
			Used           int    `json:"used"`
			Remaining      int    `json:"remaining"`
			LastConsumedAt int64  `json:"last_consumed_at"`
		} `json:"quotas"`
	}
	if err := json.Unmarshal(data, &payload); err != nil {
		return nil, time.Time{}, fmt.Errorf("解析 Console usage: %w", err)
	}
	now := time.Now().UTC()
	byMode := make(map[string]account.QuotaWindow, 3)
	for _, quota := range payload.Quotas {
		window, err := consoleQuotaWindow(quota.Kind, quota.Limit, quota.Used, quota.Remaining, credentialID, now)
		if err != nil {
			return nil, time.Time{}, err
		}
		if window != nil {
			byMode[window.Mode] = *window
		}
	}
	windows := make([]account.QuotaWindow, 0, 3)
	for _, mode := range []string{QuotaMode, QuotaModeImage, QuotaModeVideo} {
		window, ok := byMode[mode]
		if !ok {
			return nil, time.Time{}, fmt.Errorf("Console usage 响应缺少 %s 额度", consoleQuotaKind(mode))
		}
		windows = append(windows, window)
	}
	return windows, now, nil
}

// consoleQuotaWindow converts one Console usage entry into a quota window; a
// nil window means the quota kind is not tracked.
func consoleQuotaWindow(kind string, limit, used, remaining int, credentialID uint64, now time.Time) (*account.QuotaWindow, error) {
	mode := consoleQuotaMode(kind)
	if mode == "" {
		return nil, nil
	}
	if limit < 0 || used < 0 || remaining < 0 || remaining > limit {
		return nil, fmt.Errorf("Console %s 额度响应无效", consoleQuotaKind(mode))
	}
	usagePercent := 0.0
	if limit > 0 {
		usagePercent = float64(limit-remaining) / float64(limit) * 100
	}
	windowSeconds := 0
	var resetAt *time.Time
	if mode == QuotaMode {
		windowSeconds = int(consolePredictedChatRecoveryWindow / time.Second)
		if remaining == 0 {
			predicted := now.Add(consolePredictedChatRecoveryWindow)
			resetAt = &predicted
		}
	}
	return &account.QuotaWindow{
		AccountID: credentialID, Mode: mode, Remaining: remaining, Total: limit,
		UsagePercent: usagePercent, WindowSeconds: windowSeconds, ResetAt: resetAt,
		SyncedAt: &now, Source: account.QuotaSourceUpstream, UpdatedAt: now,
	}, nil
}

func isConsoleQuotaMode(mode string) bool {
	return mode == QuotaMode || mode == QuotaModeImage || mode == QuotaModeVideo
}

func consoleQuotaMode(kind string) string {
	switch strings.ToLower(strings.TrimSpace(kind)) {
	case "chat":
		return QuotaMode
	case "image":
		return QuotaModeImage
	case "video":
		return QuotaModeVideo
	default:
		return ""
	}
}

func consoleQuotaKind(mode string) string {
	switch mode {
	case QuotaMode:
		return "chat"
	case QuotaModeImage:
		return "image"
	case QuotaModeVideo:
		return "video"
	default:
		return mode
	}
}

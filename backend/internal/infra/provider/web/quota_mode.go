package web

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/chenyme/grok2api/backend/internal/domain/account"
	domainegress "github.com/chenyme/grok2api/backend/internal/domain/egress"
	infraegress "github.com/chenyme/grok2api/backend/internal/infra/egress"
	"github.com/chenyme/grok2api/backend/internal/ports/provider"
)

func (a *Adapter) SyncQuotaMode(ctx context.Context, credential account.Credential, mode string) (account.QuotaWindow, error) {
	if mode == weeklyQuotaMode {
		return a.syncWeeklyCredits(ctx, credential)
	}
	if account.IsWebImagineQuotaMode(mode) {
		return a.syncImagineQuotaMode(ctx, credential, mode)
	}
	cfg := a.config()
	token, err := a.cipher.Decrypt(credential.EncryptedAccessToken)
	if err != nil {
		return account.QuotaWindow{}, err
	}
	lease, err := a.egress.AcquireCredential(ctx, domainegress.ScopeWeb, credential)
	if err != nil {
		return account.QuotaWindow{}, err
	}
	defer lease.Release()
	payload, _ := json.Marshal(map[string]string{"modelName": mode})
	requestCtx, cancel := context.WithTimeout(ctx, time.Duration(cfg.QuotaTimeoutSeconds)*time.Second)
	defer cancel()
	endpoint := cfg.BaseURL + "/rest/rate-limits"
	response, body, err := a.requestQuotaWithStatsigRetry(ctx, requestCtx, cfg, lease, token, endpoint, payload)
	if err != nil {
		return account.QuotaWindow{}, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		if response.StatusCode == http.StatusUnauthorized {
			return account.QuotaWindow{}, provider.ErrUnauthorized
		}
		if response.StatusCode == http.StatusForbidden && provider.IsDefinitiveAccountBlockBody(body) {
			return account.QuotaWindow{}, fmt.Errorf("%w: account blocked", provider.ErrUnauthorized)
		}
		a.egress.Feedback(context.WithoutCancel(ctx), lease.NodeID, response.StatusCode, nil)
		return account.QuotaWindow{}, fmt.Errorf("Grok Web 额度接口返回 %d", response.StatusCode)
	}
	a.egress.Feedback(context.WithoutCancel(ctx), lease.NodeID, response.StatusCode, nil)
	return parseWebQuotaModeWindow(mode, credential, body)
}

// requestQuotaWithStatsigRetry 发送额度请求；403 命中可刷新签名时最多重放一次。
func (a *Adapter) requestQuotaWithStatsigRetry(ctx context.Context, requestCtx context.Context, cfg Config, lease *infraegress.Lease, token, endpoint string, payload []byte) (*http.Response, []byte, error) {
	var response *http.Response
	var body []byte
	for attempt := 0; attempt < 2; attempt++ {
		request, requestErr := http.NewRequestWithContext(requestCtx, http.MethodPost, endpoint, bytes.NewReader(payload))
		if requestErr != nil {
			return nil, nil, requestErr
		}
		request.Header = buildHeaders(token, lease, "application/json")
		applyAppHeaders(request.Header, cfg.BaseURL, cfg.BaseURL+"/")
		a.applySignedStatsig(requestCtx, request, token, lease)
		var err error
		response, err = lease.DoDeferredForbidden(request)
		if err != nil {
			a.egress.Feedback(context.WithoutCancel(ctx), lease.NodeID, 0, err)
			return nil, nil, err
		}
		body, err = io.ReadAll(io.LimitReader(response.Body, 4<<20))
		_ = response.Body.Close()
		if err != nil {
			return nil, nil, err
		}
		if response.StatusCode == http.StatusForbidden {
			// Preserve definitive account-block signals before a Statsig retry can discard the first response.
			if provider.IsDefinitiveAccountBlockBody(body) {
				return nil, nil, fmt.Errorf("%w: account blocked", provider.ErrUnauthorized)
			}
			lease.InvalidateClearance()
			if attempt == 0 && a.invalidateSignedStatsig(http.MethodPost, endpoint) {
				continue
			}
		}
		break
	}
	return response, body, nil
}

// parseWebQuotaModeWindow 把 /rest/rate-limits 响应解析为账号配额窗口。
func parseWebQuotaModeWindow(mode string, credential account.Credential, body []byte) (account.QuotaWindow, error) {
	var value struct {
		WindowSizeSeconds int `json:"windowSizeSeconds"`
		RemainingQueries  int `json:"remainingQueries"`
		TotalQueries      int `json:"totalQueries"`
	}
	if err := json.Unmarshal(body, &value); err != nil {
		return account.QuotaWindow{}, err
	}
	if value.TotalQueries <= 0 {
		return account.QuotaWindow{}, fmt.Errorf("Grok Web 额度响应缺少 totalQueries")
	}
	if value.WindowSizeSeconds <= 0 {
		value.WindowSizeSeconds = 7200
	}
	now := time.Now().UTC()
	resetAt := now.Add(time.Duration(value.WindowSizeSeconds) * time.Second)
	return account.QuotaWindow{
		AccountID: credential.ID, Mode: mode, Remaining: max(0, value.RemainingQueries), Total: value.TotalQueries,
		WindowSeconds: value.WindowSizeSeconds, ResetAt: &resetAt, SyncedAt: &now, Source: account.QuotaSourceUpstream, UpdatedAt: now,
	}, nil
}

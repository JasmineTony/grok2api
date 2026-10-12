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

// SyncQuotaGroup refreshes the authoritative Web Imagine quota group. The
// upstream endpoint returns every media product in one response, so callers
// must persist the snapshot atomically instead of treating its fields as four
// independent requests.
func (a *Adapter) SyncQuotaGroup(ctx context.Context, credential account.Credential, group string) (provider.QuotaGroupSnapshot, error) {
	if group != account.QuotaGroupWebImagine {
		return provider.QuotaGroupSnapshot{}, fmt.Errorf("unsupported Web quota group %q", group)
	}
	cfg := a.config()
	token, err := a.cipher.Decrypt(credential.EncryptedAccessToken)
	if err != nil {
		return provider.QuotaGroupSnapshot{}, err
	}
	lease, err := a.egress.AcquireCredential(ctx, domainegress.ScopeWeb, credential)
	if err != nil {
		return provider.QuotaGroupSnapshot{}, err
	}
	defer lease.Release()
	body, err := a.fetchImagineQuotaBody(ctx, cfg, token, lease)
	if err != nil {
		return provider.QuotaGroupSnapshot{}, err
	}
	a.egress.Feedback(context.WithoutCancel(ctx), lease.NodeID, http.StatusOK, nil)
	now := time.Now().UTC()
	windows, err := decodeImagineQuotaSnapshot(body, credential.ID, now)
	if err != nil {
		return provider.QuotaGroupSnapshot{}, err
	}
	return provider.QuotaGroupSnapshot{
		Group: account.QuotaGroupWebImagine, Modes: account.WebImagineQuotaModes(), Windows: windows, SyncedAt: now,
	}, nil
}

// fetchImagineQuotaBody 请求 media/unavailable 配额接口并读完响应体，非 2xx 按既有语义报错。
func (a *Adapter) fetchImagineQuotaBody(ctx context.Context, cfg Config, token string, lease *infraegress.Lease) ([]byte, error) {
	endpoint := cfg.BaseURL + "/rest/media/imagine/quota_info"
	requestCtx, cancel := context.WithTimeout(ctx, time.Duration(cfg.QuotaTimeoutSeconds)*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(requestCtx, http.MethodPost, endpoint, bytes.NewReader([]byte("{}")))
	if err != nil {
		return nil, err
	}
	request.Header = buildHeaders(token, lease, "application/json")
	applyAppHeaders(request.Header, cfg.BaseURL, cfg.BaseURL+"/imagine")
	a.applySignedStatsig(requestCtx, request, token, lease)
	response, err := lease.DoDeferredForbidden(request)
	if err != nil {
		a.egress.Feedback(context.WithoutCancel(ctx), lease.NodeID, 0, err)
		return nil, err
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, 4<<20))
	_ = response.Body.Close()
	if err != nil {
		return nil, err
	}
	if response.StatusCode == http.StatusUnauthorized {
		return nil, provider.ErrUnauthorized
	}
	if response.StatusCode == http.StatusForbidden && provider.IsDefinitiveAccountBlockBody(body) {
		return nil, fmt.Errorf("%w: account blocked", provider.ErrUnauthorized)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		a.egress.Feedback(context.WithoutCancel(ctx), lease.NodeID, response.StatusCode, nil)
		return nil, fmt.Errorf("Grok Web Imagine 配额接口返回 %d", response.StatusCode)
	}
	return body, nil
}

type imagineQuotaProduct struct {
	Available         *bool      `json:"available"`
	RemainingQueries  *int       `json:"remainingQueries"`
	WindowSizeSeconds *int       `json:"windowSizeSeconds"`
	NextAvailableAt   *time.Time `json:"nextAvailableAt"`
}

func isImagineQuotaMode(mode string) bool {
	return account.IsWebImagineQuotaMode(mode)
}

func decodeImagineQuotaSnapshot(body []byte, accountID uint64, now time.Time) ([]account.QuotaWindow, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(body, &fields); err != nil {
		return nil, fmt.Errorf("解析 Grok Web Imagine 配额: %w", err)
	}
	// 只解析 JSON 顶层字段，具体产品字段交给 imagineQuotaWindow 校验。
	windows := make([]account.QuotaWindow, 0, 4)
	for _, item := range imagineQuotaProducts() {
		raw, ok := fields[item.field]
		if !ok {
			return nil, fmt.Errorf("Grok Web Imagine 配额响应缺少字段 %s", item.field)
		}
		window, keep, err := imagineQuotaWindow(item.field, item.mode, raw, accountID, now)
		if err != nil {
			return nil, err
		}
		if keep {
			windows = append(windows, window)
		}
	}
	return windows, nil
}

// syncImagineQuotaMode 从 Imagine 配额快照中取指定模式的窗口，付费账号可回退到共享周池。
func (a *Adapter) syncImagineQuotaMode(ctx context.Context, credential account.Credential, mode string) (account.QuotaWindow, error) {
	snapshot, err := a.SyncQuotaGroup(ctx, credential, account.QuotaGroupWebImagine)
	if err != nil {
		return account.QuotaWindow{}, err
	}
	for _, w := range snapshot.Windows {
		if w.Mode == mode {
			return w, nil
		}
	}
	if credential.WebTier == account.WebTierSuper || credential.WebTier == account.WebTierHeavy {
		return a.syncWeeklyCredits(ctx, credential)
	}
	return account.QuotaWindow{}, fmt.Errorf("imagine 配额响应缺少 %s", mode)
}

func imagineQuotaProducts() []struct {
	field string
	mode  string
} {
	return []struct {
		field string
		mode  string
	}{
		{"image", ""}, // lite uses the chat fast/weekly quota path.
		{"imagePro", account.QuotaModeWebImagePro},
		{"imageEdit", account.QuotaModeWebImageEdit},
		{"video", account.QuotaModeWebVideo},
		{"video720p", account.QuotaModeWebVideo720p},
	}
}

// imagineQuotaWindow 把单个 Imagine 产品字段转换为额度窗口。
// 返回 keep=false 表示该产品没有独立的剩余额度窗口，需跳过该行。
func imagineQuotaWindow(field string, mode string, raw json.RawMessage, accountID uint64, now time.Time) (account.QuotaWindow, bool, error) {
	if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return account.QuotaWindow{}, false, nil
	}
	var product imagineQuotaProduct
	if err := json.Unmarshal(raw, &product); err != nil {
		return account.QuotaWindow{}, false, fmt.Errorf("解析 Grok Web Imagine 配额字段 %s: %w", field, err)
	}
	if product.Available == nil {
		return account.QuotaWindow{}, false, fmt.Errorf("Grok Web Imagine 配额字段 %s 结构不完整", field)
	}
	if mode == "" {
		return account.QuotaWindow{}, false, nil
	}
	skipped, err := imagineQuotaProductSkipped(field, product)
	if err != nil {
		return account.QuotaWindow{}, false, err
	}
	if skipped {
		return account.QuotaWindow{}, false, nil
	}
	if *product.Available && product.WindowSizeSeconds == nil {
		return account.QuotaWindow{}, false, fmt.Errorf("Grok Web Imagine 配额字段 %s 结构不完整", field)
	}
	remaining, windowSeconds, err := imagineQuotaProductLimits(field, product)
	if err != nil {
		return account.QuotaWindow{}, false, err
	}
	return account.QuotaWindow{
		AccountID: accountID, Mode: mode, Remaining: remaining, Total: 0,
		WindowSeconds: windowSeconds, ResetAt: imagineQuotaResetAt(product, windowSeconds, now), SyncedAt: &now,
		Source: account.QuotaSourceUpstream, UpdatedAt: now,
	}, true, nil
}

// imagineQuotaProductSkipped 判断该产品是否没有独立额度窗口。
// Paid Web tiers can use the shared weekly pool. For those accounts the
// Imagine endpoint reports only product availability and a window size,
// without an independent remainingQueries counter. Absence of that counter
// means "no product-specific window", not zero remaining quota. Omitting the
// row lets routing use the paid account's weekly window and atomically
// removes any stale per-product counter from an older response shape.
func imagineQuotaProductSkipped(field string, product imagineQuotaProduct) (bool, error) {
	if !*product.Available || product.RemainingQueries != nil {
		return false, nil
	}
	if product.WindowSizeSeconds == nil {
		return false, fmt.Errorf("Grok Web Imagine 配额字段 %s 结构不完整", field)
	}
	if *product.WindowSizeSeconds <= 0 {
		return false, fmt.Errorf("Grok Web Imagine 配额字段 %s 的 windowSizeSeconds 无效", field)
	}
	return true, nil
}

// imagineQuotaProductLimits 读取剩余额度与窗口长度（秒）；窗口长度缺省为一天。
func imagineQuotaProductLimits(field string, product imagineQuotaProduct) (int, int, error) {
	remaining := 0
	if *product.Available && product.RemainingQueries != nil {
		remaining = max(0, *product.RemainingQueries)
	}
	windowSeconds := 86400
	if product.WindowSizeSeconds != nil {
		windowSeconds = *product.WindowSizeSeconds
	}
	if windowSeconds <= 0 {
		return 0, 0, fmt.Errorf("Grok Web Imagine 配额字段 %s 的 windowSizeSeconds 无效", field)
	}
	return remaining, windowSeconds, nil
}

// imagineQuotaResetAt 计算重置时间：显式 nextAvailableAt 优先，否则以观测时间做滚动预测。
func imagineQuotaResetAt(product imagineQuotaProduct, windowSeconds int, now time.Time) *time.Time {
	if product.NextAvailableAt != nil {
		value := product.NextAvailableAt.UTC()
		return &value
	}
	// Imagine exposes the quota-window length but omits its anchor while
	// the product is available. Match Web chat quota semantics by using
	// the observation time as the rolling prediction anchor; every sync
	// replaces this estimate, while an explicit nextAvailableAt wins.
	value := now.Add(time.Duration(windowSeconds) * time.Second)
	return &value
}

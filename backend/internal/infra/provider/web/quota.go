package web

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"time"

	"github.com/chenyme/grok2api/backend/internal/domain/account"
	domainegress "github.com/chenyme/grok2api/backend/internal/domain/egress"
	infraegress "github.com/chenyme/grok2api/backend/internal/infra/egress"
	"github.com/chenyme/grok2api/backend/internal/ports/provider"
	"google.golang.org/protobuf/encoding/protowire"
)

const weeklyQuotaMode = "weekly"

func (a *Adapter) SyncQuota(ctx context.Context, credential account.Credential) (provider.QuotaSnapshot, error) {
	chatWindows := make([]account.QuotaWindow, 0, 2)
	autoWindow, autoErr := a.SyncQuotaMode(ctx, credential, "auto")
	if errors.Is(autoErr, provider.ErrUnauthorized) {
		return provider.QuotaSnapshot{}, autoErr
	}
	if autoErr == nil {
		chatWindows = append(chatWindows, autoWindow)
	}
	fastWindow, fastErr := a.SyncQuotaMode(ctx, credential, "fast")
	if errors.Is(fastErr, provider.ErrUnauthorized) {
		return provider.QuotaSnapshot{}, fastErr
	}
	if fastErr == nil {
		chatWindows = append(chatWindows, fastWindow)
	}
	imagineSnapshot, imagineErr := a.SyncQuotaGroup(ctx, credential, account.QuotaGroupWebImagine)
	if imagineErr != nil {
		// A full refresh replaces every stored window. Never return a partial
		// snapshot, otherwise a transient Imagine failure would erase the last
		// known authoritative media quotas.
		return provider.QuotaSnapshot{}, imagineErr
	}
	if len(chatWindows) > 0 {
		return a.chatQuotaSnapshot(ctx, credential, chatWindows, imagineSnapshot)
	}
	// 模式端点暂不可用时，仅已确认的付费账号允许用 weekly 兜底；
	// Basic/Auto 不能凭周额度探测提权，也不应制造无意义的付费端点流量。
	if credential.WebTier == account.WebTierSuper || credential.WebTier == account.WebTierHeavy {
		return a.paidWeeklyQuotaSnapshot(ctx, credential, imagineSnapshot)
	}
	if fastErr != nil {
		return provider.QuotaSnapshot{}, fastErr
	}
	return provider.QuotaSnapshot{}, autoErr
}

// chatQuotaSnapshot 在拿到模式额度后确定套餐等级，付费账号改为使用权威周池窗口。
func (a *Adapter) chatQuotaSnapshot(ctx context.Context, credential account.Credential, chatWindows []account.QuotaWindow, imagineSnapshot provider.QuotaGroupSnapshot) (provider.QuotaSnapshot, error) {
	tier, _ := resolveWebTierFromQuota(credential.WebTier, chatWindows, false)
	var windows []account.QuotaWindow
	// Basic/未知账号没有付费周池，避免为每次完整同步额外访问付费端点。
	// 只有模式额度已经确认付费等级时才读取 weekly 作为权威额度。
	if tier == account.WebTierSuper || tier == account.WebTierHeavy {
		weekly, weeklyErr := a.syncWeeklyCredits(ctx, credential)
		if weeklyErr != nil {
			// Paid Web routing is governed by the shared weekly pool. Returning a
			// partial successful snapshot would make the application replace and
			// erase the last authoritative weekly window.
			return provider.QuotaSnapshot{}, weeklyErr
		}
		// 周池覆盖 chat 模式窗口，但保留 imagine 窗口供前端展示与触顶判定。
		kept := make([]account.QuotaWindow, 0, 1+len(imagineSnapshot.Windows))
		kept = append(kept, weekly)
		kept = append(kept, imagineSnapshot.Windows...)
		windows = kept
	}
	if windows == nil {
		windows = append(chatWindows, imagineSnapshot.Windows...)
	}
	return provider.QuotaSnapshot{Tier: tier, Windows: windows, SyncedAt: time.Now().UTC()}, nil
}

// paidWeeklyQuotaSnapshot 用权威周池构造快照，失败时按原语义返回错误而不返回部分快照。
func (a *Adapter) paidWeeklyQuotaSnapshot(ctx context.Context, credential account.Credential, imagineSnapshot provider.QuotaGroupSnapshot) (provider.QuotaSnapshot, error) {
	weekly, weeklyErr := a.syncWeeklyCredits(ctx, credential)
	if weeklyErr != nil {
		return provider.QuotaSnapshot{}, weeklyErr
	}
	kept := append([]account.QuotaWindow{weekly}, imagineSnapshot.Windows...)
	return provider.QuotaSnapshot{Tier: credential.WebTier, Windows: kept, SyncedAt: time.Now().UTC()}, nil
}

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

func resolveWebTierFromQuota(current account.WebTier, windows []account.QuotaWindow, weeklyAvailable bool) (account.WebTier, bool) {
	if len(windows) > 0 {
		tier, known := inferWebTierFromQuota(windows)
		if !known {
			// 上游可能随时调整额度。无法识别的新形态保持 Auto，并由路由层
			// 按 Basic 的最小权限处理；不能伪造一个已确认的套餐等级。
			return account.WebTierAuto, false
		}
		return tier, weeklyAvailable && tier != account.WebTierBasic
	}
	// 周额度是付费账号信号，但无法区分 Super/Heavy。已确认的等级在模式
	// 额度暂时不可用时保留；未确认（Auto/Basic）的不能凭周额度提权。
	if current == account.WebTierHeavy || current == account.WebTierSuper {
		return current, weeklyAvailable
	}
	return current, false
}

// inferWebTierFromQuota 使用 Grok Web /rest/rate-limits 的真实额度形态判级。
// 同一快照出现矛盾信号时选择较低等级，避免把 Basic 账号路由到付费能力。
func inferWebTierFromQuota(windows []account.QuotaWindow) (account.WebTier, bool) {
	detected := account.WebTierAuto
	rank := map[account.WebTier]int{
		account.WebTierBasic: 1,
		account.WebTierSuper: 2,
		account.WebTierHeavy: 3,
	}
	for _, window := range windows {
		candidate := account.WebTierAuto
		switch window.Mode {
		case "auto":
			switch window.Total {
			case 7, 20:
				candidate = account.WebTierBasic
			case 50:
				candidate = account.WebTierSuper
			case 150:
				candidate = account.WebTierHeavy
			}
		case "fast":
			switch window.Total {
			case 30:
				candidate = account.WebTierBasic
			case 140:
				candidate = account.WebTierSuper
			case 400:
				candidate = account.WebTierHeavy
			}
		case "heavy":
			if window.Total > 0 {
				candidate = account.WebTierHeavy
			}
		}
		if candidate != account.WebTierAuto && (detected == account.WebTierAuto || rank[candidate] < rank[detected]) {
			detected = candidate
		}
	}
	return detected, detected != account.WebTierAuto
}

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

func (a *Adapter) syncWeeklyCredits(ctx context.Context, credential account.Credential) (account.QuotaWindow, error) {
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

	// 取消函数必须由调用方在读完响应体后再调用，否则会中断流式读取。
	response, cancel, requestErr := a.requestWeeklyCredits(ctx, cfg, token, lease)
	defer cancel()
	if requestErr != nil {
		return account.QuotaWindow{}, requestErr
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 4<<20))
	if err != nil {
		return account.QuotaWindow{}, err
	}
	if err := a.validateWeeklyCreditsResponse(ctx, lease, response, body); err != nil {
		return account.QuotaWindow{}, err
	}
	window, err := parseWeeklyCreditsResponse(body, credential.ID, time.Now().UTC())
	if err != nil {
		return account.QuotaWindow{}, err
	}
	a.egress.Feedback(context.WithoutCancel(ctx), lease.NodeID, response.StatusCode, nil)
	return window, nil
}

// requestWeeklyCredits 发送 gRPC-Web 周额度请求并返回响应，错误时回报出口健康。
func (a *Adapter) requestWeeklyCredits(ctx context.Context, cfg Config, token string, lease *infraegress.Lease) (*http.Response, context.CancelFunc, error) {
	requestCtx, cancel := context.WithTimeout(ctx, time.Duration(cfg.QuotaTimeoutSeconds)*time.Second)
	endpoint := cfg.BaseURL + "/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig"
	request, err := http.NewRequestWithContext(requestCtx, http.MethodPost, endpoint, bytes.NewReader([]byte{0, 0, 0, 0, 0}))
	if err != nil {
		cancel()
		return nil, nil, err
	}
	request.Header = buildHeaders(token, lease, "application/grpc-web+proto")
	applyAppHeaders(request.Header, cfg.BaseURL, cfg.BaseURL+"/")
	request.Header.Del("x-xai-request-id")
	request.Header.Set("x-grpc-web", "1")
	request.Header.Set("x-user-agent", "connect-es/2.1.1")
	response, err := lease.DoDeferredForbidden(request)
	if err != nil {
		a.egress.Feedback(context.WithoutCancel(ctx), lease.NodeID, 0, err)
		cancel()
		return nil, nil, err
	}
	return response, cancel, nil
}

// validateWeeklyCreditsResponse 把非 2xx 状态映射为既有错误语义，并上报出口健康。
func (a *Adapter) validateWeeklyCreditsResponse(ctx context.Context, lease *infraegress.Lease, response *http.Response, body []byte) error {
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		if response.StatusCode == http.StatusUnauthorized {
			return provider.ErrUnauthorized
		}
		if response.StatusCode == http.StatusForbidden && provider.IsDefinitiveAccountBlockBody(body) {
			return fmt.Errorf("%w: account blocked", provider.ErrUnauthorized)
		}
		if response.StatusCode == http.StatusForbidden {
			lease.InvalidateClearance()
		}
		a.egress.Feedback(context.WithoutCancel(ctx), lease.NodeID, response.StatusCode, nil)
		return fmt.Errorf("Grok Web 周额度接口返回 %d", response.StatusCode)
	}
	return nil
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

// weeklyCreditsFields 汇总周额度 protobuf 的解析中间结果。
type weeklyCreditsFields struct {
	usagePercent float64
	usagePresent bool
	periodStart  *time.Time
	periodEnd    *time.Time
	breakdown    []account.QuotaBreakdown
}

// decodeWeeklyCreditsField 解析单个周额度 protobuf 字段并写入中间结果，
// 返回剩余待解析字节与是否命中已知字段。
func decodeWeeklyCreditsField(fields *weeklyCreditsFields, number protowire.Number, fieldType protowire.Type, config []byte) (int, error) {
	switch {
	case number == 1 && fieldType == protowire.Fixed32Type:
		value, consumed := protowire.ConsumeFixed32(config)
		if consumed < 0 {
			return 0, fmt.Errorf("周额度使用率无效")
		}
		fields.usagePercent = float64(math.Float32frombits(value))
		fields.usagePresent = true
		return consumed, nil
	case (number == 4 || number == 5) && fieldType == protowire.BytesType:
		value, consumed := protowire.ConsumeBytes(config)
		if consumed < 0 {
			return 0, fmt.Errorf("周额度周期无效")
		}
		parsed, parseErr := parseProtoTimestamp(value)
		if parseErr != nil {
			return 0, parseErr
		}
		if number == 4 {
			fields.periodStart = &parsed
		} else {
			fields.periodEnd = &parsed
		}
		return consumed, nil
	case number == 7 && fieldType == protowire.BytesType:
		value, consumed := protowire.ConsumeBytes(config)
		if consumed < 0 {
			return 0, fmt.Errorf("周额度产品分解无效")
		}
		if item, ok := parseQuotaBreakdown(value); ok {
			fields.breakdown = append(fields.breakdown, item)
		}
		return consumed, nil
	default:
		consumed := protowire.ConsumeFieldValue(number, fieldType, config)
		if consumed < 0 {
			return 0, fmt.Errorf("周额度 protobuf 字段无效")
		}
		return consumed, nil
	}
}

// decodeWeeklyCreditsConfig 按字段号遍历周额度 protobuf 配置，遇到非法编码立即报错。
func decodeWeeklyCreditsConfig(config []byte) (weeklyCreditsFields, error) {
	fields := weeklyCreditsFields{breakdown: make([]account.QuotaBreakdown, 0, 8)}
	for len(config) > 0 {
		number, fieldType, n := protowire.ConsumeTag(config)
		if n < 0 {
			return weeklyCreditsFields{}, fmt.Errorf("周额度 protobuf tag 无效")
		}
		config = config[n:]
		consumed, err := decodeWeeklyCreditsField(&fields, number, fieldType, config)
		if err != nil {
			return weeklyCreditsFields{}, err
		}
		config = config[consumed:]
	}
	return fields, nil
}

// weeklyCreditsWindowSeconds 校验周期并返回窗口长度（秒）。
func weeklyCreditsWindowSeconds(fields weeklyCreditsFields) (int, error) {
	if fields.usagePresent && (math.IsNaN(fields.usagePercent) || math.IsInf(fields.usagePercent, 0) || fields.usagePercent < 0 || fields.usagePercent > 100) {
		return 0, fmt.Errorf("Grok Web 周额度响应缺少有效使用率")
	}
	if fields.periodStart == nil || fields.periodEnd == nil || !fields.periodEnd.After(*fields.periodStart) {
		return 0, fmt.Errorf("Grok Web 周额度响应缺少有效周期")
	}
	if !fields.usagePresent && fields.periodStart.Nanosecond() == 0 && fields.periodEnd.Nanosecond() == 0 {
		// Free accounts return a coarse entitlement period without a usage rate.
		// A paid, unused weekly pool has the same rate omitted but retains its
		// precise period boundaries, which represents zero percent used.
		return 0, fmt.Errorf("Grok Web 周额度响应缺少有效使用率")
	}
	windowSeconds := int(fields.periodEnd.Sub(*fields.periodStart).Seconds())
	if windowSeconds < 24*60*60 || windowSeconds > 31*24*60*60 {
		return 0, fmt.Errorf("Grok Web 周额度周期长度异常")
	}
	return windowSeconds, nil
}

func parseWeeklyCreditsResponse(body []byte, accountID uint64, syncedAt time.Time) (account.QuotaWindow, error) {
	payload, err := firstGRPCWebMessage(body)
	if err != nil {
		return account.QuotaWindow{}, err
	}
	config, err := protobufMessageField(payload, 1)
	if err != nil {
		return account.QuotaWindow{}, fmt.Errorf("解析 Grok Web 周额度响应: %w", err)
	}
	fields, err := decodeWeeklyCreditsConfig(config)
	if err != nil {
		return account.QuotaWindow{}, err
	}
	windowSeconds, err := weeklyCreditsWindowSeconds(fields)
	if err != nil {
		return account.QuotaWindow{}, err
	}
	usedBasisPoints := int(math.Round(fields.usagePercent * 100))
	return account.QuotaWindow{
		AccountID: accountID, Mode: weeklyQuotaMode, Remaining: max(0, 10000-usedBasisPoints), Total: 10000,
		UsagePercent: fields.usagePercent, Breakdown: fields.breakdown, WindowSeconds: windowSeconds,
		ResetAt: fields.periodEnd, SyncedAt: &syncedAt, Source: account.QuotaSourceUpstream, UpdatedAt: syncedAt,
	}, nil
}

func firstGRPCWebMessage(body []byte) ([]byte, error) {
	message, grpcStatus, err := parseGRPCWebFrames(body)
	if err != nil {
		return nil, err
	}
	if grpcStatus != "" && grpcStatus != "0" {
		return nil, fmt.Errorf("Grok Web 周额度 gRPC 状态为 %s", grpcStatus)
	}
	if message == nil {
		return nil, fmt.Errorf("Grok Web 周额度响应缺少消息帧")
	}
	return message, nil
}

func parseGRPCWebFrames(body []byte) ([]byte, string, error) {
	var message []byte
	grpcStatus := ""
	for len(body) > 0 {
		if len(body) < 5 {
			return nil, "", fmt.Errorf("gRPC-Web 响应包含不完整帧头")
		}
		flag := body[0]
		length := int(binary.BigEndian.Uint32(body[1:5]))
		body = body[5:]
		if length < 0 || length > len(body) {
			return nil, "", fmt.Errorf("gRPC-Web 帧长度无效")
		}
		payload := body[:length]
		body = body[length:]
		if flag&0x80 == 0 {
			if flag != 0 {
				return nil, "", fmt.Errorf("不支持压缩的 gRPC-Web 响应")
			}
			if message == nil {
				message = append([]byte(nil), payload...)
			}
			continue
		}
		for _, line := range bytes.Split(payload, []byte{'\n'}) {
			name, value, ok := bytes.Cut(bytes.TrimSpace(line), []byte{':'})
			if ok && string(bytes.ToLower(bytes.TrimSpace(name))) == "grpc-status" {
				grpcStatus = string(bytes.TrimSpace(value))
			}
		}
	}
	return message, grpcStatus, nil
}

func protobufMessageField(message []byte, target protowire.Number) ([]byte, error) {
	for len(message) > 0 {
		number, fieldType, n := protowire.ConsumeTag(message)
		if n < 0 {
			return nil, fmt.Errorf("protobuf tag 无效")
		}
		message = message[n:]
		if number == target && fieldType == protowire.BytesType {
			value, consumed := protowire.ConsumeBytes(message)
			if consumed < 0 {
				return nil, fmt.Errorf("protobuf message 无效")
			}
			return value, nil
		}
		consumed := protowire.ConsumeFieldValue(number, fieldType, message)
		if consumed < 0 {
			return nil, fmt.Errorf("protobuf 字段无效")
		}
		message = message[consumed:]
	}
	return nil, fmt.Errorf("protobuf 缺少字段 %d", target)
}

func parseProtoTimestamp(message []byte) (time.Time, error) {
	var seconds int64
	var nanos int32
	for len(message) > 0 {
		number, fieldType, n := protowire.ConsumeTag(message)
		if n < 0 {
			return time.Time{}, fmt.Errorf("protobuf timestamp tag 无效")
		}
		message = message[n:]
		if fieldType == protowire.VarintType && (number == 1 || number == 2) {
			value, consumed := protowire.ConsumeVarint(message)
			if consumed < 0 {
				return time.Time{}, fmt.Errorf("protobuf timestamp 值无效")
			}
			if number == 1 {
				seconds = int64(value)
			} else {
				nanos = int32(value)
			}
			message = message[consumed:]
			continue
		}
		consumed := protowire.ConsumeFieldValue(number, fieldType, message)
		if consumed < 0 {
			return time.Time{}, fmt.Errorf("protobuf timestamp 字段无效")
		}
		message = message[consumed:]
	}
	if seconds <= 0 || nanos < 0 || nanos >= int32(time.Second) {
		return time.Time{}, fmt.Errorf("protobuf timestamp 范围无效")
	}
	return time.Unix(seconds, int64(nanos)).UTC(), nil
}

func parseQuotaBreakdown(message []byte) (account.QuotaBreakdown, bool) {
	var result account.QuotaBreakdown
	var codePresent bool
	for len(message) > 0 {
		number, fieldType, n := protowire.ConsumeTag(message)
		if n < 0 {
			return account.QuotaBreakdown{}, false
		}
		message = message[n:]
		switch {
		case number == 1 && fieldType == protowire.VarintType:
			value, consumed := protowire.ConsumeVarint(message)
			if consumed < 0 {
				return account.QuotaBreakdown{}, false
			}
			result.ProductCode = int(value)
			codePresent = true
			message = message[consumed:]
		case number == 2 && fieldType == protowire.Fixed32Type:
			value, consumed := protowire.ConsumeFixed32(message)
			if consumed < 0 {
				return account.QuotaBreakdown{}, false
			}
			result.UsagePercent = float64(math.Float32frombits(value))
			message = message[consumed:]
		default:
			consumed := protowire.ConsumeFieldValue(number, fieldType, message)
			if consumed < 0 {
				return account.QuotaBreakdown{}, false
			}
			message = message[consumed:]
		}
	}
	if !codePresent || result.ProductCode < 0 || result.UsagePercent < 0 || result.UsagePercent > 100 || math.IsNaN(result.UsagePercent) || math.IsInf(result.UsagePercent, 0) {
		return account.QuotaBreakdown{}, false
	}
	return result, true
}

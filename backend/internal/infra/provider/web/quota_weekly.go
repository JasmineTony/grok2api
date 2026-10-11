package web

import (
	"bytes"
	"context"
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

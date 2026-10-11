package console

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/chenyme/grok2api/backend/internal/domain/account"
	egressdomain "github.com/chenyme/grok2api/backend/internal/domain/egress"
	mediadomain "github.com/chenyme/grok2api/backend/internal/domain/media"
	infraegress "github.com/chenyme/grok2api/backend/internal/infra/egress"
	"github.com/chenyme/grok2api/backend/internal/ports/provider"
)

func (a *Adapter) localizeConsoleImageResponse(ctx context.Context, credential account.Credential, baseURL string, data []byte) ([]byte, error) {
	if a.assets == nil {
		return nil, provider.NewMediaPostProcessingError(provider.MediaPostProcessingStorage, errors.New("图片媒体存储未配置"))
	}
	var envelope map[string]json.RawMessage
	if err := json.Unmarshal(data, &envelope); err != nil {
		return nil, provider.NewMediaPostProcessingError(provider.MediaPostProcessingDownload, fmt.Errorf("解析 Console 图片响应: %w", err))
	}
	var items []map[string]json.RawMessage
	if err := json.Unmarshal(envelope["data"], &items); err != nil || len(items) == 0 || len(items) > 10 {
		return nil, provider.NewMediaPostProcessingError(provider.MediaPostProcessingDownload, errors.New("Console 图片响应缺少有效 data"))
	}

	for index, item := range items {
		var rawURL string
		if err := json.Unmarshal(item["url"], &rawURL); err != nil || strings.TrimSpace(rawURL) == "" {
			return nil, provider.NewMediaPostProcessingError(provider.MediaPostProcessingDownload, fmt.Errorf("Console 图片响应第 %d 项缺少 URL", index+1))
		}
		raw, err := a.downloadConsoleImage(ctx, credential, baseURL, rawURL)
		if err != nil {
			return nil, provider.NewMediaPostProcessingError(provider.MediaPostProcessingDownload, err)
		}
		asset, err := a.saveConsoleImage(ctx, raw)
		if err != nil {
			return nil, provider.NewMediaPostProcessingError(provider.MediaPostProcessingStorage, err)
		}
		items[index]["url"], _ = json.Marshal(a.assets.PublicImageURL(asset.ID))
		items[index]["mime_type"], _ = json.Marshal(asset.MIMEType)
	}
	encodedItems, err := json.Marshal(items)
	if err != nil {
		return nil, provider.NewMediaPostProcessingError(provider.MediaPostProcessingStorage, err)
	}
	envelope["data"] = encodedItems
	encoded, err := json.Marshal(envelope)
	if err != nil {
		return nil, provider.NewMediaPostProcessingError(provider.MediaPostProcessingStorage, err)
	}
	return encoded, nil
}

func (a *Adapter) downloadConsoleImage(ctx context.Context, credential account.Credential, baseURL, rawURL string) ([]byte, error) {
	parsed, err := trustedConsoleImageURL(rawURL, baseURL)
	if err != nil {
		return nil, err
	}
	downloadCtx, cancel := context.WithTimeout(ctx, consoleImageDownloadTimeout)
	defer cancel()
	var lastErr error
	for attempt := 0; attempt < consoleMediaOutputAttempts; attempt++ {
		raw, retryable, attemptErr := a.downloadConsoleImageAttempt(downloadCtx, credential, baseURL, parsed.String())
		if attemptErr == nil {
			return raw, nil
		}
		lastErr = attemptErr
		if !retryable || downloadCtx.Err() != nil || attempt+1 >= consoleMediaOutputAttempts {
			break
		}
		if err := waitConsoleMediaRetry(downloadCtx, attempt); err != nil {
			return nil, err
		}
	}
	return nil, lastErr
}

func (a *Adapter) downloadConsoleImageAttempt(ctx context.Context, credential account.Credential, baseURL, rawURL string) ([]byte, bool, error) {
	lease, err := a.egress.AcquireCredential(ctx, egressdomain.ScopeConsoleAsset, credential)
	if err != nil {
		return nil, true, err
	}
	defer lease.Release()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, false, err
	}
	request.Header.Set("Accept", "image/*,*/*;q=0.8")
	userAgent := strings.TrimSpace(lease.UserAgent)
	if userAgent == "" {
		userAgent = infraegress.DefaultUserAgent
	}
	request.Header.Set("User-Agent", userAgent)
	response, err := lease.DoDeferredForbidden(request)
	if err != nil {
		a.egress.FeedbackForScope(context.WithoutCancel(ctx), egressdomain.ScopeConsoleAsset, lease.NodeID, 0, err)
		return nil, ctx.Err() == nil, fmt.Errorf("下载 Console 图片: %w", err)
	}
	defer response.Body.Close()
	// 标准 net/http 响应会保留最终请求 URL；兼容不填充 Request 的自定义出口客户端时，
	// 初始 URL 已在发起请求前完成校验。若存在最终 URL，则额外检查重定向目标。
	if response.Request != nil && response.Request.URL != nil {
		if _, err := trustedConsoleImageURL(response.Request.URL.String(), baseURL); err != nil {
			return nil, false, errors.New("Console 图片下载重定向到不受信任的地址")
		}
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		retryable := response.StatusCode == http.StatusRequestTimeout || response.StatusCode == http.StatusTooEarly || response.StatusCode == http.StatusTooManyRequests || response.StatusCode >= 500
		a.egress.FeedbackForScope(context.WithoutCancel(ctx), egressdomain.ScopeConsoleAsset, lease.NodeID, response.StatusCode, nil)
		return nil, retryable, fmt.Errorf("下载 Console 图片返回 %d", response.StatusCode)
	}
	contentType := strings.ToLower(strings.TrimSpace(strings.Split(response.Header.Get("Content-Type"), ";")[0]))
	if contentType != "" && contentType != "application/octet-stream" && !strings.HasPrefix(contentType, "image/") {
		return nil, false, errors.New("Console 图片 Content-Type 无效")
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, consoleImageBodyLimit+1))
	if err != nil {
		return nil, ctx.Err() == nil, fmt.Errorf("读取 Console 图片: %w", err)
	}
	if len(raw) == 0 || len(raw) > consoleImageBodyLimit {
		return nil, false, errors.New("Console 图片为空或超过 32 MiB")
	}
	a.egress.FeedbackForScope(context.WithoutCancel(ctx), egressdomain.ScopeConsoleAsset, lease.NodeID, response.StatusCode, nil)
	return raw, false, nil
}

func (a *Adapter) saveConsoleImage(ctx context.Context, raw []byte) (asset mediadomain.Asset, err error) {
	for attempt := 0; attempt < consoleMediaOutputAttempts; attempt++ {
		asset, err = a.assets.SaveImage(ctx, raw)
		if err == nil || ctx.Err() != nil || attempt+1 >= consoleMediaOutputAttempts {
			return asset, err
		}
		if err = waitConsoleMediaRetry(ctx, attempt); err != nil {
			return mediadomain.Asset{}, err
		}
	}
	return asset, err
}

func trustedConsoleImageURL(rawURL, baseURL string) (*url.URL, error) {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || parsed.User != nil || parsed.Hostname() == "" {
		return nil, errors.New("Console 图片内容 URL 不受信任")
	}
	if parsed.Scheme == "https" && trustedConsoleImageHost(parsed.Hostname()) {
		return parsed, nil
	}
	base, baseErr := url.Parse(strings.TrimSpace(baseURL))
	if baseErr == nil && base.User == nil && strings.EqualFold(parsed.Scheme, base.Scheme) && strings.EqualFold(parsed.Host, base.Host) && (parsed.Scheme == "http" || parsed.Scheme == "https") {
		return parsed, nil
	}
	return nil, errors.New("Console 图片内容 URL 不受信任")
}

func trustedConsoleImageHost(host string) bool {
	return strings.EqualFold(host, "assets.grok.com") || strings.EqualFold(host, "imagine-public.x.ai") || strings.EqualFold(host, "imgen.x.ai")
}

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
	"time"

	"github.com/chenyme/grok2api/backend/internal/domain/account"
	egressdomain "github.com/chenyme/grok2api/backend/internal/domain/egress"
	infraegress "github.com/chenyme/grok2api/backend/internal/infra/egress"
	providerregistry "github.com/chenyme/grok2api/backend/internal/infra/provider"
	"github.com/chenyme/grok2api/backend/internal/ports/provider"
)

func (a *Adapter) GenerateVideo(ctx context.Context, request provider.VideoRequest) (provider.VideoResult, error) {
	modelName, operation, err := resolveConsoleVideoOperation(request)
	if err != nil {
		return provider.VideoResult{}, err
	}
	firstFrames, referenceImages := consoleVideoImageCounts(request)
	if firstFrames > consoleMaxVideoFirstFrames {
		return provider.VideoResult{}, fmt.Errorf("Console %s 最多支持 %d 张首帧图，当前为 %d 张", modelName, consoleMaxVideoFirstFrames, firstFrames)
	}
	if referenceImages > provider.ConsoleVideoMaxReferenceImages {
		return provider.VideoResult{}, fmt.Errorf("Console %s 最多支持 %d 张参考图，当前为 %d 张", modelName, provider.ConsoleVideoMaxReferenceImages, referenceImages)
	}
	duration, err := consoleVideoDuration(operation, modelName, referenceImages, request.Duration)
	if err != nil {
		return provider.VideoResult{}, err
	}
	if err := validateConsoleVideoResolution(modelName, request.Resolution, len(request.ReferenceURLs) > 0); err != nil {
		return provider.VideoResult{}, err
	}
	payload, err := consoleVideoPayload(modelName, operation, request, duration)
	if err != nil {
		return provider.VideoResult{}, err
	}
	return a.submitConsoleVideo(ctx, request, operation, payload)
}

// submitConsoleVideo 提交视频创建请求并进入轮询，租约在整个轮询期间保持占用。
func (a *Adapter) submitConsoleVideo(ctx context.Context, request provider.VideoRequest, operation provider.VideoOperation, payload map[string]any) (provider.VideoResult, error) {
	token, err := a.cipher.Decrypt(request.Credential.EncryptedAccessToken)
	if err != nil {
		return provider.VideoResult{}, err
	}
	lease, err := a.egress.AcquireCredential(ctx, egressdomain.ScopeConsole, request.Credential)
	if err != nil {
		return provider.VideoResult{}, err
	}
	defer lease.Release()
	body, err := json.Marshal(payload)
	if err != nil {
		return provider.VideoResult{}, err
	}
	baseURL := a.config().BaseURL
	createPath := "/videos/generations"
	switch operation {
	case provider.VideoOperationEdit:
		createPath = "/videos/edits"
	case provider.VideoOperationExtend:
		createPath = "/videos/extensions"
	}
	created, err := a.doConsoleVideoJSON(ctx, request.Credential, token, lease, http.MethodPost, consoleV1Endpoint(baseURL, createPath), body)
	if err != nil {
		return provider.VideoResult{}, provider.WrapVideoStage(provider.VideoCreateFailureStage(err), 0, err)
	}
	requestID, err := parseConsoleVideoCreate(created)
	if err != nil {
		return provider.VideoResult{}, provider.WrapVideoStage(provider.VideoStageSubmitted, 0, err)
	}
	if request.Progress != nil {
		request.Progress(1)
	}
	return a.pollConsoleVideo(ctx, request, token, lease, baseURL, requestID)
}

// pollConsoleVideo 按固定间隔轮询视频状态直到完成或上下文结束。
func (a *Adapter) pollConsoleVideo(ctx context.Context, request provider.VideoRequest, token string, lease *infraegress.Lease, baseURL, requestID string) (provider.VideoResult, error) {
	ticker := time.NewTicker(consoleVideoPollEvery)
	defer ticker.Stop()
	for {
		statusBody, pollErr := a.doConsoleVideoJSON(ctx, request.Credential, token, lease, http.MethodGet, consoleV1Endpoint(baseURL, "/videos/"+url.PathEscape(requestID)), nil)
		if pollErr != nil {
			return provider.VideoResult{}, provider.WrapVideoStage(provider.VideoStagePoll, 0, pollErr)
		}
		result, done, parseErr := parseConsoleVideoStatus(statusBody, request.Progress)
		if parseErr != nil {
			return provider.VideoResult{}, provider.WrapVideoStage(provider.VideoStagePoll, 0, parseErr)
		}
		if done {
			return result, nil
		}
		select {
		case <-ctx.Done():
			return provider.VideoResult{}, ctx.Err()
		case <-ticker.C:
		}
	}
}

func (a *Adapter) doConsoleVideoJSON(ctx context.Context, credential account.Credential, token string, lease *infraegress.Lease, method, endpoint string, body []byte) ([]byte, error) {
	requestCtx := ctx
	cancel := func() {}
	if timeout := a.config().TimeoutSeconds; timeout > 0 {
		requestCtx, cancel = context.WithTimeout(ctx, time.Duration(timeout)*time.Second)
	}
	defer cancel()
	response, err := a.doDPoPRequest(requestCtx, credential, token, lease, method, endpoint, body, "application/json")
	if err != nil {
		a.egress.FeedbackForScope(context.WithoutCancel(ctx), egressdomain.ScopeConsole, lease.NodeID, 0, err)
		return nil, err
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, consoleMediaBodyLimit+1))
	if err != nil {
		return nil, err
	}
	if len(data) > consoleMediaBodyLimit {
		return nil, errors.New("Console 视频上游响应超过 2 MiB")
	}
	if response.StatusCode == http.StatusUnauthorized {
		return nil, provider.ErrUnauthorized
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		dpopRequired := response.StatusCode == http.StatusForbidden && provider.IsDPoPProofRequiredBody(data)
		if response.StatusCode == http.StatusForbidden && shouldInvalidateConsoleClearance(data) {
			lease.InvalidateClearance()
		}
		if !dpopRequired {
			a.egress.FeedbackForScope(context.WithoutCancel(ctx), egressdomain.ScopeConsole, lease.NodeID, response.StatusCode, nil)
		}
		return nil, newConsoleMediaUpstreamError(response.StatusCode, data, parseConsoleRetryAfterHeader(response.Header.Get("Retry-After"), time.Now().UTC()))
	}
	a.egress.FeedbackForScope(context.WithoutCancel(ctx), egressdomain.ScopeConsole, lease.NodeID, response.StatusCode, nil)
	return data, nil
}

func (a *Adapter) DownloadVideo(ctx context.Context, credential account.Credential, rawURL string) (io.ReadCloser, string, int64, error) {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || parsed.Scheme != "https" || parsed.User != nil || !trustedConsoleVideoHost(parsed.Hostname()) {
		return nil, "", 0, errors.New("Console 视频内容 URL 不受信任")
	}
	lease, err := a.egress.AcquireCredential(ctx, egressdomain.ScopeConsoleAsset, credential)
	if err != nil {
		return nil, "", 0, err
	}
	request, err := consoleVideoDownloadRequest(ctx, lease, parsed.String())
	if err != nil {
		lease.Release()
		return nil, "", 0, err
	}
	response, err := lease.DoDeferredForbidden(request)
	if err != nil {
		a.egress.FeedbackForScope(context.WithoutCancel(ctx), egressdomain.ScopeConsoleAsset, lease.NodeID, 0, err)
		lease.Release()
		return nil, "", 0, err
	}
	contentType, err := a.prepareConsoleVideoDownload(ctx, lease, response)
	if err != nil {
		return nil, "", 0, err
	}
	onFinished := func(readErr error, complete bool) {
		if readErr != nil {
			a.egress.FeedbackForScope(context.WithoutCancel(ctx), egressdomain.ScopeConsoleAsset, lease.NodeID, 0, readErr)
		} else if complete {
			a.egress.FeedbackForScope(context.WithoutCancel(ctx), egressdomain.ScopeConsoleAsset, lease.NodeID, response.StatusCode, nil)
		}
		lease.Release()
	}
	return providerregistry.NewCompletionReadCloser(response.Body, onFinished), contentType, response.ContentLength, nil
}

// consoleVideoDownloadRequest 构造视频下载请求，用户代理沿用出口租约的既有回退规则。
func consoleVideoDownloadRequest(ctx context.Context, lease *infraegress.Lease, rawURL string) (*http.Request, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Accept", "video/*,*/*;q=0.8")
	userAgent := strings.TrimSpace(lease.UserAgent)
	if userAgent == "" {
		userAgent = infraegress.DefaultUserAgent
	}
	request.Header.Set("User-Agent", userAgent)
	return request, nil
}

// prepareConsoleVideoDownload 校验视频下载响应；失败时按原顺序关闭响应体、反馈出口状态并释放租约。
func (a *Adapter) prepareConsoleVideoDownload(ctx context.Context, lease *infraegress.Lease, response *http.Response) (string, error) {
	if response.Request != nil && response.Request.URL != nil {
		finalURL := response.Request.URL
		if finalURL.Scheme != "https" || finalURL.User != nil || !trustedConsoleVideoHost(finalURL.Hostname()) {
			_ = response.Body.Close()
			lease.Release()
			return "", errors.New("Console 视频下载重定向到不受信任的地址")
		}
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		_ = response.Body.Close()
		a.egress.FeedbackForScope(context.WithoutCancel(ctx), egressdomain.ScopeConsoleAsset, lease.NodeID, response.StatusCode, nil)
		lease.Release()
		return "", fmt.Errorf("下载 Console 视频返回 %d", response.StatusCode)
	}
	contentType := strings.ToLower(strings.TrimSpace(strings.Split(response.Header.Get("Content-Type"), ";")[0]))
	if contentType == "" || contentType == "application/octet-stream" {
		contentType = "video/mp4"
	}
	if !strings.HasPrefix(contentType, "video/") {
		_ = response.Body.Close()
		lease.Release()
		return "", errors.New("Console 视频 Content-Type 无效")
	}
	return contentType, nil
}

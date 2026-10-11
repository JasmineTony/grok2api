package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/chenyme/grok2api/backend/internal/domain/account"
	infraegress "github.com/chenyme/grok2api/backend/internal/infra/egress"
	"github.com/chenyme/grok2api/backend/internal/ports/provider"
)

// GenerateVideo 通过 Build OAuth 创建并轮询视频任务；对外仍使用 grok-imagine-video-1.5，
// 发往 XAI 时仅在出站协议层转换为官方 preview 模型与 image/reference_images 结构。
// image = 首帧；reference_images = 参考图（即使只有 1 张也不升格为 image）。超过网关上限时失败，不静默截断。
// 显式模式优先；auto 下仅已确认 Super 且 bot_flag_source/bfs 为 1 或 2 默认使用 XAI。
// 其他 auto Super 账号仅在当次 Build 创建返回 403 后探测 XAI。
func (a *Adapter) GenerateVideo(ctx context.Context, request provider.VideoRequest) (provider.VideoResult, error) {
	if total := buildVideoImageCount(request); total > buildVideoMaxImages {
		return provider.VideoResult{}, provider.WrapVideoStage(provider.VideoStagePrepare, 0, fmt.Errorf("Build grok-imagine-video-1.5 最多支持 %d 张输入图，当前为 %d 张", buildVideoMaxImages, total))
	}
	accessToken, err := a.cipher.Decrypt(request.Credential.EncryptedAccessToken)
	if err != nil {
		return provider.VideoResult{}, provider.WrapVideoStage(provider.VideoStagePrepare, 0, err)
	}
	credential := request.Credential
	routeMode := normalizedBuildRouteMode(credential)
	xaiEligible := account.IsBuildSuper(credential, request.Billing)
	if routeMode == account.BuildRouteXAI || (routeMode == account.BuildRouteAuto && xaiEligible && a.CredentialMetadata(credential).BuildBotFlagged) {
		return a.generateVideoOnXAI(ctx, request, credential, accessToken, false)
	}
	// 非 bot-flagged 账号先走 Build 主地址，不读取历史回退标记。
	primaryBase := a.primaryBaseURL()
	payload, err := videoCreatePayload(request, "", buildVideoRequestProfile)
	if err != nil {
		return provider.VideoResult{}, provider.WrapVideoStage(provider.VideoStagePrepare, 0, err)
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return provider.VideoResult{}, provider.WrapVideoStage(provider.VideoStagePrepare, 0, err)
	}
	createResp, createErr := a.doVideoJSON(ctx, credential, accessToken, http.MethodPost, primaryBase, "/videos/generations", body, buildVideoRequestProfile, true)
	if createErr == nil {
		jobID, parseErr := parseVideoCreateResponse(createResp)
		if parseErr != nil {
			return provider.VideoResult{}, provider.WrapVideoStage(provider.VideoStageSubmitted, 0, parseErr)
		}
		if request.Progress != nil {
			request.Progress(1)
		}
		return a.pollVideoJob(ctx, credential, accessToken, primaryBase, jobID, "", buildVideoRequestProfile, request.Progress)
	}
	var upstream *videoUpstreamError
	if !asVideoUpstreamError(createErr, &upstream) || !isHTTPForbidden(upstream.status) {
		return provider.VideoResult{}, provider.WrapVideoStage(provider.VideoCreateFailureStage(createErr), 0, createErr)
	}
	if routeMode == account.BuildRouteBuild || !xaiEligible {
		return provider.VideoResult{}, provider.WrapVideoStage(provider.VideoCreateFailureStage(createErr), 0, createErr)
	}
	// 已确认 Super 的主地址 403：签发 upload_url 后探测 XAI；创建成功才标记降级。
	return a.generateVideoOnXAI(ctx, request, credential, accessToken, true)
}

func (a *Adapter) generateVideoOnXAI(ctx context.Context, request provider.VideoRequest, credential account.Credential, accessToken string, recordFallback bool) (provider.VideoResult, error) {
	issuer := a.uploadIssuerRef()
	if issuer == nil {
		return provider.VideoResult{}, provider.WrapVideoStage(provider.VideoStagePrepare, 0, fmt.Errorf("XAI 视频需要媒体上传接收服务"))
	}
	jobKey := strings.TrimSpace(request.JobID)
	if jobKey == "" {
		jobKey = "video-pending"
	}
	uploadURL, assetID, err := issuer.IssueVideoUpload(ctx, jobKey)
	if err != nil {
		// 配置错误（例如 PublicAPIBaseURL 不可用）不得误标降级。
		return provider.VideoResult{}, provider.WrapVideoStage(provider.VideoStagePrepare, 0, err)
	}
	payload, err := videoCreatePayload(request, uploadURL, xaiVideoRequestProfile)
	if err != nil {
		return provider.VideoResult{}, provider.WrapVideoStage(provider.VideoStagePrepare, 0, err)
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return provider.VideoResult{}, provider.WrapVideoStage(provider.VideoStagePrepare, 0, err)
	}
	base := a.fallbackBaseURL()
	createResp, err := a.doVideoJSON(ctx, credential, accessToken, http.MethodPost, base, "/videos/generations", body, xaiVideoRequestProfile, true)
	if err != nil {
		return provider.VideoResult{}, provider.WrapVideoStage(provider.VideoCreateFailureStage(err), 0, err)
	}
	// 必须先解析到可用 job ID，再标记降级；畸形 2xx 不得激活或本地置位。
	jobID, err := parseVideoCreateResponse(createResp)
	if err != nil {
		return provider.VideoResult{}, provider.WrapVideoStage(provider.VideoStageSubmitted, 0, err)
	}
	if recordFallback {
		a.activateBuildAPIFallback(ctx, &credential)
	}
	if request.Progress != nil {
		request.Progress(1)
	}
	return a.pollVideoJob(ctx, credential, accessToken, base, jobID, assetID, xaiVideoRequestProfile, request.Progress)
}

// DownloadVideo 通过 Build egress 拉取已完成任务的公开 CDN URL。
// 资源域不需要 OAuth；不得解密或转发 token 与客户端身份头。
func (a *Adapter) DownloadVideo(ctx context.Context, credential account.Credential, rawURL string) (io.ReadCloser, string, int64, error) {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || parsed.Scheme != "https" || parsed.User != nil || !trustedBuildVideoAssetHost(parsed.Hostname()) {
		return nil, "", 0, fmt.Errorf("视频内容 URL 不受信任")
	}
	requestCtx := infraegress.WithCredential(ctx, credential)
	req, err := http.NewRequestWithContext(requestCtx, http.MethodGet, parsed.String(), nil)
	if err != nil {
		return nil, "", 0, err
	}
	// 仅保留 egress 路径上的匿名 GET；禁止 Authorization / Token-Auth / 会话身份头。
	req.Header.Set("Accept", "*/*")
	response, err := a.http.Do(req)
	if err != nil {
		return nil, "", 0, err
	}
	if err := normalizeGzipResponse(response); err != nil {
		return nil, "", 0, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		_ = response.Body.Close()
		return nil, "", 0, fmt.Errorf("下载视频返回 %d", response.StatusCode)
	}
	contentType := strings.ToLower(strings.TrimSpace(strings.Split(response.Header.Get("Content-Type"), ";")[0]))
	if contentType == "" || contentType == "application/octet-stream" {
		contentType = "video/mp4"
	}
	if !strings.HasPrefix(contentType, "video/") {
		_ = response.Body.Close()
		return nil, "", 0, fmt.Errorf("上游视频 Content-Type 无效")
	}
	return response.Body, contentType, response.ContentLength, nil
}

func (a *Adapter) pollVideoJob(ctx context.Context, credential account.Credential, accessToken, base, jobID, assetID string, profile videoRequestProfile, progress func(int)) (provider.VideoResult, error) {
	ticker := time.NewTicker(buildVideoPollEvery)
	defer ticker.Stop()
	for {
		statusBody, err := a.doVideoJSON(ctx, credential, accessToken, http.MethodGet, base, "/videos/"+url.PathEscape(jobID), nil, profile, false)
		if err != nil {
			return provider.VideoResult{}, provider.WrapVideoStage(provider.VideoStagePoll, 0, err)
		}
		result, done, pollErr := parseVideoStatusResponse(statusBody, progress, assetID != "")
		if pollErr != nil {
			return provider.VideoResult{}, provider.WrapVideoStage(provider.VideoStagePoll, 0, pollErr)
		}
		if done {
			if assetID != "" {
				issuer := a.uploadIssuerRef()
				if issuer == nil {
					return provider.VideoResult{}, provider.WrapVideoStage(provider.VideoStagePoll, 0, fmt.Errorf("XAI 视频需要媒体上传接收服务"))
				}
				contentType, waitErr := issuer.WaitVideoUpload(ctx, assetID)
				if waitErr != nil {
					// 上游 done 但本地未收到上传：若 status 带 CDN URL 仍可回退远程读取。
					if result.URL != "" {
						return result, nil
					}
					return provider.VideoResult{}, provider.WrapVideoStage(provider.VideoStagePoll, 0, waitErr)
				}
				if contentType == "" {
					contentType = "video/mp4"
				}
				return provider.VideoResult{ContentType: contentType, AssetID: assetID}, nil
			}
			return result, nil
		}
		select {
		case <-ctx.Done():
			return provider.VideoResult{}, provider.WrapVideoStage(provider.VideoStagePoll, 0, ctx.Err())
		case <-ticker.C:
		}
	}
}

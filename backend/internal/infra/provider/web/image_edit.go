package web

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/chenyme/grok2api/backend/internal/domain/account"
	domainegress "github.com/chenyme/grok2api/backend/internal/domain/egress"
	"github.com/chenyme/grok2api/backend/internal/infra/egress"
	"github.com/chenyme/grok2api/backend/internal/ports/provider"
)

// EditImage retries the complete browser media flow once after a challenge
// response. Reacquiring the lease is required because the failed lease keeps
// the immutable browser-session cookies that were rejected upstream.
func (a *Adapter) EditImage(ctx context.Context, request provider.ImageEditRequest) (*provider.Response, error) {
	for attempt := 0; attempt < 2; attempt++ {
		response, err := a.editImageAttempt(ctx, request)
		if err == nil {
			return response, nil
		}
		var upstreamErr *webMediaUpstreamError
		if !errors.As(err, &upstreamErr) || !isClearanceRefreshableMediaError(upstreamErr) || attempt > 0 {
			if errors.As(err, &upstreamErr) {
				return upstreamErr.providerResponse(), nil
			}
			return nil, err
		}
		a.log().Warn("web_image_clearance_retry", "operation", "edit", "status", upstreamErr.status, "body_kind", upstreamErr.bodyKind)
	}
	return nil, fmt.Errorf("图片编辑 Clearance 重试耗尽")
}

// imageEditOptions 承载通过校验后的编辑输出参数。
type imageEditOptions struct {
	format string
	ratio  string
}

// imageEditSession 汇总一次编辑请求所需的出口租约与上游凭据。
type imageEditSession struct {
	config Config
	token  string
	lease  *egress.Lease
}

// imageEditRejected 统一构造编辑请求的拒绝结果，保持 invalidImageRequest 的错误语义。
func imageEditRejected(message string) (imageEditOptions, *provider.Response, error) {
	response, err := invalidImageRequest(message)
	return imageEditOptions{}, response, err
}

// validateImageEditAttempt 校验编辑请求并归一化输出参数；early 非 nil 时直接应答。
func validateImageEditAttempt(request provider.ImageEditRequest) (imageEditOptions, *provider.Response, error) {
	if strings.TrimSpace(request.Quality) != "" {
		return imageEditRejected("Grok Web 图片模型不支持 quality")
	}
	if len(request.ImageURLs) == 0 || len(request.ImageURLs) > 8 {
		return imageEditRejected("image 数量必须在 1 到 8 之间")
	}
	count := request.Count
	if count <= 0 {
		count = 1
	}
	if count != 1 {
		return imageEditRejected("Grok Web 图片编辑当前仅支持 n=1")
	}
	if request.PartialImages < 0 || request.PartialImages > 3 {
		return imageEditRejected("partial_images 必须在 0 到 3 之间")
	}
	if request.PartialImages > 0 && !request.Streaming {
		return imageEditRejected("partial_images 仅可在 stream=true 时使用")
	}
	resolution := strings.ToLower(strings.TrimSpace(request.Resolution))
	if resolution == "" {
		resolution = "1k"
	}
	if resolution != "1k" {
		return imageEditRejected("Grok Web 图片编辑当前仅支持 resolution=1k")
	}
	format := strings.ToLower(strings.TrimSpace(request.ResponseFormat))
	if format == "" {
		format = "url"
	}
	if format != "url" && format != "b64_json" {
		return imageEditRejected("response_format 必须是 url 或 b64_json")
	}
	ratio, err := resolveImageEditAspectRatio(request.AspectRatio, request.Size)
	if err != nil {
		return imageEditRejected(err.Error())
	}
	return imageEditOptions{format: format, ratio: ratio}, nil, nil
}

// loadImageEditInputs 下载并校验全部输入图片；early 非 nil 表示入参非法。
func (a *Adapter) loadImageEditInputs(ctx context.Context, session imageEditSession, rawURLs []string) ([]provider.ImageInput, *provider.Response, error) {
	images := make([]provider.ImageInput, 0, len(rawURLs))
	for _, rawURL := range rawURLs {
		image, loadErr := a.loadChatImage(ctx, session.lease, rawURL, session.config.MaxInputImageBytes)
		if loadErr != nil {
			response, err := invalidImageRequest(loadErr.Error())
			return nil, response, err
		}
		images = append(images, image)
	}
	return images, nil, nil
}

// uploadImageEditAssets 上传输入图片并返回上游 fileMetadataId 列表。
func (a *Adapter) uploadImageEditAssets(ctx context.Context, session imageEditSession, images []provider.ImageInput) ([]string, error) {
	assets := make([]string, 0, len(images))
	for _, image := range images {
		uploaded, uploadErr := a.uploadFileV2Direct(ctx, session.config, session.lease, session.token, image, session.config.BaseURL+"/imagine", imagineSelfUploadSource, "image_edit_upload")
		if uploadErr != nil {
			return nil, uploadErr
		}
		if uploaded.MetadataID == "" {
			return nil, fmt.Errorf("上传图片成功但上游未返回 fileMetadataId")
		}
		assets = append(assets, uploaded.MetadataID)
	}
	return assets, nil
}

// imageEditUpstreamError 把非 2xx 生成响应转换为带诊断日志的媒体错误。
func (a *Adapter) imageEditUpstreamError(response *http.Response) error {
	body, _ := io.ReadAll(io.LimitReader(response.Body, webMediaDiagnosticBodyLimit+1))
	_ = response.Body.Close()
	truncated := len(body) > webMediaDiagnosticBodyLimit
	if truncated {
		body = body[:webMediaDiagnosticBodyLimit]
	}
	upstreamErr := newWebMediaUpstreamError(response.StatusCode, body, truncated)
	a.logWebMediaUpstreamRejection("image_edit_generate", response, upstreamErr)
	return upstreamErr
}

// imageEditResponse 读取编辑结果并转换为响应载荷。
func (a *Adapter) imageEditResponse(ctx context.Context, credential account.Credential, body io.Reader, format string) (*provider.Response, error) {
	capture := &boundedCapture{limit: 8 << 20}
	parsed, consumeErr := consumeUpstream(io.TeeReader(body, capture), nil)
	if consumeErr != nil {
		return nil, consumeErr
	}
	urls := imageEditResultURLs(&parsed, capture.Bytes())
	if len(urls) == 0 {
		return jsonProviderResponse(http.StatusBadGateway, map[string]any{"error": map[string]any{
			"message": "上游未返回可用的编辑图片",
			"type":    "server_error", "code": "image_edit_incomplete",
		}}), nil
	}
	result, err := a.imageResponse(ctx, credential, urls, nil, 1, format)
	if result != nil {
		result.QuotaUnits = 1
	}
	return result, err
}

func (a *Adapter) editImageAttempt(ctx context.Context, request provider.ImageEditRequest) (*provider.Response, error) {
	options, early, err := validateImageEditAttempt(request)
	if err != nil || early != nil {
		return early, err
	}
	session := imageEditSession{config: a.config()}
	session.token, err = a.cipher.Decrypt(request.Credential.EncryptedAccessToken)
	if err != nil {
		return nil, err
	}
	session.lease, err = a.egress.AcquireCredential(ctx, domainegress.ScopeWeb, request.Credential)
	if err != nil {
		return nil, err
	}
	leaseOwned := true
	defer func() {
		if leaseOwned {
			session.lease.Release()
		}
	}()
	images, early, err := a.loadImageEditInputs(ctx, session, request.ImageURLs)
	if err != nil || early != nil {
		return early, err
	}
	assets, err := a.uploadImageEditAssets(ctx, session, images)
	if err != nil {
		return nil, err
	}
	payload := buildImageEditPayload(request.Prompt, assets, options.ratio)
	response, err := a.postJSONWithReferer(ctx, session.config, session.lease, session.token, session.config.BaseURL+"/rest/app-chat/conversations/new", payload, time.Duration(session.config.ImageTimeoutSeconds)*time.Second, session.config.BaseURL+"/imagine")
	if err != nil {
		return nil, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, a.imageEditUpstreamError(response)
	}
	if request.Streaming {
		reader, writer := io.Pipe()
		streamCtx, cancel := context.WithCancel(ctx)
		leaseOwned = false
		go a.streamImageEdit(streamCtx, writer, response.Body, session.lease, request.Credential, request.PartialImages, request.Size, options.ratio)
		return &provider.Response{StatusCode: http.StatusOK, Status: "200 OK", Header: streamHeaders(), Body: &cancelBody{ReadCloser: reader, cancel: cancel}, QuotaUnits: 1}, nil
	}
	defer response.Body.Close()
	return a.imageEditResponse(ctx, request.Credential, response.Body, options.format)
}

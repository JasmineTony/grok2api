package gateway

import (
	"context"
	"fmt"
	"strings"
	"time"

	account "github.com/chenyme/grok2api/backend/internal/domain/account"
	audit "github.com/chenyme/grok2api/backend/internal/domain/audit"
	clientkey "github.com/chenyme/grok2api/backend/internal/domain/clientkey"
	media "github.com/chenyme/grok2api/backend/internal/domain/media"
	model "github.com/chenyme/grok2api/backend/internal/domain/model"
	security "github.com/chenyme/grok2api/backend/internal/infra/security"
	requestmeta "github.com/chenyme/grok2api/backend/internal/pkg/requestmeta"
	provider "github.com/chenyme/grok2api/backend/internal/ports/provider"
)

const (
	videoJobTimeout          = 2 * time.Hour
	videoJobLease            = videoJobTimeout + 5*time.Minute
	videoJobRecoveryInterval = 30 * time.Second
	videoOutputAttempts      = 3
	// Base64 物化会同时持有原图和编码后字符串，单独限流避免高 mediaConcurrency 放大内存峰值。
	videoInputMaterializeConcurrency = 4
	videoInputJSONBaseBytes          = int64(len(`{"image_urls":[]}`))
)

// VideoInputFileReference 将本地临时 file_id 编码为只在 Gateway 内部解释的引用。
func VideoInputFileReference(fileID string) string {
	return media.InputReference(fileID)
}

type VideoInput struct {
	RequestID   string
	ClientKey   clientkey.Key
	PublicModel string
	// Operation defaults to generate when empty.
	Operation   provider.VideoOperation
	Prompt      string
	Duration    int
	AspectRatio string
	Resolution  string
	// ImageURL is the optional first-frame image (official "image").
	ImageURL string
	// ReferenceURLs are style/content references (official "reference_images").
	ReferenceURLs []string
	// ReferenceAudios are preset voice_ids for reference-to-video.
	ReferenceAudios []string
	// VideoURL is required for edit/extend (official "video").
	VideoURL string
}

// videoCreatePlan 固定视频创建阶段解析出的可调度路由、账号选择会话与计费输入。
type videoCreatePlan struct {
	route     model.Route
	selection *selectionSession
	inputJSON string
	allRefs   []string
	pricing   audit.PricingResult
	priced    bool
}

// resolveVideoCreatePlan 依次解析候选路由、校验输入引用、编码上游输入，并选出可调度路由与官方报价。
func (s *Service) resolveVideoCreatePlan(ctx context.Context, input VideoInput, operation provider.VideoOperation) (videoCreatePlan, error) {
	routes, err := s.models.GetByPublicIDCandidates(ctx, input.PublicModel)
	if err != nil {
		return videoCreatePlan{}, ErrModelNotFound
	}
	routes, err = routesForVideoOperation(routes, operation)
	if err != nil {
		return videoCreatePlan{}, err
	}
	providerSupported := func(providerValue account.Provider) bool {
		_, ok := s.providers.Videos(providerValue)
		return ok
	}
	routes, _, err = s.eligibleMediaRoutes(routes, input.ClientKey, model.CapabilityVideo, providerSupported)
	if err != nil {
		return videoCreatePlan{}, err
	}
	routes, err = routesForVideoParameters(routes, operation, input.Resolution, strings.TrimSpace(input.ImageURL) != "", len(input.ReferenceURLs), input.Duration)
	if err != nil {
		return videoCreatePlan{}, err
	}
	allRefs := videoInputReferences(input.ImageURL, input.ReferenceURLs)
	if err := s.validateVideoInputReferences(ctx, allRefs, "image"); err != nil {
		return videoCreatePlan{}, err
	}
	if videoURL := strings.TrimSpace(input.VideoURL); videoURL != "" {
		if err := s.validateVideoInputReferences(ctx, []string{videoURL}, "video"); err != nil {
			return videoCreatePlan{}, err
		}
	}
	inputJSON, err := encodeVideoInputFull(operation, input.ImageURL, input.ReferenceURLs, input.ReferenceAudios, input.VideoURL)
	if err != nil {
		return videoCreatePlan{}, err
	}
	route, selection, err := s.selectSchedulableEligibleMediaRouteWithQuotaMode(ctx, routes, input.ClientKey, true, func(route model.Route) string {
		return videoQuotaMode(route.Provider, s.providers.QuotaMode(route.Provider, route.UpstreamModel), input.Resolution)
	})
	if err != nil {
		return videoCreatePlan{}, err
	}
	if err := s.checkLedgerReady(); err != nil {
		return videoCreatePlan{}, err
	}
	pricing, priced := resolveVideoPricing(operation, route.UpstreamModel, input.Resolution, input.Duration, len(allRefs))
	return videoCreatePlan{
		route: route, selection: selection, inputJSON: inputJSON, allRefs: allRefs, pricing: pricing, priced: priced,
	}, nil
}

// normalizeVideoCreateInput 规范化视频操作名并校验与操作相关的输入契约；返回的 input 可能带
// 上补全后的默认时长。
func normalizeVideoCreateInput(input VideoInput) (provider.VideoOperation, VideoInput, error) {
	operation := input.Operation
	if operation == "" {
		operation = provider.VideoOperationGenerate
	}
	switch operation {
	case provider.VideoOperationGenerate, provider.VideoOperationEdit, provider.VideoOperationExtend:
	default:
		return "", input, fmt.Errorf("不支持的视频操作")
	}
	if len(input.Prompt) > 100000 {
		return "", input, fmt.Errorf("prompt 过长")
	}
	if operation == provider.VideoOperationGenerate {
		return operation, input, validateVideoGenerateInput(input)
	}
	return normalizeVideoTransformInput(operation, input)
}

// validateVideoGenerateInput 校验文本/图片/参考素材生视频的互斥与必填项。
func validateVideoGenerateInput(input VideoInput) error {
	hasImage := strings.TrimSpace(input.ImageURL) != ""
	hasRefs := len(input.ReferenceURLs) > 0
	hasRefAudio := len(input.ReferenceAudios) > 0
	if hasImage && (hasRefs || hasRefAudio) {
		return fmt.Errorf("image 不能与 reference_images/reference_audios 同时使用")
	}
	if hasRefs || hasRefAudio {
		if len(input.Prompt) == 0 {
			return fmt.Errorf("参考图/参考音频视频必须提供 prompt")
		}
		if resolution := strings.ToLower(strings.TrimSpace(input.Resolution)); resolution == "1080p" {
			return fmt.Errorf("参考图视频 resolution 最高 720p")
		}
	}
	if len(input.Prompt) == 0 && !hasImage && !hasRefs && !hasRefAudio {
		return fmt.Errorf("文本生视频必须提供 prompt；图片生视频可以省略 prompt")
	}
	if strings.TrimSpace(input.VideoURL) != "" {
		return fmt.Errorf("视频生成不支持 video 输入")
	}
	return validateVideoReferenceAudios(input.ReferenceAudios)
}

// normalizeVideoTransformInput 校验编辑/延长操作并补齐延长时长的默认值。
func normalizeVideoTransformInput(operation provider.VideoOperation, input VideoInput) (provider.VideoOperation, VideoInput, error) {
	if strings.TrimSpace(input.Prompt) == "" {
		return "", input, fmt.Errorf("视频编辑/延长必须提供 prompt")
	}
	if strings.TrimSpace(input.VideoURL) == "" {
		return "", input, fmt.Errorf("视频编辑/延长必须提供 video")
	}
	if strings.TrimSpace(input.ImageURL) != "" || len(input.ReferenceURLs) > 0 || len(input.ReferenceAudios) > 0 {
		return "", input, fmt.Errorf("视频编辑/延长不支持 image、reference_images 或 reference_audios")
	}
	if operation == provider.VideoOperationEdit && input.Duration != 0 {
		return "", input, fmt.Errorf("视频编辑不支持 duration")
	}
	if operation != provider.VideoOperationExtend {
		return operation, input, nil
	}
	if input.Duration == 0 {
		input.Duration = 6
	}
	if input.Duration < 2 || input.Duration > 10 {
		return "", input, fmt.Errorf("视频延长 duration 必须在 2 到 10 秒之间")
	}
	return operation, input, nil
}

func (s *Service) CreateVideo(ctx context.Context, input VideoInput) (media.Job, error) {
	if s.mediaJobs == nil || s.mediaQueue == nil {
		return media.Job{}, fmt.Errorf("视频任务服务未配置")
	}
	operation, input, err := normalizeVideoCreateInput(input)
	if err != nil {
		return media.Job{}, err
	}
	plan, err := s.resolveVideoCreatePlan(ctx, input, operation)
	if err != nil {
		return media.Job{}, err
	}
	route, selection := plan.route, plan.selection
	externalModel := model.ExternalPublicID(route.Provider, route.PublicID)
	lease, err := selection.Acquire(ctx, nil, false)
	if err != nil {
		return media.Job{}, fmt.Errorf("%w: %w", ErrNoAvailableAccount, err)
	}
	accountID := lease.Credential.ID
	lease.Release()
	token, err := security.NewOpaqueToken(18)
	if err != nil {
		return media.Job{}, err
	}
	now := time.Now().UTC()
	job := media.Job{
		ID: "video_" + token, RequestID: input.RequestID,
		ClientKeyID: input.ClientKey.ID, ClientKeyName: input.ClientKey.Name,
		ClientIP:  requestmeta.ClientIP(ctx),
		AccountID: accountID, AccountName: lease.Credential.Name,
		Provider: string(route.Provider), Model: externalModel, ModelRouteID: route.ID, UpstreamModel: model.DisplayUpstreamModel(route.Provider, route.UpstreamModel), Operation: operation, Prompt: input.Prompt,
		Seconds: input.Duration, Size: input.AspectRatio, Quality: input.Resolution,
		Status: media.StatusQueued, Progress: 0, InputJSON: plan.inputJSON, InputImageCount: len(plan.allRefs), CreatedAt: now, UpdatedAt: now,
	}
	reserved, err := s.reserveVideoBilling(ctx, input.ClientKey, "video_usage_"+job.ID, plan.pricing, plan.priced)
	if err != nil {
		return media.Job{}, err
	}
	if err := s.mediaJobs.CreateMediaJob(ctx, job); err != nil {
		if reserved {
			s.cancelBillingReservation("video_usage_" + job.ID)
		}
		return media.Job{}, err
	}
	if !s.enqueueVideoJob(job.ID) {
		s.logger.Warn("video_job_queue_full", "job_id", job.ID)
	}
	return job, nil
}

// reserveVideoBilling 预留视频任务的计费额度；未定价时返回 false 且不预留。
func (s *Service) reserveVideoBilling(ctx context.Context, key clientkey.Key, eventID string, pricing audit.PricingResult, priced bool) (bool, error) {
	if !priced {
		return false, nil
	}
	return s.clientKeys.ReserveBilling(ctx, key, eventID, pricing.CostInUSDTicks, mediaBillingReservationTTL)
}

// routesForVideoParameters removes only routes that cannot accept this request.
// Callers must first apply capability, client-key, and Provider eligibility:
// the same public model may aggregate Console, Build, and Web routes with
// different input contracts.

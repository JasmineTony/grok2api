package gateway

import (
	"context"

	accountdomain "github.com/chenyme/grok2api/backend/internal/domain/account"
	"github.com/chenyme/grok2api/backend/internal/domain/audit"
	"github.com/chenyme/grok2api/backend/internal/domain/clientkey"
	modeldomain "github.com/chenyme/grok2api/backend/internal/domain/model"
	"github.com/chenyme/grok2api/backend/internal/ports/provider"
)

// ImageGenerationInput 表示图片生成用例已经完成协议校验后的输入。
type ImageGenerationInput struct {
	RequestID      string
	ClientKey      clientkey.Key
	PublicModel    string
	Prompt         string
	Count          int
	Size           string
	AspectRatio    string
	Resolution     string
	Quality        string
	ResponseFormat string
	Streaming      bool
	PartialImages  int
	Method         string
	Path           string
	Headers        map[string][]string
}

// ImageEditInput 表示图片编辑用例已经完成协议校验后的输入。
type ImageEditInput struct {
	RequestID      string
	ClientKey      clientkey.Key
	PublicModel    string
	Prompt         string
	ImageURLs      []string
	Count          int
	Size           string
	AspectRatio    string
	Resolution     string
	Quality        string
	ResponseFormat string
	Streaming      bool
	PartialImages  int
	Method         string
	Path           string
	Headers        map[string][]string
}

type imageProviderSupport func(accountdomain.Provider) bool

type imageExecution func(context.Context, accountdomain.Provider, accountdomain.Credential, string) (*provider.Response, error)

// GenerateImage 选择支持图片生成的路由和账号，并返回可统一审计的上游响应。
func (s *Service) GenerateImage(ctx context.Context, input ImageGenerationInput) (*Result, error) {
	return s.executeImage(ctx, input.RequestID, input.ClientKey, input.PublicModel, audit.OperationImage, modeldomain.CapabilityImage, func(providerValue accountdomain.Provider) bool {
		_, ok := s.providers.ImageGeneration(providerValue)
		return ok
	}, func(executionCtx context.Context, providerValue accountdomain.Provider, credential accountdomain.Credential, upstream string) (*provider.Response, error) {
		adapter, ok := s.providers.ImageGeneration(providerValue)
		if !ok {
			return nil, ErrNoAvailableAccount
		}
		return adapter.GenerateImage(executionCtx, provider.ImageGenerationRequest{
			Credential: credential, Model: upstream, Prompt: input.Prompt, Count: input.Count,
			Size: input.Size, AspectRatio: input.AspectRatio, Resolution: input.Resolution, Quality: input.Quality,
			ResponseFormat: input.ResponseFormat, Streaming: input.Streaming, PartialImages: input.PartialImages,
		})
	}, input.Streaming, input.Resolution, input.Quality, input.Count, 0, input.Method, input.Path, input.Headers)
}

// EditImage 选择支持图片编辑的路由和账号，并返回可统一审计的上游响应。
func (s *Service) EditImage(ctx context.Context, input ImageEditInput) (*Result, error) {
	return s.executeImage(ctx, input.RequestID, input.ClientKey, input.PublicModel, audit.OperationImageEdit, modeldomain.CapabilityImageEdit, func(providerValue accountdomain.Provider) bool {
		_, ok := s.providers.ImageEdit(providerValue)
		return ok
	}, func(executionCtx context.Context, providerValue accountdomain.Provider, credential accountdomain.Credential, upstream string) (*provider.Response, error) {
		adapter, ok := s.providers.ImageEdit(providerValue)
		if !ok {
			return nil, ErrNoAvailableAccount
		}
		return adapter.EditImage(executionCtx, provider.ImageEditRequest{
			Credential: credential, Model: upstream, Prompt: input.Prompt,
			ImageURLs: input.ImageURLs, Count: input.Count, Size: input.Size, AspectRatio: input.AspectRatio,
			Resolution: input.Resolution, Quality: input.Quality, ResponseFormat: input.ResponseFormat,
			Streaming: input.Streaming, PartialImages: input.PartialImages,
		})
	}, input.Streaming, input.Resolution, input.Quality, input.Count, len(input.ImageURLs), input.Method, input.Path, input.Headers)
}

// quotaFinalizationModes separates the immediate local consumption fence from
// the authoritative provider refresh. A refresh group may update several
// upstream windows atomically, while the local fence must charge the exact
// window selected for this account so concurrent media requests cannot
// over-allocate during the short refresh delay.
func quotaFinalizationModes(effectiveMode, refreshGroup string) (refreshMode, decrementMode, availabilityMode string) {
	// Availability-only Imagine products on paid Web tiers are governed by the
	// shared weekly pool. Refresh its numeric counter and also re-read the
	// product group so available=false/nextAvailableAt can install an exact
	// product fence that overrides weekly routing.
	if effectiveMode == "weekly" {
		return effectiveMode, effectiveMode, refreshGroup
	}
	refreshMode = effectiveMode
	if refreshGroup != "" {
		refreshMode = refreshGroup
	}
	return refreshMode, effectiveMode, ""
}

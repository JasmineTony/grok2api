package model

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	accountapp "github.com/chenyme/grok2api/backend/internal/application/account"
	"github.com/chenyme/grok2api/backend/internal/domain/account"
	clientkeydomain "github.com/chenyme/grok2api/backend/internal/domain/clientkey"
	modeldomain "github.com/chenyme/grok2api/backend/internal/domain/model"
	"github.com/chenyme/grok2api/backend/internal/pkg/batch"
	"github.com/chenyme/grok2api/backend/internal/ports/provider"
	"github.com/chenyme/grok2api/backend/internal/repository"
	"golang.org/x/sync/singleflight"
)

const defaultModelSyncWorkers = 25

var (
	ErrInvalidFilter = errors.New("模型筛选条件无效")
	ErrInvalidInput  = errors.New("模型参数无效")
	ErrNotFound      = errors.New("模型不存在")
	ErrConflict      = errors.New("模型名称冲突")
)

type UpdateInput struct {
	PublicID   *string
	Enabled    *bool
	AccountIDs *[]uint64
}

type CreateInput struct {
	PublicID      string
	Provider      account.Provider
	UpstreamModel string
	Capability    modeldomain.Capability
	Enabled       bool
	AccountIDs    []uint64
}

type AccountOption struct {
	ID   uint64
	Name string
}

type RouteGroup struct {
	Routes               []modeldomain.Route
	EndpointCapabilities []string
}

type ListFilter struct {
	Provider    string
	Providers   []string
	Tiers       []string
	Status      string
	ActiveScope bool
	Sort        repository.SortQuery
}

type SyncProgressObserver func(completed, total int)

// Service 负责上游模型发现、内部来源路由与对外模型名称维护。
type Service struct {
	models    repository.ModelRepository
	accounts  repository.AccountRepository
	account   *accountapp.Service
	providers provider.Registry
	bulkPool  *batch.Pool
	logger    *slog.Logger
	syncAll   singleflight.Group
}

func NewService(models repository.ModelRepository, accounts repository.AccountRepository, accountService *accountapp.Service, providers provider.Registry) *Service {
	return &Service{models: models, accounts: accounts, account: accountService, providers: providers, bulkPool: batch.NewPool(defaultModelSyncWorkers), logger: slog.Default()}
}

func (s *Service) SetBulkPool(pool *batch.Pool) {
	if pool != nil {
		s.bulkPool = pool
	}
}

func (s *Service) SetLogger(logger *slog.Logger) {
	if logger != nil {
		s.logger = logger
	}
}

func (s *Service) List(ctx context.Context, page, pageSize int, search string, filter ListFilter) ([]modeldomain.Route, int64, error) {
	page, pageSize = normalizePage(page, pageSize)
	if !validProviderFilter(filter.Provider) || !validProviderFilters(filter.Providers) || !validTierFilters(filter.Tiers) || !validModelFilter(filter.Status, "", "enabled", "disabled") || !repository.IsValidSort(filter.Sort, "publicId", "upstreamModel", "status", "provider", "accountSupport", "lastSyncedAt") {
		return nil, 0, ErrInvalidFilter
	}
	var enabled *bool
	if filter.Status != "" {
		value := filter.Status == "enabled"
		enabled = &value
	}
	return s.models.List(ctx, repository.ModelListQuery{Page: repository.PageQuery{Offset: (page - 1) * pageSize, Limit: pageSize, Search: search, Sort: filter.Sort}, Filter: repository.ModelListFilter{Provider: filter.Provider, Providers: filter.Providers, Tiers: filter.Tiers, Enabled: enabled, ActiveScope: filter.ActiveScope}})
}

func (s *Service) ListGroups(ctx context.Context, page, pageSize int, search string, filter ListFilter) ([]RouteGroup, int64, error) {
	page, pageSize = normalizePage(page, pageSize)
	if !validProviderFilter(filter.Provider) || !validModelFilter(filter.Status, "", "enabled", "disabled") || !repository.IsValidSort(filter.Sort, "publicId", "upstreamModel", "status", "provider", "accountSupport", "lastSyncedAt") {
		return nil, 0, ErrInvalidFilter
	}
	var enabled *bool
	if filter.Status != "" {
		value := filter.Status == "enabled"
		enabled = &value
	}
	values, total, err := s.models.ListGroups(ctx, repository.ModelListQuery{
		Page:   repository.PageQuery{Offset: (page - 1) * pageSize, Limit: pageSize, Search: search, Sort: filter.Sort},
		Filter: repository.ModelListFilter{Provider: filter.Provider, Enabled: enabled},
	})
	if err != nil {
		return nil, 0, err
	}
	groups := make([]RouteGroup, 0, len(values))
	for _, value := range values {
		groups = append(groups, RouteGroup{Routes: value.Routes, EndpointCapabilities: s.endpointCapabilities(value.Routes)})
	}
	return groups, total, nil
}

func (s *Service) endpointCapabilities(routes []modeldomain.Route) []string {
	if len(routes) == 0 || s.providers == nil {
		return nil
	}
	definition, ok := s.providers.Definition(routes[0].Provider)
	if !ok {
		return nil
	}
	return endpointCapabilitiesForDefinition(routes, definition)
}

func endpointCapabilitiesForDefinition(routes []modeldomain.Route, definition provider.Definition) []string {
	available := make(map[string]bool, 6)
	for _, route := range routes {
		switch route.Capability {
		case modeldomain.CapabilityResponses, modeldomain.CapabilityChat:
			available["completions"] = definition.Conversation.ChatCompletions
			available["responses"] = definition.Conversation.Responses
			available["messages"] = definition.Conversation.Messages
		case modeldomain.CapabilityImage:
			available["image"] = definition.Media.ImageGeneration
		case modeldomain.CapabilityImageEdit:
			available["image_edit"] = definition.Media.ImageEdit
		case modeldomain.CapabilityVideo:
			available["video"] = definition.Media.VideoGeneration
		case modeldomain.CapabilityTTS:
			available["tts"] = definition.Media.TTS
		case modeldomain.CapabilitySTT:
			available["stt"] = definition.Media.STT
		case modeldomain.CapabilityRealtime:
			available["realtime"] = definition.Media.Realtime
		}
	}
	order := []string{"completions", "responses", "messages", "image", "image_edit", "video", "tts", "stt", "realtime"}
	result := make([]string, 0, len(order))
	for _, capability := range order {
		if available[capability] {
			result = append(result, capability)
		}
	}
	return result
}

func (s *Service) ListEnabled(ctx context.Context) ([]modeldomain.Route, error) {
	return s.models.ListEnabled(ctx)
}

func (s *Service) ListEnabledForClientKey(ctx context.Context, key clientkeydomain.Key) ([]modeldomain.Route, error) {
	scope, valid := clientkeydomain.NormalizeAccountScope(clientkeydomain.AccountScope{Providers: key.ProviderScope, Tiers: key.TierScope})
	if !valid {
		return nil, ErrInvalidFilter
	}
	if !scope.IsRestricted() {
		return s.models.ListEnabled(ctx)
	}
	providers := scope.Providers.Values()
	if len(providers) == 1 && providers[0] == "all" {
		providers = nil
	}
	tiers := scope.Tiers.Values()
	if len(tiers) == 1 && tiers[0] == "all" {
		tiers = nil
	}
	return s.models.ListEnabledForScope(ctx, repository.ModelListFilter{Providers: providers, Tiers: tiers})
}

func (s *Service) Get(ctx context.Context, id uint64) (modeldomain.Route, error) {
	return s.models.Get(ctx, id)
}

// GetByPublicID 每次读取共享主数据库，保证多实例下的路由禁用立即生效。
func (s *Service) GetByPublicID(ctx context.Context, publicID string) (modeldomain.Route, error) {
	return s.models.GetByPublicID(ctx, publicID)
}

func (s *Service) GetByPublicIDCandidates(ctx context.Context, publicID string) ([]modeldomain.Route, error) {
	return s.models.GetByPublicIDCandidates(ctx, publicID)
}

func (s *Service) GetByProviderUpstream(ctx context.Context, providerValue account.Provider, upstreamModel string) (modeldomain.Route, error) {
	return s.models.GetByProviderUpstream(ctx, providerValue, upstreamModel)
}

func (s *Service) Create(ctx context.Context, input CreateInput) (modeldomain.Route, error) {
	publicID, validPublicID := modeldomain.NormalizeExternalPublicID(input.Provider, input.PublicID)
	if !validPublicID {
		return modeldomain.Route{}, invalidInput("publicId 不能为空、不能携带其他 Provider 前缀，且长度不能超过 255 个字符")
	}
	upstreamModel, validUpstreamModel := modeldomain.NormalizeUpstreamModel(input.Provider, input.UpstreamModel)
	if !validUpstreamModel {
		return modeldomain.Route{}, invalidInput("upstreamModel 必须属于所选 Provider 且长度为 1-255 个字符")
	}
	definition, err := s.validateProviderCapability(input.Provider, input.Capability)
	if err != nil {
		return modeldomain.Route{}, err
	}
	if definition.ModelCatalog == provider.ModelCatalogStatic && s.providers.QuotaMode(input.Provider, upstreamModel) == "" {
		return modeldomain.Route{}, invalidInput(fmt.Sprintf("%s 仅支持内置模型目录中的上游模型", definition.ModelNamespace))
	}
	accountIDs, err := s.validateBoundAccounts(ctx, input.Provider, input.AccountIDs)
	if err != nil {
		return modeldomain.Route{}, err
	}
	value := modeldomain.Route{
		PublicID: publicID, Provider: input.Provider, UpstreamModel: upstreamModel,
		Capability: input.Capability, Origin: modeldomain.OriginManual, Enabled: input.Enabled,
	}
	created, err := s.models.Create(ctx, value, accountIDs)
	return created, mapRepositoryError(err)
}

func (s *Service) Update(ctx context.Context, id uint64, input UpdateInput) (modeldomain.Route, error) {
	value, err := s.models.Get(ctx, id)
	if err != nil {
		return modeldomain.Route{}, mapRepositoryError(err)
	}
	if input.PublicID != nil {
		publicID, ok := modeldomain.NormalizeExternalPublicID(value.Provider, *input.PublicID)
		if !ok {
			return modeldomain.Route{}, invalidInput("publicId 不能为空、不能携带其他 Provider 前缀，且长度不能超过 255 个字符")
		}
		value.PublicID = publicID
	}
	if input.Enabled != nil {
		value.Enabled = *input.Enabled
	}
	var accountIDs *[]uint64
	if input.AccountIDs != nil {
		validated, validateErr := s.validateBoundAccounts(ctx, value.Provider, *input.AccountIDs)
		if validateErr != nil {
			return modeldomain.Route{}, validateErr
		}
		accountIDs = &validated
	}
	updated, err := s.models.Update(ctx, value, accountIDs)
	return updated, mapRepositoryError(err)
}

func (s *Service) Delete(ctx context.Context, id uint64) error {
	if id == 0 {
		return invalidInput("模型 ID 无效")
	}
	return mapRepositoryError(s.models.Delete(ctx, id))
}

func (s *Service) BatchDelete(ctx context.Context, ids []uint64) (int64, error) {
	values, err := normalizeModelRouteBatchIDs(ids)
	if err != nil {
		return 0, err
	}
	return s.models.DeleteMany(ctx, values)
}

func (s *Service) ListBindableAccounts(ctx context.Context, providerValue account.Provider) ([]AccountOption, error) {
	if !providerValue.IsValid() {
		return nil, invalidInput("账号来源无效")
	}
	values, _, err := s.accounts.List(ctx, repository.AccountListQuery{
		Page:   repository.PageQuery{Offset: 0, Limit: 1000},
		Filter: repository.AccountListFilter{Provider: string(providerValue)},
	})
	if err != nil {
		return nil, err
	}
	result := make([]AccountOption, 0, len(values))
	for _, value := range values {
		result = append(result, AccountOption{ID: value.ID, Name: value.Name})
	}
	return result, nil
}

func (s *Service) validateProviderCapability(providerValue account.Provider, capability modeldomain.Capability) (provider.Definition, error) {
	if !providerValue.IsValid() || s.providers == nil {
		return provider.Definition{}, invalidInput("provider 无效")
	}
	definition, ok := s.providers.Definition(providerValue)
	if !ok {
		return provider.Definition{}, invalidInput("provider 未注册能力定义")
	}
	if !definition.SupportsModelCapability(capability) {
		return provider.Definition{}, invalidInput(fmt.Sprintf("%s 不支持 %s 能力", definition.ModelNamespace, capability))
	}
	return definition, nil
}

func (s *Service) validateBoundAccounts(ctx context.Context, providerValue account.Provider, ids []uint64) ([]uint64, error) {
	if len(ids) > 1000 {
		return nil, invalidInput("单个模型最多绑定 1000 个账号")
	}
	unique := make(map[uint64]struct{}, len(ids))
	result := make([]uint64, 0, len(ids))
	for _, id := range ids {
		if id == 0 {
			return nil, invalidInput("绑定账号 ID 无效")
		}
		if _, exists := unique[id]; exists {
			continue
		}
		unique[id] = struct{}{}
		result = append(result, id)
	}
	if len(result) == 0 {
		return result, nil
	}
	values, _, err := s.accounts.List(ctx, repository.AccountListQuery{
		Page:   repository.PageQuery{Offset: 0, Limit: 1000},
		Filter: repository.AccountListFilter{Provider: string(providerValue)},
	})
	if err != nil {
		return nil, err
	}
	available := make(map[uint64]bool, len(values))
	for _, value := range values {
		available[value.ID] = true
	}
	for _, id := range result {
		if !available[id] {
			return nil, invalidInput(fmt.Sprintf("账号 %d 不存在或与模型来源不匹配", id))
		}
	}
	return result, nil
}

// BatchSetEnabled 批量更新模型路由启停状态。
func (s *Service) BatchSetEnabled(ctx context.Context, ids []uint64, enabled bool) (int64, error) {
	values, err := normalizeModelRouteBatchIDs(ids)
	if err != nil {
		return 0, err
	}
	updated, err := s.models.UpdateManyEnabled(ctx, values, enabled)
	return updated, err
}

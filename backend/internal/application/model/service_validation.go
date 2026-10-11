package model

import (
	"errors"
	"fmt"
	"strings"

	"github.com/chenyme/grok2api/backend/internal/domain/account"
	modeldomain "github.com/chenyme/grok2api/backend/internal/domain/model"
	"github.com/chenyme/grok2api/backend/internal/repository"
)

var maxModelBatchSize = repository.MaxPageSize * len(modeldomain.Capabilities())

func validProviderFilter(value string) bool {
	return value == "" || account.Provider(value).IsValid()
}

func validProviderFilters(values []string) bool {
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		if !account.Provider(value).IsValid() {
			return false
		}
		if _, exists := seen[value]; exists {
			return false
		}
		seen[value] = struct{}{}
	}
	return true
}

func validTierFilters(values []string) bool {
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		if value != "free" && value != "super" {
			return false
		}
		if _, exists := seen[value]; exists {
			return false
		}
		seen[value] = struct{}{}
	}
	return true
}

func validModelFilter(value string, allowed ...string) bool {
	for _, candidate := range allowed {
		if value == candidate {
			return true
		}
	}
	return false
}

func normalizeDiscoveredModels(values []string) []string {
	unique := make(map[string]struct{}, len(values))
	models := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, exists := unique[value]; exists {
			continue
		}
		unique[value] = struct{}{}
		models = append(models, value)
	}
	return models
}

func normalizePage(page, pageSize int) (int, int) {
	return repository.NormalizePage(page, pageSize, repository.DefaultPageSize)
}

func normalizeBatchIDs(ids []uint64) ([]uint64, error) {
	return normalizeIDs(ids, repository.MaxPageSize, "模型")
}

func normalizeModelRouteBatchIDs(ids []uint64) ([]uint64, error) {
	return normalizeIDs(ids, maxModelBatchSize, "模型能力路由")
}

func normalizeIDs(ids []uint64, limit int, label string) ([]uint64, error) {
	if len(ids) == 0 {
		return nil, invalidInput("至少选择一个模型")
	}
	if len(ids) > limit {
		return nil, invalidInput(fmt.Sprintf("单次最多处理 %d 条%s", limit, label))
	}
	seen := make(map[uint64]struct{}, len(ids))
	result := make([]uint64, 0, len(ids))
	for _, id := range ids {
		if id == 0 {
			return nil, invalidInput("模型 ID 无效")
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		result = append(result, id)
	}
	return result, nil
}

// invalidInput 为可安全返回给管理端的模型参数错误附加稳定语义。
func invalidInput(message string) error {
	return fmt.Errorf("%w: %s", ErrInvalidInput, message)
}

// mapRepositoryError 将仓储错误转换为模型应用错误。
func mapRepositoryError(err error) error {
	if errors.Is(err, repository.ErrNotFound) {
		return ErrNotFound
	}
	if errors.Is(err, repository.ErrConflict) {
		return ErrConflict
	}
	return err
}

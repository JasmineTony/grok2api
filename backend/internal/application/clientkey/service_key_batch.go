package clientkey

import (
	"context"
	"fmt"

	"github.com/chenyme/grok2api/backend/internal/repository"
)

// BatchSetEnabled 批量启用或停用客户端 Key。
func (s *Service) BatchSetEnabled(ctx context.Context, ids []uint64, enabled bool) (int64, error) {
	values, err := normalizeBatchIDs(ids)
	if err != nil {
		return 0, err
	}
	if err := s.rejectInternalKeys(ctx, values); err != nil {
		return 0, err
	}
	updated, err := s.keys.UpdateManyEnabled(ctx, values, enabled)
	if err == nil {
		s.touches.deleteIDs(values)
		s.authCache.deleteIDs(values)
	}
	return updated, err
}

// BatchDelete 原子删除客户端 Key 及其模型权限。
func (s *Service) BatchDelete(ctx context.Context, ids []uint64) (int64, error) {
	values, err := normalizeBatchIDs(ids)
	if err != nil {
		return 0, err
	}
	if err := s.rejectInternalKeys(ctx, values); err != nil {
		return 0, err
	}
	deleted, err := s.keys.DeleteMany(ctx, values)
	if err == nil {
		s.touches.deleteIDs(values)
		s.authCache.deleteIDs(values)
	}
	return deleted, err
}

func (s *Service) rejectInternalKeys(ctx context.Context, ids []uint64) error {
	inspector, ok := s.keys.(internalKeyInspector)
	if !ok {
		return nil
	}
	count, err := inspector.CountInternalKeys(ctx, ids)
	if err != nil {
		return err
	}
	if count > 0 {
		return ErrSystemManaged
	}
	return nil
}

func normalizeBatchIDs(ids []uint64) ([]uint64, error) {
	if len(ids) == 0 {
		return nil, invalidInput("至少选择一个 Key")
	}
	if len(ids) > repository.MaxPageSize {
		return nil, invalidInput(fmt.Sprintf("单次最多处理 %d 个 Key", repository.MaxPageSize))
	}
	seen := make(map[uint64]struct{}, len(ids))
	result := make([]uint64, 0, len(ids))
	for _, id := range ids {
		if id == 0 {
			return nil, invalidInput("Key ID 无效")
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		result = append(result, id)
	}
	return result, nil
}

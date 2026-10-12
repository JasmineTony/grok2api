package redis

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/chenyme/grok2api/backend/internal/repository"
)

// 本文件承载额度刷新脏标记的代际、清理与列举。

func (s *Store) MarkQuotaRefreshDirty(ctx context.Context, accountID uint64, mode string, ttl time.Duration) (uint64, error) {
	mode = strings.TrimSpace(mode)
	if accountID == 0 || mode == "" || ttl <= 0 {
		return 0, fmt.Errorf("quota refresh identity is invalid")
	}
	member := strconv.FormatUint(accountID, 10) + ":" + mode
	now := time.Now().UTC()
	expiresAt := now.Add(ttl)
	generation, err := markQuotaRefreshDirtyScript.Run(ctx, s.client,
		[]string{s.key("quota-refresh", "generations"), s.key("quota-refresh", "dirty"), s.key("quota-refresh", "expiry")},
		member, expiresAt.UnixMilli(), maxQuotaRefreshDirty, now.UnixMilli(),
	).Uint64()
	if err != nil {
		return 0, err
	}
	if generation == 0 {
		return 0, fmt.Errorf("quota refresh dirty set is full")
	}
	return generation, nil
}

func (s *Store) QuotaRefreshGeneration(ctx context.Context, accountID uint64, mode string) (uint64, bool, error) {
	member := strconv.FormatUint(accountID, 10) + ":" + strings.TrimSpace(mode)
	values, err := quotaRefreshStateScript.Run(ctx, s.client,
		[]string{s.key("quota-refresh", "generations"), s.key("quota-refresh", "dirty"), s.key("quota-refresh", "expiry")}, member, time.Now().UTC().UnixMilli(),
	).StringSlice()
	if err != nil {
		return 0, false, err
	}
	if len(values) != 2 {
		return 0, false, fmt.Errorf("quota refresh state response is invalid")
	}
	generation, err := strconv.ParseUint(values[0], 10, 64)
	return generation, values[1] == "1", err
}

func (s *Store) ClearQuotaRefreshDirty(ctx context.Context, accountID uint64, mode string, generation uint64) (bool, error) {
	member := strconv.FormatUint(accountID, 10) + ":" + strings.TrimSpace(mode)
	result, err := clearQuotaRefreshDirtyScript.Run(ctx, s.client,
		[]string{s.key("quota-refresh", "generations"), s.key("quota-refresh", "dirty"), s.key("quota-refresh", "expiry")},
		member, generation, time.Now().UTC().UnixMilli(),
	).Int()
	return result == 1, err
}

func (s *Store) ListQuotaRefreshDirty(ctx context.Context, now time.Time, limit int) ([]repository.QuotaRefreshDirty, error) {
	if limit <= 0 || limit > 1000 {
		limit = 100
	}
	values, err := listQuotaRefreshDirtyScript.Run(ctx, s.client,
		[]string{s.key("quota-refresh", "generations"), s.key("quota-refresh", "dirty"), s.key("quota-refresh", "expiry")},
		now.UnixMilli(), limit,
	).StringSlice()
	if err != nil {
		return nil, err
	}
	result := make([]repository.QuotaRefreshDirty, 0, min(limit, len(values)/2))
	for index := 0; index+1 < len(values); index += 2 {
		member := values[index]
		separator := strings.IndexByte(member, ':')
		if separator <= 0 || separator == len(member)-1 {
			continue
		}
		accountID, parseErr := strconv.ParseUint(member[:separator], 10, 64)
		generation, generationErr := strconv.ParseUint(values[index+1], 10, 64)
		if parseErr != nil || generationErr != nil || accountID == 0 || generation == 0 {
			continue
		}
		result = append(result, repository.QuotaRefreshDirty{AccountID: accountID, Mode: member[separator+1:], Generation: generation})
	}
	return result, nil
}

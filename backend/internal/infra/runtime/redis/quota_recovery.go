package redis

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/chenyme/grok2api/backend/internal/domain/account"
	"github.com/chenyme/grok2api/backend/internal/repository"
)

// 本文件承载额度恢复队列的调度、认领、确认与重排。

func (s *Store) ScheduleQuotaRecovery(ctx context.Context, value account.QuotaRecoveryEvent) error {
	if value.AccountID == 0 || value.Mode == "" || value.DueAt.IsZero() {
		return fmt.Errorf("额度恢复事件无效")
	}
	member := strconv.FormatUint(value.AccountID, 10) + ":" + value.Mode
	result, err := scheduleQuotaRecoveryScript.Run(ctx, s.client, []string{s.key("quota-recovery", "events"), s.key("quota-recovery", "attempts"), s.key("quota-recovery", "claims")}, member, value.DueAt.UnixMilli(), max(0, value.Attempts), maxQuotaRecoveryEvents).Int()
	if err != nil {
		return err
	}
	if result == 0 {
		return fmt.Errorf("额度恢复队列已满")
	}
	return nil
}

func (s *Store) EnsureQuotaRecovery(ctx context.Context, value account.QuotaRecoveryEvent) error {
	if value.AccountID == 0 || value.Mode == "" || value.DueAt.IsZero() {
		return fmt.Errorf("额度恢复事件无效")
	}
	member := strconv.FormatUint(value.AccountID, 10) + ":" + value.Mode
	result, err := ensureQuotaRecoveryScript.Run(ctx, s.client, []string{s.key("quota-recovery", "events"), s.key("quota-recovery", "attempts")}, member, value.DueAt.UnixMilli(), max(0, value.Attempts), maxQuotaRecoveryEvents).Int()
	if err != nil {
		return err
	}
	if result == 0 {
		return fmt.Errorf("额度恢复队列已满")
	}
	return nil
}

func (s *Store) CancelQuotaRecovery(ctx context.Context, accountID uint64, mode string) error {
	mode = strings.TrimSpace(mode)
	if accountID == 0 || mode == "" {
		return fmt.Errorf("额度恢复事件无效")
	}
	member := strconv.FormatUint(accountID, 10) + ":" + mode
	_, err := cancelQuotaRecoveryScript.Run(ctx, s.client, []string{s.key("quota-recovery", "events"), s.key("quota-recovery", "attempts"), s.key("quota-recovery", "claims")}, member).Int()
	return err
}

func (s *Store) ClaimDueQuotaRecoveries(ctx context.Context, now time.Time, limit int, lease time.Duration) ([]account.QuotaRecoveryEvent, error) {
	if limit <= 0 {
		limit = 100
	}
	claimToken, err := randomToken()
	if err != nil {
		return nil, err
	}
	values, err := claimQuotaRecoveryScript.Run(ctx, s.client, []string{s.key("quota-recovery", "events"), s.key("quota-recovery", "attempts"), s.key("quota-recovery", "claims")}, now.UnixMilli(), limit, now.Add(lease).UnixMilli(), claimToken).StringSlice()
	if err != nil {
		return nil, err
	}
	result := make([]account.QuotaRecoveryEvent, 0, len(values)/3)
	for index := 0; index+2 < len(values); index += 3 {
		raw := values[index]
		idText, mode, ok := strings.Cut(raw, ":")
		id, parseErr := strconv.ParseUint(idText, 10, 64)
		attempts, attemptsErr := strconv.Atoi(values[index+1])
		if ok && parseErr == nil && id > 0 && mode != "" {
			if attemptsErr != nil || attempts < 0 {
				attempts = 0
			}
			result = append(result, account.QuotaRecoveryEvent{AccountID: id, Mode: mode, DueAt: now, Attempts: attempts, ClaimToken: values[index+2]})
		}
	}
	return result, nil
}

func (s *Store) AckQuotaRecovery(ctx context.Context, value account.QuotaRecoveryEvent) error {
	member := strconv.FormatUint(value.AccountID, 10) + ":" + value.Mode
	result, err := ackQuotaRecoveryScript.Run(ctx, s.client, []string{s.key("quota-recovery", "events"), s.key("quota-recovery", "attempts"), s.key("quota-recovery", "claims")}, member, value.ClaimToken).Int()
	if err != nil {
		return err
	}
	if result == 0 {
		return repository.ErrConflict
	}
	return nil
}

func (s *Store) RescheduleQuotaRecovery(ctx context.Context, value account.QuotaRecoveryEvent) error {
	member := strconv.FormatUint(value.AccountID, 10) + ":" + value.Mode
	result, err := rescheduleQuotaRecoveryScript.Run(ctx, s.client, []string{s.key("quota-recovery", "events"), s.key("quota-recovery", "attempts"), s.key("quota-recovery", "claims")}, member, value.DueAt.UnixMilli(), max(0, value.Attempts), value.ClaimToken).Int()
	if err != nil {
		return err
	}
	if result == 0 {
		return repository.ErrConflict
	}
	return nil
}

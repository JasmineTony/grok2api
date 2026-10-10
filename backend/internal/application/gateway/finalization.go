package gateway

import (
	"context"
	"time"

	"github.com/chenyme/grok2api/backend/internal/domain/audit"
	"github.com/chenyme/grok2api/backend/internal/pkg/perfmetrics"
)

const (
	finalizationHealthBudget    = 750 * time.Millisecond
	finalizationOwnershipBudget = 1500 * time.Millisecond
	finalizationQuotaBudget     = time.Second
	finalizationAuditBudget     = 3 * time.Second
	finalizationMetadataBudget  = 500 * time.Millisecond
)

type finalizationBudget struct {
	deadline  time.Time
	operation string
	provider  string
}

func newFinalizationBudget(operation, provider string) finalizationBudget {
	return finalizationBudget{
		deadline:  time.Now().Add(finalizationTimeout),
		operation: operation,
		provider:  provider,
	}
}

func (b finalizationBudget) run(stage string, limit time.Duration, action func(context.Context) error) error {
	started := time.Now()
	deadline := b.deadline
	if candidate := started.Add(limit); candidate.Before(deadline) {
		deadline = candidate
	}
	ctx, cancel := context.WithDeadline(context.Background(), deadline)
	err := action(ctx)
	cancel()
	outcome := "success"
	if err != nil {
		outcome = "failed"
	}
	perfmetrics.Default.ObserveDuration("finalization_stage_duration_us", perfmetrics.Labels{
		Subsystem: "gateway", Operation: b.operation, Provider: b.provider, Stage: stage, Outcome: outcome,
	}, time.Since(started))
	return err
}

// persistFailureAudit 以独立超时落库失败审计，避免请求取消或收尾预算耗尽丢失记录。
func (s *Service) persistFailureAudit(record audit.Record, requestID string) {
	persistCtx, cancel := context.WithTimeout(context.Background(), finalizationTimeout)
	defer cancel()
	if err := s.audits.Create(persistCtx, record); err != nil {
		s.logger.Error("request_usage_write_failed", "event_id", record.EventID, "request_id", requestID, "error", err)
	}
}

// persistFinalizationAudit 通过收尾预算落库审计记录，失败只记录日志，不回滚已确认的用量。
func (s *Service) persistFinalizationAudit(budget finalizationBudget, record audit.Record, requestID string) {
	if err := budget.run("audit", finalizationAuditBudget, func(stageCtx context.Context) error {
		return s.audits.Create(stageCtx, record)
	}); err != nil {
		s.logger.Error("request_usage_write_failed", "event_id", record.EventID, "request_id", requestID, "error", err)
	}
}

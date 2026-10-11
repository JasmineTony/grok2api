package audit

import (
	"context"
	"errors"
	"time"

	auditdomain "github.com/chenyme/grok2api/backend/internal/domain/audit"
	"github.com/chenyme/grok2api/backend/internal/pkg/batch"
	"github.com/chenyme/grok2api/backend/internal/pkg/perfmetrics"
	"github.com/chenyme/grok2api/backend/internal/repository"
)

func (s *Service) runSupervised() {
	defer close(s.done)
	backoff := 100 * time.Millisecond
	for {
		err := batch.Do(context.Background(), func(context.Context) error {
			s.run()
			return nil
		})
		if err == nil {
			return
		}
		var panicErr *batch.PanicError
		if errors.As(err, &panicErr) {
			s.logger.Error("audit_worker_restarting", "backoff", backoff, "error", panicErr, "stack", string(panicErr.Stack))
		} else {
			s.logger.Error("audit_worker_restarting", "backoff", backoff, "error", err)
		}
		timer := time.NewTimer(backoff)
		select {
		case <-s.stop:
			timer.Stop()
			_ = batch.Do(context.Background(), func(context.Context) error {
				s.run()
				return nil
			})
			return
		case <-timer.C:
		}
		backoff = min(backoff*2, 5*time.Second)
	}
}

// auditWriteLoop 持有批量写入循环的可变状态：计时器、待提交请求与 ack 标记。
// 仅在 run 的调用栈内存在，避免把循环状态摊到多个辅助函数的参数上。
type auditWriteLoop struct {
	service  *Service
	requests []auditWriteRequest
	timer    *time.Timer
	timerC   <-chan time.Time
	hasAck   bool
}

func (l *auditWriteLoop) resetTimer(delay time.Duration) {
	if delay <= 0 {
		delay = auditDefaultCommitDelay
	}
	if l.timer == nil {
		l.timer = time.NewTimer(delay)
	} else {
		if !l.timer.Stop() {
			select {
			case <-l.timer.C:
			default:
			}
		}
		l.timer.Reset(delay)
	}
	l.timerC = l.timer.C
}

func (l *auditWriteLoop) flush() {
	if len(l.requests) == 0 {
		return
	}
	l.service.persistBatch(l.requests)
	l.requests = l.requests[:0]
	l.hasAck = false
	l.timerC = nil
}

func (l *auditWriteLoop) appendRequest(request auditWriteRequest) {
	wasEmpty := len(l.requests) == 0
	l.requests = append(l.requests, request)
	if request.ack != nil && !l.hasAck {
		l.hasAck = true
		l.resetTimer(time.Duration(l.service.commitDelay.Load()))
	} else if wasEmpty {
		l.resetTimer(time.Duration(l.service.flushInterval.Load()))
	}
}

// collectOnStop 在停止信号后排空已入队请求并提交剩余批次。
func (l *auditWriteLoop) collectOnStop() {
	for {
		select {
		case request := <-l.service.queue:
			l.service.notifyQueueSpace()
			l.appendRequest(request)
			if len(l.requests) >= int(l.service.batchSize.Load()) {
				l.flush()
			}
		default:
			l.flush()
			return
		}
	}
}

// applyConfigChange 在批量参数变更后按当前待提交状态重算提交期限。
func (l *auditWriteLoop) applyConfigChange() {
	if len(l.requests) >= int(l.service.batchSize.Load()) {
		l.flush()
		return
	}
	if len(l.requests) == 0 {
		return
	}
	if l.hasAck {
		l.resetTimer(time.Duration(l.service.commitDelay.Load()))
		return
	}
	l.resetTimer(time.Duration(l.service.flushInterval.Load()))
}

func (l *auditWriteLoop) run() {
	defer func() {
		if l.timer != nil {
			l.timer.Stop()
		}
	}()
	for {
		select {
		case request := <-l.service.queue:
			l.service.notifyQueueSpace()
			l.appendRequest(request)
			if len(l.requests) >= int(l.service.batchSize.Load()) {
				l.flush()
			}
		case <-l.timerC:
			l.flush()
		case <-l.service.configChanged:
			l.applyConfigChange()
		case <-l.service.stop:
			l.collectOnStop()
			return
		}
	}
}

func (s *Service) run() {
	loop := auditWriteLoop{service: s, requests: make([]auditWriteRequest, 0, int(s.batchSize.Load()))}
	loop.run()
}

func (s *Service) persistBatch(requests []auditWriteRequest) {
	startedAt := time.Now()
	pending := append([]auditWriteRequest(nil), requests...)
	retryDelay := auditWriteRetryBase
	retryRound := 0
	for len(pending) > 0 {
		lastErr := s.persistAuditRequests(pending)
		var invalid *repository.InvalidBatchRecordError
		if errors.As(lastErr, &invalid) && invalid.Index >= 0 && invalid.Index < len(pending) {
			rejected := pending[invalid.Index]
			completeAuditWrites([]auditWriteRequest{rejected}, lastErr)
			s.recordRejectedAudit(rejected, lastErr)
			pending = append(pending[:invalid.Index], pending[invalid.Index+1:]...)
			continue
		}
		if lastErr == nil {
			records := auditRecords(pending)
			s.recordLedgerSuccess()
			s.notifyCommitted(records)
			perfmetrics.Default.Add("audit_records_total", perfmetrics.Labels{Subsystem: "audit", Stage: "batch", Outcome: "success"}, int64(len(records)))
			perfmetrics.Default.Add("audit_batch_size", perfmetrics.Labels{Subsystem: "audit", Stage: "batch", Outcome: "success"}, int64(len(records)))
			perfmetrics.Default.ObserveDuration("audit_batch_commit_duration_us", perfmetrics.Labels{Subsystem: "audit", Stage: "batch", Outcome: "success"}, time.Since(startedAt))
			completeAuditWrites(pending, nil)
			return
		}
		perfmetrics.Default.Add("audit_batch_size", perfmetrics.Labels{Subsystem: "audit", Stage: "batch", Outcome: "retry"}, int64(len(pending)))
		retryRound++
		var panicErr *batch.PanicError
		if errors.As(lastErr, &panicErr) {
			s.logger.Error("audit_batch_write_retrying", "count", len(pending), "attempts", auditWriteAttempts, "retry_in", retryDelay, "error", panicErr, "stack", string(panicErr.Stack))
		} else if retryRound == 1 {
			s.logger.Warn("audit_batch_write_retrying", "count", len(pending), "attempts", auditWriteAttempts, "retry_in", retryDelay, "error", lastErr)
		} else {
			s.logger.Debug("audit_batch_write_retrying", "count", len(pending), "attempts", auditWriteAttempts, "retry_in", retryDelay, "error", lastErr)
		}
		timer := time.NewTimer(retryDelay)
		<-timer.C
		retryDelay = min(retryDelay*2, auditWriteRetryMax)
	}
}

func (s *Service) persistAuditRequests(requests []auditWriteRequest) error {
	records := auditRecords(requests)
	var lastErr error
	for attempt := 1; attempt <= auditWriteAttempts; attempt++ {
		ctx, cancel := context.WithTimeout(context.Background(), auditWriteTimeout)
		lastErr = batch.Do(ctx, func(workCtx context.Context) error { return s.audits.CreateBatch(workCtx, records) })
		cancel()
		if lastErr == nil {
			return nil
		}
		if errors.Is(lastErr, repository.ErrInvalidRecord) {
			return lastErr
		}
		s.recordLedgerFailure()
		if attempt < auditWriteAttempts {
			timer := time.NewTimer(time.Duration(attempt) * 100 * time.Millisecond)
			select {
			case <-s.stop:
				timer.Stop()
			case <-timer.C:
			}
		}
	}
	return lastErr
}

func auditRecords(requests []auditWriteRequest) []auditdomain.Record {
	records := make([]auditdomain.Record, len(requests))
	for index := range requests {
		records[index] = requests[index].record
	}
	return records
}

func (s *Service) recordRejectedAudit(request auditWriteRequest, err error) {
	dropped := s.dropped.Add(1)
	s.recordLedgerDrop()
	perfmetrics.Default.Inc("audit_records_total", perfmetrics.Labels{Subsystem: "audit", Operation: string(request.record.Operation), Stage: "batch", Outcome: "rejected"})
	s.logger.Error("audit_record_rejected", "event_id", request.record.EventID, "dropped", dropped, "error", err)
	s.notifyDropped(request.record.EventID)
}

func completeAuditWrites(requests []auditWriteRequest, err error) {
	for _, request := range requests {
		if request.ack == nil {
			continue
		}
		select {
		case request.ack <- err:
		default:
		}
	}
}

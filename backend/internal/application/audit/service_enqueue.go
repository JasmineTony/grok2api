package audit

import (
	"context"
	"errors"
	"time"

	"github.com/chenyme/grok2api/backend/internal/pkg/perfmetrics"
)

func (s *Service) tryEnqueue(request auditWriteRequest) error {
	s.lifecycleMu.RLock()
	defer s.lifecycleMu.RUnlock()
	if s.stopped.Load() {
		return ErrWriterUnavailable
	}
	select {
	case s.queue <- request:
		return nil
	default:
		return ErrQueueFull
	}
}

func (s *Service) enqueueBestEffort(ctx context.Context, request auditWriteRequest) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := s.tryEnqueue(request); !errors.Is(err, ErrQueueFull) {
		return err
	}
	s.queueWaiters.Add(1)
	defer s.queueWaiters.Add(-1)
	timer := time.NewTimer(auditEnqueueWait)
	defer timer.Stop()
	for {
		if err := s.tryEnqueue(request); !errors.Is(err, ErrQueueFull) {
			return err
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-s.stop:
			return ErrWriterUnavailable
		case <-timer.C:
			s.recordEnqueueDrop(request, "queue_full")
			return ErrQueueFull
		case <-s.queueSpace:
		}
	}
}

func (s *Service) enqueueAcknowledged(ctx context.Context, request auditWriteRequest) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := s.tryEnqueue(request); !errors.Is(err, ErrQueueFull) {
		return err
	}
	s.queueWaiters.Add(1)
	defer s.queueWaiters.Add(-1)
	for {
		if err := s.tryEnqueue(request); !errors.Is(err, ErrQueueFull) {
			return err
		}
		select {
		case <-ctx.Done():
			s.recordEnqueueDrop(request, "context_done")
			return ctx.Err()
		case <-s.stop:
			s.recordEnqueueDrop(request, "writer_stopping")
			return ErrWriterUnavailable
		case <-s.queueSpace:
		}
	}
}

func (s *Service) notifyQueueSpace() {
	if s.queueWaiters.Load() <= 0 {
		return
	}
	select {
	case s.queueSpace <- struct{}{}:
	default:
	}
}

func (s *Service) recordEnqueueDrop(request auditWriteRequest, reason string) {
	dropped := s.dropped.Add(1)
	s.recordLedgerDrop()
	perfmetrics.Default.Inc("audit_records_total", perfmetrics.Labels{Subsystem: "audit", Operation: string(request.record.Operation), Stage: "enqueue", Outcome: "dropped"})
	if dropped == 1 || dropped%1000 == 0 {
		s.logger.Warn("audit_queue_full", "reason", reason, "dropped", dropped)
	}
	s.notifyDropped(request.record.EventID)
}

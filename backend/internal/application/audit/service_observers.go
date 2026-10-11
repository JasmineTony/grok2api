package audit

import (
	auditdomain "github.com/chenyme/grok2api/backend/internal/domain/audit"
)

func (s *Service) notifyCommitted(records []auditdomain.Record) {
	s.observerMu.RLock()
	observer := s.commitObserver
	s.observerMu.RUnlock()
	if observer == nil {
		return
	}
	eventIDs := make([]string, 0, len(records))
	for _, record := range records {
		if record.EventID != "" {
			eventIDs = append(eventIDs, record.EventID)
		}
	}
	if len(eventIDs) > 0 {
		func() {
			defer func() {
				if recovered := recover(); recovered != nil {
					s.logger.Error("audit_commit_observer_panicked", "error", recovered)
				}
			}()
			observer(eventIDs)
		}()
	}
}

func (s *Service) notifyDropped(eventID string) {
	if eventID == "" {
		return
	}
	s.observerMu.RLock()
	observer := s.dropObserver
	s.observerMu.RUnlock()
	if observer == nil {
		return
	}
	defer func() {
		if recovered := recover(); recovered != nil {
			s.logger.Error("audit_drop_observer_panicked", "error", recovered)
		}
	}()
	observer([]string{eventID})
}

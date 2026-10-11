package gateway

import (
	"time"

	"github.com/chenyme/grok2api/backend/internal/domain/account"
	"github.com/chenyme/grok2api/backend/internal/repository"
)

func (s *Selector) applyHealthInvalidation(event repository.InvalidationEvent) {
	updatedAt := event.PublishedAt.UTC()
	if updatedAt.IsZero() {
		updatedAt = time.Now().UTC()
	}
	expiresAt := updatedAt.Add(routingHealthOverrideTTL)
	if !time.Now().UTC().Before(expiresAt) {
		return
	}
	var cooldownUntil *time.Time
	if event.CooldownUntil != nil {
		value := event.CooldownUntil.UTC()
		cooldownUntil = &value
	}
	overrideLastError := account.NormalizeHealthMarker(event.HealthMarker)
	if overrideLastError == "" && (event.FailureCount > 0 || cooldownUntil != nil) {
		overrideLastError = "upstream failure"
	}
	value := routingHealthOverride{
		provider: event.Provider, failureCount: max(0, event.FailureCount), cooldownUntil: cooldownUntil,
		lastError: overrideLastError, updatedAt: updatedAt, revision: event.Revision, expiresAt: expiresAt,
	}
	s.healthMu.Lock()
	current, exists := s.healthOverrides[event.AccountID]
	if exists {
		if current.revision > 0 && value.revision > 0 && value.revision < current.revision {
			s.healthMu.Unlock()
			return
		}
		if (current.revision == 0 || value.revision == 0) && value.updatedAt.Before(current.updatedAt) {
			s.healthMu.Unlock()
			return
		}
	}
	s.healthOverrides[event.AccountID] = value
	s.healthMu.Unlock()
}

func (s *Selector) applyRoutingHealth(value account.Credential, now time.Time) account.Credential {
	s.healthMu.RLock()
	override, exists := s.healthOverrides[value.ID]
	s.healthMu.RUnlock()
	if !exists || override.provider != value.Provider {
		return value
	}
	if !now.Before(override.expiresAt) {
		s.healthMu.Lock()
		if current, ok := s.healthOverrides[value.ID]; ok && !now.Before(current.expiresAt) {
			delete(s.healthOverrides, value.ID)
		}
		s.healthMu.Unlock()
		return value
	}
	value.FailureCount = override.failureCount
	value.CooldownUntil = override.cooldownUntil
	value.LastError = override.lastError
	return value
}

func (s *Selector) routingHealthSnapshot(provider account.Provider, now time.Time) map[uint64]routingHealthOverride {
	var result map[uint64]routingHealthOverride
	expired := make([]uint64, 0)
	s.healthMu.RLock()
	for accountID, value := range s.healthOverrides {
		if !now.Before(value.expiresAt) {
			expired = append(expired, accountID)
			continue
		}
		if value.provider == provider {
			if result == nil {
				result = make(map[uint64]routingHealthOverride)
			}
			result[accountID] = value
		}
	}
	s.healthMu.RUnlock()
	if len(expired) > 0 {
		s.healthMu.Lock()
		for _, accountID := range expired {
			if value, ok := s.healthOverrides[accountID]; ok && !now.Before(value.expiresAt) {
				delete(s.healthOverrides, accountID)
			}
		}
		s.healthMu.Unlock()
	}
	return result
}

func applyHealthSnapshot(value account.Credential, overrides map[uint64]routingHealthOverride) account.Credential {
	if override, ok := overrides[value.ID]; ok && override.provider == value.Provider {
		value.FailureCount = override.failureCount
		value.CooldownUntil = override.cooldownUntil
		value.LastError = override.lastError
	}
	return value
}

func (s *Selector) clearHealthOverrides(provider account.Provider, accountID uint64) {
	s.healthMu.Lock()
	defer s.healthMu.Unlock()
	if accountID != 0 {
		delete(s.healthOverrides, accountID)
		return
	}
	if provider == "" {
		clear(s.healthOverrides)
		return
	}
	for id, value := range s.healthOverrides {
		if value.provider == provider {
			delete(s.healthOverrides, id)
		}
	}
}

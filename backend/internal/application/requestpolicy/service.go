package requestpolicy

import (
	"context"
	"errors"
	"strings"
	"sync/atomic"
	"time"

	notificationdomain "github.com/chenyme/grok2api/backend/internal/domain/notification"
	policydomain "github.com/chenyme/grok2api/backend/internal/domain/requestpolicy"
	"github.com/chenyme/grok2api/backend/internal/repository"
)

type notificationPublisher interface {
	Publish(context.Context, notificationdomain.Event) (notificationdomain.Event, bool, error)
}

type Service struct {
	repository    repository.RequestPolicyRepository
	rules         atomic.Value
	notifications notificationPublisher
	now           func() time.Time
}

func NewService(repo repository.RequestPolicyRepository) (*Service, error) {
	if repo == nil {
		return nil, errors.New("request policy repository is required")
	}
	service := &Service{repository: repo, now: time.Now}
	service.rules.Store([]policydomain.Rule(nil))
	return service, nil
}

func (s *Service) SetNotifications(value notificationPublisher) { s.notifications = value }
func (s *Service) Refresh(ctx context.Context) error {
	values, err := s.repository.ListRequestPolicies(ctx)
	if err != nil {
		return err
	}
	s.rules.Store(policydomain.SortRules(values))
	return nil
}
func (s *Service) List(ctx context.Context) ([]policydomain.Rule, error) {
	return s.repository.ListRequestPolicies(ctx)
}
func (s *Service) Get(ctx context.Context, id uint64) (policydomain.Rule, error) {
	return s.repository.GetRequestPolicy(ctx, id)
}
func (s *Service) Create(ctx context.Context, value policydomain.Rule) (policydomain.Rule, error) {
	if err := policydomain.ValidateRule(value); err != nil {
		return policydomain.Rule{}, err
	}
	created, err := s.repository.CreateRequestPolicy(ctx, value)
	if err == nil {
		err = s.Refresh(ctx)
	}
	return created, err
}
func (s *Service) Update(ctx context.Context, value policydomain.Rule) (policydomain.Rule, error) {
	if err := policydomain.ValidateRule(value); err != nil {
		return policydomain.Rule{}, err
	}
	updated, err := s.repository.UpdateRequestPolicy(ctx, value)
	if err == nil {
		err = s.Refresh(ctx)
	}
	return updated, err
}
func (s *Service) Delete(ctx context.Context, id uint64) error {
	if err := s.repository.DeleteRequestPolicy(ctx, id); err != nil {
		return err
	}
	return s.Refresh(ctx)
}

func (s *Service) Evaluate(ctx context.Context, request policydomain.Request) (policydomain.Decision, error) {
	values, _ := s.rules.Load().([]policydomain.Rule)
	decision := policydomain.Evaluate(values, request)
	if decision.MaxTokens != nil && request.Tokens > *decision.MaxTokens {
		decision.Allowed = false
		decision.Reason = "request token limit exceeded"
	}
	if decision.MaxMedia != nil && request.Media && request.MediaCount > *decision.MaxMedia {
		decision.Allowed = false
		decision.Reason = "request media limit exceeded"
	}
	if len(decision.MatchedRuleIDs) > 0 {
		if err := s.repository.RecordRequestPolicyHits(ctx, decision.MatchedRuleIDs, s.now().UTC()); err != nil {
			return decision, err
		}
	}
	if !decision.Allowed && !decision.DryRun && s.notifications != nil {
		_, _, _ = s.notifications.Publish(context.WithoutCancel(ctx), notificationdomain.Event{EventKey: "request_policy_denied", Severity: notificationdomain.SeverityWarning, Title: "Request policy denied a request", Body: "A request was rejected by rule " + sanitize(decision.RuleName) + ".", DedupKey: "request-policy-denied:" + sanitize(decision.RuleName)})
	}
	return decision, nil
}

func sanitize(value string) string {
	value = strings.TrimSpace(value)
	if len(value) > 120 {
		value = value[:120]
	}
	return value
}

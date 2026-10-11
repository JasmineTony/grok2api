package invalidation

import (
	"context"
	"log/slog"
	"sync/atomic"
	"time"

	"github.com/chenyme/grok2api/backend/internal/repository"
)

const (
	defaultQueueSize  = 2048
	publishTimeout    = 500 * time.Millisecond
	logSampleInterval = 1000
	maxCoalesceBatch  = defaultQueueSize
)

type Service struct {
	bus      repository.InvalidationBus
	source   string
	logger   *slog.Logger
	handler  func(repository.InvalidationEvent)
	queue    chan repository.InvalidationEvent
	dropped  atomic.Uint64
	failures atomic.Uint64
}

func NewService(bus repository.InvalidationBus, source string, handler func(repository.InvalidationEvent), logger *slog.Logger) *Service {
	if logger == nil {
		logger = slog.Default()
	}
	if handler == nil {
		handler = func(repository.InvalidationEvent) {}
	}
	return &Service{bus: bus, source: source, logger: logger, handler: handler, queue: make(chan repository.InvalidationEvent, defaultQueueSize)}
}

// Notify applies local invalidation synchronously and queues remote delivery.
// Local correctness never depends on Redis availability or queue capacity.
func (s *Service) Notify(ctx context.Context, event repository.InvalidationEvent) {
	if s == nil || !event.Valid() {
		return
	}
	if event.SourceInstance == "" {
		event.SourceInstance = s.source
	}
	if event.PublishedAt.IsZero() {
		event.PublishedAt = time.Now().UTC()
	}
	s.handler(event)
	if s.bus == nil {
		return
	}
	select {
	case s.queue <- event:
	default:
		dropped := s.dropped.Add(1)
		if dropped == 1 || dropped%logSampleInterval == 0 {
			s.logger.Warn("invalidation_publish_queue_full", "dropped", dropped)
		}
	}
}

// RunPublisher drains the bounded remote notification queue until shutdown.
func (s *Service) RunPublisher(ctx context.Context) error {
	if s == nil || s.bus == nil {
		<-ctx.Done()
		return nil
	}
	for {
		select {
		case <-ctx.Done():
			return nil
		case event := <-s.queue:
			pending := s.coalescePending(event)
			s.publishPending(ctx, pending)
		}
	}
}

// coalescePending collects the events already queued behind first so that
// repeated invalidations of the same key collapse into a single remote publish.
func (s *Service) coalescePending(first repository.InvalidationEvent) map[invalidationKey]repository.InvalidationEvent {
	pending := map[invalidationKey]repository.InvalidationEvent{eventKey(first): first}
drain:
	for drained := 1; drained < maxCoalesceBatch; drained++ {
		select {
		case next := <-s.queue:
			pending[eventKey(next)] = next
		default:
			break drain
		}
	}
	return pending
}

// publishPending delivers one coalesced batch and samples publish failures.
func (s *Service) publishPending(ctx context.Context, pending map[invalidationKey]repository.InvalidationEvent) {
	for _, next := range pending {
		publishCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), publishTimeout)
		err := s.bus.PublishInvalidation(publishCtx, next)
		cancel()
		if err != nil {
			failures := s.failures.Add(1)
			if failures == 1 || failures%logSampleInterval == 0 {
				s.logger.Warn("invalidation_publish_failed", "failures", failures, "error", err)
			}
		}
	}
}

type invalidationKey struct {
	layer       repository.InvalidationLayer
	provider    string
	accountID   uint64
	clientKeyID uint64
}

func eventKey(event repository.InvalidationEvent) invalidationKey {
	key := invalidationKey{layer: event.Layer(), provider: string(event.Provider)}
	if key.layer == repository.InvalidationLayerClientKey {
		key.clientKeyID = event.ClientKeyID
	} else if event.Kind == repository.InvalidationAccountHealthChanged {
		// Health events are intentionally account-scoped. Coalescing different
		// accounts would silently drop cooldown updates on multi-replica setups.
		key.accountID = event.AccountID
	}
	return key
}

// RunSubscriber consumes remote events. Pub/Sub delivery is best effort; the
// local cache TTL remains the correctness fallback when events are missed.
func (s *Service) RunSubscriber(ctx context.Context) error {
	if s == nil || s.bus == nil {
		<-ctx.Done()
		return nil
	}
	return s.bus.ListenInvalidations(ctx, func(eventCtx context.Context, event repository.InvalidationEvent) error {
		if !event.Valid() || event.SourceInstance == s.source {
			return nil
		}
		s.handler(event)
		return nil
	})
}

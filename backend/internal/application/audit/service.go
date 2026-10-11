package audit

import (
	"context"
	"errors"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	auditdomain "github.com/chenyme/grok2api/backend/internal/domain/audit"
	"github.com/chenyme/grok2api/backend/internal/pkg/perfmetrics"
	"github.com/chenyme/grok2api/backend/internal/pkg/requestmeta"
	"github.com/chenyme/grok2api/backend/internal/pkg/resultcache"
	"github.com/chenyme/grok2api/backend/internal/repository"
)

var (
	ErrQueueFull         = errors.New("审计写入队列已满")
	ErrWriterUnavailable = errors.New("audit writer is not running")
	ErrInvalidCursor     = errors.New("审计游标无效")
	ErrInvalidFilter     = errors.New("审计筛选条件无效")
	ErrInvalidPeriod     = errors.New("审计时间范围无效")
	ErrLedgerUnavailable = errors.New("billing ledger is not ready")
)

type LedgerMode string

const (
	LedgerModeObserve LedgerMode = "observe"
	LedgerModeEnforce LedgerMode = "enforce"
)

type LedgerConfig struct {
	Mode                      LedgerMode
	FailureThreshold          int
	UnhealthyGrace            time.Duration
	QueueHighWatermarkPercent int
}

type LedgerSnapshot struct {
	Mode                LedgerMode
	Ready               bool
	Irrecoverable       bool
	QueueDepth          int
	QueueCapacity       int
	ConsecutiveFailures int
	Dropped             uint64
	LastSuccessAt       time.Time
	LastFailureAt       time.Time
	UnhealthySince      time.Time
}

type Period string

const (
	Period24Hours Period = "24h"
	Period7Days   Period = "7d"
	Period30Days  Period = "30d"
	Period90Days  Period = "90d"
)

const (
	auditEnqueueWait         = 25 * time.Millisecond
	auditWriteTimeout        = 2 * time.Second
	auditWriteAttempts       = 3
	auditWriteRetryBase      = 250 * time.Millisecond
	auditWriteRetryMax       = 5 * time.Second
	auditDefaultCommitDelay  = 5 * time.Millisecond
	auditSummaryTTL          = 10 * time.Second
	requestMethodLimit       = 16
	requestPathLimit         = 2048
	requestHeaderNameLimit   = 256
	requestHeaderValueLimit  = 2048
	requestHeaderValuesLimit = 32
	requestHeaderCountLimit  = 128
	requestHeadersLimit      = 32 << 10
)

type auditWriteRequest struct {
	record auditdomain.Record
	ack    chan error
}

// Service 提供请求元数据审计查询，以及有界异步批量写入。
type Service struct {
	audits               repository.AuditRepository
	logger               *slog.Logger
	queue                chan auditWriteRequest
	batchSize            atomic.Int64
	flushInterval        atomic.Int64
	commitDelay          atomic.Int64
	configChanged        chan struct{}
	lifecycleMu          sync.RWMutex
	queueSpace           chan struct{}
	queueWaiters         atomic.Int64
	startOnce            sync.Once
	stopOnce             sync.Once
	stop                 chan struct{}
	done                 chan struct{}
	stopped              atomic.Bool
	started              atomic.Bool
	dropped              atomic.Uint64
	now                  func() time.Time
	summaryCache         *resultcache.Cache[string, SummaryResult]
	ledgerMu             sync.Mutex
	ledgerConfig         LedgerConfig
	ledgerFailures       int
	ledgerUnhealthySince time.Time
	ledgerLastSuccess    time.Time
	ledgerLastFailure    time.Time
	ledgerLastDrop       time.Time
	ledgerQueueHighSince time.Time
	ledgerLastWarning    time.Time
	observerMu           sync.RWMutex
	commitObserver       func([]string)
	dropObserver         func([]string)
}

func NewService(audits repository.AuditRepository, logger *slog.Logger, bufferSize, batchSize int, flushInterval time.Duration) *Service {
	if logger == nil {
		logger = slog.Default()
	}
	service := &Service{
		audits: audits, logger: logger, queue: make(chan auditWriteRequest, bufferSize),
		configChanged: make(chan struct{}, 1), queueSpace: make(chan struct{}, bufferSize), stop: make(chan struct{}), done: make(chan struct{}),
		now: time.Now, summaryCache: resultcache.New[string, SummaryResult](64, auditSummaryTTL),
		ledgerConfig: defaultLedgerConfig(),
	}
	service.UpdateConfig(batchSize, flushInterval)
	return service
}

func defaultLedgerConfig() LedgerConfig {
	return LedgerConfig{
		Mode:                      LedgerModeEnforce,
		FailureThreshold:          1,
		UnhealthyGrace:            10 * time.Second,
		QueueHighWatermarkPercent: 90,
	}
}

// UpdateLedgerConfig changes readiness policy without altering the audit writer.
func (s *Service) UpdateLedgerConfig(value LedgerConfig) {
	defaults := defaultLedgerConfig()
	if value.Mode != LedgerModeObserve && value.Mode != LedgerModeEnforce {
		value.Mode = defaults.Mode
	}
	if value.FailureThreshold <= 0 {
		value.FailureThreshold = defaults.FailureThreshold
	}
	if value.UnhealthyGrace <= 0 {
		value.UnhealthyGrace = defaults.UnhealthyGrace
	}
	if value.QueueHighWatermarkPercent < 1 || value.QueueHighWatermarkPercent > 100 {
		value.QueueHighWatermarkPercent = defaults.QueueHighWatermarkPercent
	}
	s.ledgerMu.Lock()
	s.ledgerConfig = value
	s.ledgerMu.Unlock()
}

// SetCommitObserver registers a lightweight callback invoked after the audit and billing transaction commits.
func (s *Service) SetCommitObserver(observer func([]string)) {
	s.observerMu.Lock()
	s.commitObserver = observer
	s.observerMu.Unlock()
}

// SetDropObserver registers a callback for records that can no longer enter
// the writer. It must not release the durable billing reservation itself.
func (s *Service) SetDropObserver(observer func([]string)) {
	s.observerMu.Lock()
	s.dropObserver = observer
	s.observerMu.Unlock()
}

func (s *Service) UpdateConfig(batchSize int, flushInterval time.Duration) {
	s.UpdateWriterConfig(batchSize, flushInterval, time.Duration(s.commitDelay.Load()))
}

// UpdateWriterConfig hot-reloads batching limits without replacing the active queue.
func (s *Service) UpdateWriterConfig(batchSize int, flushInterval, commitDelay time.Duration) {
	if commitDelay <= 0 {
		commitDelay = auditDefaultCommitDelay
	}
	s.batchSize.Store(int64(batchSize))
	s.flushInterval.Store(int64(flushInterval))
	s.commitDelay.Store(int64(commitDelay))
	select {
	case s.configChanged <- struct{}{}:
	default:
	}
}

// Start 启动单个审计写入协程，将请求热路径与关系型数据库批量写入解耦。
func (s *Service) Start() {
	s.startOnce.Do(func() {
		s.started.Store(true)
		go s.runSupervised()
	})
}

// Record 将审计写入有界队列；突发满载时短暂等待，持续拥塞才降级丢弃审计。
func (s *Service) Record(value auditdomain.Record) bool {
	return s.enqueueBestEffort(context.Background(), auditWriteRequest{record: sanitizeRequestMetadata(value)}) == nil
}

// Create returns success only after the audit and billing transaction commits.
func (s *Service) Create(ctx context.Context, value auditdomain.Record) error {
	return s.createAcknowledged(ctx, value)
}

// CreateDurable returns success only after the audit and billing transaction commits.
func (s *Service) CreateDurable(ctx context.Context, value auditdomain.Record) error {
	return s.createAcknowledged(ctx, value)
}

func (s *Service) createAcknowledged(ctx context.Context, value auditdomain.Record) error {
	startedAt := time.Now()
	if err := ctx.Err(); err != nil {
		return err
	}
	if value.ClientIP == "" {
		value.ClientIP = requestmeta.ClientIP(ctx)
	}
	value = sanitizeRequestMetadata(value)
	if !s.started.Load() || s.stopped.Load() {
		return ErrWriterUnavailable
	}
	request := auditWriteRequest{record: value, ack: make(chan error, 1)}
	if err := s.enqueueAcknowledged(ctx, request); err != nil {
		return err
	}
	select {
	case err := <-request.ack:
		outcome := "success"
		if err != nil {
			outcome = "failed"
		}
		labels := perfmetrics.Labels{Subsystem: "audit", Operation: string(value.Operation), Stage: "ack", Outcome: outcome}
		perfmetrics.Default.Inc("audit_records_total", labels)
		perfmetrics.Default.ObserveDuration("audit_ack_duration_us", labels, time.Since(startedAt))
		return err
	case <-ctx.Done():
		labels := perfmetrics.Labels{Subsystem: "audit", Operation: string(value.Operation), Stage: "ack", Outcome: "timeout"}
		perfmetrics.Default.Inc("audit_records_total", labels)
		perfmetrics.Default.ObserveDuration("audit_ack_duration_us", labels, time.Since(startedAt))
		return ctx.Err()
	}
}

// Close 停止接收新审计并尽力排空队列。
func (s *Service) Close(ctx context.Context) error {
	if !s.started.Load() {
		s.Start()
	}
	s.stopOnce.Do(func() {
		s.lifecycleMu.Lock()
		s.stopped.Store(true)
		close(s.stop)
		s.lifecycleMu.Unlock()
	})
	select {
	case <-s.done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

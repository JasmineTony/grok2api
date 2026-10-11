package gateway

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	accountdomain "github.com/chenyme/grok2api/backend/internal/domain/account"
	"github.com/chenyme/grok2api/backend/internal/domain/audit"
	"github.com/chenyme/grok2api/backend/internal/domain/clientkey"
	modeldomain "github.com/chenyme/grok2api/backend/internal/domain/model"
	infraegress "github.com/chenyme/grok2api/backend/internal/infra/egress"
	"github.com/chenyme/grok2api/backend/internal/pkg/requestmeta"
	"github.com/chenyme/grok2api/backend/internal/ports/provider"
)

type VoiceWebSocketInput struct {
	RequestID   string
	ClientKey   clientkey.Key
	PublicModel string
	// Path is one of /realtime or /stt.
	Path string
}

type VoiceWebSocketSession struct {
	Conn        provider.VoiceWebSocketConn
	Finalize    func(VoiceWebSocketOutcome)
	RequestID   string
	PublicModel string
	Provider    accountdomain.Provider
	AccountID   uint64
	AccountName string
	Operation   audit.Operation
	Capability  modeldomain.Capability
}

type VoiceWebSocketOutcome struct {
	ErrorCode            string
	UpstreamFailed       bool
	AudioDurationSeconds float64
}

// OpenVoiceWebSocket selects a Console account and dials the upstream voice websocket.
func (s *Service) OpenVoiceWebSocket(ctx context.Context, input VoiceWebSocketInput) (*VoiceWebSocketSession, error) {
	run, err := s.startVoiceWebSocketRun(ctx, input)
	if err != nil {
		return nil, err
	}
	for attempt := 0; run.attemptPolicy.allows(attempt); attempt++ {
		session, attemptErr := run.attempt(attempt)
		if session != nil || attemptErr != nil {
			return session, attemptErr
		}
	}
	if run.lastErr != nil {
		return nil, run.lastErr
	}
	return nil, ErrNoAvailableAccount
}

// voiceWebSocketRun 承载一次语音 websocket 会话建立的固定输入与尝试状态。
type voiceWebSocketRun struct {
	service               *Service
	ctx                   context.Context
	path                  string
	requestID             string
	clientKey             clientkey.Key
	capability            modeldomain.Capability
	operation             audit.Operation
	route                 modeldomain.Route
	externalModel         string
	auditBase             audit.Record
	egressTrace           *infraegress.Trace
	startedAt             time.Time
	quotaMode             string
	attemptPolicy         routingAttemptPolicy
	excluded              map[uint64]bool
	selection             *selectionSession
	lastCredentialFailure *accountdomain.Credential
	lastErr               error
}

// startVoiceWebSocketRun 解析路径与候选路由、组装审计基线并初始化尝试状态。
func (s *Service) startVoiceWebSocketRun(ctx context.Context, input VoiceWebSocketInput) (*voiceWebSocketRun, error) {
	pathValue := strings.TrimSpace(input.Path)
	capability, operation, defaultModel, err := voiceWebSocketRoute(pathValue)
	if err != nil {
		return nil, err
	}
	publicModel := strings.TrimSpace(input.PublicModel)
	if publicModel == "" {
		publicModel = defaultModel
	}
	ctx, egressTrace := infraegress.WithTrace(ctx)
	startedAt := time.Now()
	eventID := newAuditEventID()
	route, preselectedSession, err := s.selectVoiceWebSocketRoute(ctx, publicModel, input.ClientKey, capability)
	if err != nil {
		return nil, err
	}
	run := &voiceWebSocketRun{
		service: s, ctx: ctx, path: pathValue, requestID: input.RequestID, clientKey: input.ClientKey,
		capability: capability, operation: operation, route: route,
		externalModel: modeldomain.ExternalPublicID(route.Provider, route.PublicID),
		egressTrace:   egressTrace, startedAt: startedAt, excluded: make(map[uint64]bool), selection: preselectedSession,
	}
	run.auditBase = audit.Record{
		EventID: eventID, RequestID: input.RequestID, ClientKeyID: input.ClientKey.ID, ClientKeyName: input.ClientKey.Name,
		ClientIP:     requestmeta.ClientIP(ctx),
		ModelRouteID: route.ID, ModelPublicID: run.externalModel, ModelUpstreamModel: modeldomain.DisplayUpstreamModel(route.Provider, route.UpstreamModel),
		Provider: string(route.Provider), Operation: operation, UsageSource: audit.UsageSourceNone, Streaming: true,
	}
	if err := s.checkLedgerReady(); err != nil {
		return nil, err
	}
	run.quotaMode = s.providers.QuotaMode(route.Provider, route.UpstreamModel)
	run.attemptPolicy = newRoutingAttemptPolicy(int(s.maxAttempts.Load()))
	return run, nil
}

// selectVoiceWebSocketRoute 选择支持语音 websocket 的可调度路由；全部候选冷却或耗尽时回退到普通选择以保留审计。
func (s *Service) selectVoiceWebSocketRoute(ctx context.Context, publicModel string, key clientkey.Key, capability modeldomain.Capability) (modeldomain.Route, *selectionSession, error) {
	routes, err := s.models.GetByPublicIDCandidates(ctx, publicModel)
	if err != nil {
		return modeldomain.Route{}, nil, ErrModelNotFound
	}
	supportsVoiceWebSocket := func(providerValue accountdomain.Provider) bool {
		_, ok := s.providers.VoiceWebSocket(providerValue)
		return ok
	}
	route, preselectedSession, err := s.selectSchedulableMediaRoute(ctx, routes, key, capability, true, supportsVoiceWebSocket)
	if err == nil {
		return route, preselectedSession, nil
	}
	// Preserve selection-failure audits when every eligible target is cooling
	// or exhausted. The regular request loop will reproduce the error.
	route, err = s.selectMediaRoute(routes, key, capability, supportsVoiceWebSocket)
	if err != nil {
		return modeldomain.Route{}, nil, err
	}
	return route, nil, nil
}

// attempt 执行一轮账号获取、凭证校验与上游拨号；返回会话、错误或 nil,nil 表示换号重试。
func (run *voiceWebSocketRun) attempt(attempt int) (*VoiceWebSocketSession, error) {
	s := run.service
	lease, err := run.acquireLease()
	if err != nil {
		return nil, err
	}
	credential, err := s.accounts.EnsureCredential(run.ctx, lease.Credential, false)
	if err != nil {
		run.rememberCredentialFailure(lease.Credential)
		run.lastErr = err
		lease.Release()
		return nil, nil
	}
	adapter, ok := s.providers.VoiceWebSocket(run.route.Provider)
	if !ok {
		lease.Release()
		run.writeFailureAudit(http.StatusBadGateway, "upstream_unavailable", &credential)
		return nil, ErrNoAvailableAccount
	}
	lease.markSelectorUpstreamStarted()
	conn, cleanup, dialErr := adapter.DialVoiceWebSocket(run.ctx, provider.VoiceWebSocketRequest{
		Credential: credential,
		Path:       run.path,
		Model:      run.route.UpstreamModel,
	})
	if dialErr != nil {
		return run.handleDialFailure(attempt, lease, credential, cleanup, dialErr)
	}
	return run.buildSession(lease, credential, conn, cleanup), nil
}

// acquireLease 为当前尝试获取账号租约；账号池不可用时落库失败审计并返回统一错误。
func (run *voiceWebSocketRun) acquireLease() (*accountLease, error) {
	s := run.service
	var err error
	if run.selection == nil {
		run.selection, err = s.selector.beginSelectionSessionForKey(run.ctx, run.route.Provider, run.route.ID, run.route.UpstreamModel, run.quotaMode, "", run.excluded, false, run.clientKey.AccountScope())
	}
	if err != nil {
		return nil, run.selectionUnavailableError(err)
	}
	lease, err := run.selection.Acquire(run.ctx, run.excluded, false)
	if err != nil {
		return nil, run.selectionUnavailableError(err)
	}
	run.excluded[lease.Credential.ID] = true
	return lease, nil
}

// selectionUnavailableError 落库账号选择失败审计并返回统一错误。
func (run *voiceWebSocketRun) selectionUnavailableError(err error) error {
	errorCode := "upstream_unavailable"
	var selectionFailure *SelectionUnavailableError
	if errors.As(err, &selectionFailure) {
		errorCode = selectionFailure.Code()
	}
	run.writeFailureAudit(http.StatusServiceUnavailable, errorCode, run.lastCredentialFailure)
	return fmt.Errorf("%w: %w", ErrNoAvailableAccount, err)
}

// handleDialFailure 处理上游拨号失败；返回 nil,nil 表示换号重试，否则返回会话或终态错误。
func (run *voiceWebSocketRun) handleDialFailure(attempt int, lease *accountLease, credential accountdomain.Credential, cleanup func(), dialErr error) (*VoiceWebSocketSession, error) {
	if cleanup != nil {
		cleanup()
	}
	if status, ok := provider.ErrorHTTPStatus(dialErr); ok {
		return run.handleDialHTTPFailure(attempt, lease, credential, status, dialErr)
	}
	return run.handleDialTransportFailure(attempt, lease, credential, dialErr)
}

// handleDialHTTPFailure 按上游返回的 HTTP 状态处理拨号失败。
func (run *voiceWebSocketRun) handleDialHTTPFailure(attempt int, lease *accountLease, credential accountdomain.Credential, status int, dialErr error) (*VoiceWebSocketSession, error) {
	failure := newHTTPUpstreamFailure(status, nil, credential.ID, credential.Name)
	failure.RequestScopedForbidden = provider.IsRequestScopedError(dialErr)
	failure.RetryAfter = provider.ErrorRetryAfter(dialErr)
	failure.Cause = dialErr
	run.lastErr = failure
	if run.retryDialFailure(attempt, lease, credential, status, failure) {
		return nil, nil
	}
	lease.Release()
	run.writeFailureAudit(failure.HTTPStatus, failure.AuditCode(), &credential)
	return nil, failure
}

// retryDialFailure 判定带状态码的拨号失败是否换号重试，并按状态标记账号或出口。
func (run *voiceWebSocketRun) retryDialFailure(attempt int, lease *accountLease, credential accountdomain.Credential, status int, failure *UpstreamFailure) bool {
	s := run.service
	switch {
	case status == http.StatusUnauthorized && credential.AuthType == accountdomain.AuthTypeSSO:
		s.markSSOCredentialRejected(run.ctx, credential, fmt.Sprintf("%s SSO credential rejected", credential.Provider))
		run.rememberCredentialFailure(credential)
	case status == http.StatusForbidden && s.providers.RetryForbiddenAsEgress(credential.Provider) && !failure.RequestScopedForbidden && attempt == 0 && run.attemptPolicy.hasNext(attempt):
		run.retryAccount(credential.ID)
	case status == http.StatusPaymentRequired || status == http.StatusTooManyRequests:
		run.markDialRateLimit(credential, status, failure.RetryAfter, lease)
		if !run.attemptPolicy.hasNext(attempt) {
			return false
		}
	case status >= http.StatusInternalServerError && run.attemptPolicy.hasNext(attempt):
	default:
		return false
	}
	lease.Release()
	return true
}

// markDialRateLimit 对 402/429 拨号失败对账远端额度窗口，否则直接标记账号失败。
func (run *voiceWebSocketRun) markDialRateLimit(credential accountdomain.Credential, status int, retryAfter time.Duration, lease *accountLease) {
	s := run.service
	if quotaKind, _ := s.providers.QuotaKind(credential.Provider); quotaKind == provider.QuotaRemoteWindow && lease.QuotaMode != "" {
		state, reconcileErr := s.accounts.ReconcileRateLimit(run.ctx, credential.ID, lease.QuotaMode, retryAfter)
		s.applyRateLimitReconciliation(run.ctx, credential, status, retryAfter, state, reconcileErr)
		return
	}
	s.selector.MarkFailure(run.ctx, credential, status, retryAfter)
}

// handleDialTransportFailure 处理无 HTTP 状态的传输层拨号失败。
func (run *voiceWebSocketRun) handleDialTransportFailure(attempt int, lease *accountLease, credential accountdomain.Credential, dialErr error) (*VoiceWebSocketSession, error) {
	s := run.service
	run.lastErr = dialErr
	if isSSOCredentialRejected(dialErr, credential) {
		s.markSSOCredentialRejected(run.ctx, credential, fmt.Sprintf("%s SSO credential rejected", credential.Provider))
		run.rememberCredentialFailure(credential)
		lease.Release()
		return nil, nil
	}
	failure := newTransportUpstreamFailure(dialErr, credential.ID, credential.Name)
	run.lastErr = failure
	if run.ctx.Err() == nil && isRetryableTransportFailure(credential.Provider, dialErr) && attempt == 0 && run.attemptPolicy.hasNext(attempt) {
		run.retryAccount(credential.ID)
		lease.Release()
		return nil, nil
	}
	lease.Release()
	run.writeFailureAudit(failure.HTTPStatus, failure.AuditCode(), &credential)
	return nil, failure
}

// retryAccount 允许同一账号在本轮重试：移出排除集合并复位选择会话中的账号状态。
func (run *voiceWebSocketRun) retryAccount(accountID uint64) {
	delete(run.excluded, accountID)
	if run.selection != nil {
		run.selection.RetryAccount(accountID)
	}
}

// rememberCredentialFailure 记录最近一次被上游拒绝的凭证，供选择失败审计使用。
func (run *voiceWebSocketRun) rememberCredentialFailure(credential accountdomain.Credential) {
	failed := credential
	run.lastCredentialFailure = &failed
}

// buildSession 构造客户端会话，并绑定一次性 finalize 收尾。
func (run *voiceWebSocketRun) buildSession(lease *accountLease, credential accountdomain.Credential, conn provider.VoiceWebSocketConn, cleanup func()) *VoiceWebSocketSession {
	var finalizeOnce sync.Once
	finalize := func(outcome VoiceWebSocketOutcome) {
		finalizeOnce.Do(func() { run.finalizeSession(lease, credential, cleanup, outcome) })
	}
	return &VoiceWebSocketSession{
		Conn: conn, Finalize: finalize, RequestID: run.requestID, PublicModel: run.externalModel,
		Provider: run.route.Provider, AccountID: credential.ID, AccountName: credential.Name,
		Operation: run.operation, Capability: run.capability,
	}
}

// finalizeSession 完成一次语音 websocket 会话的收尾：清理、租约释放、额度结算与审计落库。
func (run *voiceWebSocketRun) finalizeSession(lease *accountLease, credential accountdomain.Credential, cleanup func(), outcome VoiceWebSocketOutcome) {
	s := run.service
	if cleanup != nil {
		cleanup()
	}
	successful := strings.TrimSpace(outcome.ErrorCode) == ""
	// 上游已完成并返回确认时长时用量就已产生：即使下游传输中途断开，
	// key 计费与账号额度结算也必须按同一口径推进，避免账实不符（issue #1072）。
	usageConfirmed := successful || (run.operation == audit.OperationSTT && outcome.AudioDurationSeconds > 0)
	lease.completeSelectorObservation(!outcome.UpstreamFailed)
	lease.Release()
	budget := newFinalizationBudget(string(run.operation), string(run.route.Provider))
	accountID := credential.ID
	if usageConfirmed {
		run.settleSessionQuota(budget, accountID)
	}
	record := run.auditBase
	record.StatusCode, record.ErrorCode = voiceWebSocketAuditOutcome(outcome)
	record.DurationMS = time.Since(run.startedAt).Milliseconds()
	record.CreatedAt = time.Now().UTC()
	record.AccountID = &accountID
	record.AccountName = credential.Name
	applyAuditEgress(&record, run.egressTrace, run.route.Provider)
	run.applySTTPricing(&record, outcome)
	if auditErr := budget.run("audit", finalizationAuditBudget, func(stageCtx context.Context) error {
		return s.audits.Create(stageCtx, record)
	}); auditErr != nil {
		s.logger.Error("request_usage_write_failed", "event_id", record.EventID, "request_id", run.requestID, "error", auditErr)
	}
}

// settleSessionQuota 在收尾预算内扣减账号额度（非 weekly）并推进远端窗口刷新。
func (run *voiceWebSocketRun) settleSessionQuota(budget finalizationBudget, accountID uint64) {
	s := run.service
	if run.quotaMode == "" {
		return
	}
	if run.quotaMode != "weekly" {
		var updated bool
		err := budget.run("quota_decrement", finalizationQuotaBudget, func(stageCtx context.Context) error {
			var decrementErr error
			updated, decrementErr = s.accounts.DecrementQuota(stageCtx, accountID, run.quotaMode, 1)
			return decrementErr
		})
		if err != nil {
			s.logger.Warn("voice_quota_decrement_failed", "provider", run.route.Provider, "account_id", accountID, "mode", run.quotaMode, "units", 1, "error", err)
		} else if updated {
			s.selector.ConsumeQuota(run.route.Provider, accountID, run.quotaMode, 1)
		}
	}
	if quotaKind, _ := s.providers.QuotaKind(run.route.Provider); quotaKind == provider.QuotaRemoteWindow {
		s.accounts.QueueQuotaRefresh(accountID, run.quotaMode)
	}
}

// applySTTPricing 按已确认的音频时长为 STT 请求补齐官方报价。
func (run *voiceWebSocketRun) applySTTPricing(record *audit.Record, outcome VoiceWebSocketOutcome) {
	if run.operation != audit.OperationSTT {
		return
	}
	// 计费只看是否收到已确认的正时长：上游已经完成工作，客户端的传输
	// 结局（干净关闭还是中途断开）不应让已确认用量消失。
	// EstimateOfficialSTTCost 自身已对 <=0/NaN/Inf 返回未定价。
	if pricing, priced := audit.EstimateOfficialSTTCost(outcome.AudioDurationSeconds, true); priced {
		record.EstimatedCostInUSDTicks = pricing.CostInUSDTicks
		record.PricingModel = pricing.Model
		record.PricingVersion = audit.OfficialPricingAsOf
	}
}

// writeFailureAudit 落库一次失败审计；写入失败只记录日志。
func (run *voiceWebSocketRun) writeFailureAudit(statusCode int, errorCode string, credential *accountdomain.Credential) {
	record := run.auditBase
	record.StatusCode = statusCode
	record.ErrorCode = errorCode
	record.DurationMS = time.Since(run.startedAt).Milliseconds()
	record.CreatedAt = time.Now().UTC()
	if credential != nil {
		accountID := credential.ID
		record.AccountID = &accountID
		record.AccountName = credential.Name
	}
	applyAuditEgress(&record, run.egressTrace, run.route.Provider)
	persistCtx, cancel := context.WithTimeout(context.Background(), finalizationTimeout)
	defer cancel()
	if auditErr := run.service.audits.Create(persistCtx, record); auditErr != nil {
		run.service.logger.Error("request_usage_write_failed", "event_id", record.EventID, "request_id", run.requestID, "error", auditErr)
	}
}

func voiceWebSocketAuditOutcome(outcome VoiceWebSocketOutcome) (int, string) {
	errorCode := strings.TrimSpace(outcome.ErrorCode)
	if errorCode == "" {
		// Audits store the logical request outcome. The transport handshake remains
		// HTTP 101, while successful request accounting uses the common 2xx predicate.
		return http.StatusOK, ""
	}
	return http.StatusBadGateway, errorCode
}

func voiceWebSocketRoute(pathValue string) (modeldomain.Capability, audit.Operation, string, error) {
	switch strings.TrimSpace(pathValue) {
	case "/realtime":
		return modeldomain.CapabilityRealtime, audit.OperationRealtime, "grok-voice-latest", nil
	case "/stt":
		return modeldomain.CapabilitySTT, audit.OperationSTT, "grok-stt", nil
	default:
		return "", "", "", errors.New("不支持的 voice websocket path")
	}
}

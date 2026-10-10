package gateway

import (
	"context"
	"errors"
	"time"

	accountdomain "github.com/chenyme/grok2api/backend/internal/domain/account"
	"github.com/chenyme/grok2api/backend/internal/domain/audit"
	"github.com/chenyme/grok2api/backend/internal/domain/clientkey"
	modeldomain "github.com/chenyme/grok2api/backend/internal/domain/model"
	infraegress "github.com/chenyme/grok2api/backend/internal/infra/egress"
	"github.com/chenyme/grok2api/backend/internal/pkg/requestmeta"
)

// 媒体/语音请求共用的路由、审计与重试辅助。此文件不承载具体用例的结算语义。

// mediaAuditIdentity 描述媒体/语音请求审计基线中由请求本身决定的字段。
type mediaAuditIdentity struct {
	eventID   string
	requestID string
	key       clientkey.Key
	route     modeldomain.Route
	publicID  string
	operation audit.Operation
	streaming bool
	method    string
	path      string
	headers   map[string][]string
	// mediaInputImages 只在图片编辑审计中写入，与既有口径一致。
	mediaInputImages int64
}

// newMediaAuditRecord 构造媒体/语音请求的审计基线；失败与结算记录都由它派生。
func newMediaAuditRecord(ctx context.Context, identity mediaAuditIdentity) audit.Record {
	record := audit.Record{
		EventID: identity.eventID, RequestID: identity.requestID, ClientKeyID: identity.key.ID, ClientKeyName: identity.key.Name,
		ClientIP:     requestmeta.ClientIP(ctx),
		ModelRouteID: identity.route.ID, ModelPublicID: identity.publicID, ModelUpstreamModel: modeldomain.DisplayUpstreamModel(identity.route.Provider, identity.route.UpstreamModel),
		Provider: string(identity.route.Provider), Operation: identity.operation, UsageSource: audit.UsageSourceNone, Streaming: identity.streaming,
		RequestMethod: identity.method, RequestPath: identity.path, RequestHeaders: identity.headers,
	}
	if identity.operation == audit.OperationImageEdit {
		record.MediaInputImages = identity.mediaInputImages
	}
	return record
}

// newMediaAuditContext 组装一次媒体/语音请求的审计上下文。
func newMediaAuditContext(ctx context.Context, identity mediaAuditIdentity, trace *infraegress.Trace, startedAt time.Time) mediaAuditContext {
	return mediaAuditContext{
		base: newMediaAuditRecord(ctx, identity), provider: identity.route.Provider,
		trace: trace, startedAt: startedAt, requestID: identity.requestID,
	}
}

// mediaAuditContext 固定一次媒体/语音请求的审计基线，供失败与结算路径派生记录。
type mediaAuditContext struct {
	base      audit.Record
	provider  accountdomain.Provider
	trace     *infraegress.Trace
	startedAt time.Time
	requestID string
}

// settleRecord 从审计基线派生一条结算记录，包含账号、时长与出口信息。
func (auditCtx mediaAuditContext) settleRecord(credential accountdomain.Credential, statusCode int, errorCode string) audit.Record {
	accountID := credential.ID
	record := auditCtx.base
	record.AccountID, record.AccountName, record.StatusCode = &accountID, credential.Name, statusCode
	record.ErrorCode = errorCode
	record.DurationMS, record.CreatedAt = time.Since(auditCtx.startedAt).Milliseconds(), time.Now().UTC()
	applyAuditEgress(&record, auditCtx.trace, auditCtx.provider)
	return record
}

// writeMediaFailureAudit 在请求无法进入结算路径时立即落库失败审计。
func (s *Service) writeMediaFailureAudit(auditCtx mediaAuditContext, statusCode int, errorCode string, credential *accountdomain.Credential) {
	record := auditCtx.base
	record.StatusCode = statusCode
	record.ErrorCode = errorCode
	record.DurationMS = time.Since(auditCtx.startedAt).Milliseconds()
	record.CreatedAt = time.Now().UTC()
	if credential != nil {
		accountID := credential.ID
		record.AccountID = &accountID
		record.AccountName = credential.Name
	}
	applyAuditEgress(&record, auditCtx.trace, auditCtx.provider)
	s.persistFailureAudit(record, auditCtx.requestID)
}

// resolveSchedulableMediaRoute 解析媒体/语音请求的可调度目标。全部同名目标都不可调度时
// 回退到能力/权限筛选，使调用方仍能在请求循环中复现并审计选择失败。
func (s *Service) resolveSchedulableMediaRoute(ctx context.Context, publicModel string, key clientkey.Key, capability modeldomain.Capability, consumesQuota bool, supports func(accountdomain.Provider) bool) (modeldomain.Route, *selectionSession, error) {
	routes, err := s.models.GetByPublicIDCandidates(ctx, publicModel)
	if err != nil {
		return modeldomain.Route{}, nil, ErrModelNotFound
	}
	route, preselectedSession, err := s.selectSchedulableMediaRoute(ctx, routes, key, capability, consumesQuota, supports)
	if err == nil {
		return route, preselectedSession, nil
	}
	route, err = s.selectMediaRoute(routes, key, capability, supports)
	if err != nil {
		return modeldomain.Route{}, nil, err
	}
	return route, nil, nil
}

// selectionFailureCode 返回账号选择失败用于审计的错误码。
func selectionFailureCode(err error) string {
	var selectionFailure *SelectionUnavailableError
	if errors.As(err, &selectionFailure) {
		return selectionFailure.Code()
	}
	return "upstream_unavailable"
}

// retryExcludedAccount 让同一账号在当前出口会话下重新参与候选，用于出口会话被拒的场景。
func retryExcludedAccount(excluded map[uint64]bool, selection *selectionSession, accountID uint64) {
	delete(excluded, accountID)
	if selection != nil {
		selection.RetryAccount(accountID)
	}
}

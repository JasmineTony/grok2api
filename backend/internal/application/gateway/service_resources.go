package gateway

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	accountapp "github.com/chenyme/grok2api/backend/internal/application/account"
	accountdomain "github.com/chenyme/grok2api/backend/internal/domain/account"
	clientkey "github.com/chenyme/grok2api/backend/internal/domain/clientkey"
	infraegress "github.com/chenyme/grok2api/backend/internal/infra/egress"
	provider "github.com/chenyme/grok2api/backend/internal/ports/provider"
	http "net/http"
	url "net/url"
)

// ownedResponseTarget 固定一次已归属 Response 转发的目标账号与适配器。
type ownedResponseTarget struct {
	providerName accountdomain.Provider
	accountID    uint64
	accountScope clientkey.AccountScope
	adapter      provider.ResponseAdapter
	operation    string
}

// ownedResponseForward 固定一次 Response 资源转发的调用上下文。
type ownedResponseForward struct {
	adapter         provider.ResponseAdapter
	lease           *accountLease
	physicalCallCtx context.Context
	method          string
	path            string
}

// resolveOwnedResponseTarget 校验 Response 归属、账号范围与 Provider 支持，并返回转发目标。
func (s *Service) resolveOwnedResponseTarget(ctx context.Context, input ResourceInput, method string) (ownedResponseTarget, error) {
	ownership, err := s.responses.Get(ctx, input.ResponseID, input.ClientKey.ID, time.Now().UTC())
	if err != nil {
		return ownedResponseTarget{}, ErrResponseNotFound
	}
	if !s.providers.SupportsStoredResponses(ownership.Provider) {
		_ = s.responses.Delete(ctx, input.ResponseID, input.ClientKey.ID)
		return ownedResponseTarget{}, ErrResponseNotFound
	}
	accountScope := input.ClientKey.AccountScope()
	if !accountScope.AllowsProvider(ownership.Provider) {
		return ownedResponseTarget{}, &SelectionUnavailableError{Reason: SelectionNoAccounts, Scope: accountScope}
	}
	adapter, ok := s.providers.Responses(ownership.Provider)
	if !ok {
		return ownedResponseTarget{}, ErrResponseAccountUnavailable
	}
	operation := "response_get"
	if method == http.MethodDelete {
		operation = "response_delete"
	}
	return ownedResponseTarget{
		providerName: ownership.Provider, accountID: ownership.AccountID,
		accountScope: accountScope, adapter: adapter, operation: operation,
	}, nil
}

// attemptOwnedResponseForward 转发一次资源请求；401 时按既有语义刷新凭据并重放一次。
func (s *Service) attemptOwnedResponseForward(ctx context.Context, forward ownedResponseForward, credential accountdomain.Credential) (*provider.Response, accountdomain.Credential, error) {
	response, err := forward.adapter.ForwardResponse(forward.physicalCallCtx, provider.ResponseResourceRequest{Credential: credential, Method: forward.method, Path: forward.path})
	if err != nil {
		if isSSOCredentialRejected(err, credential) {
			s.markSSOCredentialRejected(ctx, credential, fmt.Sprintf("%s SSO credential rejected", credential.Provider))
		}
		forward.lease.Release()
		return nil, credential, err
	}
	if response.StatusCode != http.StatusUnauthorized {
		return response, credential, nil
	}
	response.Body.Close()
	refreshed, refreshErr := s.ensureOwnedResponseRefresh(ctx, forward, credential)
	if refreshErr != nil {
		return nil, credential, refreshErr
	}
	response, err = forward.adapter.ForwardResponse(forward.physicalCallCtx, provider.ResponseResourceRequest{Credential: refreshed, Method: forward.method, Path: forward.path})
	if err != nil {
		forward.lease.Release()
		return nil, refreshed, err
	}
	return response, refreshed, nil
}

// ensureOwnedResponseRefresh 判定 401 账号是否永久不可刷新，否则刷新凭据供重放使用。
func (s *Service) ensureOwnedResponseRefresh(ctx context.Context, forward ownedResponseForward, credential accountdomain.Credential) (accountdomain.Credential, error) {
	if credential.AuthType == accountdomain.AuthTypeSSO {
		s.markSSOCredentialRejected(ctx, credential, fmt.Sprintf("%s SSO credential rejected", credential.Provider))
		forward.lease.Release()
		return credential, ErrResponseAccountUnavailable
	}
	if s.markPermanentlyUnrefreshableCredentialRejected(ctx, credential) {
		forward.lease.Release()
		return credential, fmt.Errorf("%w: %w", ErrResponseAccountUnavailable, accountapp.ErrCredentialRefreshPermanent)
	}
	refreshed, refreshErr := s.accounts.EnsureCredential(ctx, credential, true)
	if refreshErr != nil {
		if errors.Is(refreshErr, accountapp.ErrCredentialRefreshPermanent) {
			s.markCredentialRejectedAfterPermanentRefresh(ctx, credential)
		}
		forward.lease.Release()
		return credential, refreshErr
	}
	return refreshed, nil
}

// applyOwnedResponseOutcome 记录成功观测，并在资源已删除或消失时清理本地归属。
func (s *Service) applyOwnedResponseOutcome(ctx context.Context, input ResourceInput, method string, response *provider.Response, credential accountdomain.Credential) {
	if response.StatusCode >= 200 && response.StatusCode < 300 {
		s.selector.markSuccess(ctx, credential, false)
		if method == http.MethodDelete {
			_ = s.responses.Delete(ctx, input.ResponseID, input.ClientKey.ID)
		}
		return
	}
	if response.StatusCode == http.StatusNotFound || response.StatusCode == http.StatusGone {
		_ = s.responses.Delete(ctx, input.ResponseID, input.ClientKey.ID)
	}
}

func (s *Service) forwardOwnedResponse(ctx context.Context, input ResourceInput, method string) (*Result, error) {
	target, err := s.resolveOwnedResponseTarget(ctx, input, method)
	if err != nil {
		return nil, err
	}
	physicalCallCtx := infraegress.WithPhysicalCallTrace(ctx, string(target.providerName), target.operation)
	lease, err := s.selector.AcquirePinnedForKey(ctx, target.providerName, target.accountID, 0, "", "", false, target.accountScope)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrResponseAccountUnavailable, err)
	}
	credential, err := s.accounts.EnsureCredential(ctx, lease.Credential, false)
	if err != nil {
		lease.Release()
		return nil, fmt.Errorf("%w: %w", ErrResponseAccountUnavailable, err)
	}
	path := "/responses/" + url.PathEscape(input.ResponseID)
	if input.RawQuery != "" {
		path += "?" + input.RawQuery
	}
	forward := ownedResponseForward{adapter: target.adapter, lease: lease, physicalCallCtx: physicalCallCtx, method: method, path: path}
	response, credential, err := s.attemptOwnedResponseForward(ctx, forward, credential)
	if err != nil {
		return nil, err
	}
	s.applyOwnedResponseOutcome(ctx, input, method, response, credential)
	var once sync.Once
	release := func() { once.Do(lease.Release) }
	finalize := func(Usage, string, string) { release() }
	return &Result{StatusCode: response.StatusCode, Status: response.Status, Header: response.Header, Body: &finalizingBody{ReadCloser: response.Body, finalize: release}, Finalize: finalize}, nil
}

// markPermanentlyUnrefreshableCredentialRejected removes an account from the pool after a real upstream request confirms its access token is invalid.
func (s *Service) markPermanentlyUnrefreshableCredentialRejected(ctx context.Context, credential accountdomain.Credential) bool {
	if !credential.RefreshPermanent {
		return false
	}
	s.markCredentialRejectedAfterPermanentRefresh(ctx, credential)
	return true
}

func (s *Service) markCredentialRejectedAfterPermanentRefresh(ctx context.Context, credential accountdomain.Credential) {
	_ = s.accounts.MarkReauthRequired(ctx, credential.ID, fmt.Sprintf("%s OAuth access token rejected after permanent refresh failure", credential.Provider))
	s.selector.MarkQuotaStateChanged(credential.Provider, credential.ID)
}

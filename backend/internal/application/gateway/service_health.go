package gateway

import (
	"context"
	"errors"
	"time"

	accountdomain "github.com/chenyme/grok2api/backend/internal/domain/account"
	neterrorpkg "github.com/chenyme/grok2api/backend/internal/pkg/neterror"
	provider "github.com/chenyme/grok2api/backend/internal/ports/provider"
	slog "log/slog"
	http "net/http"
)

func isUpstreamStreamFailure(errorCode string) bool {
	switch errorCode {
	case "upstream_stream_incomplete", "upstream_stream_interrupted", "upstream_stream_idle_timeout", "upstream_response_empty", "upstream_output_loop":
		return true
	default:
		return false
	}
}

func streamFailureHealthPenalty(errorCode string, usage Usage, idleCooldown time.Duration) (int, time.Duration) {
	if (errorCode == "upstream_stream_idle_timeout" || errorCode == "upstream_response_empty") && !usage.OutputObserved && usage.OutputTokens == 0 && usage.ReasoningTokens == 0 {
		if idleCooldown <= 0 {
			idleCooldown = qualityIdleAccountCooldown
		}
		if errorCode == "upstream_response_empty" {
			return http.StatusBadGateway, idleCooldown
		}
		return http.StatusGatewayTimeout, idleCooldown
	}
	return 0, 0
}

// upstreamResponseErrorHealthPenalty classifies failures that happen after a
// successful response header but before a usable non-streaming body exists.
// A truly empty response receives the configured long cooldown. If some body
// bytes arrived before an idle timeout, retain only the ordinary short network
// cooldown by returning a zero status/retry pair.
func upstreamResponseErrorHealthPenalty(err error, idleCooldown time.Duration) (int, time.Duration, bool) {
	switch {
	case neterrorpkg.IsUpstreamResponseEmpty(err):
		status, cooldown := streamFailureHealthPenalty("upstream_response_empty", Usage{}, idleCooldown)
		return status, cooldown, true
	case neterrorpkg.IsUpstreamStreamIdleTimeout(err):
		if neterrorpkg.IdleTimeoutObservedData(err) {
			return 0, 0, true
		}
		status, cooldown := streamFailureHealthPenalty("upstream_stream_idle_timeout", Usage{}, idleCooldown)
		return status, cooldown, true
	default:
		return 0, 0, false
	}
}

// auditRequestSucceeded keeps transport truth (the HTTP status) separate from
// the terminal request outcome. A stream that fails after 2xx headers is not a
// successful request even though its HTTP status remains 2xx.
func auditRequestSucceeded(statusCode int, errorCode string) bool {
	return statusCode >= 200 && statusCode < 300 && errorCode == ""
}

func isRetryableTransportFailure(providerValue accountdomain.Provider, err error) bool {
	return providerValue != accountdomain.ProviderBuild || !neterrorpkg.IsResponseHeaderTimeout(err)
}

func isSSOCredentialRejected(err error, credential accountdomain.Credential) bool {
	if credential.AuthType != accountdomain.AuthTypeSSO || err == nil {
		return false
	}
	if errors.Is(err, provider.ErrUnauthorized) {
		return true
	}
	status, ok := provider.ErrorHTTPStatus(err)
	return ok && status == http.StatusUnauthorized
}

func (s *Service) markSSOCredentialRejected(ctx context.Context, credential accountdomain.Credential, reason string) {
	if credential.AuthType != accountdomain.AuthTypeSSO {
		return
	}
	writeCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), finalizationTimeout)
	defer cancel()
	if err := s.accounts.MarkReauthRequired(writeCtx, credential.ID, reason); err != nil {
		s.logger.Error("account_reauth_required_write_failed", "account_id", credential.ID, "provider", credential.Provider, "error", err)
	}
	// Discard the process-local one-second candidate snapshot even if persistence fails,
	// preventing the invalid account from being selected by the next request.
	s.selector.MarkQuotaStateChanged(credential.Provider)
}

func (s *Service) queueAccountModelSync(accountID uint64) {
	syncer, ok := s.models.(accountModelSyncer)
	if !ok || accountID == 0 {
		return
	}
	s.modelSyncMu.Lock()
	if s.modelSyncing == nil {
		s.modelSyncing = make(map[uint64]struct{})
	}
	if _, exists := s.modelSyncing[accountID]; exists {
		s.modelSyncMu.Unlock()
		return
	}
	s.modelSyncing[accountID] = struct{}{}
	s.modelSyncMu.Unlock()

	go func() {
		defer func() {
			s.modelSyncMu.Lock()
			delete(s.modelSyncing, accountID)
			s.modelSyncMu.Unlock()
		}()
		ctx, cancel := context.WithTimeout(context.Background(), modelCatalogRefreshTimeout)
		defer cancel()
		logger := s.logger
		if logger == nil {
			logger = slog.Default()
		}
		count, err := syncer.SyncAccount(ctx, accountID)
		if err != nil {
			logger.Warn("model_etag_refresh_failed", "account_id", accountID, "error", err)
			return
		}
		logger.Info("model_etag_refresh_completed", "account_id", accountID, "models", count)
	}()
}

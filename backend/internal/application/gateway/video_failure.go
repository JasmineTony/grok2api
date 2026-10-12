package gateway

import (
	"context"
	"errors"
	"strings"
	"time"

	account "github.com/chenyme/grok2api/backend/internal/domain/account"
	audit "github.com/chenyme/grok2api/backend/internal/domain/audit"
	media "github.com/chenyme/grok2api/backend/internal/domain/media"
	provider "github.com/chenyme/grok2api/backend/internal/ports/provider"
	slog "log/slog"
	http "net/http"
)

func (s *Service) failVideoJob(ctx context.Context, job media.Job, code string, err error, upstreamStatus int, attempts []audit.Attempt) {
	now := time.Now().UTC()
	message := ""
	if err != nil {
		message = err.Error()
	}
	job.Status, job.ErrorCode, job.ErrorMessage = media.StatusFailed, code, message
	if len(job.ErrorMessage) > 512 {
		job.ErrorMessage = job.ErrorMessage[:512]
	}
	job.LeaseUntil, job.UpdatedAt, job.CompletedAt = nil, now, &now
	if updateErr := s.persistVideoJobWithRetry(ctx, job); updateErr != nil {
		s.logger.Error("video_job_terminal_write_failed", "job_id", job.ID, "error", updateErr)
		return
	}
	if auditErr := s.recordVideoAudit(context.Background(), job, max(int64(0), now.Sub(job.CreatedAt).Milliseconds()), upstreamStatus, attempts); auditErr != nil {
		s.logger.Error("video_usage_record_failed", "job_id", job.ID, "event_id", "video_usage_"+job.ID, "error", auditErr)
	}
	s.cancelBillingReservation("video_usage_" + job.ID)
	s.releaseVideoInputs(job)
}

func resolveVideoAuditStatusCode(job media.Job, upstreamStatus int, attempts []audit.Attempt) int {
	if job.Status != media.StatusFailed {
		return http.StatusOK
	}
	if upstreamStatus >= 100 && upstreamStatus <= 599 {
		return upstreamStatus
	}
	for i := len(attempts) - 1; i >= 0; i-- {
		if attempts[i].UpstreamStatusCode != nil {
			status := *attempts[i].UpstreamStatusCode
			if status >= 100 && status <= 599 {
				return status
			}
		}
	}
	if status := parseUpstreamStatusFromMessage(job.ErrorMessage); status > 0 {
		return status
	}
	switch job.ErrorCode {
	case "account_unavailable", "provider_unavailable":
		return http.StatusServiceUnavailable
	case "model_not_found":
		return http.StatusNotFound
	case "rate_limited":
		return http.StatusTooManyRequests
	default:
		return http.StatusBadGateway
	}
}

func parseUpstreamStatusFromMessage(message string) int {
	message = strings.TrimSpace(message)
	if message == "" {
		return 0
	}
	// Console/Web summaries commonly look like: "Console 媒体上游返回 429: ..."
	for _, token := range []string{"返回 ", "status ", "Status ", "HTTP "} {
		idx := strings.Index(message, token)
		if idx < 0 {
			continue
		}
		status, overflow := scanLeadingHTTPStatus(strings.TrimSpace(message[idx+len(token):]))
		if overflow || status != 0 {
			return status
		}
	}
	return 0
}

// scanLeadingHTTPStatus 解析 rest 开头的十进制状态码：status 非 0 表示命中 100–599 的状态码；
// overflow 为 true 表示数字已超过 599，调用方必须立即放弃整个解析。
func scanLeadingHTTPStatus(rest string) (status int, overflow bool) {
	n := 0
	for i := 0; i < len(rest); i++ {
		ch := rest[i]
		if ch < '0' || ch > '9' {
			break
		}
		n = n*10 + int(ch-'0')
		if n > 599 {
			return 0, true
		}
	}
	if n >= 100 && n <= 599 {
		return n, false
	}
	return 0, false
}

func captureVideoAttempt(recorder *failureAttemptRecorder, credential account.Credential, startedAt time.Time, err error) {
	if recorder == nil || err == nil {
		return
	}
	status, hasStatus := provider.ErrorHTTPStatus(err)
	stage := "upstream_response"
	if videoStage, ok := provider.VideoErrorStage(err); ok {
		stage = "video_" + string(videoStage)
	}
	attempt := audit.Attempt{
		Source:         audit.AttemptSourceUpstreamHTTP,
		Stage:          stage,
		AccountID:      auditAccountID(credential.ID),
		AccountName:    credential.Name,
		Method:         recorder.method,
		RequestPath:    recorder.path,
		StartedAt:      startedAt.UTC(),
		DurationMS:     time.Since(startedAt).Milliseconds(),
		TransportError: sanitizeDiagnosticText(err.Error(), diagnosticTextLimit),
		ErrorChain:     errorFrames(err),
	}
	if hasStatus {
		value := status
		attempt.UpstreamStatusCode = &value
		attempt.UpstreamStatus = http.StatusText(status)
		body := []byte(sanitizeDiagnosticText(err.Error(), diagnosticTextLimit))
		attempt.ResponseBody = body
	}
	recorder.append(attempt)
}

func (s *Service) videoAttemptPolicy() routingAttemptPolicy {
	configured := int(s.videoMaxAttempts.Load())
	// Legacy installs may still have 0 from the short-lived "inherit" default.
	// Treat it as the general default pool size instead of reintroducing inherit UI.
	if configured == 0 {
		configured = 999
	}
	return newRoutingAttemptPolicy(configured)
}

func (s *Service) releaseVideoInputs(job media.Job) {
	if s.mediaAssets == nil {
		return
	}
	references := decodeVideoInput(job.InputJSON)
	if len(references) == 0 {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := s.mediaAssets.ReleaseInputAssets(ctx, references); err != nil {
		logger := s.logger
		if logger == nil {
			logger = slog.Default()
		}
		logger.Warn("video_input_release_failed", "job_id", job.ID, "error", err)
	}
}

func (s *Service) logVideoGenerationFailure(job media.Job, credential account.Credential, err error) {
	logger := s.logger
	if logger == nil {
		logger = slog.Default()
	}
	attributes := []any{
		"job_id", job.ID,
		"request_id", job.RequestID,
		"account_id", credential.ID,
		"provider", credential.Provider,
		"model", job.UpstreamModel,
		"egress_scope", job.EgressScope,
		"egress_mode", job.EgressMode,
		"error", sanitizeDiagnosticText(err.Error(), 512),
	}
	if status, ok := provider.ErrorHTTPStatus(err); ok {
		attributes = append(attributes, "upstream_status", status)
	}
	if job.EgressNodeID != nil {
		attributes = append(attributes, "egress_node_id", *job.EgressNodeID, "egress_node_name", job.EgressNodeName)
	}
	logger.Warn("video_generation_failed", attributes...)
}

func (s *Service) deferVideoJob(ctx context.Context, job media.Job) {
	now := time.Now().UTC()
	leaseUntil := now.Add(5 * time.Minute)
	job.Status = media.StatusInProgress
	job.LeaseUntil = &leaseUntil
	job.UpdatedAt = now
	job.ErrorCode = ""
	job.ErrorMessage = ""
	if err := s.persistVideoJobWithRetry(ctx, job); err != nil {
		s.logger.Error("video_job_defer_write_failed", "job_id", job.ID, "error", err)
	}
}

// persistVideoJobWithRetry 至少执行一次收尾写入；后续退避可被工作进程关闭信号取消。
func (s *Service) persistVideoJobWithRetry(ctx context.Context, job media.Job) error {
	var lastErr error
	for attempt := 1; attempt <= 3; attempt++ {
		writeCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Second)
		lastErr = s.mediaJobs.UpdateMediaJob(writeCtx, job)
		cancel()
		if lastErr == nil {
			return nil
		}
		if attempt < 3 {
			timer := time.NewTimer(time.Duration(attempt) * 100 * time.Millisecond)
			select {
			case <-ctx.Done():
				timer.Stop()
				return errors.Join(lastErr, ctx.Err())
			case <-timer.C:
			}
		}
	}
	return lastErr
}

package provider

import (
	"errors"
	"fmt"
	"net/http"
)

// VideoStage identifies which phase of an asynchronous video job failed.
type VideoStage string

const (
	// VideoStagePrepare is local work performed before the create request is sent.
	// It is not account-failover eligible because retrying deterministic local
	// validation or configuration failures against another credential is useless.
	VideoStagePrepare VideoStage = "prepare"
	// VideoStageCreate means the upstream explicitly rejected the create request.
	// Account failover is safe only for the retryable 4xx statuses selected by
	// the gateway; 5xx responses remain indeterminate because work may already
	// have been accepted before the server failed.
	VideoStageCreate VideoStage = "create"
	// VideoStageSubmitted means the create request may have reached upstream but
	// no usable job identifier was obtained. Retrying could duplicate work.
	VideoStageSubmitted VideoStage = "submitted"
	VideoStagePoll      VideoStage = "poll"
)

// VideoStageError records the asynchronous video phase without treating every
// create-path error as safe for account failover.
type VideoStageError struct {
	Stage  VideoStage
	Status int
	Err    error
}

func (e *VideoStageError) Error() string {
	if e == nil {
		return "video request failed"
	}
	if e.Err != nil {
		return e.Err.Error()
	}
	if e.Status > 0 {
		return fmt.Sprintf("video %s failed with status %d", e.Stage, e.Status)
	}
	return fmt.Sprintf("video %s failed", e.Stage)
}

func (e *VideoStageError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Err
}

func (e *VideoStageError) HTTPStatusCode() int {
	if e == nil {
		return 0
	}
	if e.Status > 0 {
		return e.Status
	}
	return ErrorHTTPStatusOrZero(e.Err)
}

// VideoErrorStage reports the video phase for an error chain.
func VideoErrorStage(err error) (VideoStage, bool) {
	var stageErr *VideoStageError
	if !errors.As(err, &stageErr) || stageErr == nil || stageErr.Stage == "" {
		return "", false
	}
	return stageErr.Stage, true
}

// VideoCreateFailureStage distinguishes an explicit upstream rejection from an
// indeterminate POST result. Explicit 4xx responses (including the 401
// sentinel) are rejections; transport errors and 5xx responses remain
// submitted because the upstream may already have accepted the job.
func VideoCreateFailureStage(err error) VideoStage {
	if errors.Is(err, ErrUnauthorized) {
		return VideoStageCreate
	}
	if status, ok := ErrorHTTPStatus(err); ok && status >= http.StatusBadRequest && status < http.StatusInternalServerError {
		return VideoStageCreate
	}
	return VideoStageSubmitted
}

// WrapVideoStage annotates err with the video phase and optional HTTP status.
func WrapVideoStage(stage VideoStage, status int, err error) error {
	if err == nil {
		return nil
	}
	var existing *VideoStageError
	if errors.As(err, &existing) {
		return err
	}
	if status <= 0 {
		status = ErrorHTTPStatusOrZero(err)
	}
	return &VideoStageError{Stage: stage, Status: status, Err: err}
}


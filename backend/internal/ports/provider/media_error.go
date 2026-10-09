package provider

import (
	"errors"
	"fmt"
)

// MediaPostProcessingStage identifies a local processing stage that failed after media generation.
type MediaPostProcessingStage string

const (
	MediaPostProcessingDownload MediaPostProcessingStage = "download"
	MediaPostProcessingStorage  MediaPostProcessingStage = "storage"
)

// MediaPostProcessingError indicates that upstream media was created but download or storage failed.
// These errors must not trigger generation on another account or reduce the generating account's health.
type MediaPostProcessingError struct {
	Stage MediaPostProcessingStage
	Cause error
}

func (e *MediaPostProcessingError) Error() string {
	if e == nil || e.Cause == nil {
		return "media post-processing failed"
	}
	return fmt.Sprintf("media post-processing %s failed: %v", e.Stage, e.Cause)
}

func (e *MediaPostProcessingError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Cause
}

// NewMediaPostProcessingError marks a download or storage error as non-retryable across accounts.
func NewMediaPostProcessingError(stage MediaPostProcessingStage, cause error) error {
	if cause == nil {
		return nil
	}
	return &MediaPostProcessingError{Stage: stage, Cause: cause}
}

// IsMediaPostProcessingError reports whether an error occurred during local processing after media generation.
func IsMediaPostProcessingError(err error) bool {
	var target *MediaPostProcessingError
	return errors.As(err, &target)
}

package repository

import (
	"context"
	"time"
)

// UsageRollupRefreshResult describes one idempotent usage aggregation pass.
type UsageRollupRefreshResult struct {
	CoveredFrom  time.Time
	CoveredUntil time.Time
	HourRows     int64
	DayRows      int64
}

// UsageRollupRepository maintains derived hourly and daily usage summaries.
// The request audit table remains the source of truth; rollups are disposable.
type UsageRollupRepository interface {
	Refresh(ctx context.Context, now time.Time) (UsageRollupRefreshResult, error)
}

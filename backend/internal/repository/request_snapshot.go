package repository

import (
	"context"
	"github.com/chenyme/grok2api/backend/internal/domain/requestsnapshot"
	"time"
)

type RequestSnapshotRepository interface {
	CreateRequestSnapshot(context.Context, requestsnapshot.Snapshot) (requestsnapshot.Snapshot, error)
	GetRequestSnapshot(context.Context, string, time.Time) (requestsnapshot.Snapshot, error)
	DeleteExpiredRequestSnapshots(context.Context, time.Time, int) (int64, error)
}

package notification

import "time"

type Severity string

const (
	SeverityInfo    Severity = "info"
	SeverityWarning Severity = "warning"
	SeverityError   Severity = "error"
)

type Status string

const (
	StatusUnread       Status = "unread"
	StatusRead         Status = "read"
	StatusAcknowledged Status = "acknowledged"
)

type Event struct {
	ID             uint64
	EventKey       string
	Severity       Severity
	Title          string
	Body           string
	DedupKey       string
	Status         Status
	CreatedAt      time.Time
	ReadAt         *time.Time
	AcknowledgedAt *time.Time
	ExpiresAt      *time.Time
}

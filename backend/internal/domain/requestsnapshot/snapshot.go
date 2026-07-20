package requestsnapshot

import "time"

type Snapshot struct {
	ID               string    `json:"id"`
	RequestID        string    `json:"requestId,omitempty"`
	Protocol         string    `json:"protocol"`
	Operation        string    `json:"operation"`
	Model            string    `json:"model"`
	EncryptedPayload string    `json:"-"`
	PayloadSHA256    string    `json:"payloadSha256"`
	PayloadBytes     int       `json:"payloadBytes"`
	CreatedAt        time.Time `json:"createdAt"`
	ExpiresAt        time.Time `json:"expiresAt"`
}
type View struct {
	Snapshot Snapshot `json:"snapshot"`
	Payload  any      `json:"payload"`
	DryRun   bool     `json:"dryRun"`
}

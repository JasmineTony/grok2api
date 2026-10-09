package provider

import (
	"time"

	"github.com/chenyme/grok2api/backend/internal/domain/account"
)

// DeviceAuthorization represents the result of starting Device OAuth.
type DeviceAuthorization struct {
	DeviceCode              string
	UserCode                string
	VerificationURI         string
	VerificationURIComplete string
	Interval                time.Duration
	ExpiresIn               time.Duration
}

// CredentialSeed represents an OAuth credential not yet persisted after login or import.
type CredentialSeed struct {
	Provider                account.Provider
	AuthType                account.AuthType
	WebTier                 account.WebTier
	Name                    string
	Email                   string
	UserID                  string
	TeamID                  string
	SourceKey               string
	OIDCClientID            string
	AccessToken             string
	RefreshToken            string
	CloudflareCookies       string
	ExpiresAt               time.Time
	WebNSFWEnabledAt        *time.Time
	WebTermsAcceptedAt      *time.Time
	WebTermsAcceptedVersion int
	WebBirthDateSetAt       *time.Time
}

type QuotaSnapshot struct {
	Tier     account.WebTier
	Windows  []account.QuotaWindow
	SyncedAt time.Time
}

// QuotaGroupSnapshot is an authoritative snapshot for a group of quota modes
// returned by one upstream request. Modes lists the complete local scope so
// callers can atomically remove products that the upstream explicitly reports
// as unavailable without touching unrelated quota windows.
type QuotaGroupSnapshot struct {
	Group    string
	Modes    []string
	Windows  []account.QuotaWindow
	SyncedAt time.Time
}

// RefreshedCredential represents rotated credentials returned by an OAuth refresh.
type RefreshedCredential struct {
	EncryptedAccessToken  string
	EncryptedRefreshToken string
	ExpiresAt             time.Time
	// RefreshTokenRotated reports that the OAuth response explicitly returned
	// a different refresh token. It is diagnostic metadata only; token values
	// must never be logged.
	RefreshTokenRotated bool
}

// CredentialMetadata contains non-sensitive display data safely derived from a stored credential.
// Raw tokens and complete JWT claims must never be exposed through this structure.
type CredentialMetadata struct {
	// BuildBotFlagInspected is true only when the Build token was successfully
	// decrypted and decoded. False means the risk source is unknown, not clean.
	BuildBotFlagInspected bool
	// BuildBotFlagged is true when BuildBotFlagSource is 1 or 2.
	BuildBotFlagged bool
	// BuildBotFlagSource is the numeric bot_flag_source/bfs claim (1 or 2), or 0 when unset.
	BuildBotFlagSource int
}

// AccountIdentity contains non-sensitive account identity metadata confirmed by upstream.
// Email is for display only; cross-Provider automatic linking uses stable UserID only.
type AccountIdentity struct {
	Email  string
	UserID string
	TeamID string
}

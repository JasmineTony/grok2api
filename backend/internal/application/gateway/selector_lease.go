package gateway

import (
	"time"

	account "github.com/chenyme/grok2api/backend/internal/domain/account"
)

type candidateCacheKey struct {
	provider          account.Provider
	modelRouteID      uint64
	upstreamModel     string
	quotaMode         string
	includeBotFlagged bool
}

type routingBaseCacheKey struct {
	provider  account.Provider
	quotaMode string
}

type routingOverlayCacheKey struct {
	provider      account.Provider
	modelRouteID  uint64
	upstreamModel string
}

type routingLayerVersion struct {
	global   uint64
	provider uint64
}

type routingBaseSnapshot struct {
	values     []account.RoutingAccountBase
	version    routingLayerVersion
	expiresAt  time.Time
	staleUntil time.Time
	lastAccess time.Time
}

type routingOverlaySnapshot struct {
	value      account.RoutingOverlaySnapshot
	version    routingLayerVersion
	expiresAt  time.Time
	staleUntil time.Time
	lastAccess time.Time
}

package relational

import (
	"context"
	"strings"

	"github.com/chenyme/grok2api/backend/internal/repository"
)

type ModelRepository struct {
	db       *Database
	observer repository.InvalidationObserver
}

const retiredWebImageQualityLitePublicID = "Web/grok-imagine-image-quality-lite"

// Console static support is anchored to the reconciled catalog routes instead
// of the provider name alone. Manual aliases remain supported while an
// equivalent catalog route exists, and stale aliases stop advertising support
// as soon as that catalog entry is removed.
const modelConsoleStaticSupportExpression = `(model_routes.provider = 'grok_console' AND (
	model_routes.origin = 'catalog'
	OR EXISTS (
		SELECT 1 FROM model_routes console_catalog_route
		WHERE console_catalog_route.provider = model_routes.provider
			AND console_catalog_route.upstream_model = model_routes.upstream_model
			AND console_catalog_route.capability = model_routes.capability
			AND console_catalog_route.origin = 'catalog'
	)
))`

const modelConsoleStaticSupportAvailabilityExpression = `(route.provider = 'grok_console' AND (
	route.origin = 'catalog'
	OR EXISTS (
		SELECT 1 FROM model_routes console_catalog_route
		WHERE console_catalog_route.provider = route.provider
			AND console_catalog_route.upstream_model = route.upstream_model
			AND console_catalog_route.capability = route.capability
			AND console_catalog_route.origin = 'catalog'
	)
))`

// These Web media catalog capabilities are available to Basic accounts for
// their confirmed quota products. Older capability snapshots may predate that
// support, so catalog routes (and their aliases) remain discoverable while the
// runtime selector enforces the adapter's parameter-specific tier order.
const modelWebBasicMediaStaticSupportExpression = `(model_routes.provider = 'grok_web'
	AND model_routes.upstream_model IN ('grok-imagine-image-quality', 'grok-imagine-image-2.0', 'imagine-image-edit', 'grok-imagine-video')
	AND (
		model_routes.origin = 'catalog'
		OR EXISTS (
			SELECT 1 FROM model_routes web_catalog_route
			WHERE web_catalog_route.provider = model_routes.provider
				AND web_catalog_route.upstream_model = model_routes.upstream_model
				AND web_catalog_route.capability = model_routes.capability
				AND web_catalog_route.origin = 'catalog'
		)
	))`

const modelWebBasicMediaStaticSupportAvailabilityExpression = `(route.provider = 'grok_web'
	AND route.upstream_model IN ('grok-imagine-image-quality', 'grok-imagine-image-2.0', 'imagine-image-edit', 'grok-imagine-video')
	AND (
		route.origin = 'catalog'
		OR EXISTS (
			SELECT 1 FROM model_routes web_catalog_route
			WHERE web_catalog_route.provider = route.provider
				AND web_catalog_route.upstream_model = route.upstream_model
				AND web_catalog_route.capability = route.capability
				AND web_catalog_route.origin = 'catalog'
		)
	))`

const availableRoutePredicate = `
	EXISTS (
		SELECT 1 FROM provider_accounts account
		WHERE account.provider = model_routes.provider
			AND account.enabled = ?
			AND account.auth_status = ?
			AND (
				EXISTS (
					SELECT 1 FROM model_route_accounts binding
					WHERE binding.model_route_id = model_routes.id
						AND binding.account_id = account.id
				)
				OR (
					NOT EXISTS (SELECT 1 FROM model_route_accounts binding WHERE binding.model_route_id = model_routes.id)
					AND (
						` + modelConsoleStaticSupportExpression + `
						OR ` + modelWebBasicMediaStaticSupportExpression + `
						OR EXISTS (
							SELECT 1 FROM account_model_capabilities capability
							WHERE capability.account_id = account.id
								AND capability.upstream_model = model_routes.upstream_model
						)
					)
				)
			)
	)
`

// Build Super 共享能力：Billing paid 或 build_super_entitled；仅 grok_build。
const modelAccountBuildSuperPredicate = `(EXISTS (SELECT 1 FROM account_billing_snapshots billing WHERE billing.account_id = account.id AND ` + accountPaidBillingSignals + `) OR (account.provider = 'grok_build' AND account.build_super_entitled = TRUE))`
const modelPeerBuildSuperPredicate = `(EXISTS (SELECT 1 FROM account_billing_snapshots billing WHERE billing.account_id = peer.id AND ` + accountPaidBillingSignals + `) OR (peer.provider = 'grok_build' AND peer.build_super_entitled = TRUE))`

const modelSharedPaidBuildSupportSortExpression = `(model_routes.provider = 'grok_build'
	AND ` + modelAccountBuildSuperPredicate + `
	AND EXISTS (
		SELECT 1
		FROM provider_accounts peer
		JOIN account_model_capabilities peer_capability ON peer_capability.account_id = peer.id AND peer_capability.upstream_model = model_routes.upstream_model
		WHERE peer.provider = model_routes.provider
			AND peer.enabled = TRUE
			AND peer.auth_status = 'active'
			AND ` + modelPeerBuildSuperPredicate + `
	))`

const modelSharedPaidBuildSupportAvailabilityExpression = `(route.provider = 'grok_build'
	AND ` + modelAccountBuildSuperPredicate + `
	AND EXISTS (
		SELECT 1
		FROM provider_accounts peer
		JOIN account_model_capabilities peer_capability ON peer_capability.account_id = peer.id AND peer_capability.upstream_model = route.upstream_model
		WHERE peer.provider = route.provider
			AND peer.enabled = TRUE
			AND peer.auth_status = 'active'
			AND ` + modelPeerBuildSuperPredicate + `
	))`

// These predicates mirror the gateway's client-key scope classification. They
// are used only by the admin model picker to avoid presenting routes that the
// selected account scope can never serve.
const modelAccountBuildFreePredicate = `(account.provider = 'grok_build'
	AND NOT ` + modelAccountBuildSuperPredicate + `
	AND (
		EXISTS (SELECT 1 FROM account_quota_recovery recovery WHERE recovery.account_id = account.id AND recovery.kind = 'free')
		OR LOWER(TRIM(account.observed_model)) LIKE '%-build-free'
		OR EXISTS (SELECT 1 FROM account_billing_snapshots billing WHERE billing.account_id = account.id AND ` + accountFreeBillingSignal + `)
	))`

const modelAccountBuildSuperTierPredicate = `(account.provider = 'grok_build' AND ` + modelAccountBuildSuperPredicate + `)`

const modelAccountWebFreePredicate = `(account.provider = 'grok_web'
	AND EXISTS (SELECT 1 FROM web_account_profiles profile WHERE profile.account_id = account.id AND profile.tier = 'basic'))`

const modelAccountWebSuperPredicate = `(account.provider = 'grok_web'
	AND EXISTS (SELECT 1 FROM web_account_profiles profile WHERE profile.account_id = account.id AND profile.tier IN ('super', 'heavy')))`

const modelSharedPaidBuildScopeExpression = `(model_routes.provider = 'grok_build'
	AND ` + modelAccountBuildSuperPredicate + `
	AND EXISTS (
		SELECT 1
		FROM provider_accounts peer
		JOIN account_model_capabilities peer_capability ON peer_capability.account_id = peer.id AND peer_capability.upstream_model = model_routes.upstream_model
		WHERE peer.provider = model_routes.provider
			AND ` + modelPeerBuildSuperPredicate + `
	))`

const modelRouteAccountCapabilityPredicate = `(
	EXISTS (
		SELECT 1 FROM model_route_accounts binding
		WHERE binding.model_route_id = model_routes.id
			AND binding.account_id = account.id
	)
	OR (
		NOT EXISTS (SELECT 1 FROM model_route_accounts binding WHERE binding.model_route_id = model_routes.id)
		AND (
			` + modelConsoleStaticSupportExpression + `
			OR ` + modelWebBasicMediaStaticSupportExpression + `
			OR EXISTS (
				SELECT 1 FROM account_model_capabilities capability
				WHERE capability.account_id = account.id
					AND capability.upstream_model = model_routes.upstream_model
			)
			OR ` + modelSharedPaidBuildScopeExpression + `
		)
	)
)`

const modelAvailableRouteAccountCapabilityPredicate = `(
	EXISTS (
		SELECT 1 FROM model_route_accounts binding
		WHERE binding.model_route_id = model_routes.id
			AND binding.account_id = account.id
	)
	OR (
		NOT EXISTS (SELECT 1 FROM model_route_accounts binding WHERE binding.model_route_id = model_routes.id)
		AND (
			` + modelConsoleStaticSupportExpression + `
			OR ` + modelWebBasicMediaStaticSupportExpression + `
			OR EXISTS (
				SELECT 1 FROM account_model_capabilities capability
				WHERE capability.account_id = account.id
					AND capability.upstream_model = model_routes.upstream_model
			)
			OR ` + modelSharedPaidBuildSupportSortExpression + `
		)
	)
)`

func modelTierAvailabilityPredicate(tiers []string) string {
	return modelTierAvailabilityPredicateWithAvailability(tiers, false)
}

func modelTierAvailabilityPredicateWithAvailability(tiers []string, activeOnly bool) string {
	parts := make([]string, 0, len(tiers))
	for _, tier := range tiers {
		switch tier {
		case "free":
			parts = append(parts, modelAccountBuildFreePredicate, modelAccountWebFreePredicate)
		case "super":
			parts = append(parts, modelAccountBuildSuperTierPredicate, modelAccountWebSuperPredicate)
		}
	}
	if len(parts) == 0 {
		return ""
	}
	accountPredicate := ""
	capabilityPredicate := modelRouteAccountCapabilityPredicate
	if activeOnly {
		accountPredicate = " AND account.enabled = TRUE AND account.auth_status = 'active'"
		capabilityPredicate = modelAvailableRouteAccountCapabilityPredicate
	}
	return `(model_routes.provider = 'grok_console' OR EXISTS (
		SELECT 1 FROM provider_accounts account
		WHERE account.provider = model_routes.provider
		` + accountPredicate + `
			AND (` + strings.Join(parts, " OR ") + `)
			AND ` + capabilityPredicate + `
	))`
}

const (
	modelProviderPriorityExpression = "CASE model_routes.provider WHEN 'grok_build' THEN 0 WHEN 'grok_web' THEN 1 WHEN 'grok_console' THEN 2 ELSE 3 END"
	modelSupportSortExpression      = `(SELECT COUNT(*) FROM provider_accounts account WHERE account.provider = model_routes.provider AND account.enabled = TRUE AND account.auth_status = 'active' AND (EXISTS (SELECT 1 FROM model_route_accounts binding WHERE binding.model_route_id = model_routes.id AND binding.account_id = account.id) OR (NOT EXISTS (SELECT 1 FROM model_route_accounts binding WHERE binding.model_route_id = model_routes.id) AND (` + modelConsoleStaticSupportExpression + ` OR ` + modelWebBasicMediaStaticSupportExpression + ` OR EXISTS (SELECT 1 FROM account_model_capabilities capability WHERE capability.account_id = account.id AND capability.upstream_model = model_routes.upstream_model) OR ` + modelSharedPaidBuildSupportSortExpression + `))))`
	modelSyncedSortExpression       = `(SELECT MAX(sync.last_success_at) FROM provider_accounts account JOIN account_model_sync_states sync ON sync.account_id = account.id WHERE account.provider = model_routes.provider AND account.enabled = TRUE AND account.auth_status = 'active')`
)

func NewModelRepository(db *Database) *ModelRepository { return &ModelRepository{db: db} }

func (r *ModelRepository) SetInvalidationObserver(observer repository.InvalidationObserver) {
	r.observer = observer
}

func (r *ModelRepository) notifyInvalidation(ctx context.Context, event repository.InvalidationEvent) {
	if r.observer != nil {
		r.observer(ctx, event)
	}
}

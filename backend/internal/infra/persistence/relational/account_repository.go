package relational

import (
	"context"

	"github.com/chenyme/grok2api/backend/internal/repository"
)

type AccountRepository struct {
	db       *Database
	observer repository.InvalidationObserver
}

func NewAccountRepository(db *Database) *AccountRepository { return &AccountRepository{db: db} }

func (r *AccountRepository) SetInvalidationObserver(observer repository.InvalidationObserver) {
	r.observer = observer
}

func (r *AccountRepository) notifyInvalidation(ctx context.Context, event repository.InvalidationEvent) {
	if r.observer != nil {
		r.observer(ctx, event)
	}
}

const (
	accountUpdateBatchSize      = 500
	accountNormalizedPlanCode   = `LOWER(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(billing.plan_code), ' ', ''), '_', ''), '-', ''), '+', 'plus'))`
	accountNormalizedPlanName   = `LOWER(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(billing.plan_name), ' ', ''), '_', ''), '-', ''), '+', 'plus'))`
	accountPaidPlanNames        = `'super', 'supergrok', 'supergrokpro', 'supergrokheavy', 'supergroklite', 'supergrokplus', 'grokpro', 'xpremium', 'xpremiumplus', 'apikey'`
	accountPaidPlanSignal       = `(` + accountNormalizedPlanCode + ` IN (` + accountPaidPlanNames + `) OR ` + accountNormalizedPlanName + ` IN (` + accountPaidPlanNames + `) OR substr(` + accountNormalizedPlanCode + `, 1, 9) = 'supergrok' OR substr(` + accountNormalizedPlanName + `, 1, 9) = 'supergrok')`
	accountFreePlanSignal       = `(LOWER(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(billing.plan_code), ' ', ''), '_', ''), '-', ''), '+', 'plus')) IN ('free', 'grokfree', 'freetier', 'basic', 'grokbasic', 'xbasic') OR LOWER(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(billing.plan_name), ' ', ''), '_', ''), '-', ''), '+', 'plus')) IN ('free', 'grokfree', 'freetier', 'basic', 'grokbasic', 'xbasic'))`
	accountPaidBillingSignals   = `(` + accountPaidPlanSignal + ` OR billing.monthly_limit > 0 OR billing.on_demand_cap > 0 OR billing.on_demand_used > 0 OR billing.prepaid_balance > 0)`
	accountPaidBillingPredicate = `EXISTS (SELECT 1 FROM account_billing_snapshots billing WHERE billing.account_id = provider_accounts.id AND ` + accountPaidBillingSignals + `)`
	// 仅 grok_build 的管理员确认 Super entitlement；与 domain.IsBuildSuper 对齐。
	accountBuildSuperEntitledPredicate        = `(provider_accounts.provider = 'grok_build' AND provider_accounts.build_super_entitled = TRUE)`
	accountBuildSuperPredicate                = `(` + accountPaidBillingPredicate + ` OR ` + accountBuildSuperEntitledPredicate + `)`
	accountInferredFreeBillingSignal          = `(TRIM(billing.plan_code) = '' AND TRIM(billing.plan_name) = '' AND billing.synced_at IS NOT NULL AND billing.monthly_limit = 0 AND billing.used = 0 AND billing.on_demand_cap = 0 AND billing.on_demand_used = 0 AND billing.prepaid_balance = 0 AND billing.credit_usage_percent = 0)`
	accountFreeBillingSignal                  = `(` + accountFreePlanSignal + ` OR ` + accountInferredFreeBillingSignal + `)`
	accountFreeSignalPredicate                = `(provider_accounts.provider = 'grok_build' AND (LOWER(TRIM(provider_accounts.observed_model)) LIKE '%-build-free' OR EXISTS (SELECT 1 FROM account_billing_snapshots billing WHERE billing.account_id = provider_accounts.id AND ` + accountFreeBillingSignal + `)))`
	accountRecoveryPredicate                  = `EXISTS (SELECT 1 FROM account_quota_recovery recovery WHERE recovery.account_id = provider_accounts.id AND recovery.status IN ('exhausted', 'probing'))`
	providerQuotaExhaustedPredicate           = `((provider_accounts.provider = 'grok_web' AND ((EXISTS (SELECT 1 FROM account_quota_windows quota WHERE quota.account_id = provider_accounts.id AND quota.mode = 'weekly') AND NOT EXISTS (SELECT 1 FROM account_quota_windows quota WHERE quota.account_id = provider_accounts.id AND quota.mode = 'weekly' AND quota.remaining > 0)) OR (NOT EXISTS (SELECT 1 FROM account_quota_windows quota WHERE quota.account_id = provider_accounts.id AND quota.mode = 'weekly') AND EXISTS (SELECT 1 FROM account_quota_windows quota WHERE quota.account_id = provider_accounts.id) AND NOT EXISTS (SELECT 1 FROM account_quota_windows quota WHERE quota.account_id = provider_accounts.id AND quota.remaining > 0)))) OR (provider_accounts.provider = 'grok_console' AND EXISTS (SELECT 1 FROM account_quota_windows quota WHERE quota.account_id = provider_accounts.id AND quota.mode = 'console') AND NOT EXISTS (SELECT 1 FROM account_quota_windows quota WHERE quota.account_id = provider_accounts.id AND quota.mode = 'console' AND quota.remaining > 0)))`
	accountTypeSortExpression                 = `CASE WHEN provider_accounts.provider = 'grok_web' THEN COALESCE((SELECT profile.tier FROM web_account_profiles profile WHERE profile.account_id = provider_accounts.id), 'auto') WHEN ` + accountBuildSuperPredicate + ` THEN 'paid' WHEN ` + accountFreeSignalPredicate + ` THEN 'free' ELSE 'unknown' END`
	accountStatusSortExpression               = `CASE WHEN provider_accounts.enabled = FALSE THEN 4 WHEN provider_accounts.auth_status = 'reauthRequired' THEN 5 WHEN EXISTS (SELECT 1 FROM account_quota_recovery recovery WHERE recovery.account_id = provider_accounts.id AND recovery.status = 'probing') THEN 3 WHEN EXISTS (SELECT 1 FROM account_quota_recovery recovery WHERE recovery.account_id = provider_accounts.id AND recovery.status = 'exhausted') OR ` + providerQuotaExhaustedPredicate + ` THEN 2 WHEN provider_accounts.cooldown_until > CURRENT_TIMESTAMP THEN 1 ELSE 0 END`
	accountUnclassifiedRefreshReauthPredicate = `NOT EXISTS (SELECT 1 FROM account_credentials credential WHERE credential.account_id = provider_accounts.id AND credential.refresh_permanent = FALSE AND credential.refresh_unclassified_auth_failures > 0)`
	missingConsoleAccountPredicate            = `NOT EXISTS (SELECT 1 FROM provider_accounts AS console_account WHERE console_account.provider = ? AND console_account.source_key = ('console-' || provider_accounts.source_key))`
)

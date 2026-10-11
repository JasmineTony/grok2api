package gateway

import (
	"github.com/chenyme/grok2api/backend/internal/domain/account"
)

func (s *Selector) resolveTierOrder(provider account.Provider, upstreamModel, quotaMode string) []account.WebTier {
	if s.tierOrders == nil {
		return nil
	}
	if resolver, ok := s.tierOrders.(interface {
		TierOrderForQuotaMode(account.Provider, string, string) []account.WebTier
	}); ok {
		return resolver.TierOrderForQuotaMode(provider, upstreamModel, quotaMode)
	}
	return s.tierOrders.TierOrder(provider, upstreamModel)
}

func tierOrderRank(order []account.WebTier, tier account.WebTier) int {
	tier = normalizedRoutingWebTier(tier)
	for index, value := range order {
		if value == tier {
			return index
		}
	}
	return len(order)
}

func normalizedRoutingWebTier(tier account.WebTier) account.WebTier {
	if tier == "" || tier == account.WebTierAuto {
		return account.WebTierBasic
	}
	return tier
}

func webTierInOrder(order []account.WebTier, tier account.WebTier) bool {
	tier = normalizedRoutingWebTier(tier)
	for _, allowed := range order {
		if allowed == tier {
			return true
		}
	}
	return false
}

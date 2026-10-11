package audit

import (
	"context"
	"fmt"
	"time"

	"github.com/chenyme/grok2api/backend/internal/repository"
)

type SummaryUsage struct {
	Requests                int64
	SuccessfulRequests      int64
	FailedRequests          int64
	InputTokens             int64
	CachedInputTokens       int64
	OutputTokens            int64
	ReasoningTokens         int64
	TotalTokens             int64
	AverageDurationMS       float64
	SuccessRate             float64
	EstimatedCostInUSDTicks int64
	PricedRequests          int64
	UnpricedRequests        int64
	PricedTokens            int64
	UnpricedTokens          int64
}

type SummaryResult struct {
	Period      Period
	GeneratedAt time.Time
	Start       time.Time
	End         time.Time
	Usage       SummaryUsage
}

func (s *Service) Summary(ctx context.Context, search, rawPeriod string, filter ListFilter) (SummaryResult, error) {
	return s.summary(ctx, search, rawPeriod, filter, true)
}

// SummaryFresh 绕过短缓存，供管理员显式刷新时读取最新汇总。
func (s *Service) SummaryFresh(ctx context.Context, search, rawPeriod string, filter ListFilter) (SummaryResult, error) {
	return s.summary(ctx, search, rawPeriod, filter, false)
}

func (s *Service) summary(ctx context.Context, search, rawPeriod string, filter ListFilter, useCache bool) (SummaryResult, error) {
	if !validAuditFilter(filter.Status, "", "success", "clientError", "serverError", "2xx", "4xx", "5xx", "other") || !validAuditFilter(filter.Mode, "", "stream", "nonStream") {
		return SummaryResult{}, ErrInvalidFilter
	}
	period, start, end, err := s.resolvePeriod(rawPeriod)
	if err != nil {
		return SummaryResult{}, err
	}
	if !useCache {
		return s.loadSummary(ctx, search, filter, period, start, end)
	}
	cacheKey := fmt.Sprintf("%s\x00%s\x00%s\x00%s\x00%s\x00%s\x00%s", period, search, filter.Model, filter.Status, filter.Mode, filter.Key, filter.Account)
	return s.summaryCache.Load(ctx, cacheKey, end, func() (SummaryResult, error) {
		return s.loadSummary(ctx, search, filter, period, start, end)
	})
}

func (s *Service) loadSummary(ctx context.Context, search string, filter ListFilter, period Period, start, end time.Time) (SummaryResult, error) {
	aggregate, err := s.audits.Summarize(ctx, repository.AuditSummaryQuery{Search: search, Start: start, End: end, Filter: repository.AuditListFilter{
		Model: filter.Model, Status: filter.Status, Mode: filter.Mode, Key: filter.Key, Account: filter.Account,
	}})
	if err != nil {
		return SummaryResult{}, err
	}
	usage := SummaryUsage{
		Requests: aggregate.Requests, SuccessfulRequests: aggregate.SuccessfulRequests, FailedRequests: aggregate.FailedRequests,
		InputTokens: aggregate.InputTokens, CachedInputTokens: aggregate.CachedInputTokens, OutputTokens: aggregate.OutputTokens,
		ReasoningTokens: aggregate.ReasoningTokens, TotalTokens: aggregate.TotalTokens,
		EstimatedCostInUSDTicks: aggregate.EstimatedCostInUSDTicks, PricedRequests: aggregate.PricedRequests,
		UnpricedRequests: aggregate.UnpricedRequests, PricedTokens: aggregate.PricedTokens, UnpricedTokens: aggregate.UnpricedTokens,
	}
	if aggregate.Requests > 0 {
		usage.SuccessRate = float64(aggregate.SuccessfulRequests) / float64(aggregate.Requests) * 100
		usage.AverageDurationMS = float64(aggregate.DurationMS) / float64(aggregate.Requests)
	}
	return SummaryResult{Period: period, GeneratedAt: end, Start: start, End: end, Usage: usage}, nil
}

func (s *Service) resolvePeriod(value string) (Period, time.Time, time.Time, error) {
	period, duration, err := parsePeriod(value)
	if err != nil {
		return "", time.Time{}, time.Time{}, err
	}
	end := s.now().UTC()
	return period, end.Add(-duration), end, nil
}

func parsePeriod(value string) (Period, time.Duration, error) {
	if value == "" {
		value = string(Period24Hours)
	}
	switch Period(value) {
	case Period24Hours:
		return Period24Hours, 24 * time.Hour, nil
	case Period7Days:
		return Period7Days, 7 * 24 * time.Hour, nil
	case Period30Days:
		return Period30Days, 30 * 24 * time.Hour, nil
	case Period90Days:
		return Period90Days, 90 * 24 * time.Hour, nil
	default:
		return "", 0, ErrInvalidPeriod
	}
}

func validAuditFilter(value string, allowed ...string) bool {
	for _, candidate := range allowed {
		if value == candidate {
			return true
		}
	}
	return false
}

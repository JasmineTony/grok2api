package relational

import (
	"time"

	"github.com/chenyme/grok2api/backend/internal/domain/egress"
)

func toEgressDomain(row egressNodeModel) egress.Node {
	return egress.Node{
		ID: row.ID, Name: row.Name, Scope: egress.Scope(row.Scope), Enabled: row.Enabled, ProxyPool: row.ProxyPool,
		SourceID: valueEgressNodeID(row.SourceID), SourceKey: row.SourceKey, AccountCapacity: row.AccountCapacity,
		ProxyProfileID:    valueEgressNodeID(row.ProxyProfileID),
		EncryptedProxyURL: row.EncryptedProxyURL, UserAgent: row.UserAgent, EncryptedCloudflareCookie: row.EncryptedCloudflareCookie,
		ClearanceRefreshedAt: row.ClearanceRefreshedAt, ClearanceFingerprint: row.ClearanceFingerprint,
		ClearanceBindingFingerprint: row.ClearanceBindingFingerprint,
		Health:                      row.Health, FailureCount: row.FailureCount, CooldownUntil: row.CooldownUntil, LastError: row.LastError,
		ProbeStatus: egress.ProbeStatus(row.ProbeStatus), LastProbedAt: row.LastProbedAt, ProbeLatencyMS: row.ProbeLatencyMS, ExitIP: row.ExitIP, ProbeError: row.ProbeError,
		ProbeProvider: storedProbeProvider(egress.ProbeProvider(row.ProbeProvider)),
		IPv4Probe:     probeFamilyFromRow(row.IPv4ProbeStatus, row.IPv4LastProbedAt, row.IPv4ProbeLatencyMS, row.IPv4ExitIP, row.IPv4ProbeError),
		IPv6Probe:     probeFamilyFromRow(row.IPv6ProbeStatus, row.IPv6LastProbedAt, row.IPv6ProbeLatencyMS, row.IPv6ExitIP, row.IPv6ProbeError),
		CreatedAt:     row.CreatedAt, UpdatedAt: row.UpdatedAt,
	}
}

func fromEgressDomain(value egress.Node) egressNodeModel {
	health := value.Health
	if health == 0 && value.ID == 0 {
		health = 1
	}
	probeStatus := value.ProbeStatus
	if !probeStatus.IsValid() {
		probeStatus = egress.ProbeStatusUnknown
	}
	return egressNodeModel{
		ID: value.ID, Name: value.Name, Scope: string(value.Scope), Enabled: value.Enabled, ProxyPool: value.ProxyPool,
		SourceID: egressNodeID(value.SourceID), SourceKey: value.SourceKey, AccountCapacity: value.AccountCapacity,
		ProxyProfileID:    egressNodeID(value.ProxyProfileID),
		EncryptedProxyURL: value.EncryptedProxyURL, UserAgent: value.UserAgent, EncryptedCloudflareCookie: value.EncryptedCloudflareCookie,
		ClearanceRefreshedAt: value.ClearanceRefreshedAt, ClearanceFingerprint: value.ClearanceFingerprint,
		ClearanceBindingFingerprint: value.ClearanceBindingFingerprint,
		Health:                      health, FailureCount: value.FailureCount, CooldownUntil: value.CooldownUntil, LastError: value.LastError,
		ProbeStatus: string(probeStatus), LastProbedAt: value.LastProbedAt, ProbeLatencyMS: value.ProbeLatencyMS, ExitIP: value.ExitIP, ProbeError: value.ProbeError,
		ProbeProvider:   string(storedProbeProvider(value.ProbeProvider)),
		IPv4ProbeStatus: string(normalizedProbeStatus(value.IPv4Probe.Status)), IPv4LastProbedAt: probeTestedAt(value.IPv4Probe), IPv4ProbeLatencyMS: value.IPv4Probe.LatencyMS, IPv4ExitIP: value.IPv4Probe.ExitIP, IPv4ProbeError: value.IPv4Probe.Error,
		IPv6ProbeStatus: string(normalizedProbeStatus(value.IPv6Probe.Status)), IPv6LastProbedAt: probeTestedAt(value.IPv6Probe), IPv6ProbeLatencyMS: value.IPv6Probe.LatencyMS, IPv6ExitIP: value.IPv6Probe.ExitIP, IPv6ProbeError: value.IPv6Probe.Error,
		CreatedAt: value.CreatedAt, UpdatedAt: value.UpdatedAt,
	}
}

func normalizedProbeStatus(value egress.ProbeStatus) egress.ProbeStatus {
	if value.IsValid() {
		return value
	}
	return egress.ProbeStatusUnknown
}

func storedProbeProvider(value egress.ProbeProvider) egress.ProbeProvider {
	if value.IsValid() {
		return value
	}
	return ""
}

func probeTestedAt(value egress.ProbeFamilyResult) *time.Time {
	if value.TestedAt.IsZero() {
		return nil
	}
	testedAt := value.TestedAt.UTC()
	return &testedAt
}

func probeFamilyFromRow(status string, testedAt *time.Time, latencyMS int, exitIP, probeError string) egress.ProbeFamilyResult {
	result := egress.ProbeFamilyResult{
		Status: normalizedProbeStatus(egress.ProbeStatus(status)), LatencyMS: latencyMS, ExitIP: exitIP, Error: probeError,
	}
	if testedAt != nil {
		result.TestedAt = testedAt.UTC()
	}
	return result
}

func toEgressSubscriptionSourceDomain(row egressSubscriptionSourceModel) egress.SubscriptionSource {
	return egress.SubscriptionSource{
		ID: row.ID, Name: row.Name, Scope: egress.Scope(row.Scope), Enabled: row.Enabled, EncryptedURL: row.EncryptedURL, EncryptedProxyURL: row.EncryptedProxyURL,
		RefreshIntervalSeconds: row.RefreshIntervalSeconds, DefaultAccountCapacity: row.DefaultAccountCapacity,
		LastSyncedAt: row.LastSyncedAt, NextSyncAt: row.NextSyncAt, LastSyncImported: row.LastSyncImported, LastSyncError: row.LastSyncError,
		CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
	}
}

func fromEgressSubscriptionSourceDomain(value egress.SubscriptionSource) egressSubscriptionSourceModel {
	return egressSubscriptionSourceModel{
		ID: value.ID, Name: value.Name, Scope: string(value.Scope), Enabled: value.Enabled, EncryptedURL: value.EncryptedURL, EncryptedProxyURL: value.EncryptedProxyURL,
		RefreshIntervalSeconds: value.RefreshIntervalSeconds, DefaultAccountCapacity: value.DefaultAccountCapacity,
		LastSyncedAt: value.LastSyncedAt, NextSyncAt: value.NextSyncAt, LastSyncImported: value.LastSyncImported, LastSyncError: value.LastSyncError,
		CreatedAt: value.CreatedAt, UpdatedAt: value.UpdatedAt,
	}
}

func toEgressOperationsConfigDomain(row egressOperationsConfigModel) egress.OperationsConfig {
	return egress.OperationsConfig{
		ProbeProvider:        egress.ProbeProvider(row.ProbeProvider).Normalized(),
		ProbeIntervalSeconds: row.ProbeIntervalSeconds, AutoAssignEnabled: row.AutoAssignEnabled, AutoBalanceEnabled: row.AutoBalanceEnabled,
		AssignmentIntervalSeconds: row.AssignmentIntervalSeconds,
		Fallbacks: map[egress.Scope]egress.FallbackConfig{
			egress.ScopeBuild:        {Mode: egress.FallbackMode(row.BuildFallbackMode).Normalized(), NodeID: row.BuildFallbackNodeID},
			egress.ScopeWeb:          {Mode: egress.FallbackMode(row.WebFallbackMode).Normalized(), NodeID: row.WebFallbackNodeID},
			egress.ScopeConsole:      {Mode: egress.FallbackMode(row.ConsoleFallbackMode).Normalized(), NodeID: row.ConsoleFallbackNodeID},
			egress.ScopeWebAsset:     {Mode: egress.FallbackMode(row.WebAssetFallbackMode).Normalized(), NodeID: row.WebAssetFallbackNodeID},
			egress.ScopeConsoleAsset: {Mode: egress.FallbackMode(row.ConsoleAssetFallbackMode).Normalized(), NodeID: row.ConsoleAssetFallbackNodeID},
		},
		UpdatedAt: row.UpdatedAt,
	}
}

func fromEgressOperationsConfigDomain(value egress.OperationsConfig) egressOperationsConfigModel {
	buildFallback := value.FallbackFor(egress.ScopeBuild)
	webFallback := value.FallbackFor(egress.ScopeWeb)
	consoleFallback := value.FallbackFor(egress.ScopeConsole)
	webAssetFallback := value.FallbackFor(egress.ScopeWebAsset)
	consoleAssetFallback := value.FallbackFor(egress.ScopeConsoleAsset)
	return egressOperationsConfigModel{
		ID: 1, ProbeProvider: string(value.ProbeProvider.Normalized()), ProbeIntervalSeconds: value.ProbeIntervalSeconds, AutoAssignEnabled: value.AutoAssignEnabled,
		AutoBalanceEnabled: value.AutoBalanceEnabled, AssignmentIntervalSeconds: value.AssignmentIntervalSeconds,
		BuildFallbackMode: string(buildFallback.Mode), BuildFallbackNodeID: buildFallback.NodeID,
		WebFallbackMode: string(webFallback.Mode), WebFallbackNodeID: webFallback.NodeID,
		ConsoleFallbackMode: string(consoleFallback.Mode), ConsoleFallbackNodeID: consoleFallback.NodeID,
		WebAssetFallbackMode: string(webAssetFallback.Mode), WebAssetFallbackNodeID: webAssetFallback.NodeID,
		ConsoleAssetFallbackMode: string(consoleAssetFallback.Mode), ConsoleAssetFallbackNodeID: consoleAssetFallback.NodeID,
		UpdatedAt: value.UpdatedAt,
	}
}

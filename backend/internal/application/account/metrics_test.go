package account

import (
	"context"
	"errors"
	"testing"
	"time"

	accountdomain "github.com/chenyme/grok2api/backend/internal/domain/account"
	"github.com/chenyme/grok2api/backend/internal/infra/provider"
	"github.com/chenyme/grok2api/backend/internal/pkg/batch"
	"github.com/chenyme/grok2api/backend/internal/pkg/perfmetrics"
)

func TestCredentialImportMetricsAreProviderScopedAndIdentityFree(t *testing.T) {
	registry := perfmetrics.NewRegistry()
	previous := perfmetrics.Default
	perfmetrics.Default = registry
	t.Cleanup(func() { perfmetrics.Default = previous })

	recordCredentialImportMetrics(accountdomain.ProviderWeb, ImportResult{Created: 2, Updated: 1}, nil)
	samples := registry.CollectAndReset()
	assertAccountMetric(t, samples, "account_import_runs_total", "credentials", "grok_web", "success", 1)
	assertAccountMetric(t, samples, "account_import_items_total", "credentials", "grok_web", "created", 2)
	assertAccountMetric(t, samples, "account_import_items_total", "credentials", "grok_web", "updated", 1)

	recordCredentialImportMetrics(accountdomain.ProviderConsole, ImportResult{}, context.Canceled)
	assertAccountMetric(t, registry.CollectAndReset(), "account_import_runs_total", "credentials", "grok_console", "canceled", 1)
}

func TestAccountBatchMetricsUseBoundedOperationsAndOutcomes(t *testing.T) {
	registry := perfmetrics.NewRegistry()
	previous := perfmetrics.Default
	perfmetrics.Default = registry
	t.Cleanup(func() { perfmetrics.Default = previous })

	recordAccountBatchMetrics("quota_sync", batch.Summary{
		Total: 5, Submitted: 4, Succeeded: 2, Failed: 2, Panicked: 1, Duration: 25 * time.Millisecond,
	}, errors.New("partial failure"))
	samples := registry.CollectAndReset()
	assertAccountMetric(t, samples, "account_bulk_runs_total", "quota_sync", "", "partial", 1)
	assertAccountMetric(t, samples, "account_bulk_items_total", "quota_sync", "", "succeeded", 2)
	assertAccountMetric(t, samples, "account_bulk_items_total", "quota_sync", "", "failed", 1)
	assertAccountMetric(t, samples, "account_bulk_items_total", "quota_sync", "", "panicked", 1)
	assertAccountMetric(t, samples, "account_bulk_items_total", "quota_sync", "", "unsubmitted", 1)

	recordAccountBatchMetrics("account-12345", batch.Summary{}, nil)
	assertAccountMetric(t, registry.CollectAndReset(), "account_bulk_runs_total", "unknown", "", "success", 1)
}

func TestCredentialRefreshMetricsUseBoundedOutcomes(t *testing.T) {
	registry := perfmetrics.NewRegistry()
	previous := perfmetrics.Default
	perfmetrics.Default = registry
	t.Cleanup(func() { perfmetrics.Default = previous })

	recordCredentialRefreshMetric(accountdomain.ProviderBuild, credentialRefreshMetricOutcome(&provider.CredentialRefreshError{Permanent: true}))
	recordCredentialRefreshMetric(accountdomain.ProviderBuild, credentialRefreshMetricOutcome(errors.New("dial failed")))
	samples := registry.CollectAndReset()
	assertAccountMetric(t, samples, "token_refresh_total", "credential_refresh", "grok_build", "permanent_failure", 1)
	assertAccountMetric(t, samples, "token_refresh_total", "credential_refresh", "grok_build", "transport_failure", 1)
}

func assertAccountMetric(t *testing.T, samples []perfmetrics.Sample, name, operation, provider, outcome string, total int64) {
	t.Helper()
	for _, sample := range samples {
		if sample.Name == name && sample.Labels.Operation == operation && sample.Labels.Provider == provider && sample.Labels.Outcome == outcome {
			if sample.Total != total {
				t.Fatalf("%s total = %d, want %d", name, sample.Total, total)
			}
			return
		}
	}
	t.Fatalf("missing metric %s operation=%s provider=%s outcome=%s in %#v", name, operation, provider, outcome, samples)
}

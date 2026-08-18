# Iteration result: Provider concurrency guard

- Date completed: 2026-08-18
- Status: Complete
- Base commit: `5588f223`
- Final commit: N/A (working tree)
- Pull request: N/A

## Delivered

- Added typed `routing.providerConcurrency` limits for Grok Build, Grok Web,
  and Grok Console with bounded defaults and validation.
- Added the canonical `provider:<provider>` runtime lease key and wired the
  existing memory/Redis `ConcurrencyLimiter` through the Selector.
- Every account lease now acquires a provider lease first and releases both
  exactly once, while preserving account-level `MaxConcurrent` behavior.
- Added provider saturation, provider independence, release, and
  account-below-provider-limit tests.
- Preserved provider concurrency defaults when loading older persisted runtime
  settings that predate the new YAML-only field.

## Verification results

| Check | Result | Notes |
| --- | --- | --- |
| Focused backend tests | Passed | Config, settings, gateway, app, repository |
| Full backend tests | Passed | `go test ./... -count=1` |
| Go static analysis | Passed | `go vet ./...` |
| Markdown/patch checks | Passed | Markdown audit and `git diff --check` (only CRLF warnings) |

## Unresolved and follow-up work

- Aggregate outbound transport pool limits and non-idempotent outer replay
  protection remain outside this iteration.

## Rollback

Revert only the iteration 46 source, tests, configuration example, and plan
records. No database or account-data rollback is required.

# Iteration result: Upstream observability contract

- Date completed: 2026-08-18
- Status: Complete
- Base commit: `5588f223`
- Final commit: N/A (working tree)
- Pull request: N/A

## Delivered

- Extended the bounded performance label set with HTTP `status`; hashing,
  sorting, and Prometheus rendering include the field without adding any
  high-cardinality identifiers.
- Added `grok2api_upstream_request_total` at the gateway adapter-call boundary
  with provider, operation, status, and response/error outcome labels.
- Preserved the independent `grok2api_upstream_physical_call_total` metric,
  which still records provider-internal fallback and recovery calls.
- Added the backward-compatible `grok2api_ws_active{path,provider}` alias while
  retaining `grok2api_voice_websocket_active`.
- Added exporter regression assertions for the new counter and gauge alias.

## Verification results

| Check | Result | Notes |
| --- | --- | --- |
| Focused backend tests | Passed | Perfmetrics, observability, gateway |
| Full backend tests | Passed | `go test ./... -count=1` |
| Go static analysis | Passed | `go vet ./...` |
| Markdown/patch checks | Passed | Markdown audit and `git diff --check` (only CRLF warnings) |

## Unresolved and follow-up work

- Grafana dashboard JSON and deployment-specific alert thresholds remain
  environment work, not embedded application code.

## Rollback

Revert only the iteration 49 source, tests, and plan records. No database or
account-data rollback is required.

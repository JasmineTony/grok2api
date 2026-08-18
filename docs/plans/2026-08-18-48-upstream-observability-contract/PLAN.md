# 2026-08-18-48 Upstream observability contract

## Scope

Complete the missing low-cardinality Prometheus contract requested by the P2
monitoring plan.

1. Emit one logical `upstream_request_total` sample per gateway adapter call
   with bounded provider, operation, status, and outcome labels.
2. Preserve the existing physical-call counter, which counts actual outbound
   network attempts including provider-internal fallback/recovery.
3. Add a stable `grok2api_ws_active` alias with `path` and `provider` labels
   while preserving the existing `grok2api_voice_websocket_active` metric.
4. Extend the shared metric-label value with a bounded HTTP status dimension.

## Constraints

- Do not read, copy, or modify the three user-provided `2026-08-17.json`
  credential files.
- Keep labels bounded; never add account ID, request ID, model, token, or proxy
  values.
- Preserve existing metric names and dashboards for backward compatibility.
- Do not introduce a Prometheus client dependency.

## Ordered Work

1. Extend `perfmetrics.Labels` and its hash/export paths with `Status`.
2. Instrument the gateway logical adapter call boundary.
3. Export the upstream request counter and WebSocket alias.
4. Add exporter regression assertions and run all local gates.

## Acceptance Criteria

- `grok2api_upstream_request_total{provider,operation,status,...}` appears for
  both response and transport-error adapter calls.
- `grok2api_upstream_physical_call_total` remains unchanged.
- `grok2api_ws_active{path,provider}` is emitted without removing the existing
  metric.
- Full backend tests, `go vet`, Markdown audit, and diff checks pass.

## Rollback

Revert only the iteration 48 source, tests, and plan records. No database or
account-data rollback is required.

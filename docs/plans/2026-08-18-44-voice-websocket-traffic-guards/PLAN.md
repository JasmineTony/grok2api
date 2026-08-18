# 2026-08-18-44 Voice WebSocket Traffic Guards

## Scope

Continue the unfinished P1 high-traffic safeguards with changes that can be
proved locally:

1. Add a configurable idle timeout for `/v1/realtime` and `/v1/stt`.
2. Add a configurable token-bucket message rate limit for client-to-upstream
   WebSocket traffic.
3. Export active Voice WebSocket gauges by bounded path operation and provider.
4. Classify idle timeout and message-rate termination separately in metrics and
   audit status instead of reporting both as generic upstream failures.
5. Preserve the existing account lease for the whole session, which already
   enforces each account's configured `MaxConcurrent` capacity.

## Constraints

- Do not read, copy, or modify the three user-provided `2026-08-17.json`
  credential files.
- Do not place account IDs, request IDs, model names, tokens, or proxy
  identifiers in Prometheus labels.
- Apply the message limiter only to client-to-upstream frames; upstream output
  remains bounded by connection lifecycle and message-size limits.
- Keep the new limits static startup configuration in this iteration.
- Do not change account-selection or billing reservation semantics.

## Ordered Work

1. Add server configuration defaults, validation, example values, and tests.
2. Wire the policy through HTTP server dependencies into the inference handler.
3. Add idle tracking and a token-bucket limiter to the Voice WebSocket pump.
4. Add active-session gauges and bounded close outcomes.
5. Add focused unit tests for limiter refill/burst, activity tracking, status
   classification, metrics, and configuration.
6. Run focused tests, full backend tests, `go vet`, Markdown audit, and diff
   checks.

## Acceptance Criteria

- An idle Voice WebSocket closes after the configured no-traffic duration and
  records `websocket_idle_timeout` with logical status 408.
- A client exceeding the configured token bucket closes with
  `websocket_rate_limit_exceeded` and logical status 429.
- Active gauges increment after an upstream session opens and decrement exactly
  once during finalization.
- Normal, STT duration-limit, upstream-error, client-error, idle, and
  rate-limited metric outcomes stay bounded.
- Existing Voice WebSocket origin, STT reservation, billing, and lease behavior
  remains intact.

## Rollback

Revert only the iteration 44 source, tests, configuration example, and plan
records. No database or account-data rollback is required.

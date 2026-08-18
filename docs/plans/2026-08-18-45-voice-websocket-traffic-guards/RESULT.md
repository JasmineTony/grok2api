# Iteration result: Voice WebSocket traffic guards

- Date completed: 2026-08-18
- Status: Complete
- Base commit: `5588f223`
- Final commit: N/A (working tree)
- Pull request: N/A

## Delivered

- Added startup configuration for Voice WebSocket idle timeout, client message
  rate, and burst capacity with bounded defaults and validation.
- Wired the policy through the HTTP server into the inference handler while
  retaining safe defaults for tests and embedded construction.
- Added bidirectional activity tracking and a per-connection token bucket for
  client-to-upstream frames.
- Classified idle termination as `websocket_idle_timeout` with logical status
  408 and client rate termination as `websocket_rate_limit_exceeded` with
  logical status 429.
- Added bounded `voice_websocket_active` gauges by operation and provider, with
  exactly-once decrement through the existing session finalizer.
- Confirmed the existing account lease remains held until finalization, so the
  account `MaxConcurrent` limit also bounds active Voice WebSockets.

## Verification results

| Check | Result | Notes |
| --- | --- | --- |
| Focused backend tests | Passed | Config, inference, gateway, observability, HTTP server |
| Full backend tests | Passed | `go test ./... -count=1` |
| Go static analysis | Passed | `go vet ./...` |
| Markdown/patch checks | Passed | 117 tracked Markdown files; diff check clean apart from line-ending warnings |

## Unresolved and follow-up work

- Per-provider semaphores, aggregate outbound connection limits, and
  non-idempotent outer replay protection remain outside this iteration.
- Voice WebSocket policy is startup configuration in this iteration and is not
  exposed through the runtime settings DTO.

## Rollback

Revert only the iteration 45 source, tests, configuration example, and plan
records. No database or account-data rollback is required.

## Final acceptance

- [x] Idle and client message-rate limits are configurable and tested.
- [x] Idle/rate close outcomes use distinct bounded metrics and audit statuses.
- [x] Active session gauges increment and decrement without identity labels.
- [x] Existing STT billing, origin checks, and account lease semantics remain.
- [x] Backend and repository verification gates pass.

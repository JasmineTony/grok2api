# Iteration result: P1 lifecycle hardening

- Date completed: 2026-08-18
- Status: Complete
- Base commit: `5588f223`
- Final commit: N/A (working tree)
- Pull request: N/A

## Delivered

- Added four redacted Web Lite fixtures under
  `backend/testdata/protocol/web_lite/` covering final nested cards,
  completed-without-image, duplicate final cards, and partial-only streams.
- Added fixture-driven parser tests and classified partial progress with a
  URL as `incomplete_image`.
- Normalized empty import seed providers to the adapter provider, rejected
  mismatches, moved Web/Console duplicate preservation to the Service layer,
  counted request-local duplicates as `skipped`, and added provider-scoped
  import SSE summaries.
- Added `Provider` to Build import seeds and extended frontend account-task
  DTO decoding with `skipped` and optional provider breakdown fields.
- Changed OAuth permanence to code-first classification, redacted extracted
  error messages, added exponential backoff with an uncapped
  `Retry-After` floor, and exported bounded token-refresh outcomes.
- Wired audit commit/drop observers to billing reservation protection cleanup.
  Added settlement, writer-unavailable, queue depth, active reservation, and
  reservation-age metrics with Prometheus counter/gauge types.

## Verification results

| Check | Result | Notes |
| --- | --- | --- |
| Focused backend tests | Passed | Web, CLI OAuth, account, audit, clientkey, observability, app, account HTTP |
| Full backend tests | Passed | `go test ./... -count=1` |
| Go static analysis | Passed | `go vet ./...` |
| Frontend typecheck/build | Passed | `tsc -b && vite build` |
| Frontend tests | Passed | 19 files, 66 tests |
| Frontend formatting/lint | Passed | Prettier check and ESLint |
| Markdown/patch checks | Passed | 117 tracked Markdown files; `git diff --check` clean apart from line-ending warnings |

## Deviations from plan

- Web/Console parser unit tests were updated because duplicate preservation is
  now intentionally owned by the Service layer; final persisted counts remain
  idempotent.

## Unresolved and follow-up work

- Live Web Lite schema capture is still external; no new successful parsing
  rule was inferred from an unredacted response.
- Per-provider semaphores, WS idle/rate limits, aggregate outbound limits, and
  non-idempotent gateway replay protection remain for the next iteration.

## Rollback

Revert only the iteration 43 source, tests, fixtures, frontend DTO changes,
and plan records. No database or account-data rollback is required.

## Final acceptance

- [x] Web Lite fixture and parser diagnostic coverage is reusable and redacted.
- [x] Import deduplication and provider-scoped summaries are explicit.
- [x] OAuth failure classification/backoff/diagnostic redaction are tested.
- [x] Billing settlement and reservation observability are exported.
- [x] Backend and frontend local verification gates pass.

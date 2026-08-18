# Iteration result: Non-idempotent outer replay guard

- Date completed: 2026-08-18
- Status: Complete
- Base commit: `5588f223`
- Final commit: N/A (working tree)
- Pull request: N/A

## Delivered

- Added a provider response replay-safety signal for future adapters with an
  explicit upstream idempotency contract.
- Added `canRetryOuterResponse` to distinguish explicit retryable 4xx outcomes
  from indeterminate 5xx POST results.
- Preserved Build account failover because gateway-generated Build requests use
  one upstream `Idempotency-Key` across attempts.
- Prevented Web and Console 5xx responses from selecting another account while
  returning the original response body through the existing audit/finalization
  path.
- Added focused coverage for Build, Web, Console, explicit 4xx, indeterminate
  5xx, and provider opt-in behavior.

## Verification results

| Check | Result | Notes |
| --- | --- | --- |
| Focused backend tests | Passed | Gateway and provider packages |
| Full backend tests | Passed | `go test ./... -count=1` |
| Go static analysis | Passed | `go vet ./...` |
| Markdown/patch checks | Passed | Markdown audit and `git diff --check` (only CRLF warnings) |

## Unresolved and follow-up work

- Aggregate outbound transport pool limits remain outside this iteration.

## Rollback

Revert only the iteration 47 source, tests, and plan records. No database or
account-data rollback is required.

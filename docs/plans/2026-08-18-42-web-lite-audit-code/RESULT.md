# Iteration result: Web Lite audit code consistency

- Date completed: 2026-08-18
- Status: Complete
- Base commit: `5588f223`
- Final commit: N/A (working tree)
- Pull request: N/A

## Delivered

- Added `imageFailureAuditCode` in
  `backend/internal/application/gateway/image.go`.
- Image generation and editing failures now preserve a provider public code
  only when it passes `provider.ErrorPublicCode` validation.
- Preserved existing error-code behavior:
  - media post-processing failures remain `media_postprocessing_failed`;
  - invalid and unclassified errors remain `upstream_unavailable`.
- Added focused classifier coverage for wrapped valid codes, invalid codes,
  and media post-processing precedence.
- Added an integration assertion proving that
  `web_lite_image_parse_failed` reaches the persisted gateway audit record
  with HTTP status `502`.
- Confirmed that a public-code image failure leaves no client-key billing
  reservation behind.

## Verification results

| Check | Result | Notes |
| --- | --- | --- |
| Focused gateway tests | Passed | `go test ./internal/application/gateway -count=1` |
| Full backend tests | Passed | `go test ./... -count=1` |
| Go static analysis | Passed | `go vet ./...` |
| Patch check | Passed | `git diff --check`; line-ending warnings only |
| Account JSON preservation | Passed | all three files remain untracked and untouched |

## Deviations from plan

- None.

## Unresolved and follow-up work

- A redacted capture from the current external Grok Web Lite response remains
  necessary before changing successful parsing rules.
- No live upstream request was made in this iteration; the change is covered
  by provider-code unit tests and gateway-to-audit integration tests.

## Rollback

Revert only:

- `backend/internal/application/gateway/image.go`
- the iteration 42 additions in
  `backend/internal/application/gateway/service_test.go`
- `docs/plans/2026-08-18-42-web-lite-audit-code/`
- the iteration 42 row in `docs/plans/README.md`

No database, account-data, or configuration rollback is required.

## Final acceptance

- [x] Valid provider public codes reach image audit records.
- [x] Invalid codes remain private and collapse to the generic audit code.
- [x] Media post-processing semantics are unchanged.
- [x] Billing reservations are released on the tested failure path.
- [x] Verification and rollback records are complete.

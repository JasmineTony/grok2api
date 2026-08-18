# Iteration result: Full remediation observability and CI gates

- Date completed: 2026-08-18
- Status: Complete
- Base commit: `5588f223`
- Final commit: N/A (working tree)
- Pull request: N/A

## Delivered

- Added cumulative, non-destructive snapshots to
  `backend/internal/pkg/perfmetrics/registry.go`.
- Exported a strict allowlist of low-cardinality operational counters through
  the existing opt-in Prometheus listener:
  - account import runs and created/updated/skipped items;
  - account bulk runs and succeeded/failed/panicked/unsubmitted items;
  - Web Lite parser outcomes;
  - voice WebSocket open/close outcomes;
  - billing reservation and cleanup outcomes.
- Added bounded account import and bulk-operation labels. Unknown operation
  strings are collapsed to `unknown`; account IDs, names, request IDs, model
  names, tokens, cookies, and proxy values are never metric labels.
- Added `provider.PublicCodeError` and validation for lowercase, bounded public
  machine codes.
- Changed Web Lite terminal parser failures to expose HTTP `502` with code
  `web_lite_image_parse_failed`, while keeping the client message generic.
- Added bounded Web Lite diagnostic classes:
  `empty_capture`, `upstream_error`, `soft_stop_no_image`,
  `no_image_chunk`, `incomplete_image`, `completed_without_url`, and
  `unusable_image_url`.
- Removed raw response-field names, message tags, image-field names, upstream
  error codes, and upstream error messages from the Web Lite parser warning.
  The warning now retains only counts, booleans, progress, byte size, account
  ID, and the bounded reason.
- Added voice WebSocket lifecycle metrics with bounded outcomes:
  `success`, `failed`, `canceled`, `duration_limit`, `upstream_error`, and
  `client_error`.
- Confirmed that `.github/workflows/ci.yml` already contains:
  - Linux `go test -race -p 1 ./...`;
  - backend tests, `go vet`, and `govulncheck`;
  - frontend `pnpm verify`;
  - Actionlint, Markdown/release audits, and Gitleaks;
  - Docker health smoke;
  - Firefox/WebKit and Chromium browser jobs.
  No duplicate CI jobs were added.

## Verification results

| Check | Result | Notes |
| --- | --- | --- |
| Focused Go tests | Passed | perfmetrics, observability, account, provider, Web, gateway, inference |
| Full Go tests | Passed | `go test ./... -count=1` |
| Go static analysis | Passed | `go vet ./...` |
| Frontend formatting | Passed | repository-local Prettier binary |
| Frontend typecheck | Passed | `tsc -b` |
| Frontend lint | Passed | ESLint with zero warnings |
| Frontend tests | Passed | 19 files, 66 tests, V8 coverage |
| Frontend production build | Passed | Vite 8.2.0 |
| Frontend governance | Passed | icons, UI symbols, bundle, chunk cycles, Knip, code, architecture, duplication |
| Script tests | Passed | 10 Python release-automation tests |
| Release audit | Passed | v3.6.1 metadata |
| Patch check | Passed | `git diff --check` |
| CI gate inspection | Passed | race/static/frontend/security/container/browser gates present |

The `pnpm verify` wrapper could not initialize its user-level tool directory
because Windows denied access to
`C:\Users\kehon\AppData\Local\pnpm\.tools`. Every command in `verify` was run
directly with the repository-local binaries and scripts and passed.

The first focused Go invocation also hit the host's inaccessible default Go
build cache. Re-running with workspace-local `GOCACHE`, `TEMP`, and `TMP`
completed successfully.

## Assumptions and defaults verification

| Assumption/default | Result | Evidence |
| --- | --- | --- |
| Metrics labels are bounded | Confirmed | whitelist exporter and focused tests |
| Existing billing metrics are Prometheus-visible | Confirmed | allowlisted `billing_reservation_*` samples |
| Web Lite error details remain private | Confirmed | public-code transport test and redacted warning fields |
| Successful existing Lite fixtures are unchanged | Confirmed | full Web provider test package passed |
| CI race coverage is Linux-based | Confirmed | `backend-race` job in `ci.yml` |
| Account JSON files remain untouched | Confirmed | no JSON file is in the tracked diff |

## Push gate evidence

- First remote push occurred only after final local acceptance: N/A
- Final synchronization base: `5588f223`
- Final verification run: full backend, frontend, script, Markdown, release,
  and diff checks described above

## Deviations from plan

- CI files were not modified because all requested race, static, frontend,
  secret, container, and browser gates already existed.
- The Web Lite parser was not changed to guess a new upstream schema. Only
  bounded diagnostics, metrics, redaction, and the stable public error code
  were added.
- Local race execution remains unavailable because the Windows host has no GCC;
  the existing Ubuntu CI race job is the authoritative gate.

## Unresolved and follow-up work

- A redacted capture from the current failing Grok Web Lite upstream response
  is still required before adding a new successful parsing rule.
- Live upstream quota outcomes remain external:
  Responses and Console image can return `429` depending on account quota.
- Local Firefox startup remains host-blocked; the Linux CI Firefox/WebKit job
  remains the cross-browser gate.
- The pinned local Gitleaks attempt could not start because Go was denied
  access to the user-level checksum database at
  `C:\Users\kehon\go\pkg\sumdb\sum.golang.org\latest`; CI runs pinned
  Gitleaks `v8.30.1` with repository configuration.

## Rollback

Revert only the iteration 41 changes in:

- `backend/internal/pkg/perfmetrics/`
- `backend/internal/observability/`
- `backend/internal/application/account/service.go`
- `backend/internal/application/account/metrics_test.go`
- `backend/internal/application/gateway/voice_ws.go`
- `backend/internal/application/gateway/service_test.go`
- `backend/internal/infra/provider/provider.go`
- `backend/internal/infra/provider/public_error_test.go`
- `backend/internal/infra/provider/web/image.go`
- `backend/internal/infra/provider/web/protocol_test.go`
- `backend/internal/transport/http/inference/handler.go`
- `backend/internal/transport/http/inference/handler_test.go`

No database migration, account-data rollback, or configuration rollback is
required.

## Final acceptance

- [x] Implementation matches the accepted scope.
- [x] Checks and security review are complete.
- [x] Repository state and environment deviations are documented.
- [x] The plan index is updated.

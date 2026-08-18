# Result

- Date completed: 2026-08-18
- Status: Complete
- Base commit: `5588f223`
- Final commit: N/A (working tree)
- Pull request: N/A

## Scope Completed

No production files, credentials, or user-provided `2026-08-17.json` account
files were modified. The implementation is limited to the audited CLI,
trusted-proxy handling, administrator login IP resolution, WebSocket origin
validation, and streaming STT billing protection.

## Code Changes

- `backend/internal/cli/run.go`
  - `Run` now dispatches the documented `serve` subcommand before parsing
    command options.
  - Regression coverage is in `backend/internal/cli/run_test.go`.
- `backend/internal/infra/config/config.go`
  - Added `server.trustedProxies`.
  - Values must be an IP or valid CIDR; an empty entry is rejected.
- `backend/internal/app/application.go` and
  `backend/internal/transport/http/server.go`
  - Pass the configured networks into Gin.
  - Explicitly call `SetTrustedProxies`; an empty list disables forwarded-IP
    trust instead of inheriting Gin's trust-all default.
- `backend/internal/transport/http/adminauth/handler.go`
  - Login throttling now uses `Context.ClientIP()`, which honors
    `X-Forwarded-For` only for configured trusted proxy networks.
- `backend/internal/transport/http/inference/voice_ws_handler.go`
  - Empty Origin and same-host Origin remain valid.
  - Cross-host or malformed browser Origins are rejected.
  - STT `transcript.done` duration is capped at the same 3,600-second limit
    used for the billing reservation.
  - A duration-limit outcome is preserved instead of being overwritten by the
    generic upstream interruption branch.
- `backend/internal/application/gateway/voice_ws.go`
  - Streaming STT reserves the official one-hour estimate before dialing.
  - The session exposes the one-hour duration cap.
  - Successful finalization settles actual duration; failed or over-limit
    finalization records no billable estimate, allowing the existing atomic
    audit transaction to delete the reservation.
  - Over-limit audits use logical status `402 Payment Required` with
    `stt_duration_limit_exceeded`.
- `config.example.yaml`
  - Documents the opt-in `trustedProxies: []` default.

## Verification

Passed:

- `go test ./... -count=1`
- `go vet ./...`
- Focused gateway, HTTP inference, admin-auth, config, CLI, and HTTP server
  tests
- Frontend `tsc -b`
- Frontend ESLint with `--max-warnings 0`
- Frontend Vitest: 19 files, 66 tests
- Frontend Vite production build
- `git diff --check`
- `go test ./internal/infra/provider/streamidle -count=20 -run TestReadCloserResetsDeadlineOnProgress`

The first full Go run had one timing-sensitive failure in
`internal/infra/provider/streamidle/TestReadCloserResetsDeadlineOnProgress`;
the focused 20-run check and the subsequent complete `go test ./... -count=1`
both passed, so no unrelated production change was made.

Race verification is environment-blocked, not code-failed:

- `go test -race ...` first reported `-race requires cgo`.
- With `CGO_ENABLED=1`, the host reported `C compiler "gcc" not found`.

## Exhaustive 2026-08-17 Account Run

The three supplied files contain 58 entries: 20 Build, 20 Web, and 18
Console. Using the current binary and the isolated local audit database:

- Build import: HTTP `200` SSE, `created=20`, `updated=0`, `synced=20`,
  `syncFailed=0`.
- Web import: HTTP `200` SSE, `created=19`, `updated=1`, `synced=20`,
  `syncFailed=0`.
- Console import: HTTP `200` SSE, `created=17`, `updated=1`, `synced=18`,
  `syncFailed=0`.
- Bulk refresh: Build `20/20` JSON accounts succeeded; Web quota `20/20`;
  Console quota `18/18`; billing `20/20` eligible accounts; model sync
  `3/3` provider groups.

The local database also contained one older Build credential from the earlier
single-account smoke fixture, so the post-run account total was 59. Its
separate `400 invalid_grant` / revoked-refresh-token state is not attributed
to any of the 20 accounts in the supplied Build file.

## Audit Findings Retained as External/Fixture Issues

- The Web Lite image request still fails with HTTP `502`, code
  `upstream_unavailable`, after the provider stream ends without a parseable
  image. The lower-level provider error is
  `Grok Web Lite 响应结束但未解析到最终图片`
  (`backend/internal/infra/provider/web/image.go:489`). A captured,
  redacted provider fixture is required before changing the parser; Web
  Quality, Console image, and TTS paths must remain unchanged.
- Live upstream `429` responses are quota signals, not parser regressions:
  Responses `grok-4.5` returned `429`; Console image returned
  `429 upstream_quota_exhausted`; TTS returned `200 audio/mpeg`.
- The first API sweep intentionally called
  `/api/admin/v1/models/accounts` without `provider` and the wrong
  `/api/admin/v1/quality-guard/profiles` path. Those produced expected
  `400 账号来源无效` and `404`; the corrected provider-scoped route and
  `/api/admin/v1/egress-quality-guard/profiles` both returned `200`.
- Firefox Playwright smoke remains environment-blocked by
  `Failed to launch tab subprocess`; Chromium and WebKit smoke passed.
- The optional `gitleaks` binary is not installed on this host, so a local
  gitleaks run was not claimed.

## Rollback

Revert the files in this plan and remove `server.trustedProxies` from local
configuration. No database migration or account-data rollback is required.

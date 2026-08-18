# Iteration result: Live account request error diagnosis

- Date completed: 2026-08-17
- Status: Complete
- Base commit: `cd5ca92ad7da142a070ffe2597fadc03e359a5d1`
- Implementation commit: `fe06a15d5d745d5742bdc0af60b019a34952d386`
- Final commit: Documentation closeout after implementation commit `fe06a15d5d745d5742bdc0af60b019a34952d386`

## Delivered

- Read the three supplied files from `E:\codex\grok2api` without copying them into the repository. Each contained one structurally valid account with no provider/schema mismatch.
- Imported each matching Build, Web, and Console file into a disposable SQLite instance. All three returned HTTP 200, terminal `complete`, `created=1`, `synced=1`, and `syncFailed=0`.
- Exercised 43 account operations across single, batch, and all-account enable/disable, quota/Billing synchronization, token refresh, quota reset, Build detection, egress policy, Web conversion, Web account tools, and deletion preview. Every operation returned 2xx.
- Deleted and re-imported each provider account. Build, Web, and Console delete/restore flows each returned HTTP 200 and a terminal import event.
- Bound temporary inference routes to the original imported account IDs and tested Build Responses, Web Chat Completions, and Console Responses.
- Fixed the confirmed defect: account SSE `error` events omitted status on the backend, while the frontend hardcoded every task error to `ApiError(502, ...)`. The backend now emits `status`, `code`, and `message`; the frontend validates and preserves 400–599 status codes.

## Provider test findings

| Path | Result | Evidence |
| --- | --- | --- |
| Build import/sync | Passed | `complete`, `synced=1`, `syncFailed=0`. |
| Web import/sync | Passed | `complete`, `synced=1`, `syncFailed=0`; Web quota, terms, birthday, NSFW, scripts, and conversion calls returned 2xx. |
| Console import/sync | Passed | `complete`, `synced=1`, `syncFailed=0`; Console quota call returned 2xx. |
| Build inference | Provider/account limited | Upstream returned `429 subscription:free-usage-exhausted`; later local selection correctly returned `429 upstream_quota_exhausted` with zero remaining billing quota. |
| Web inference | Passed | Bound `Web/grok-chat-fast` request returned HTTP 200. |
| Console inference | Provider/account limited | Upstream returned `429 RESOURCE_EXHAUSTED`; structured log reported team/model RPS `actual=6`, `limit=6`, `retry_after=2s`. |
| Controlled malformed import | Fixed | Backend SSE returned `status=400`, `code=authImportFailed`; frontend preserves 400 instead of converting it to 502. |

## Verification results

| Check | Result | Notes |
| --- | --- | --- |
| Account document import | Passed | Three matching files imported in isolation; all completed and synchronized. |
| Account management matrix | Passed | 43 single/batch/all operations plus three delete/restore cycles returned 2xx. |
| Backend focused tests | Passed | `go test ./internal/transport/http/account`. |
| Backend full tests and static analysis | Passed | `go test ./...` and `go vet ./...`. |
| Frontend focused tests | Passed | Account task API tests include status-preserving SSE errors. |
| Frontend full checks | Passed | Prettier, `tsc -b`, ESLint, 22 files/81 tests, Vite build, Knip, API-contract, architecture, bundle, chunk, icon, UI-symbol, code, and JSCPD checks passed. Existing Knip `.css` hint and baseline clones remain unchanged. |
| Temporary secret cleanup | Passed | Temporary SQLite DB, config, access token, client key, SSE captures, inference responses, and invalid fixtures were deleted. |

## Root-cause conclusion

- The supplied account files and current provider request implementations are usable locally; import, sync, Web actions, and Build/Web inference do not reproduce a universal 502.
- Build and Console failures are account/provider state: Build subscription free usage exhausted; Console team/model RPS exhausted. These remain 429-class responses and should not be rewritten as 502.
- The confirmed application defect was error presentation: SSE task failures were serialized without status and the frontend invented HTTP 502 for every error event. This is corrected in `backend/internal/transport/http/account/handler.go` and `frontend/src/features/accounts/account-tasks-api.ts`.
- If a deployed instance still reports universal 502, inspect request-audit details and structured logs for `credential_decrypt_failed`, `NO_AVAILABLE_NODES`, or `upstream_request_failed`; those indicate deployment key/egress state rather than these JSON formats.

## Unresolved and follow-up work

- Live provider quotas and RPS limits must recover upstream or use a different authorized account; source changes cannot manufacture Build credits or Console team capacity.
- Device OAuth completion was not attempted because it requires interactive user authorization.

## Rollback

Revert implementation commit `fe06a15d5d745d5742bdc0af60b019a34952d386`. No schema or persistent-data migration is planned.

## Final acceptance

- [x] Implementation matches the accepted scope.
- [x] Checks and security review are complete.
- [x] Temporary credential artifacts are removed.
- [x] The plan index is updated.

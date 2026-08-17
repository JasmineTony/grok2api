# Iteration result: Account request parity and interface remediation

- Date completed: 2026-08-17
- Status: Complete
- Initial base commit: `d04c5ef13a3c034326f7684201e5db0b214d1630`
- Final synchronized base: `5588f2232d035931ff1e78e7791d9f5f36b74980`
- Final commit: `N/A (uncommitted local worktree)`
- Pull request: `N/A`

## Delivered

- Restored Grok Build Device OAuth completion against upstream or rolling backends whose account response predates the fork-only `state` and `stateChangedAt` fields.
- Restored Grok Web SSO and Grok Console SSO imports across the current SSE contract and the older successful JSON envelope without probing or duplicating the request.
- Preserved non-2xx API errors, existing 401 refresh semantics, multipart `files` uploads, strict SSE parsing, and strict successful JSON MIME handling.
- Added account-state compatibility normalization for disabled, reauthentication, quota exhaustion, Console quota windows, cooldown, and ready states.
- Split account DTO contracts into a dedicated module so the compatibility work does not regress the frontend maintainability gate.
- Added a production-aware administration API audit covering shared client calls, direct refresh requests, dynamic path concatenation, all 15 registered admin route groups, and zero unresolved paths.
- Added focused request-contract tests for all three onboarding flows, older account responses, account updates, JSON fallback, error preservation, MIME rejection, and refresh URL/method.

## Verification results

| Check                       | Result | Notes                                                                                   |
| --------------------------- | ------ | --------------------------------------------------------------------------------------- |
| Focused frontend tests      | Passed | 3 files, 14 tests.                                                                      |
| Full frontend tests         | Passed | 21 files, 76 tests.                                                                     |
| Frontend typecheck          | Passed | `tsc -b`.                                                                               |
| Frontend lint               | Passed | ESLint with zero warnings.                                                              |
| Frontend production build   | Passed | Vite transformed 3,836 modules.                                                         |
| Admin API contract audit    | Passed | 112 calls, 109 unique contracts, 15 production registration groups, 0 unresolved calls. |
| Frontend governance audits  | Passed | Code, architecture, bundle, chunk-cycle, icon, and UI-symbol checks.                    |
| Backend tests               | Passed | `go test ./...`.                                                                        |
| Backend static analysis     | Passed | `go vet ./...`.                                                                         |
| Markdown audit              | Passed | 117 tracked Markdown files, no removable files.                                         |
| Formatting and diff hygiene | Passed | Prettier and `git diff --check`.                                                        |
| Independent review          | Passed | No P0/P1 findings; all three P2 audit/MIME findings were fixed and revalidated.         |

## Assumptions and defaults verification

| Assumption/default                                                       | Result    | Evidence                                                                                                                               |
| ------------------------------------------------------------------------ | --------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Initial upstream baseline was `369de6fd648b695a70dfab1587cfa956bb4f5c83` | Confirmed | Fetched upstream reference and ancestry check.                                                                                         |
| Final upstream baseline is `f06d6fe79fd51b002b3a25b2f0be7532a455a298`    | Confirmed | HTTPS `ls-remote`, fetch, commit/file comparison, and independent review.                                                              |
| The final upstream delta affects this request scope                      | Rejected  | The delta only changes image-edit routing, model capability, and quota fencing; OAuth/SSO handlers and contracts are blob-identical.   |
| Backend administrative routes remain rooted at `/api/admin/v1`           | Confirmed | Production registration audit covered 15 route groups.                                                                                 |
| Real credentials are unnecessary for local contract verification         | Confirmed | Handler/provider tests and mocked frontend request tests cover paths, methods, bodies, streams, responses, and errors without secrets. |
| Original worktree receives no iteration 40 writes                        | Confirmed | All implementation and generated build output stayed in `E:\codex\grok2api-account-request-fix`.                                       |

## Push gate evidence

- First remote push occurred only after final local acceptance: No remote push performed.
- Final origin synchronization base: `origin/main` remains `f53bbaae8d40316da6c337db3301941760f0990c` and is already contained by the branch base.
- Final feature synchronization base: `origin/fix/new-model-capability-failover-20260816` is `5588f2232d035931ff1e78e7791d9f5f36b74980`; iteration 39 was fast-forwarded before the final verification run.
- Final upstream review base: `f06d6fe79fd51b002b3a25b2f0be7532a455a298`; its new image-edit-only changes are intentionally not merged into this request-scoped branch.
- Final verification run: Completed after the independent review fixes.

## Deviations from plan

- The administration API audit was promoted into the standard frontend `verify` chain because a one-time manual matrix would not prevent future route drift.
- Full upstream `f06d6fe7` was not merged because its post-start changes are unrelated image-edit behavior; the changed files and account request blobs were reviewed explicitly.

## Unresolved and follow-up work

- No in-scope code defect remains.
- Live OAuth/SSO provider acceptance with real credentials was not performed; production operators should verify with authorized test accounts after deployment without logging codes, cookies, or SSO tokens.

## Rollback

Revert the iteration files or remove the isolated worktree and local branch. No schema, credential, or persistent-data migration is included.

## Final acceptance

- [x] Implementation matches the accepted scope.
- [x] Checks and security review are complete.
- [x] Repository state is documented; only the intentional uncommitted iteration diff remains.
- [x] The plan index is updated.

# Iteration result: Live account request root-cause verification

- Date completed: 2026-08-18
- Status: Complete
- Base commit: `03d4cef294dbe999bbf73dcb51d9ca3a56bb4b7e`
- Final synchronization base: `4a2fd1a5d5ae8bb0065321816e6b3ae2e9a0a7b0`
- Final commit: Branch `HEAD` at delivery
- Pull request: Compare `main...fix/upstream-architecture-performance-20260817`

## Delivered

- Synchronized the branch to `fork/main`; `upstream/main` at `57746fc70289fcbab4bf33db33c521cf756ebbb9` is already an ancestor of the synchronized base.
- Imported the three dated Build, Web, and Console exports through their matching HTTP endpoints into an isolated SQLite database.
- Exercised 39 correct-key account actions, including enable, disable, detection, quota, token refresh, scripts, conversion, synchronization, egress settings, delete preview, actual deletion, and restore.
- Reproduced the deployment-wide provider failures with a controlled wrong `credentialEncryptionKey`.
- Classified decryption failures as HTTP/SSE status 409 with code `credentialDecryptionFailed` and an actionable recovery message instead of generic 502 responses.
- Classified permanently rejected Build refresh credentials as HTTP 409 with code `accountReauthorizationRequired`.
- Preserved the original Build account ID when credential refresh fails during account detection.
- Promoted all-decryption-failure batch and conversion operations to structured errors while retaining best-effort summaries for mixed failures.
- Added backend regression tests, frontend translations, and operator documentation.

## Verification results

| Check | Result | Notes |
| --- | --- | --- |
| Correct-key import | Pass | Build created with expected revoked-refresh sync failure; Web and Console created and synchronized |
| Correct-key request matrix | Pass | 37 HTTP 200 responses and 2 expected Build HTTP 409 reauthorization responses |
| Delete and restore | Pass | Each original Build, Web, and Console account was deleted and re-imported successfully |
| Wrong-key request matrix | Pass | Provider-dependent single and batch operations return structured 409 decryption failures |
| Wrong-key local operations | Pass | Enable, disable, egress GET, and delete preview remain HTTP 200 |
| Build detection wrong-key result | Pass | Failed item preserves its account ID and reports HTTP 409 with the recovery reason |
| Focused backend tests | Pass | Security, account application, and account HTTP transport packages |
| Full backend tests | Pass | `go test -coverprofile=<temporary-path>/coverage.out ./...` |
| Backend vet | Pass | `go vet ./...` |
| Vulnerability scan | Pass | No called vulnerabilities found by `govulncheck`; four required-module findings are unreachable |
| Frontend verification | Pass | Format, typecheck, ESLint, 81 Vitest tests, build, budgets, Knip, architecture, contracts, and duplication checks |
| Dependency audit | Pass | `pnpm audit --audit-level high` found no known vulnerabilities |
| Race detector | Environment limitation | Windows host has `CGO_ENABLED=0` and no GCC/Clang compiler; CI remains the authoritative Linux race gate |
| Repository secret scan | Pass | CI-equivalent Gitleaks scan completed after disposable credentials were removed |
| Repository cleanliness | Pass | Temporary credential-bearing directory removed; `git diff --check` passed |

## Assumptions and defaults verification

| Assumption/default | Result | Evidence |
| --- | --- | --- |
| Account exports are compatible | Confirmed | All three matching import routes completed |
| Local host reaches provider endpoints | Confirmed | Web and Console synchronized; Build reached OAuth and received `invalid_grant` |
| Provider failures are not all client-version failures | Confirmed | Current synchronized client succeeds with the correct key and fails deterministically with a wrong key |
| Current branch includes upstream account contracts | Confirmed | `upstream/main` is an ancestor of synchronized `fork/main` |
| All reported local actions share one failure mode | Rejected | Local database-only actions remained successful even under the wrong key |

## Push gate evidence

- First remote push is performed only after this complete local acceptance record is committed.
- Final synchronization base: `4a2fd1a5d5ae8bb0065321816e6b3ae2e9a0a7b0`
- Final verification run: backend, frontend, security, live request matrices, cleanup, and diff checks complete before push.
- Remote branch SHA parity is verified immediately after delivery and reported with the final handoff.

## Deviations from plan

- The local `origin/main` remote-tracking ref was not trusted because of earlier ref corruption; synchronization used the verified `fork/main` ref.
- The Build export contains a revoked refresh token. Its `invalid_grant` response is an account-state result, not an application defect.
- Interactive OAuth/device authorization was not repeated because the imported credential behavior was sufficient to exercise the affected routes.
- The Windows host cannot execute Go's race detector without a C compiler.

## Unresolved and follow-up work

- A deployment whose database was encrypted with another `credentialEncryptionKey` must restore the original key or re-import the accounts. Application code cannot recover plaintext encrypted with an unavailable key.
- If enable, disable, egress, or delete-preview requests still fail after the key is corrected, inspect the deployment's reverse proxy, admin authentication, and frontend API base independently; those failures were not reproduced locally.

## Rollback

Revert the delivery commit to restore the previous error mapping. No production database, deployment, or persistent account state was modified.

## Final acceptance

- [x] Implementation matches the accepted scope.
- [x] Checks and security review are complete, with the race-detector environment limitation documented.
- [x] Repository state is clean of temporary credential artifacts and documented.
- [x] The plan index is updated.

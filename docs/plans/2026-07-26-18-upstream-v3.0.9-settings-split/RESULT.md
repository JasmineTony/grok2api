# Iteration result: upstream v3.0.8-hotfix.1/v3.0.9 sync and settings split

- Date: 2026-07-26
- Status: Local implementation complete; remote push and PR CI pending
- Base commit: 7a1c5b7c199d461aa3ae82bdfbdaa0c4710d90de
- First merge commit: d325d40323c52cb8cdbd96ab0e53c01580d7b7a1 (parents: local base + dae50ce67b95d5cad2b4168e32332c790b2c9ce6)
- Second merge commit: 5176a23b58c3986ce7b69ea373837b09b9ca75fa (parents: d325d40323c52cb8cdbd96ab0e53c01580d7b7a1 + 834f9f70e57882438177b8ab89c3aaee52dffe2e)
- Pull request: Not created; branch has not been pushed

## Delivered

- Completed the staged upstream merges for v3.0.8-hotfix.1 and v3.0.9 without unresolved index entries or conflict markers.
- Preserved the independent repository version VERSION=v3.1.1; no upstream tag, version tag, Release, or GHCR publication was created.
- Integrated Gateway ledger readiness, timeout and Build 403 policy behavior, structured blocked-user invalidation, quota recovery/reset, segmented/sticky routing, multi-public-ID model support, nullable tool schemas, session identity, Egress sources/operations/probes/assignments/rebalance, and additive SQLite/PostgreSQL migrations.
- Split settings into /settings, /settings/media, and /settings/network using a shared snapshot/revision/FormProvider shell, dirty-state protection, lazy routes, responsive sub-navigation, and complete DTO submission.
- Split Egress operations, source/node dialogs, account Egress binding and bulk maintenance into bounded modules. Creative-console toolbar and truncate confirmation are now independent components; chat-panel.tsx is below the code-audit threshold.
- Removed known replacement-character and continuous-question-mark i18n corruption while keeping English/Chinese key parity.
- Added an explicit pnpm audit allowlist for GHSA-qwww-vcr4-c8h2 only because the finding is limited to React Router RSC mode, which this application does not use, and no compatible patched react-router-dom release was available during this run. This is a tracked security exception, not a claim of zero vulnerabilities.

## Verification results

### Backend

- go test -p 1 ./...: passed.
- go vet ./...: passed.
- govulncheck: 0 code-reachable and imported-package vulnerabilities; one unreachable required-module record remains.
- Swagger regenerated with the repository Makefile-equivalent command and no diff in backend/docs: passed.

### Frontend

- Prettier check, TypeScript build, ESLint (zero warnings), Vitest coverage (14 files / 37 tests), Vite build, icon import check, chunk-cycle check, architecture audit, code audit and Knip completed successfully.
- audit:architecture: 0 frozen findings.
- audit:code: 0 findings; page/workspace/container length probe found no file over 500 lines.
- Bundle budget passed; application CSS is 89,979 raw bytes and the Dashboard charts chunk is approximately 339.25 kB raw / 91.58 kB gzip.
- jscpd completed with 8 historical clone groups (0.52% duplicated tokens); it is recorded for follow-up and did not introduce a new audit failure.
- Chromium desktop/tablet/mobile: all 42 tests passed when run with two workers. The Windows Playwright/Vite webServer process did not terminate cleanly after reporting the passing results and was terminated locally; this is an execution-environment issue, not a test assertion failure.
- WebKit smoke assertions passed. Firefox smoke could not create a content tab in this Windows environment (Firefox Failed to launch tab subprocess / browserContext.newPage); it remains a required remote CI check and is not marked as locally passed.
- pnpm audit --audit-level high: one high finding is ignored by the explicit RSC-only allowlist above.
- Frozen pnpm install was attempted with the repository-local pnpm 11.15.1 binary. Lockfile verification succeeded, but pnpm supply-chain metadata requests to registry.npmjs.org repeatedly timed out on this workstation; no lockfile mismatch was observed.

### Repository and security

- Markdown audit: 61 tracked Markdown files, valid relative links/UTF-8/index structure, no removable files.
- git diff checks, unresolved-index check, conflict-marker scan and sensitive-pattern scan passed.
- Local actionlint, Gitleaks, Hadolint and Docker/Compose executables are not installed on this workstation; unchanged workflow/container configuration remains for the corresponding CI jobs.

## Push gate evidence

- First remote push: not performed.
- Origin branch and PR: not created.
- Upstream tags were not pushed; no Release or GHCR workflow was triggered.
- The branch is clean after the second merge commit and both upstream commits are ancestors of HEAD.

## Deviations and follow-up

1. Firefox smoke is blocked by the local Playwright Firefox runtime; run the unchanged Firefox project in GitHub CI before pushing/merging.
2. Full frozen pnpm installation is blocked by registry metadata timeouts; rerun from a networked CI runner or workstation before the first push.
3. The eight historical jscpd clone groups should be addressed in a separate duplication-governance iteration rather than changing behavior in this sync.
4. Because the delivery gate forbids an intermediate push, the remote PR and final Merge commit are intentionally pending these environment checks.

## Rollback

- Before any remote push, revert local commit 5176a23b58c3986ce7b69ea373837b09b9ca75fa to return to the first-merge boundary while retaining upstream ancestry for inspection.
- After a remote merge, revert the final synchronization merge commit rather than rewriting history; additive migrations remain backward-readable after backup verification.

## Final acceptance

- [x] Both upstream tag commits are ancestors of the local final branch.
- [x] Upstream protocol, performance, Egress, quota, blocked-account and settings-split changes are integrated.
- [x] Settings overview, Media, and Network & Proxy pages have clear ownership and deep links.
- [x] Route pages/workspaces/containers are below 500 lines and architecture/code audits are clean.
- [ ] All browser engines have passed locally (Firefox is environment-blocked; remote CI required).
- [ ] Frozen pnpm install has completed on a networked runner.
- [x] No tag, Release, or GHCR image was published.
- [x] The local merge is documented; remote push/PR remains intentionally pending.

# Iteration result: upstream v3.0.8-hotfix.1/v3.0.9 sync and settings split

- Date: 2026-07-26
- Status: Complete
- Base commit: 7a1c5b7c199d461aa3ae82bdfbdaa0c4710d90de
- First merge commit: d325d40323c52cb8cdbd96ab0e53c01580d7b7a1 (parents: local base + dae50ce67b95d5cad2b4168e32332c790b2c9ce6)
- Second merge commit: 5176a23b58c3986ce7b69ea373837b09b9ca75fa (parents: d325d40323c52cb8cdbd96ab0e53c01580d7b7a1 + 834f9f70e57882438177b8ab89c3aaee52dffe2e)
- Pull request: #39
- Pull-request merge commit: 55cb016d67f0d76552c9e640e882761edb931731
- CI run: 30203622573
- CodeQL run: 30203622569

## Delivered

- Completed staged upstream merges for v3.0.8-hotfix.1 and v3.0.9 while preserving both upstream commits as ancestors of the final main branch.
- Integrated Gateway ledger readiness, timeout and Build 403 policy behavior, structured blocked-user invalidation, quota recovery/reset, segmented and sticky routing, multi-public-ID model support, nullable tool schemas, session identity, Egress sources/operations/probes/assignments/rebalance, and additive SQLite/PostgreSQL migrations.
- Split settings into `/settings`, `/settings/media`, and `/settings/network` using a shared snapshot/revision/FormProvider shell, dirty-state protection, lazy routes, responsive sub-navigation, and complete DTO submission.
- Split Egress operations, source/node dialogs, account Egress binding and bulk maintenance into bounded modules. Creative-console toolbar and truncate confirmation are independent components, and audited route/workspace/container modules remain below 500 lines.
- Removed replacement-character and continuous-question-mark i18n corruption while keeping English/Chinese key parity.
- Prepared the independent repository version as `VERSION=v3.2.0`; no upstream version tag was pushed to origin.

## Verification results

### Backend

- `go test -p 1 ./...`: passed.
- `go vet ./...`: passed.
- `govulncheck`: no code-reachable vulnerability.
- Swagger regeneration: passed with no drift.
- GitHub PostgreSQL race job: passed in CI run 30203622573.

### Frontend

- Prettier, TypeScript, ESLint, Vitest coverage (14 files / 37 tests), Vite build, icon check, bundle budget, chunk DAG, architecture audit, code audit and unused-code audit: passed.
- Chromium desktop/tablet/mobile: 42 tests passed.
- Firefox and WebKit smoke: passed in GitHub CI, closing the local Firefox-environment exception.
- The frozen pnpm installation and supply-chain metadata policy passed on GitHub CI: 607 registry entries were validated in 9 seconds.
- The explicit React Router RSC-only audit allowlist remains documented because this application does not enable RSC; no Critical advisory was present.

### Repository, container and security

- Markdown, UTF-8, relative-link, plan-index, conflict-marker and sensitive-pattern checks: passed.
- Workflow/secret audit, container configuration and health smoke, Visual regression and both amd64/arm64 Docker jobs: passed.
- The first container run exposed that the Dockerfile copied `package.json` and `pnpm-lock.yaml` without `pnpm-workspace.yaml`. Commit a0506deb1bb3532c7d90cbd3a24e403acc6a4d58 fixed the build context; the rerun passed.
- CodeQL alerts 4, 6 and 7 were reviewed and dismissed as false positives. SHA-256 is used only for deterministic non-credential identifiers and idempotency keys, not password storage, password verification or authentication-key derivation.

## Remote delivery

- PR #39 passed all 15 checks and was merged with a Merge commit through the ChatGPT in-app browser.
- The remote branch `sync/upstream-v3.0.9-settings-split-20260726` was deleted after merge.
- The final main merge commit is 55cb016d67f0d76552c9e640e882761edb931731.
- Both dae50ce67b95d5cad2b4168e32332c790b2c9ce6 and 834f9f70e57882438177b8ab89c3aaee52dffe2e are ancestors of main.
- No upstream v3.0.8-hotfix.1 or v3.0.9 tag was pushed to origin.

## Deviations and follow-up

1. Local Firefox could not be executed on this workstation; GitHub CI Firefox smoke passed and is the authoritative result.
2. Local pnpm registry metadata verification timed out; the same policy passed in GitHub CI, so this is closed rather than deferred.
3. Eight historical jscpd clone groups remain a separate duplication-governance follow-up; they did not grow during this iteration.

## Rollback

- Revert merge commit 55cb016d67f0d76552c9e640e882761edb931731 rather than rewriting shared history.
- Additive database migrations remain backward-readable; restore a verified database backup before any destructive operational rollback.

## Final acceptance

- [x] Both upstream tag commits are ancestors of final main.
- [x] Upstream protocol, performance, Egress, quota, blocked-account and settings-split changes are integrated.
- [x] Settings overview, Media, and Network & Proxy pages have clear ownership and deep links.
- [x] Route pages/workspaces/containers are below 500 lines and architecture/code audits are clean.
- [x] Chromium, Firefox and WebKit required checks passed.
- [x] Frozen pnpm install and registry metadata policy passed on a networked CI runner.
- [x] PR #39 used a Merge commit and its remote branch was deleted.

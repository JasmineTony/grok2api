# Iteration result: latest upstream integration and v3.6.1 release

- Date completed: Pending
- Status: In progress
- Base commit: `17fa07b851d0e159840ad3cd8f6b6f5eeb4d42bd`
- Final release-candidate commit: Pending
- Delivery pull request: Pending
- Delivery merge commit: Pending
- Release tag object: Pending
- Release commit: Pending
- Release workflow: Pending
- Closeout commit: Pending

## Delivered

- Completed the semantic upstream merge through `86ae605717087c2df479dc8a268219d3ad8fe731` while preserving the independent split settings architecture, account-state behavior, Egress controls, precise invalidation, bounded video failover, safe media delivery, and existing API compatibility.
- Added the `routing.videoMaxAttempts` contract end to end with legacy missing/zero normalization to `999`, explicit `-1` unlimited support, finite limits through `65535`, bilingual UI, decoder/route/i18n tests, and browser coverage.
- Aligned the release identity and documentation to `v3.6.1`, including README, E2E fixtures/assertions, release notes, and the `nanoid 3.3.18` security override.
- Remote delivery, publication, registry verification, branch cleanup, and final documentation closeout remain pending until the first push.

## Verification results

| Check | Result | Notes |
| --- | --- | --- |
| Baseline | Passed | `origin/main=9dd7d182...`; iteration 33 merge `17fa07b8...`; latest upstream target `86ae6057...`; remote `v3.6.1` absent before delivery |
| Merge index | Passed | `MERGE_HEAD=86ae6057...`; `git diff --name-only --diff-filter=U` and `git ls-files -u` are empty; current merge remains uncommitted until this evidence is staged |
| Backend | Passed | `go test -p=1 -coverprofile=coverage.out ./...`, `go vet ./...`, and `govulncheck@v1.6.0 ./...`; govulncheck reported 0 vulnerabilities |
| Swagger | Passed | Two deterministic generations produced stable SHA-256 values: `docs.go=53199291...`, `swagger.json=C872BDB2...`, `swagger.yaml=89BBCC49...` |
| Frontend | Passed | Prettier, `tsc -b`, ESLint with zero warnings, Vitest coverage (18 files / 59 tests), production build, performance/import/symbol/bundle/chunk/Knip/codebase/architecture/duplication audits, and `pnpm audit --audit-level high` |
| Browser | Passed with isolated host limitation | Chromium desktop/tablet/mobile suites passed (3 + 6 + 26); WebKit 28 passed; Firefox failed before page creation with host Playwright `browserContext.newPage` `_page` startup error |
| UI interaction | Passed | Three widths, filter/popover viewport bounds, network-proxy health filter and bulk cleanup preview/confirm, subscription sync/upstream proxy status, settings video attempts, About, Changelog, and split settings were verified |
| Repository | Passed | Release-version audit, 10 release automation tests, Markdown audit, actionlint v1.7.7, `git diff --check`, and workflow/static audits passed |
| Dependency security | Passed | `nanoid` override/lock updated to `3.3.18`; high-level pnpm audit reported zero vulnerabilities |
| Remote delivery | Pending | No first push, delivery PR, tag, Release, GHCR verification, or branch deletion has occurred yet |

## Assumptions and defaults verification

| Assumption/default | Result | Evidence |
| --- | --- | --- |
| Stable target | Confirmed | `v3.6.1` |
| Latest upstream target | Confirmed | `86ae605717087c2df479dc8a268219d3ad8fe731` |
| Historical origin branches | Confirmed | All 15 non-main origin branches observed before delivery are strict ancestors of `origin/main`; deletion remains gated on final-main containment |

## Push gate evidence

- First remote push occurred only after final local acceptance: not yet occurred; local acceptance and committed-snapshot evidence are complete before the authorized push.
- Final synchronization base: live anonymous HTTPS refresh on 2026-08-14 confirmed `origin/main=9dd7d18243ebce7ca088549d9ffab4185107480a`; it is an ancestor of local merge `5a06d687ee12d5ffe0b3febbf81d64d2ebb51667` with left/right count `0/117`.
- Final verification run: the local suite passed for the accepted snapshot; merge commit parents are `f6c4bbc26db75ee218d760c36e1b73bc79f529a5` and `86ae605717087c2df479dc8a268219d3ad8fe731`; the refreshed `origin/main` did not move.

## Deviations from plan

- Firefox cross-browser execution is isolated as a host Playwright startup defect because all failures occur before `newPage` returns; Chromium and WebKit application coverage passed.
- The repository-local untracked caches, coverage output, Python bytecode, and `.claude/settings.local.json` remain deliberately excluded from Git.

## Unresolved and follow-up work

- Refresh `origin/main`, create and verify the real merge commit, push the delivery branch, and complete PR/CI/merge delivery.
- Publish and verify the annotated `v3.6.1` tag, stable latest Release, five release jobs, common GHCR OCI index aliases, amd64/arm64 manifests, and `/healthz`.
- Complete the docs-only closeout and containment-gated deletion of merged non-main branches.

## Rollback

Before Release publication, retain `main` and `v3.6.0` and delete only the unmerged release branch if rollback is required. After publication, deploy the previously verified `v3.6.0` OCI digest while preparing a corrective version; do not move the immutable `v3.6.1` tag. Never delete persisted data or branches that are not final-main ancestors.

## Final acceptance

- [ ] Implementation matches the accepted scope.
- [ ] Local and remote checks and security review are complete.
- [ ] Exact upstream and delivery ancestry are preserved.
- [ ] Release tag, Release flags, GHCR artifacts, and health evidence are verified.
- [ ] Obsolete branch cleanup was containment-gated and completed safely.
- [ ] Repository state and plan index are current.

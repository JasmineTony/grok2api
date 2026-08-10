# Iteration result: project audit, release hardening, and v3.5.5

- Date completed: 2026-08-10
- Status: Local acceptance complete; remote release pending
- Base commit: `2aca24006fa77d6951e3cfa98b06d431296a7ffa`
- Release commit: Pending
- Final documentation commit: Pending
- Pull request: Pending
- Release: Pending

## Delivered

- Consolidated the Egress node, source, health-check, and IP-probe response validators so list and mutation decoders share one runtime contract.
- Consolidated Statsig signer and FlareSolverr endpoint validation into one tested trusted-service URL policy.
- Added repository-derived version, release-note, and branch metadata with seven release-automation unit tests.
- Added a release-version audit that validates the active README, browser fixtures, release URL, about-route identity, image aliases, notes, and absence of hard-coded versions in the release helper.
- Made unsuccessful GitHub PR merge responses terminate the release helper with a failure.
- Added local and remote annotated-tag validation before GitHub Release creation, including a required match with `origin/main`.
- Hardened release workflow preflight against lightweight tags.
- Increased digest artifact retention from one day to 14 days and added explicit two-architecture SHA-256 digest validation.
- Updated `VERSION`, README, E2E release fixtures, release notes, plan index, and release automation for `v3.5.5`.

## Verification results

| Check | Result | Notes |
| --- | --- | --- |
| Local audit baseline | Passed | Existing frontend formatting, types, lint, tests, production build, bundle, code, and architecture gates passed before implementation |
| Frontend formatting, types, and lint | Passed | Prettier, TypeScript project build, and ESLint completed with zero warnings |
| Frontend unit and coverage | Passed | 16 files and 47 tests; settings API coverage increased through authoritative decoder-contract tests |
| Production build and performance budgets | Passed | CSS 94.90 kB under the 95,000-byte budget; main entry 239.76 kB; 101 JavaScript chunks with no cycles |
| Frontend code and architecture audits | Passed | Lucide/UI-symbol, bundle, Knip, code, and architecture audits reported no regressions |
| Duplication audit | Passed | Reduced from seven to five clones and from 0.47% to 0.28% duplicated lines |
| Chromium layout/accessibility matrix | Application tests passed; local teardown limitation | All 81 desktop/tablet/mobile tests reported `ok`; the Windows Playwright parent process did not exit after web-server teardown and was interrupted after all test cases completed |
| Backend test and vet | Passed | `go test -p 1 ./...` and `go vet ./...` |
| Reachable Go vulnerabilities | Passed | Zero reachable vulnerabilities; two required-module advisories are not called by this code |
| Swagger drift | Passed | Direct `swag v1.16.6` generation produced no tracked diff; GNU Make is not installed locally |
| Dependency audit | Passed | `pnpm audit --audit-level high`: no known vulnerabilities |
| Release metadata and automation | Passed | Version audit plus seven Python unit tests |
| Workflow and documentation audit | Passed | actionlint and Markdown audit; 91 tracked Markdown files and no removable records |
| Secret scan | Pending clean-worktree rerun | Current-source scan will be repeated from the committed clean worktree so ignored dependency/build caches cannot create false positives |
| Docker/Compose/Hadolint/local image smoke | Environment unavailable | Docker is not installed; GitHub CI remains authoritative |
| Firefox/WebKit and backend race | Pending CI | GitHub required checks are authoritative for these platform-specific gates |

## Assumptions and defaults verification

| Assumption/default | Result | Evidence |
| --- | --- | --- |
| `VERSION` is the canonical stable release identity | Confirmed | `scripts/audit-release-version.py` passed for `v3.5.5` |
| Release notes are uniquely discoverable from the version heading | Confirmed | Release metadata unit tests reject missing and ambiguous matches |
| Protected release approvals can outlive one-day artifacts | Confirmed | Prior release workflow evidence and 14-day retention remediation |
| Release PR branch is derived from the active non-main branch | Confirmed | Release metadata unit test rejects `main`; active branch is `release/v3.5.5-project-audit` |
| Remote synchronization base is unchanged | Confirmed | HTTPS fetch resolved `origin/main` to `2aca24006fa77d6951e3cfa98b06d431296a7ffa` |

## Push gate evidence

- First remote push occurred only after final local acceptance: Yes; no remote branch exists yet
- Final synchronization base: `2aca24006fa77d6951e3cfa98b06d431296a7ffa`
- Final verification run: frontend full quality matrix, backend test/vet/vulnerability scan, Swagger drift, dependency audit, release automation tests, actionlint, Markdown audit, Git diff/conflict checks, and 81-case Chromium matrix

## Deviations from plan

- The local Windows Playwright process required interruption after all 81 Chromium cases reported success because its preview-server teardown did not return control.
- Local Docker, Compose, Hadolint, container health, Firefox/WebKit, and backend race authority is deferred to GitHub CI as recorded in the accepted plan.

## Unresolved and follow-up work

- Pull request, merge commit, annotated tag, GitHub Release, protected release jobs, GHCR alias/platform/digest verification, published-image `/healthz`, and docs-only closeout remain pending.

## Rollback

Before publication, abandon or revert the branch. After publication, keep `v3.5.5` immutable and deploy the verified `v3.5.2` OCI index while preparing a corrective release.

## Final acceptance

- [x] Implementation matches the accepted scope.
- [x] Local checks and security review are complete except the clean-worktree secret-scan rerun recorded above.
- [x] Repository state is documented and only approved local cache directories remain outside the delivery.
- [x] The plan index is updated.

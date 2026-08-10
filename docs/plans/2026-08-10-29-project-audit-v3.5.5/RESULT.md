# Iteration result: project audit, release hardening, and v3.5.5

- Date completed: 2026-08-10
- Status: Complete
- Base commit: `2aca24006fa77d6951e3cfa98b06d431296a7ffa`
- Local implementation commit: `1b0be34b989c8913f50faac7cbeea8114a1c4e28`
- Local acceptance commit: `1228648bb3b5649da5b07d95af103f8af2172f98`
- Release commit: `792217d50e36d6ee15142e1ba9d05d9e042a2a7c`
- Closeout helper commit: `4d78c5327266dc939b340b4118c05888fe6cf100`
- Pull request: [#54](https://github.com/JasmineTony/grok2api/pull/54)
- Release: [Grok2API v3.5.5](https://github.com/JasmineTony/grok2api/releases/tag/v3.5.5)
- Release workflow: [run 31369118385](https://github.com/JasmineTony/grok2api/actions/runs/31369118385)

## Delivered

- Consolidated the Egress node, source, health-check, and IP-probe response validators so list and mutation decoders share one runtime contract.
- Consolidated Statsig signer and FlareSolverr endpoint validation into one tested trusted-service URL policy.
- Added repository-derived version, release-note, and branch metadata with seven release-automation unit tests.
- Added a release-version audit that validates the active README, browser fixtures, release URL, about-route identity, image aliases, notes, and absence of hard-coded versions in the release helper.
- Made unsuccessful GitHub PR merge responses terminate the release helper with a failure.
- Added local and remote annotated-tag validation before GitHub Release creation, requiring the release commit to be contained by remote `main`.
- Hardened release workflow preflight against lightweight tags.
- Increased digest artifact retention from one day to 14 days and added explicit two-architecture SHA-256 digest validation.
- Updated `VERSION`, README, E2E release fixtures, release notes, plan index, and release automation for `v3.5.5`.
- Removed the release helper's dependency on the configured `origin` transport after publication exposed an SSH rewrite/host-key failure; tag and `main` verification now use the repository-derived HTTPS URL and permit later closeout commits on `main`.
- Replaced fixed-sleep lease-return signals in segmented-selector retry tests with batch-observed repeated notifications, removing a race-instrumentation timing flake without changing production selection behavior.

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
| Secret scan | Passed | Gitleaks scanned 7.23 MB from a detached clean worktree at `1b0be34b989c8913f50faac7cbeea8114a1c4e28`; no leaks found |
| Docker/Compose/Hadolint/local image smoke | Passed in GitHub | Docker is not installed locally; the authoritative container configuration and health-smoke job passed |
| Firefox/WebKit and backend race | Passed in GitHub | All platform-specific required checks passed |
| Delivery PR checks | Passed | All 15 required checks passed before merge |
| Post-release helper regression | Passed | Ten Python tests, release-version audit, and `python scripts/github-release.py check-tag` passed without an origin URL override |
| Segmented selector race regression | Passed after remediation | The first closeout run exposed a fixed-sleep test signal that could fire before the selector subscribed under `-race`; the test now waits through observable batch progress and reliably drives the full-planner retry |

## Publication evidence

| Artifact | Verified value |
| --- | --- |
| Delivery merge | PR #54, merge commit `792217d50e36d6ee15142e1ba9d05d9e042a2a7c`, with release branch head `1228648bb3b5649da5b07d95af103f8af2172f98` retained as the second parent |
| Annotated tag object | `b73ca2597dd93d4b9d4e0ed24bbc5a66b514abdf` |
| Tag peeled commit | `792217d50e36d6ee15142e1ba9d05d9e042a2a7c` |
| GitHub Release | Release ID `367765948`; published, non-draft, non-prerelease, and selected as latest |
| Release workflow | Run `31369118385`; validate, amd64 publish, arm64 publish, final-tag publish, and release-image smoke jobs all completed successfully |
| GHCR OCI index | `sha256:4458da1fc56ab0dbf0af69d6a49f0eacb7585daf12b0bd7e8c904a15425a54af` |
| GHCR aliases | `v3.5.5`, `3.5.5`, `3.5`, `3`, and `latest` all resolve to the same OCI index |
| Linux platforms | `linux/amd64` child `sha256:1188ce2723c4957337d6333fe83c5ab90c6847970d864ceea432af03104a8b77`; `linux/arm64` child `sha256:d556d73a63e8e8a4ff1a11400b2695a468ee6d5322388094fddfda1a27a03767` |
| Published-image health | Release workflow `/healthz` smoke passed against the published image |

## Assumptions and defaults verification

| Assumption/default | Result | Evidence |
| --- | --- | --- |
| `VERSION` is the canonical stable release identity | Confirmed | `scripts/audit-release-version.py` passed for `v3.5.5` |
| Release notes are uniquely discoverable from the version heading | Confirmed | Release metadata unit tests reject missing and ambiguous matches |
| Protected release approvals can outlive one-day artifacts | Confirmed | Prior release workflow evidence and 14-day retention remediation |
| Release PR branch is derived from the active non-main branch | Confirmed | Release metadata unit test rejects `main`; active branch is `release/v3.5.5-project-audit` |
| Delivery ancestry is preserved | Confirmed | PR #54 used a true merge commit with both the former `main` and accepted release head as parents |

## Push gate evidence

- First release-branch push occurred only after final local acceptance: Yes
- Final synchronization base: `2aca24006fa77d6951e3cfa98b06d431296a7ffa`
- Final verification run: frontend full quality matrix, backend test/vet/vulnerability scan, Swagger drift, dependency audit, release automation tests, actionlint, Markdown audit, Git diff/conflict checks, and 81-case Chromium matrix
- Remote acceptance: all 15 required PR checks passed before merge

## Deviations from plan

- The local Windows Playwright process required interruption after all 81 Chromium cases reported success because its preview-server teardown did not return control.
- Local Docker, Compose, Hadolint, container health, Firefox/WebKit, and backend race authority was deferred to GitHub CI as recorded in the accepted plan; every corresponding required job passed.
- The first post-tag release-helper invocation inherited an environment-specific SSH rewrite for `origin` and failed before application logic could validate the tag. Publication was completed with a process-local HTTPS rewrite, then the helper was corrected in `4d78c5327266dc939b340b4118c05888fe6cf100` to derive a canonical HTTPS remote and verify ancestry rather than exact `main` equality.
- The first closeout PR run failed `TestSegmentedActiveDoesNotRepeatWindowsAfterFullFallback` because its single fixed-delay notification could occur before `awaitLeaseRetry` subscribed when race instrumentation slowed the initial planner. The production selector did not report a data race; the deterministic test driver was corrected and the complete required check set was rerun.

## Unresolved and follow-up work

- No release-blocking project finding remains open.
- Frontend line coverage remains low in aggregate despite the new focused runtime-boundary tests; future feature work should continue adding tests around high-risk state and API boundaries rather than treating the current percentage as a release regression.

## Rollback

The published `v3.5.5` tag is immutable. If a production rollback is required, deploy the previously verified `v3.5.2` image while preparing a new corrective version; never move `v3.5.5`.

## Final acceptance

- [x] Implementation matches the accepted scope.
- [x] Local checks and security review are complete.
- [x] PR #54 is merged with a true merge commit and all required checks passed.
- [x] The annotated tag, stable latest Release, protected publication workflow, aliases, architectures, digest, and published-image health are verified.
- [x] The release helper's post-publication origin-transport defect is corrected and regression-tested.
- [x] The segmented-selector race test no longer depends on scheduler timing.
- [x] Repository state is documented and only approved local cache directories remain outside the delivery.
- [x] The plan index is updated.

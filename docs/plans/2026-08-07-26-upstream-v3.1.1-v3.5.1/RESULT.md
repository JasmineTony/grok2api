# Iteration result: upstream v3.1.1 integration, dependency stabilization, review, and v3.5.1 release

- Date completed: Pending remote publication
- Status: In progress
- Base commit: `91cee12048726effa8abdcad54d94879ef3c1eae`
- Exact upstream tag commit: `fee63588d76c36070fafd343cf8a4097249bb96d`
- Local integration branch: `sync/upstream-v3.1.1-v3.5.1-20260807`
- Final release commit: Pending
- Pull request: Pending
- Release: Pending

## Delivered locally

- Merged exact upstream v3.1.1 with `--no-ff` ancestry preserved and resolved overlaps against the independent v3.5.0 settings, Egress, Quality Guard, compatibility, and governance layers.
- Integrated Console DPoP, media, quota, account import, grouped model routing, persistence, and Windows Quality Guard compatibility changes.
- Set `VERSION=v3.5.1` and updated README and E2E release fixtures.
- Updated compatible frontend and Go dependencies under a conservative release-age cutoff, regenerated `frontend/pnpm-lock.yaml`, and tidied `backend/go.mod`/`backend/go.sum`.
- Refactored grouped model administration into `models-page`, table, editor, delete-dialog, display, form, and utility modules so Fast Refresh and architecture limits remain satisfied.
- Added regression coverage for grouped route aggregation and capability labels.

## Dependency age evidence

Selection cutoff: `2026-08-04T16:00:00Z`. This is stricter than the requested 24-hour exclusion and conservatively excludes the most recent 48-hour window used for selection.

| Ecosystem | Selected updates | Publication evidence |
| --- | --- | --- |
| npm direct dependencies | 34 compatible updates | Earliest selected: React Query 5.101.4 at `2026-07-21T13:04:07Z`; latest selected: marked 18.0.9 at `2026-08-04T04:35:37Z`; registry verification returned `violations=0` against the cutoff |
| Go direct | `go-redis/v9` 9.22.0 | `2026-08-03T17:39:49Z` |
| Go direct | `gorm.io/driver/postgres` 1.6.2 | `2026-07-31T07:55:55Z` |
| Go indirect | `github.com/jackc/pgx/v5` 5.10.0 | `2026-06-03T00:41:58Z` |
| Held | `@testing-library/jest-dom` 6.9.1 | 6.10.0 was not accepted because pnpm marked it as a broken release |

The selected npm set includes React 19.2.8, React Router DOM 7.18.2, Vite 8.2.0, Playwright 1.62.1, ESLint 10.8.0, TypeScript ESLint 8.66.0, the compatible Radix updates, and the lockfile-resolved transitive graph. No prerelease or selected version newer than the cutoff is present.

## Code review findings and disposition

| Area | Finding | Disposition |
| --- | --- | --- |
| Frontend correctness | Upstream-only Chinese Egress fallback keys caused the bilingual resource key test to fail | Added matching English keys; resource synchronization test passes |
| Frontend maintainability | Merged grouped models page exceeded both the 900-line code audit and 500-line architecture limit | Split table, editor, delete dialogs, form schema, display components, and utilities; both audits pass |
| Fast Refresh | Component module exported transformation functions and types | Moved non-component exports into `model-group-utils.ts` |
| Type safety | New TypeScript ESLint version exposed unbound browser callback methods | Stored bound callbacks in the deferred-render test rather than disabling the rule |
| Performance | Group aggregation sorted all synchronization timestamps and rebuilt the Zod schema on every render | Replaced sorting with a linear maximum reduction and memoized the locale-aware schema |
| Regression coverage | New grouping behavior had no independent frontend unit test | Added aggregation and capability-label tests |
| Dependency compatibility | `@testing-library/jest-dom` 6.10.0 was marked broken by pnpm | Held at verified 6.9.1 |
| npm advisory | One ignored high advisory remains for React Router unstable RSC mode | Retained the narrow `GHSA-qwww-vcr4-c8h2` exception because this Vite SPA does not use unstable RSC APIs |
| Residual performance | Console image localization downloads and persists up to ten returned images sequentially | Accepted for v3.5.1 to bound memory, storage, and upstream pressure; consider measured parallelism only with operational evidence |
| Tooling compatibility | `eslint-plugin-jsx-a11y` declares peer support through ESLint 9 while the project remains on its already-supported ESLint 10 line | Non-blocking peer warning; lint passes with zero warnings |

## Local verification results

| Check | Result | Notes |
| --- | --- | --- |
| Frontend `pnpm verify` | Passed | Format, typecheck, ESLint, 15 test files / 44 tests, coverage, build, performance summary, icons, UI symbols, bundle, chunks, Knip, code, architecture, and duplicate audits passed |
| Backend `go test -p 1 ./...` | Passed | All packages passed with repository-external Windows cache/temp paths |
| Backend `go vet ./...` | Passed | No findings |
| npm audit | Passed with reviewed exception | 0 active advisories returned; metadata reports one high advisory ignored by the existing narrow RSC-only exception |
| Race detector | Environment limitation | Local Go has `CGO_ENABLED=0` and no GCC; CI remains the authoritative race gate |
| Go vulnerability database | Network limitation | Pinned govulncheck v1.6.0 downloaded successfully but `vuln.go.dev` returned EOF; required CI gate remains authoritative |
| Container configuration and smoke | Environment limitation | Docker is not installed locally; required CI Compose, Hadolint, PostgreSQL race, and health-smoke gates remain authoritative |
| Workflow and secret audit | Passed locally | Pinned actionlint v1.7.7 passed; staged Gitleaks v8.30.1 scanned the complete release diff and found no leaks |
| Swagger/Markdown/diff/repository checks | Passed | Swagger regenerated with no drift; Markdown audit passed for 86 tracked files; `git diff --check` and conflict-marker scan passed |

## Assumptions and defaults verification

| Assumption/default | Result | Evidence |
| --- | --- | --- |
| Exact upstream v3.1.1 target | Confirmed | `refs/upstream-tags/v3.1.1` points to `fee63588d76c36070fafd343cf8a4097249bb96d` |
| True ancestry | Pending commit | Merge remains open with `.git/MERGE_HEAD` set to the exact upstream tag; final commit must have two parents |
| Dependency minimum age | Confirmed | Registry/module timestamps above; npm audit command reported `changed=34 violations=0` |
| Independent compatibility layers preserved | Confirmed locally | Frontend and backend complete gates pass after conflict resolution |
| Version consistency | Confirmed locally | `VERSION=v3.5.1`; README and E2E fixtures updated |

## Push gate evidence

- First remote push occurred only after final local acceptance: Not yet
- Final synchronization base: Pending origin/main recheck
- Final verification run: Pending after documentation/security gates

## Deviations from plan

- The local race run could not start because the Windows Go environment has CGO disabled and no GCC toolchain. This is an environment limitation, not a test failure; the repository CI race job remains required.
- Registry bulk requests were intermittently affected by Windows TLS/timeouts. Authoritative `pnpm view` and `go list -m -json` queries completed the final timestamp proof.

## Unresolved and follow-up work

- Complete final Swagger, Markdown, workflow/secret, Compose/container, and clean-worktree acceptance.
- Commit the true merge, push once, create and merge the PR after all required checks pass.
- Publish annotated `v3.5.1`, approve protected release jobs, verify Release flags, GHCR aliases/platforms/digest, and published-image `/healthz`.
- Replace pending fields with exact remote evidence and close the plan after publication.

## Rollback

Before publication, revert or abandon the local plan branch. After publication, keep v3.5.1 immutable and deploy the verified v3.5.0 image digest if rollback is required.

## Final acceptance

- [x] Implementation matches the accepted local scope.
- [ ] Checks and security review are complete.
- [ ] Repository state is clean and documented.
- [ ] The plan index is updated to Complete.
- [ ] Remote release evidence is complete.

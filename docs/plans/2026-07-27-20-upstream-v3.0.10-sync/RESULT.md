# Iteration result: Exact upstream v3.0.10 synchronization

- Date completed: 2026-07-27 (local acceptance)
- Status: Local acceptance complete; remote delivery pending
- Base commit: `47088eb8743f03d580af5b07d94581eb2e5e2c5c`
- Upstream parent: `c27f0545197b3edf41d5deedcc2c3c3597887766`
- Local merge commit: Pending creation after this result is staged
- Pull request: Pending first remote push

## Delivered

- Resolved all 20 textual conflicts from the exact upstream `v3.0.10` tag without following later `upstream/main` commits.
- Preserved the independent repository's stable `Failure` model, account state machine, request policy, metrics, notifications, replay gates, credential-safety rules, existing APIs, additive database migrations, and `VERSION=v3.2.0`.
- Integrated upstream reasoning compatibility, model aliases, Team/Model rate-limit parsing, linked-account deletion, selector fixes, compaction recovery, Egress source/operation/assignment/probe behavior, and compatible repository/database additions.
- Restored the seven missing v3.0.10 settings fields, the `-1` unlimited-attempt contract, the `1..200` finite range, and destructive confirmation behavior.
- Restored client-key model-alias controls, stable pre-upstream audit descriptions, linked-account deletion previews, Egress batch deletion, single-node IPv4/IPv6 probing, and English/Chinese locale parity in the existing component architecture.
- Updated Playwright fixtures for the v3.0.10 Egress operations contract and centralized a 15-second route-readiness assertion so cold development-server transforms do not create false failures.

## Verification results

| Check | Result | Notes |
| --- | --- | --- |
| Backend compile and tests | Passed | `go test -run '^$' -p 1 ./...` and `go test -p 1 ./...`. |
| Backend static analysis | Passed | `go vet ./...`. |
| Go vulnerability scan | Passed | `govulncheck v1.6.0`: zero reachable vulnerabilities; one required-module advisory has no reachable call path. |
| Swagger | Passed | Regenerated with `swag v1.16.6`; `docs.go`, `swagger.json`, and `swagger.yaml` have no drift. |
| Frontend frozen install | Passed | pnpm 11.15.1 verified the 607-entry lockfile supply-chain policy and installed the frozen graph. |
| Frontend advisory audit | Passed with documented exception | One ignored High advisory, `GHSA-qwww-vcr4-c8h2`, affects React Router RSC streaming APIs. This browser SPA imports no RSC or `react-server` entry points; the existing explicit audit exception remains unchanged for this no-dependency sync. |
| Frontend verify | Passed | Format, TypeScript, ESLint, 39 unit tests with coverage, production build, profile summary, Lucide imports, bundle/chunk budgets, Knip, architecture/code audits, and duplicate audit. |
| Bundle budgets | Passed | CSS 89.97 kB raw; main entry 152.73 kB raw / 51.59 kB gzip; Dashboard charts 339.25 kB raw / 91.59 kB gzip; 84-chunk production graph is acyclic. |
| Browser acceptance | Passed | 66 tests passed with two workers: Chromium desktop/tablet/mobile plus Firefox and WebKit smoke, including axe, settings deep links, model Dialog, and authenticated routes. Playwright-provided Firefox was used because no system Firefox is installed. |
| Markdown and repository checks | Passed | 65 tracked Markdown files; UTF-8, relative links, plan structure, conflict markers, and `git diff --check` passed. |
| Workflow and secret audit | Passed | actionlint v1.7.7 passed; Gitleaks v8.30.1 found no leaks in an isolated snapshot of all tracked worktree files. |
| Container checks | Pending CI | Docker/Hadolint/Compose are not installed on this Windows host. The PR must not merge until the required container configuration, health smoke, and amd64/arm64 Docker jobs pass. |

## Assumptions and defaults verification

| Assumption/default | Result | Evidence |
| --- | --- | --- |
| Exact upstream target only | Passed locally | `MERGE_HEAD` is exactly `c27f0545197b3edf41d5deedcc2c3c3597887766`; no later upstream main commit or upstream tag is staged for push. |
| `VERSION=v3.2.0` | Passed | The worktree and staged merge retain `v3.2.0`; the published tag is not moved. |
| Compatibility-first conflict resolution | Passed | Backend and frontend focused tests cover credential invalidation, selectors, aliases, linked deletion, Egress, settings, reasoning, compaction, and protocol behavior. |
| No release side effects | Passed locally | No tag, Release workflow, GHCR operation, or release configuration change was created. Remote verification remains a pre-merge requirement. |

## Push gate evidence

- The branch remains local while this result is written.
- The first remote push is allowed only after the two-parent merge commit is created, the final diff/index checks pass, and `origin/main` is revalidated.
- The PR must use Merge commit, not Squash, so the upstream tag commit remains an ancestor.
- Required GitHub checks: Backend, PostgreSQL race, Frontend, Visual, Firefox/WebKit, workflow/secret, container health, CodeQL, amd64 Docker, and arm64 Docker.

## Deviations from plan

- Upstream source and tests define `routing.maxAttempts=-1` as unlimited, `0` as invalid, and `1..200` as finite. The original plan text that named `0` as unlimited was corrected to the authoritative upstream contract.
- Local browser processes cannot spawn reliably inside the restricted sandbox. The complete browser suite was therefore run outside the sandbox using the project-pinned Playwright browsers; all 66 tests passed.
- Docker tooling is absent locally, so Hadolint, Compose config/health, and image builds are delegated to required GitHub checks and remain merge blockers.

## Unresolved and follow-up work

- Remote PR number, merge SHA, required-check run, and branch-cleanup evidence will be added from the final main baseline when iteration 21 starts.
- Iteration 21 will implement the immersive UI, About/Changelog routes, network-settings layout correction, Lucide/emoji enforcement, and Chrome DevTools performance acceptance.

## Rollback

Before remote delivery, preserve the local merge commit and delete the branch only if the synchronization is intentionally abandoned. After delivery, revert the two-parent merge commit with a normal merge revert; never rewrite published history or move `v3.2.0`.

## Final acceptance

- [x] Implementation matches the accepted local scope.
- [x] Backend, frontend, security, documentation, and browser checks are complete.
- [x] The exact upstream commit is ready to be preserved as the merge's second parent.
- [x] The branch has not been pushed before local acceptance.
- [ ] Required GitHub checks and Merge-commit delivery are complete.
- [ ] Remote branch cleanup and final `origin/main` ancestry verification are complete.
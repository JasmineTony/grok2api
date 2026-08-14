# Iteration result: upstream main parity and administration defect remediation

- Date completed: 2026-08-14
- Status: Complete
- Base commit: `9dd7d18243ebce7ca088549d9ffab4185107480a`
- Plan commit / first parent: `a208b0b7c61f2b2a3d6c7d6494aaac8e4e1cf66e`
- Upstream commit / second parent: `ec16d98c7f654ec74e05f04e4b727c4639c0f2ea`
- Integration merge commit: this two-parent merge commit; the exact SHA is recorded by the final local handoff and `git show -s --format=%H%n%P HEAD`
- Pull request: N/A (local-only; no push authorized or performed)

## Delivered

- Integrated exact upstream `main` commit `ec16d98c7f654ec74e05f04e4b727c4639c0f2ea` through a true merge while retaining the independent split React frontend, revision-aware settings flow, security boundaries, and release governance.
- Made shared Dropdown, nested submenu, Popover, Select, and AlertDialog surfaces viewport-safe and scrollable; removed forced filter-label truncation; repaired English locale mojibake and separator corruption; and verified the affected flows at 1440, 768, and 375 pixel widths.
- Replaced the blocking model-sync JSON request with the coordinated SSE contract: immediate connection, heartbeat, bounded write deadline, progress, complete/partial-complete/error terminal events, concurrent-run rejection, fixed progress toast, and direct parser/contract tests.
- Preserved resilient model discovery: a historical compatibility-alias collision skips only the conflicting discovered model instead of aborting the remaining provider batch.
- Restored Egress health filtering and explicit pagination, retained selected-node batch deletion, added previewed one-action cleanup for nodes whose IPv4 and IPv6 probes are both unhealthy, and exposed bound-account and subscription-managed impact before confirmation.
- Completed per-subscription proxy and synchronization presentation: safe configured-state indicators, explicit keep/clear semantics, per-source sync action, Console Asset scope, last/next sync time, imported count, sanitized error state, and account-capacity transport preservation.
- Restored settings parity for `routing.markBuildChatDeniedAsReauth`, `routing.accountIsolatedConnections`, and `providerWeb.clearanceMode=on_demand`, including legacy omission handling, forms, bilingual labels, fixtures, and tests.
- Integrated compatible upstream media, tunnel proxy, Console voice/TTS/STT/Realtime, Quality Guard degradation, account/quota, and audit behavior. The independent Creative Console now supports video generate/edit/extend, transient video/image inputs, reference images and voice, model eligibility, duration/resolution restrictions, and API contract tests.
- Expanded frontend API documentation and generated Swagger for video, TTS, Audio Speech/Tasks, STT, transcriptions, voices, and Realtime routes.
- Raised the Go toolchain contract and Docker build argument from `1.26.5` to `1.26.6` after the final vulnerability gate identified seven reachable standard-library advisories; the repeated scan reports zero reachable vulnerabilities.

## Verification results

| Check | Result | Evidence |
| --- | --- | --- |
| Git merge state before commit | Passed | `MERGE_HEAD=ec16d98c...`; `git diff --name-only --diff-filter=U` empty; staged and unstaged `git diff --check` passed |
| Frontend model SSE focused tests | Passed | `model-api.test.ts`: 4/4 progress, full/partial complete, error, request header/method, and missing-terminal cases |
| Frontend format/type/lint | Passed | Repository-local Prettier check, `tsc -b`, and ESLint with zero warnings |
| Frontend coverage | Passed | Vitest coverage: 18 test files, 54 tests |
| Frontend build and static audits | Passed | Vite build; performance summary; icon/UI-symbol checks; bundle budget; acyclic 103-chunk graph; Knip; code and architecture audits; jscpd at 0.42% duplicated lines |
| Chromium defect matrix | Passed | 9/9: Models nested filters, Network health filter/cleanup/sync status, and Creative video generate/edit/extend at 1440x900, 768x1024, and 375x812; command exited 0 with a manually managed hidden Vite server |
| Firefox/WebKit local smoke | Environment-limited | Firefox repeatedly failed before page creation with `browserContext.newPage: Cannot read properties of undefined (reading '_page')`; stopped after nine identical host-runtime failures. No application assertion ran. |
| Backend focused tests | Passed | model service/handler, Egress service/handler, settings, gateway, relational persistence, and inference packages |
| Backend full tests | Passed | Go 1.26.6: `go test -p 1 -coverprofile=coverage.out ./...` |
| Backend vet | Passed | Go 1.26.6: `go vet ./...` |
| Reachable vulnerabilities | Passed after remediation | Initial Go 1.26.5 scan found seven reachable standard-library advisories fixed in 1.26.6; repeated `govulncheck@v1.6.0 ./...` reports 0 reachable vulnerabilities |
| Swagger generation/drift | Passed | Repeated swag v1.16.6 generation produced stable SHA-256: `docs.go` `531992...B13E`, `swagger.json` `C872BD...A47`, `swagger.yaml` `89BBCC...44AD6` |
| Backend race | Environment-limited | Local Windows toolchain has `CGO_ENABLED=0`; `go test -race -p 1 ./...` stopped with the authoritative `-race requires cgo` prerequisite error |
| Container smoke | Environment-limited | Docker CLI is not installed on this host; no container or publication action was attempted |
| Repository documentation/version | Passed | Markdown audit: 104 tracked Markdown files and no removable files; release-version audit kept `VERSION=v3.6.0`; 10 release-automation unit tests passed |
| Workflow lint | Passed | actionlint v1.7.7 completed before the secret scan |
| Secret scan | Passed on staged delivery snapshot | gitleaks v8.30.1 scanned the staged tracked snapshot; repository-local dependency/build caches were excluded from the scan and remain outside Git |
| Final review | Passed | Targeted code, security, accessibility, API/DTO, changed-on-both, generated-contract, and upstream feature-disposition review found no blocking regression |

## Assumptions and defaults verification

| Assumption/default | Result | Evidence |
| --- | --- | --- |
| Exact upstream target remains pinned | Confirmed | The merge second parent is `ec16d98c7f654ec74e05f04e4b727c4639c0f2ea`; no moving-branch substitution was used |
| Independent frontend architecture remains authoritative | Confirmed | Upstream behavior was mapped into split pages/components; no wholesale frontend `ours`/`theirs` replacement was used |
| Ordinary configurable fields are represented end to end | Confirmed | Settings inventory tests cover 64 configurable leaf fields; the two missing routing fields and on-demand clearance are present in DTOs, validators, forms, panels, fixtures, and backend compatibility tests |
| Explicit compatibility exceptions remain intentional | Confirmed | Write-only secrets remain password/clear operations; configured-state booleans replace secret values; response-only revision, restart, recommendation, pagination, health, and sync metadata are not written back as ordinary settings |
| Egress cleanup reuses bounded backend semantics | Confirmed | Cleanup selects only nodes with both address-family probes unhealthy, releases bindings transactionally, reports impact before confirmation, and retains selected-node deletion |
| `VERSION` remains non-release `v3.6.0` | Confirmed | Release-version audit passed; no tag, Release, image, or remote delivery was performed |
| Local artifacts remain outside Git | Confirmed | `.claude/`, `.gomodcache/`, `.gopath/`, Python bytecode, coverage, Playwright output, and other caches were not staged |

## Push gate evidence

- First remote push occurred only after final local acceptance: N/A; no push was authorized or performed.
- Final synchronization base: independent first parent `a208b0b7c61f2b2a3d6c7d6494aaac8e4e1cf66e`; exact upstream second parent `ec16d98c7f654ec74e05f04e4b727c4639c0f2ea`.
- Final verification run: 2026-08-14 on the local merge worktree, followed by staged-snapshot secret and Git hygiene checks before commit.

## Deviations from plan

- The repository-level `pnpm verify` shim could not create the user pnpm tool directory (`EPERM`). Every command in the authoritative `verify` expansion was run through repository-local `.cmd` binaries/scripts and passed.
- The final vulnerability scan exposed a new standard-library baseline issue not present in the pinned upstream delta. Go/Docker were minimally aligned to 1.26.6 and the full backend matrix was rerun.
- The first direct Playwright invocation used a Windows path that matched no tests. The corrected file pattern plus a manually managed hidden Vite server ran all nine selected Chromium scenarios and exited 0, avoiding the previously observed owned-webServer teardown hang.
- Firefox smoke is blocked by a local Playwright/browser-context startup failure before application code executes. Race and container checks are likewise blocked by missing host prerequisites; these are recorded rather than masked by source changes.
- Final manual review found and repaired pre-existing/merge-carried English locale mojibake (`路`, `1鈥?2`) that was consistent with the reported individual-text display defect.

## Unresolved and follow-up work

- No blocking implementation or contract finding remains open for this local integration.
- Non-blocking hardening opportunities remain: bind Egress cleanup preview to a revision if exact preview/delete identity is required; serialize or revision-guard simultaneous per-source subscription syncs; make node upsert plus sync metadata one atomic repository operation; and further harden proxied subscription DNS pinning against resolver-view changes.
- Public Voice/TTS/STT/Realtime APIs, documentation, Swagger, routing, and backend behavior are integrated. A dedicated administration Creative Console voice operation panel was not part of this defect-remediation scope.
- Firefox/WebKit, race, and container checks should run in the protected CI environment before any future remote delivery.
- Local cache and generated test-output directories remain untracked and intentionally preserved.

## Rollback

Before any remote delivery, abandon or revert this local branch while preserving `main`, the two parent histories, and all untracked local caches. Never delete persisted deployment data or move an immutable release tag. After a future remote merge, revert the integration/closeout through a corrective change rather than rewriting shared history.

## Final acceptance

- [x] Implementation matches the accepted scope.
- [x] Required local checks and security review are complete, with host-only limitations explicitly isolated.
- [x] Exact upstream ancestry is preserved by a true two-parent merge commit.
- [x] Repository state, generated contracts, assumptions, deviations, and follow-up work are documented.
- [x] The plan index is updated.
- [x] No push, PR, tag, Release, or image publication occurred.

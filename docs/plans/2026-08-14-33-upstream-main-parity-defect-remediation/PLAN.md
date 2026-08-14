# Iteration plan: upstream main parity and administration defect remediation

- Date: 2026-08-14
- Sequence: 33
- Owner: JasmineTony
- Status: In progress
- Base commit: `9dd7d18243ebce7ca088549d9ffab4185107480a`
- Working branch: `sync/upstream-main-parity-20260814`
- Upstream branch: `chenyme/grok2api main`
- Upstream commit: `ec16d98c7f654ec74e05f04e4b727c4639c0f2ea`
- Upstream merge base: `6e9eef7619b83899c82e24353177c8a819f15914`

## Objective

Integrate the exact current upstream `main` history with a true merge commit while preserving the independent repository's frontend architecture, security controls, release governance, and public compatibility. Repair the reported administration defects: clipped filter/dialog surfaces and truncated labels, model-route model synchronization failures, and incomplete proxy-node cleanup and subscription synchronization visibility. Complete a broader frontend/backend contract audit so presentation may differ from upstream but ordinary configurable fields, request/response semantics, and compatibility behavior do not silently diverge.

## Background

The independent `main` is `9dd7d18243ebce7ca088549d9ffab4185107480a` (`v3.6.0` closeout). Upstream `main` is `ec16d98c7f654ec74e05f04e4b727c4639c0f2ea`; upstream's latest published `v3.x` tag remains `v3.1.2`, so this iteration pins the exact untagged upstream commit rather than relying on a moving branch. The branches share upstream `v3.1.2` commit `6e9eef7619b83899c82e24353177c8a819f15914` and have substantial independent changes; textual wholesale replacement is unsafe.

Initial audit found:

- Radix dropdown submenus are not portaled while their parent menu clips horizontal overflow; fixed-width nested filters and explicit truncation make the problem visible on narrow layouts.
- Model synchronization is a long-running blocking JSON request; upstream replaced it with heartbeat/progress SSE to avoid reverse-proxy and Cloudflare timeouts.
- Egress batch deletion already exists, but the current frontend lost the backend-supported `probe=healthy|unhealthy|unknown` filter and does not expose the complete subscription synchronization metadata.
- The backend exposes two active routing settings absent from the independent frontend contract: `markBuildChatDeniedAsReauth` and `accountIsolatedConnections`.
- Exact upstream integration covers 96 upstream-only commits and 52 files changed on both sides, requiring semantic conflict and contract review.

## Scope

- Merge exact upstream commit `ec16d98c7f654ec74e05f04e4b727c4639c0f2ea` with true ancestry; do not squash or flatten upstream history.
- Preserve the independent split frontend routes/components and visual language while integrating upstream backend/domain/persistence behavior and all compatible additive API/settings fields.
- Repair shared Dropdown/Popover/Select/Dialog viewport behavior, nested submenu clipping, and user-visible label truncation without introducing root-level horizontal overflow.
- Adopt the final upstream model-sync SSE contract with immediate connection, heartbeat, progress, terminal success/error reporting, and compatible frontend progress feedback.
- Preserve model discovery resilience, including skipping alias-conflicting discovered models instead of aborting an entire synchronization batch.
- Restore egress probe filtering, provide explicit one-action cleanup for all unusable nodes through the existing backend operation, preserve existing multi-select deletion, and show last/next subscription sync time, imported count, and safe error state.
- Integrate per-subscription proxy, tunnel validation/dialer, on-demand clearance, quota/routing, Console/media, quality-guard, and other upstream changes when compatible; adapt overlapping frontend surfaces rather than replacing the independent architecture wholesale.
- Restore missing active settings fields across TypeScript DTOs, runtime validators, form schemas/mappers, split settings panels, bilingual i18n, fixtures, and tests.
- Add or strengthen contract inventories and round-trip tests so omitted frontend fields cannot be hidden by permissive decoders.
- Perform a review pass for security, accessibility, responsive layout, API/DTO consistency, persisted-data migration safety, and upstream feature disposition.
- Create and maintain `RESULT.md`; keep all delivery changes local until the complete plan passes acceptance.

## Out of scope

- Publishing a new independent version, moving an existing tag, creating a GitHub Release, or pushing before explicit release/version approval.
- Redesigning the independent navigation or replacing split pages with upstream monolithic pages solely for visual parity.
- Deleting local cache/helper directories or any persisted deployment data.
- Exposing subscription URLs, proxy credentials, upstream raw errors, account secrets, or other sensitive values in UI, logs, tests, or documentation.
- Unrelated dependency upgrades that are not required by the pinned upstream integration or a failing security/build gate.

## Implementation steps

1. Record the exact Git/upstream baseline, branch divergence, changed-file inventory, contracts, and targeted defect evidence.
2. Create the local delivery branch after this plan is recorded; keep the branch local until all acceptance checks pass.
3. Merge exact upstream commit with `--no-ff --no-commit`; resolve conflicts semantically and verify Git's unmerged index rather than relying on marker scans.
4. Audit conflict-free changed-on-both files for lost behavior, especially model sync, Egress, settings, media, account routing, quality guard, persistence, and shared UI primitives.
5. Repair viewport-safe overlays and readable filter labels; add responsive component/E2E coverage.
6. Integrate the final model-sync SSE service/handler/client/UI contract and focused error/progress/timeout tests.
7. Complete proxy-node cleanup/filtering and subscription sync status surfaces using existing safe backend semantics; add missing focused tests.
8. Reconcile backend and frontend settings/API leaf fields, restore missing routing settings, document explicit response-only/write-only compatibility exceptions, and add round-trip/partition checks.
9. Run formatting, generation, frontend/backend tests and audits; fix only evidenced regressions and rerun failed gates.
10. Conduct independent review and consistency audits, update `RESULT.md` and the plan index, and leave the accepted branch local for user review unless separately authorized to deliver remotely.

## Security and compatibility constraints

- Preserve public routes, JSON/SSE semantics, database migrations, encryption keys, revision-aware settings writes, old-client omission semantics, and existing independent provider extensions.
- New ordinary configurable fields must be represented end to end; write-only secrets, configured-state responses, and response metadata require explicit documented exceptions.
- Subscription/proxy errors remain sanitized; never render or persist credential-bearing URLs or raw transport exceptions.
- Retain SSRF protections, tunnel validation, account isolation, request redaction, and migration rollback compatibility.
- Do not select entire frontend `ours` or `theirs` trees; page presentation may differ, but the underlying fields and behavior must be accounted for.
- Preserve `.claude/`, `.gomodcache/`, `.gopath/`, Python bytecode caches, and other untracked local artifacts outside commits.

## Verification

- Git: exact merge ancestry and parents, `git status`, empty `git diff --name-only --diff-filter=U`, marker scan, `git diff --check`, and no unintended tracked caches.
- Frontend focused: model SSE API/parser/UI tests; Egress filter/delete/sync metadata tests; settings DTO/form round-trip and field partition tests; shared overlay responsive tests.
- Frontend full: format check, TypeScript build, lint, coverage, production build, bundle/chunk/icon/UI/unused/code/architecture/duplication audits.
- Browser: authenticated Chromium desktop/tablet/mobile paths for filters, settings, models, and Egress; Firefox/WebKit smoke and accessibility checks where the local runtime supports them.
- Backend focused: model handler/service/discovery tests, Egress handler/service/migration/tunnel tests, settings compatibility tests, and affected provider/gateway tests.
- Backend full: `go test -p 1 ./...`, `go vet ./...`, vulnerability scan when network tooling is available, Swagger drift, and race/container checks where supported.
- Repository: release-version audit (must remain `v3.6.0` for this non-release iteration), Markdown audit, secret scan, workflow lint/tests, and final diff review.

## Risks and rollback

- The pinned upstream delta is large and 52 files changed on both branches. Mitigate through semantic resolution, focused subsystem tests, field inventories, and review rather than whole-file selection.
- SSE changes require frontend and backend to ship together. Keep both sides in one plan and add explicit protocol mismatch tests.
- Egress migration and tunnel support touch persisted/encrypted configuration. Preserve compatibility markers and old ciphertext until tests prove rollback safety.
- Overlay fixes can affect many menus. Change shared primitives conservatively, test nested and narrow viewports, and retain local scrolling for long content.
- Before remote publication, rollback is abandoning or reverting this local branch. After a future release, create a corrective version rather than moving an immutable tag.

## Delivery and push gate

- This `PLAN.md` is the delivery unit. Keep the branch local until scope, verification, acceptance criteria, and assumptions/defaults are complete.
- Local checkpoint commits are allowed; do not create partial remote branches or intermediate pull requests.
- Record the final synchronization and verification pass before the first push.
- This iteration does not authorize push, PR, merge, tag, Release, or image publication.

## Assumptions and defaults

- Exact upstream target is `ec16d98c7f654ec74e05f04e4b727c4639c0f2ea`; a newer upstream commit discovered before final acceptance requires an explicit recorded decision, not a silent target move.
- Independent frontend routes, component boundaries, design tokens, revision handling, and security hardening remain authoritative presentation/architecture constraints.
- Compatible upstream additive fields and runtime behavior are retained unless an explicit security or compatibility reason is documented in `RESULT.md`.
- Existing Egress batch delete and backend cleanup capabilities are reused; the issue is primarily discoverability/filtering/one-action UI rather than creating an unbounded delete API.
- `VERSION` remains `v3.6.0` because release publication is out of scope.
- Local Windows checks use repository-local frontend binaries and repository-local Go cache/temp paths.

## Acceptance criteria

- [ ] Exact upstream commit is integrated through a true merge commit and remains an ancestor of the branch.
- [ ] No unmerged paths or unexplained conflict-free overlap regressions remain.
- [ ] Filter/dialog/popover/select content remains reachable and readable at 375, 768, and 1440 pixel widths.
- [ ] Model synchronization no longer depends on a silent long-running JSON response and reports progress plus terminal errors accurately.
- [ ] Users can filter unusable proxy nodes, clean all unusable nodes in one confirmed action, retain selected-node batch deletion, and see complete safe subscription sync state.
- [ ] Backend and frontend ordinary configurable field inventories agree; missing routing fields are restored and explicit exceptions are documented.
- [ ] Required focused and full checks pass, or environment-only limitations are isolated with authoritative alternative evidence.
- [ ] Security, accessibility, responsive layout, code review, and upstream consistency audits find no release-blocking issue.
- [ ] Documentation and `RESULT.md` are current; the plan index is updated.
- [ ] Assumptions and defaults are verified.
- [ ] The plan branch has not been pushed before final acceptance.

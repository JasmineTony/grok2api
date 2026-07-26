# Iteration plan: upstream v3.0.8-hotfix.1/v3.0.9 sync and settings split

- Date: 2026-07-26
- Sequence: 18
- Owner: JasmineTony
- Status: In progress
- Base commit: `7a1c5b7c199d461aa3ae82bdfbdaa0c4710d90de`
- Working branch: `sync/upstream-v3.0.9-settings-split-20260726`
- Upstream tags: `v3.0.8-hotfix.1@dae50ce67b95d5cad2b4168e32332c790b2c9ce6`, `v3.0.9@834f9f70e57882438177b8ab89c3aaee52dffe2e`

## Objective

1. Precisely merge upstream v3.0.8-hotfix.1 and v3.0.9 while preserving both upstream commits as ancestors.
2. Resolve conflicts without regressing the repository's Failure model, account state machine, policies, observability, security gates, or component architecture.
3. Split the current combined media/network settings area into route-level Media and Network & Proxy pages.
4. Preserve public APIs, existing configuration semantics, database compatibility, dependency freeze policy, and the Go module path.

## Background

- v3.0.9 contains v3.0.8-hotfix.1 as an ancestor; sequential merge commits keep both synchronization boundaries explicit and reduce the second conflict set.
- The upstream changes include high-concurrency scheduling, Egress operations, configurable Build 403 invalidation, BOM imports, cached-token accounting, timeout hot reload, model catalog changes, blocked-account invalidation, nullable tool schemas, quota reset, and creative-console message actions.
- The current settings delivery group mixes provider networking, media storage, media execution, Clearance, and Egress. It also contains components above the 500-line architecture limit.

## Scope

- Merge `v3.0.8-hotfix.1` and then `v3.0.9` with `--no-ff` merge commits.
- Preserve the local unified error/state model, Prometheus metrics, request policies, notifications, auto-cleanup, FlareSolverr safety, replay gates, and frontend architecture.
- Add `/settings`, `/settings/media`, and `/settings/network` route pages with shared settings revision/save/reset semantics.
- Keep service capacity, batch, routing, audit, client-key defaults, and account maintenance on `/settings`.
- Move media storage and media execution controls to `/settings/media`.
- Move provider endpoints, Statsig/Clearance, network timeouts, Egress nodes, proxy pools, and health operations to `/settings/network`.
- Add shared settings sub-navigation, route prefetching, lazy loading, responsive layouts, error/loading states, and tests.

## Out of scope

- No new version tag, GitHub Release, or GHCR publication.
- No upstream commits after v3.0.9.
- No routine Go, frontend, Docker, or GitHub Actions dependency upgrades.
- No API/config key removals, destructive database migrations, or full-site visual redesign.

## Implementation steps

1. Persist this plan and keep the branch local.
2. Merge v3.0.8-hotfix.1 and resolve backend, database, configuration, frontend, and documentation conflicts.
3. Merge v3.0.9 and resolve its incremental conflicts.
4. Review automatically merged overlap for semantic regressions.
5. Split settings routes, pages, panels, shared form shell, navigation, and lazy loaders.
6. Add routing, save/reset, error, mobile, keyboard, i18n, and regression tests.
7. Run complete backend, frontend, database, Swagger, Markdown, security, container, and browser verification.
8. Complete RESULT.md, synchronize with final origin/main, then push once and create one final PR. Use a merge commit for the PR so upstream ancestry remains visible.

## Conflict rules

- Preserve local safety and governance, then layer upstream protocol and performance fixes.
- Unknown 403, timeout, proxy, and 5xx failures must not trigger permanent reauthentication; explicit blocked-user or credential evidence may use the structured invalidation path.
- Upstream Egress operations must coexist with account policies, health history, breakers, Clearance, and secret redaction.
- Database changes must remain additive/idempotent for SQLite and PostgreSQL.
- Do not replace the refactored frontend with upstream monolithic pages; route pages/workspaces/containers remain below 500 lines.
- Keep the independent `VERSION` line; this iteration does not publish a version.

## Security and compatibility constraints

- Do not use `reset --hard`, push upstream tags, or commit credentials, cookies, proxy passwords, raw logs, traces, or temporary databases.
- Auto-cleanup, FlareSolverr, and other high-risk capabilities remain disabled by default.
- Proxy URLs, cookies, Statsig values, and credentials remain write-only, redacted, or encrypted.
- Existing `/v1/*`, `/api/admin/v1/*`, configuration semantics, and `github.com/chenyme/grok2api/backend` remain compatible.

## Verification

- `go test -p 1 ./...`, `go vet ./...`, `govulncheck`, Swagger drift check.
- SQLite/PostgreSQL creation, old-schema upgrade, and repeated migration.
- Frozen pnpm install, audit, format, typecheck, lint, coverage, build, icons, bundle, chunks, architecture, code, duplicates, unused, and E2E checks.
- Chromium three-viewport light/dark coverage plus Firefox/WebKit settings smoke.
- Markdown UTF-8/link/index audit, secret/conflict scan, and `git diff --check`.

## Risks and rollback

- Large upstream overlap can introduce semantic regressions even without text conflicts; staged merge commits and targeted tests mitigate this.
- Route splitting can break deep links or partial saves; retain `/settings`, share one snapshot/revision model, and test each page directly.
- Roll back by reverting the final merge commit; additive database changes remain readable by the previous application after backup verification.

## Delivery and push gate

- This PLAN.md is the delivery unit. Keep the branch local until all scope, tests, acceptance criteria, assumptions, and RESULT.md are complete.
- Local checkpoint commits are allowed; do not create intermediate remote branches or PRs.
- Reconcile with final origin/main and rerun the full suite before the first push.

## Assumptions and defaults

- v3.0.9 includes v3.0.8-hotfix.1, but sequential merges are retained for auditability.
- Media and Network & Proxy are independent route pages, not renamed sections on one page.
- All pages continue to use the existing settings API and revision concurrency control.
- A future release requires a separate release plan.

## Acceptance criteria

- [ ] Both upstream tag commits are ancestors of the final branch.
- [ ] Upstream protocol, performance, Egress, quota, and blocked-account changes are semantically integrated.
- [ ] Settings overview, Media, and Network & Proxy pages have clear ownership and deep links.
- [ ] Route pages/workspaces/containers are below 500 lines; i18n keys match; no new architecture violations.
- [ ] Backend, frontend, database, Swagger, security, container, and browser checks pass.
- [ ] No tag, Release, or GHCR image is published.
- [ ] RESULT.md and the plan index are complete.
- [ ] No remote push occurs before final local acceptance.
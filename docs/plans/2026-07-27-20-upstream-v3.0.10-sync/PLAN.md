# Iteration plan: Exact upstream v3.0.10 synchronization

- Date: 2026-07-27
- Sequence: 20
- Owner: JasmineTony
- Status: In progress
- Base commit: `47088eb8743f03d580af5b07d94581eb2e5e2c5c`
- Working branch: `sync/upstream-v3.0.10-20260727`

## Objective

Merge the exact upstream release `v3.0.10@c27f0545197b3edf41d5deedcc2c3c3597887766` while preserving upstream ancestry, the independent repository's compatibility and reliability controls, and `VERSION=v3.2.0`.

## Background

The independent repository is currently based on upstream v3.0.9 plus local reliability, security, Egress, component architecture, and release hardening. A merge simulation identified 20 textual conflicts. Upstream v3.0.10 also restores seven settings fields and the `routing.maxAttempts=-1` unlimited-attempt semantic that must be integrated without replacing the current componentized frontend.

## Scope

- Fetch only the signed release target needed for `upstream/v3.0.10` and verify its peeled commit.
- Create a two-parent merge commit from upstream v3.0.10.
- Resolve gateway, config, repository, database, Egress, account, client-key, audit, settings, and i18n conflicts semantically.
- Preserve the stable `Failure` model, account state machine, request policy, metrics, notifications, replay gates, and protection against unknown 403/timeout/proxy/DNS/5xx credential invalidation.
- Integrate upstream rate-limit parsing, reasoning, model aliases, linked-account behavior, selector fixes, protocol fixes, Egress ordering/routing, and compatible schema additions.
- Restore the seven v3.0.10 settings fields and the upstream `-1` unlimited retry semantics in the existing frontend architecture.
- Add or update focused tests and complete repository validation.

## Out of scope

- Following commits after upstream v3.0.10 on `upstream/main`.
- Pushing upstream tags to `origin`.
- Creating a version tag, GitHub Release, or GHCR image.
- The immersive visual redesign, settings About/Changelog routes, and UI-symbol audit, which belong to iteration 21.
- Regular dependency upgrades unrelated to upstream v3.0.10.

## Implementation steps

1. Verify the clean base, remotes, exact upstream tag commit, and that no release references are changed.
2. Merge `upstream/v3.0.10` with `--no-ff --no-commit`.
3. Resolve all conflicts according to compatibility-first semantic rules; do not accept entire upstream frontend pages over current modules.
4. Restore backend and frontend settings contracts, including seven missing fields and unlimited attempts.
5. Run compile-first, focused, database migration, backend, frontend, security, documentation, and repository checks.
6. Complete `RESULT.md`, synchronize with the latest `origin/main`, repeat final verification, then perform the branch's first push.
7. Create a pull request and merge it with a Merge commit only after all required GitHub checks pass.

## Security and compatibility constraints

- Do not use `reset --hard`, bypass checks, force-merge, or force-push.
- Keep `VERSION=v3.2.0`; do not move the published `v3.2.0` tag.
- Do not push upstream tags or create Release/GHCR artifacts.
- Preserve `/v1/*`, `/api/admin/v1/*`, existing configuration meanings, existing database data/fields, and `github.com/chenyme/grok2api/backend`.
- Schema changes must be additive and idempotent on SQLite and PostgreSQL.
- Secrets, cookies, authorization data, raw traces, heap snapshots, and temporary databases remain untracked under `.cache`.
- Unknown 403, timeouts, proxy/DNS errors, and 5xx responses must not permanently invalidate credentials.

## Verification

- `go test -run '^$' -p 1 ./...`
- `go test -p 1 ./...`
- `go vet ./...`
- `govulncheck ./...`
- Swagger regeneration with no unexplained drift.
- SQLite/PostgreSQL create, upgrade, and repeated migration coverage.
- `pnpm install --frozen-lockfile`
- `pnpm audit --audit-level high`
- `pnpm format:check`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test:coverage`
- `pnpm build`
- `pnpm check:icons`, bundle, chunks, architecture, code, duplicates, unused, and E2E checks.
- Settings contract tests prove the v3.0.10 field set, stable order, no duplicates, and locale parity.
- `git diff --check`, UTF-8/Markdown audit, conflict-marker scan, secret scan, actionlint, Hadolint, and Compose validation.

## Risks and rollback

- Semantic conflict resolution can regress credential health or routing. Prevent this with focused failure/selector/Egress tests and by reviewing the merge against both parents.
- Additive migrations can diverge across databases. Prevent this with create/upgrade/repeat tests for SQLite and PostgreSQL.
- Frontend contract drift can silently omit settings. Prevent this with a canonical field-list test.
- Before remote delivery, rollback is deleting the local branch after preserving any needed patch. After merge, use a normal revert of the merge commit; never rewrite published history or move release tags.

## Delivery and push gate

- This `PLAN.md` is the delivery unit. Keep the branch local until scope, verification, acceptance criteria, and assumptions/defaults are complete.
- Local checkpoint commits are allowed; do not create partial remote branches or intermediate pull requests.
- Complete `RESULT.md` and the final synchronization/verification pass before the first push.
- The pull request must be merged with a Merge commit so `c27f0545197b3edf41d5deedcc2c3c3597887766` remains an ancestor.

## Assumptions and defaults

- The exact target is the formal upstream v3.0.10 tag, not later upstream main.
- Independent-repository governance and compatibility controls take precedence when upstream behavior conflicts, while upstream protocol fixes are layered on top.
- Existing frontend component boundaries and the 500-line route/workspace/container constraint remain in force.
- The branch remains local until final acceptance.

## Acceptance criteria

- [ ] Exact upstream v3.0.10 is present as a parent/ancestor of the final merge commit.
- [ ] `VERSION` remains `v3.2.0` and published tags are untouched.
- [ ] All 20 merge conflicts are resolved semantically with no conflict markers.
- [ ] Settings expose the v3.0.10 contract, including seven restored fields and unlimited attempts.
- [ ] Required backend, frontend, database, security, documentation, and repository checks pass.
- [ ] No upstream tag, Release, or GHCR artifact is created.
- [ ] `RESULT.md` and the plan index are complete.
- [ ] The branch has not been pushed before final acceptance.

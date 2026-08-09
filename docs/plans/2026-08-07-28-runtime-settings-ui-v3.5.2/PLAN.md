# Iteration plan: upstream-aligned runtime settings UI and v3.5.2 release

- Date: 2026-08-07
- Sequence: 28
- Owner: JasmineTony
- Status: Complete
- Base commit: `cfd25a99133537a8b7a10bfad84432938de520b6`
- Working branch: `release/v3.5.2-runtime-settings-ui`
- Pull request: [#52](https://github.com/JasmineTony/grok2api/pull/52)
- Release merge commit: `3db29d6b5b5bb9b8d55ed3a607c094509106776b`
- Annotated tag: `v3.5.2` (`b633c645748e79d3e925b04ad953431225305274`, peeled to the release merge commit)
- Release workflow: [31202835696](https://github.com/JasmineTony/grok2api/actions/runs/31202835696), successful on attempt 2

## Objective

Rebuild the runtime-settings entry experience around the supplied upstream layout, preserve the independent project visual language, split Media and Network as independent destinations, split About and Changelog as independent destinations, remove redundant generic page chrome, retain every existing settings module without route conflicts, and publish the accepted result as stable release `v3.5.2`.

## Background

The current repository already separates General, Runtime policies, Account maintenance, Grok Build, Grok Web, Grok Console, Media, Network proxy, About, and Changelog routes, but the runtime-settings landing/navigation treatment differs from the supplied upstream reference. Two historical origin branches are not ancestors of `main`; their product changes have been superseded, so their ancestry must be reconciled without reintroducing old version, dependency, release-document, or UI state.

## Scope

- Recompose the runtime-settings navigation using the upstream page framework and module order.
- Keep Grok Build, Grok Web, Grok Console, Runtime policies, and Account maintenance in the matching positions.
- Represent Media and Network proxy as distinct destinations while preserving the reference grouping rhythm.
- Represent About and Changelog as distinct destinations while preserving the reference grouping rhythm.
- Remove redundant headings, descriptions, buttons, badges, and decorative generic elements from the runtime-settings entry surface.
- Preserve route contracts, complete settings DTO saves, revision behavior, authentication, and standalone page functionality.
- Add focused route/navigation tests and visual overflow/accessibility coverage.
- Produce desktop and mobile screenshots of the final page.
- Reconcile all origin delivery branches into `main`: retain already-merged ancestry and use ancestry-only merges for stale, superseded branches after verifying their unique patches are already represented or obsolete.
- Update version and release materials to `v3.5.2`, deliver through one final PR with merge-commit semantics, and verify Release/GHCR publication.

## Out of scope

- Synchronizing a newer upstream release or unrelated upstream development branches.
- Dependency upgrades unrelated to the UI or release correctness.
- Backend settings schema, database migration, or public API changes.
- Reintroducing historical v3.4.1 dependency/version state from obsolete branches.

## Implementation steps

1. Audit current routes, navigation components, responsive layout, tests, branch topology, version references, and release automation.
2. Implement the upstream-aligned runtime-settings shell and module ordering with Lucide-only icons and reduced-motion-safe interaction.
3. Update route/navigation tests and E2E coverage for all independent destinations, active state, keyboard navigation, and responsive overflow.
4. Run a local authenticated application, validate desktop/tablet/mobile layouts, and capture final screenshots.
5. Run the complete frontend, backend, repository, security, workflow, browser, and build verification suite.
6. Record complete local evidence in `RESULT.md`; only then perform ancestry-only reconciliation of obsolete unmerged branches, synchronize the latest remote `main`, and rerun final acceptance.
7. Update `VERSION`, README, release fixtures, release notes, and release helper paths for `v3.5.2`.
8. Push the final plan branch once, create one PR, wait for all CI/CodeQL checks, and merge with a true merge commit.
9. Create and push an annotated `v3.5.2` tag at the release merge commit, publish a stable latest GitHub Release, approve protected release jobs, and verify GHCR aliases, platforms, digest, and published-image `/healthz`.
10. Update release evidence and close out documentation without moving the immutable tag.

## Security and compatibility constraints

- Do not expose, copy, store, or commit credentials, tokens, browser session data, or private keys.
- Keep `.claude/` and `.gomodcache/` untracked and out of all commits.
- Preserve complete revision-aware settings DTO writes and current route compatibility.
- Use only Lucide icons; no runtime emoji, inline raw SVG, or decorative icon regressions.
- Preserve reduced-motion behavior, keyboard focus, semantic navigation, contrast, and narrow-screen usability.
- Never rewrite an existing release tag. The new `v3.5.2` tag must be annotated and point to the accepted release merge commit.
- Do not merge upstream development branches; “all branches” applies to the independent repository's delivery branches, with obsolete unique history reconciled without applying stale file state.

## Verification

- `git status --short --branch`, branch ancestry and divergence reports, `git diff --check`.
- Frontend format, TypeScript, ESLint, Vitest coverage, production build, bundle/chunk/icon/UI audits, Knip, jscpd, code audit, and architecture audit.
- Focused settings route/navigation tests plus authenticated Chromium/WebKit E2E at desktop and mobile viewports.
- `go test -p 1 ./...` and `go vet ./...` with repository-local Windows caches.
- Markdown, workflow, secret, container configuration, and health smoke checks.
- GitHub PR checks and CodeQL.
- `VERSION=v3.5.2`; annotated tag object plus peeled commit; published non-draft/non-prerelease latest Release.
- GHCR aliases `v3.5.2`, `3.5.2`, `3.5`, `3`, and `latest` on one OCI index with `linux/amd64` and `linux/arm64`; published-image `/healthz` passes.

## Risks and rollback

- Risk: compact navigation can hide route identity or reduce accessibility. Prevent with semantic links, visible active state, focus treatment, and responsive E2E.
- Risk: ancestry reconciliation can accidentally revive obsolete files. Use `merge -s ours --no-ff` only after patch review, then verify the working tree remains unchanged.
- Risk: release documentation can point at pre-merge commits. Tag only the final PR merge commit and distinguish any later documentation-only main commit.
- Before publication, abandon or revert the plan branch. After publication, keep `v3.5.2` immutable and roll back deployments to the verified `v3.5.1` image digest while preparing a corrective release.

## Delivery and push gate

- This `PLAN.md` is the delivery unit. Keep the branch local until scope, verification, acceptance criteria, and assumptions/defaults are complete.
- Local checkpoint commits are allowed; do not create partial remote branches or intermediate pull requests.
- Record final synchronization and the complete final verification pass before the first push.

## Assumptions and defaults

- The supplied screenshot defines the desired hierarchy and order, not a requirement to copy its typography or remove the independent project's theme system.
- Media and Network proxy remain separate routes and separate clickable rows, placed together in the reference's Media and Network region.
- About and Changelog remain separate routes and separate clickable rows, placed together in the reference's About and Update region.
- Historical unmerged branches are obsolete delivery branches whose unique functional changes are already superseded by current `main`; verify before ancestry-only merge.
- No new backend API or database behavior is needed for this UI iteration.

## Acceptance criteria

- [x] Runtime-settings hierarchy and ordering match the supplied upstream reference.
- [x] Media, Network proxy, About, and Changelog are independent, conflict-free destinations.
- [x] Redundant generic page elements are removed while all existing settings modules remain reachable.
- [x] Desktop and mobile screenshots demonstrate the final accepted layout.
- [x] Required local checks and all required remote CI/CodeQL checks pass.
- [x] All independent origin delivery branches are ancestors of the release merge commit without stale state regressions.
- [x] `VERSION=v3.5.2` and release materials are consistent.
- [x] Stable annotated Release, GHCR aliases/platforms/digest, and published-image `/healthz` are completely verified.
- [x] Local-acceptance documentation and `RESULT.md` are current.
- [x] Assumptions and defaults are verified.
- [x] The plan branch has not been pushed before final local acceptance.

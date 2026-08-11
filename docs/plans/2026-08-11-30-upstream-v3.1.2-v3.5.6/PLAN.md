# Iteration plan: upstream v3.1.2 integration and v3.5.6 release

- Date: 2026-08-11
- Sequence: 30
- Owner: JasmineTony
- Status: Planned
- Base commit: `cda4409d3e60aaea0b6140335f4422a2fe80926c`
- Working branch: `sync/upstream-v3.1.2-v3.5.6-20260811`
- Upstream tag: `chenyme/grok2api v3.1.2`
- Upstream commit: `6e9eef7619b83899c82e24353177c8a819f15914`

## Objective

Integrate the exact upstream `v3.1.2` history into the independent repository with a true merge commit, preserve all current independent UI, routing, security, release-governance, performance, and compatibility layers, resolve every merge conflict intentionally, update the independent release identity to `v3.5.6`, and publish a fully verified stable release.

## Background

The current independent `main` is `cda4409d3e60aaea0b6140335f4422a2fe80926c` at `v3.5.5`. Upstream `v3.1.2` is a lightweight tag at commit `6e9eef7619b83899c82e24353177c8a819f15914`, based on merge commit `64fe10a64bc2f1d24508f78befbc727594859e17`. The shared ancestry is `fee63588d76c36070fafd343cf8a4097249bb96d`, the previously integrated upstream `v3.1.1` baseline.

The upstream delta spans Web Gateway citation and Responses streaming support, Build bot-risk scheduling controls, transient media ingestion, subscription proxy hardening, provider stream idle timeouts, Console clock-skew handling, audit filters, settings fields, persistence changes, and related frontend surfaces. The independent repository has substantial overlapping settings, media, Egress, selector, frontend architecture, UI, security, performance, and release automation changes that must not be replaced wholesale.

## Scope

- Preserve exact upstream ancestry by merging commit `6e9eef7619b83899c82e24353177c8a819f15914` with `--no-ff`.
- Review the complete upstream delta and identify overlapping independent behavior before resolving conflicts.
- Integrate upstream Web Gateway/citation/Responses streaming behavior and provider routing changes while retaining existing independent protocol and reliability extensions.
- Integrate media URL/upload ingestion with SSRF protection and transient staging while preserving current media routes, DTOs, and UI.
- Integrate Build bot-risk exclusion, stream idle timeout, subscription proxy, Console clock-skew, audit filtering, account progress, and persistence/schema updates.
- Preserve the current runtime settings navigation split, Lucide-only UI contract, responsive design, revision-aware settings saves, release automation, CI hardening, and independent version semantics.
- Update `VERSION`, README references, E2E release fixtures, release notes, version audits, and plan records to `v3.5.6`.
- Review dependencies changed by the merge; retain existing compatibility/security pins unless the upstream change or an audit proves an update is required.
- Run the complete frontend, backend, workflow, security, browser, container, release, and Git hygiene acceptance matrix.
- Deliver through one final pull request with a true merge commit, publish an immutable annotated `v3.5.6` tag, stable latest GitHub Release, and multi-architecture GHCR image.

## Out of scope

- Unrelated dependency upgrades or broad redesigns not required by the upstream integration.
- Rewriting public API contracts, persisted data, or current independent routes without an upstream compatibility requirement and focused migration coverage.
- Moving or replacing any previously published tag.
- Committing or deleting `.claude/` or `.gomodcache/`.
- Squash-merging the delivery branch or flattening upstream ancestry.

## Implementation steps

1. Record the clean independent baseline, upstream tag/commit, merge base, changed-file inventory, and current release state.
2. Create this plan and keep the delivery branch local until complete acceptance.
3. Use independent read-only review passes for backend/domain/persistence, Web/streaming, media/security, frontend/settings, and release/version overlap.
4. Merge `refs/tags/upstream-v3.1.2` with `--no-ff --no-commit` and resolve conflicts file by file, preserving both upstream intent and independent contracts.
5. Review conflict-free overlapping files for semantic regressions that textual merge cannot detect.
6. Update version identity and release materials to `v3.5.6`; regenerate Swagger only through the established generator and require no unexplained drift.
7. Run formatting, TypeScript, lint, frontend unit/coverage, production build, bundle/chunk/icon/UI/unused/duplicate/code/architecture audits, and supported browser matrices.
8. Run backend tests, race tests in CI, vet, vulnerability checks, schema/persistence tests, and focused tests for newly integrated upstream features.
9. Run dependency, workflow, secret, Markdown, release-version, container configuration, image-health, and Git conflict/diff checks.
10. Synchronize with the latest remote `main`, rerun final acceptance, complete `RESULT.md`, and only then perform the first push.
11. Create the final PR, wait for every required CI/CodeQL check, and merge using a true merge commit.
12. Create annotated tag `v3.5.6` at the delivery merge commit, publish a non-draft/non-prerelease latest Release, approve protected release jobs, and verify GHCR aliases, OCI digest, platforms, attestations, and `/healthz`.
13. Complete a closeout PR recording immutable release SHA/tag evidence separately from any later documentation-only `main` SHA.

## Security and compatibility constraints

- Never output, persist, or commit GitHub, registry, account, proxy, or application credentials.
- Preserve all existing database data and ensure schema changes remain forward-compatible with current deployments.
- Retain SSRF protections, trusted URL validation, credential encryption semantics, request redaction, and account isolation.
- Preserve public API routes and existing independent DTO fields unless compatible additive upstream fields are required.
- Preserve the independent Go module path and release-only GHCR publication boundary.
- The release tag must be annotated, immutable after push, and peel to the accepted delivery merge commit.
- Resolve conflicts by behavior and tests, not by selecting an entire `ours` or `theirs` tree.

## Verification

- Git: merge ancestry, conflict-marker scan, `git diff --check`, branch/tag/parent verification.
- Frontend: `pnpm format:check`, `pnpm typecheck`, `pnpm lint`, `pnpm test:coverage`, `pnpm build`, performance summary, Lucide/UI-symbol checks, bundle/chunk budgets, Knip, code audit, architecture audit, duplication audit.
- Browser: Chromium desktop/tablet/mobile route and interaction matrix; Firefox/WebKit and visual regression through supported local or GitHub runners.
- Backend: `go test -p 1 ./...`, focused upstream feature tests, `go vet ./...`, `govulncheck`, race test through a CGO-enabled runner, Swagger drift.
- Repository: dependency audit, release-version audit, release automation unit tests, actionlint, Gitleaks, Markdown audit, Docker/Compose/Hadolint/container smoke when tooling is available.
- GitHub: all required PR and CodeQL checks pass before merge.
- Release: annotated tag object and peeled commit, stable latest Release, successful protected workflow, aliases `v3.5.6`, `3.5.6`, `3.5`, `3`, `latest`, one OCI index, `linux/amd64`, `linux/arm64`, and published-image `/healthz`.

## Risks and rollback

- Large conflict-free overlaps may hide semantic regressions. Mitigate with subsystem-specific comparison, focused tests, architecture audits, and browser validation rather than relying only on Git conflicts.
- Schema and media-ingest changes may affect persistent deployments. Preserve additive migrations, test upgrades, and do not alter encryption or delete data.
- Upstream settings fields may conflict with independent page boundaries. Preserve the independent navigation and map new fields into the appropriate existing pages.
- If acceptance fails before publication, revert or abandon the branch. After publication, keep `v3.5.6` immutable and deploy the previously verified `v3.5.5` OCI image while preparing a corrective version.

## Delivery and push gate

- This `PLAN.md` is the delivery unit. Keep the branch local until scope, verification, acceptance criteria, and assumptions/defaults are complete.
- Local checkpoint commits are allowed; do not create partial remote branches or intermediate pull requests.
- Record the final synchronization and verification pass before the first push.

## Assumptions and defaults

- `origin/main` remains `cda4409d3e60aaea0b6140335f4422a2fe80926c` until the final synchronization gate.
- The exact upstream integration target is commit `6e9eef7619b83899c82e24353177c8a819f15914`; the upstream tag itself is lightweight, but the independent release tag will be annotated.
- `VERSION` remains the canonical independent version identity and will become `v3.5.6` only after the merge is resolved.
- Existing independent settings routes, API compatibility, database state, UI design rules, security controls, and release governance take precedence when upstream code is structurally older or less strict.
- Additive upstream features should be retained unless they conflict with a documented independent security or compatibility contract.
- Docker and CGO-enabled race testing may be unavailable locally; corresponding GitHub jobs remain authoritative when the limitation is environmental.

## Acceptance criteria

- [ ] Exact upstream `v3.1.2` commit is an ancestor of the delivery branch through a true merge commit.
- [ ] All conflicts and semantic overlaps are reviewed and resolved without losing independent or upstream-required behavior.
- [ ] Public API, settings routes, persistence, security, and release governance remain compatible.
- [ ] `VERSION=v3.5.6` and all release-facing references agree.
- [ ] Required local checks and GitHub checks pass.
- [ ] Delivery PR is merged with a true merge commit.
- [ ] Annotated `v3.5.6` tag, stable latest Release, GHCR aliases/platforms/digest, and `/healthz` are verified.
- [ ] Documentation closeout is complete and distinguishes release SHA from final `main` SHA.
- [ ] Assumptions and defaults are verified.
- [ ] `RESULT.md` is complete.
- [ ] The plan branch has not been pushed before final acceptance.

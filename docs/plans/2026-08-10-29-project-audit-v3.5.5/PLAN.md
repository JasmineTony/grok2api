# Iteration plan: project audit, release hardening, and v3.5.5

- Date: 2026-08-10
- Sequence: 29
- Owner: JasmineTony
- Status: Complete
- Base commit: `2aca24006fa77d6951e3cfa98b06d431296a7ffa`
- Working branch: `release/v3.5.5-project-audit`

## Objective

Audit the current repository for concrete code-structure, frontend formatting, type-safety, build, architecture, version-consistency, and release-mechanism defects; fix the accepted findings without changing public API or persisted-data contracts; then publish and verify stable release `v3.5.5`.

## Background

The `v3.5.2` release completed the upstream-aligned runtime-settings layout and passed the existing frontend, backend, browser, container, and release checks. The current audit found that local application quality gates remain healthy, but the release helper is tied to the previous branch and release-note path, merge failures can still return a successful process exit, release preflight accepts lightweight tags, and digest artifacts expire too quickly for a protected environment that can remain pending for more than one day. The release workflow also reports missing or malformed digest inputs only through a generic shell failure.

The frontend duplication audit additionally identified repeated response-decoder schemas and identical URL validators. These copies can drift independently and weaken the value of the runtime type boundary even though the current build passes.

## Scope

- Refactor duplicated frontend decoder schemas and identical settings URL validation logic while preserving DTOs, validation behavior, routes, and API requests.
- Add focused tests for the refactored validation and release/version tooling where practical.
- Replace the hard-coded GitHub release helper branch, title, and release-note path with validated repository-derived values.
- Make failed GitHub PR merges fail the release helper process.
- Validate that the remote release tag is annotated and peels to the expected commit before creating a GitHub Release.
- Require annotated release tags in the container release workflow.
- Retain digest artifacts long enough for protected-environment approvals and validate downloaded digest inputs with actionable diagnostics.
- Introduce an automated version-consistency audit covering `VERSION`, README, E2E fixtures, release notes, and release-helper discovery.
- Update version and release materials to `v3.5.5`.
- Run the full local frontend, backend, workflow, documentation, security, browser, and repository acceptance matrix.
- Deliver through one final merge-commit pull request, create an immutable annotated tag, publish the stable latest GitHub Release, and verify GHCR aliases, platforms, digest, and published-image health.

## Out of scope

- Upstream feature synchronization or dependency upgrades unrelated to a confirmed vulnerability or build defect.
- Public API, configuration-schema, database-schema, Go module-path, or route-contract changes.
- Broad UI redesign beyond code-structure and validation improvements found by this audit.
- Moving or rewriting any existing release tag.
- Committing or deleting local `.claude/` or `.gomodcache/` directories.

## Review findings to remediate

1. `.github/workflows/release-image.yml` retains per-architecture digest artifacts for only one day, while the protected release environment can remain pending longer and make the manifest job irrecoverably lose its inputs.
2. The release workflow verifies only that a tag peels to a commit; a lightweight tag therefore passes despite the repository's annotated-tag release contract.
3. The manifest job has no explicit digest-input validation, so expired, missing, duplicate, or malformed digest files produce a generic shell exit instead of an actionable error.
4. `scripts/github-release.py` is hard-coded to the `v3.5.2` branch, PR title, and plan path, making later releases susceptible to opening the wrong PR or publishing stale notes.
5. A rejected or otherwise unsuccessful GitHub merge response is printed by the release helper but still exits successfully.
6. The release helper creates a GitHub Release without first proving that the remote tag is annotated and peels to the intended commit.
7. Version identity is repeated manually across multiple release-facing files without an automated consistency gate.
8. Frontend runtime decoders and settings URL validators contain identical copies that can drift and weaken type-boundary maintenance.

## Implementation steps

1. Capture the clean `main` baseline and run read-only frontend/backend/repository audits.
2. Create this accepted iteration record and the release branch before implementation.
3. Consolidate duplicated frontend decoder shapes and URL validation logic; add focused regression tests.
4. Generalize and harden the GitHub release helper, including branch/note discovery, merge failure propagation, and remote annotated-tag verification.
5. Harden the release-image workflow for annotated tags, protected-environment delays, and digest diagnostics.
6. Add and wire a repository version-consistency audit.
7. Update `VERSION`, README, E2E fixtures, release notes, and iteration records for `v3.5.5`.
8. Run formatting, TypeScript, ESLint, unit/coverage, production build, bundle/chunk/icon/UI/unused/duplicate/code/architecture audits, browser tests, backend tests/vet/vulnerability checks, Swagger drift, workflow/security/Markdown checks, and Git hygiene checks.
9. Complete `RESULT.md`, synchronize with remote `main`, rerun the final acceptance matrix, and only then perform the first push.
10. Create and merge one pull request using a true merge commit.
11. Create and push annotated tag `v3.5.5` at the release merge commit, publish a non-draft/non-prerelease latest Release, approve protected jobs, and verify every GHCR alias, architecture, digest, and `/healthz`.
12. Complete a closeout pull request that records release and publication evidence, removes any environment-specific transport coupling discovered during publication, and distinguishes the immutable release commit from the later closeout commit.

## Security and compatibility constraints

- Never print, persist, or commit GitHub credentials; credentials may exist only in process memory.
- Preserve all public API routes, request/response DTOs, configuration semantics, database compatibility, and the existing Go module path.
- Use merge-commit semantics for the delivery PR so branch and ancestry history remain auditable.
- The `v3.5.5` tag must be annotated, immutable after push, and point to the accepted release merge commit.
- CI may validate but must not publish release images; GHCR publication remains restricted to an approved GitHub Release workflow and protected `release` environment.
- Keep existing dependency overrides and advisory exceptions unless a confirmed audit result requires a narrowly scoped change.

## Verification

- `git diff --check` and conflict-marker scan.
- Frontend: `pnpm format:check`, `pnpm typecheck`, `pnpm lint`, `pnpm test:coverage`, `pnpm build`, performance summary, icon/UI-symbol audit, bundle/chunk budgets, Knip, code audit, architecture audit, and duplication audit.
- Browser: supported Chromium, Firefox, and WebKit route/visual matrix, recording environmental launch limitations separately from application failures.
- Backend: `go test -p 1 ./...`, `go vet ./...`, `govulncheck`, race test where supported, and Swagger regeneration with no unexpected diff.
- Repository: `pnpm audit --audit-level high`, actionlint, Gitleaks, Markdown audit, release-version audit, Docker/Compose/Hadolint/container health where tooling is available.
- GitHub: required PR checks all pass and the PR is merged with a merge commit.
- Release: annotated tag object and peeled commit, published stable latest Release, protected workflow success, GHCR aliases `v3.5.5`, `3.5.5`, `3.5`, `3`, and `latest` on one OCI index, `linux/amd64` plus `linux/arm64`, and published-image `/healthz`.

## Risks and rollback

- Release-script discovery could select the wrong notes file. Prevent this by requiring exactly one current-version release-notes heading and failing closed on ambiguity.
- Stricter annotated-tag validation can reject old lightweight tags. This is intentional for new releases and does not mutate historical tags.
- Decoder refactors could alter runtime error behavior. Preserve the same validators and cover both list and single-object decoding paths.
- Before publication, abandon or revert the branch. After publication, keep `v3.5.5` immutable and roll deployments back to the verified `v3.5.2` OCI digest while preparing a corrective release.

## Delivery and push gate

- This `PLAN.md` is the delivery unit. Keep the branch local until scope, verification, acceptance criteria, and assumptions/defaults are complete.
- Local checkpoint commits are allowed; do not create partial remote branches or intermediate pull requests.
- Record the final synchronization and verification pass before the first push.

## Assumptions and defaults

- `origin/main` remains based on `2aca24006fa77d6951e3cfa98b06d431296a7ffa` until final synchronization.
- `VERSION` is the canonical release identity and uses stable `vMAJOR.MINOR.PATCH` syntax.
- The release PR head is the currently checked-out non-`main` branch unless explicitly overridden.
- Release notes live in exactly one iteration directory whose `RELEASE-NOTES.md` heading matches the current `VERSION`.
- The protected release environment can delay jobs for multiple days, so digest artifacts require a retention window greater than one day.
- Docker-dependent local checks may be unavailable on this Windows host; GitHub container jobs remain authoritative when local tooling is absent.

## Acceptance criteria

- [x] All accepted audit findings are remediated with focused tests or executable checks.
- [x] Public API, configuration, data, route, and Go module compatibility are preserved.
- [x] `VERSION=v3.5.5` and all current release-facing references agree.
- [x] Required local checks and GitHub PR checks pass.
- [x] The delivery PR is merged with a true merge commit.
- [x] The annotated `v3.5.5` tag and stable latest GitHub Release are published and verified.
- [x] All GHCR aliases resolve to one multi-architecture OCI index and published-image `/healthz` passes.
- [x] Documentation and release closeout evidence are complete.
- [x] Assumptions and defaults are verified.
- [x] `RESULT.md` records local acceptance and complete remote release evidence.
- [x] The plan branch has not been pushed before final local acceptance.

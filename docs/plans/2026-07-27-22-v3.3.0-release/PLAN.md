# Iteration plan: v3.3.0 release and delivery closeout

- Date: 2026-07-27
- Sequence: 22
- Owner: JasmineTony
- Status: Complete (release and publication verified; closeout PR #44)
- Base commit: `048fd7c8efafb4ac1ee027ac064ab1eddfb82f41`
- Working branch: `docs/v3.3.0-release-closeout`

## Objective

Publish the independently maintained `v3.3.0` release from the fully verified main branch, including an annotated tag, GitHub Release, multi-architecture GHCR image, provenance, SBOM, stable aliases, and `/healthz` smoke proof.

## Background

- PR #41 merged the exact upstream `v3.0.10@c27f0545197b3edf41d5deedcc2c3c3597887766` with preserved ancestry.
- PR #42 delivered settings parity and UI governance as squash commit `048fd7c8efafb4ac1ee027ac064ab1eddfb82f41`.
- PR #42 passed all 15 remote checks. The post-merge main CI run `30294101864` and CodeQL run `30294102345` also passed.
- The source version is `v3.3.0`; the annotated tag points to the final main commit without moving any earlier tag.

## Scope

- Update `VERSION` and current-version README facts to `v3.3.0`.
- Finalize iteration 21 PR, CI, merge, and branch-cleanup evidence.
- Add release notes for upstream v3.0.10 integration, settings parity, network layout repair, Lucide governance, and compatibility guarantees.
- Run the complete local frontend, backend, documentation, security, browser, and repository acceptance suite before the first push.
- Deliver the release preparation by a squash-merged PR.
- Create and push only the annotated `v3.3.0` tag at the final release commit.
- Publish `Grok2API v3.3.0` and verify the protected release workflow, GHCR manifest, attestations, SBOM, aliases, and smoke test.
- Use a final documentation-only closeout PR to record immutable release evidence without moving the published tag.

## Out of scope

- No routine dependency refresh, framework migration, public API change, configuration semantic change, database migration, or Go module path change.
- Do not mirror the upstream `v3.0.10` tag to origin.
- Do not move or overwrite `v3.1.0`, `v3.1.1`, or `v3.2.0`.

## Security review and accepted advisory boundary

- GitHub alert #1 / `GHSA-qwww-vcr4-c8h2` affects React Router RSC action handling before 8.3.0.
- This application is a Vite browser SPA and does not implement React Router RSC streaming, server actions, or an RSC request endpoint; repository searches and runtime architecture must confirm that affected code is unreachable.
- A React Router 8 major upgrade is not mixed into this release. The alert may be dismissed as `not_used` with an explicit comment and must be reopened if RSC mode is introduced.
- Reachable Critical/High vulnerabilities, secret findings, failed CodeQL checks, or failed release image checks block publication.

## Implementation steps

1. Update release metadata, README, iteration 21 final evidence, plan index, and release notes.
2. Verify the RSC advisory is unreachable and record the accepted boundary.
3. Run frontend frozen install, audit, verify, Chromium/WebKit coverage, bundle/chunk gates, and repository audits.
4. Run backend tests, vet, govulncheck, and Swagger no-drift checks with repository-local caches.
5. Run Markdown, UTF-8, diff, conflict-marker, secret, workflow, and container configuration checks.
6. Push `release/v3.3.0` once after local acceptance, create the release PR, wait for all checks, and squash merge with branch deletion.
7. Wait for final main CI and CodeQL, create annotated tag `v3.3.0`, push only that tag, and publish the stable GitHub Release.
8. Approve protected `release` environment deployments with JSON integer environment IDs when pending.
9. Verify multi-architecture images, provenance, SBOM, final manifest digest, stable aliases, and `/healthz`.
10. Archive immutable release evidence in a docs-only closeout PR, then synchronize and clean all local worktrees.

## Security and compatibility constraints

- Preserve `/v1/*`, `/api/admin/v1/*`, existing configuration semantics, database fields, and `github.com/chenyme/grok2api/backend`.
- Never commit credentials, cookies, Authorization values, private keys, traces, heap snapshots, screenshots, logs, or temporary databases.
- Do not bypass checks, force merge, force push, or use `reset --hard`.
- Release publication remains triggered only by a published GitHub Release.

## Verification

- Frontend: frozen install, dependency audit, `pnpm verify`, Chromium three-viewport E2E, and WebKit smoke.
- Backend: `go test -p 1 ./...`, `go vet ./...`, govulncheck v1.6.0, Swagger no drift.
- Repository: Markdown audit, `git diff --check`, actionlint, Gitleaks, Hadolint/Compose checks through CI.
- GitHub: Verify, Visual, Firefox/WebKit, PostgreSQL race, CodeQL, container health, amd64, and arm64 checks.
- Release: tag/VERSION/main ancestry, protected approvals, digest manifest, provenance, SBOM, aliases, and `/healthz`.

## Risks and rollback

- If the release PR fails, fix only the release branch and rerun the complete affected gates.
- If the release workflow fails before publishing stable tags, correct the workflow or source through a normal PR; do not move the tag.
- If a published image is defective, restore deployment to the immutable `v3.2.0` digest and publish a new patch version; never overwrite `v3.3.0`.

## Delivery and push gate

- Keep the release branch local until the scope, verification, preliminary `RESULT.md`, and release notes are complete.
- The release preparation branch is pushed once after local acceptance; remote CI fixes are the only permitted follow-up pushes.
- The final closeout documentation branch is separately pushed once after immutable release evidence is available.

## Assumptions and defaults

- `v3.3.0` is a stable release, not a prerelease.
- The release tag points to the squash-merged release preparation commit on main.
- The protected `release` environment may require multiple approvals for architecture builds, final tags, and smoke.

## Acceptance criteria

- [x] `VERSION=v3.3.0` and README/release notes are consistent.
- [x] Iteration 21 is archived with PR #42 and final CI evidence.
- [x] Local and GitHub release-preparation gates pass.
- [x] Annotated `v3.3.0` tag points to the final release main commit.
- [x] GitHub Release and GHCR multi-architecture image are published.
- [x] Provenance, SBOM, digest, aliases, and `/healthz` are verified.
- [x] Final release evidence is archived without moving the tag.
- [x] Local `HEAD == origin/main`, worktrees are clean, and temporary branches are removed after PR #44.

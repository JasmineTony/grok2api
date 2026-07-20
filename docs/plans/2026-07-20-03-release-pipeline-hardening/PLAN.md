# Iteration plan: GHCR and release pipeline hardening

- Date: 2026-07-20
- Owner: JasmineTony
- Status: Complete
- Working branch: `codex/release-hardening`

## Objective

Remove accidentally published GHCR artifacts and ensure that branch pushes and pull requests can validate containers but can never publish them. Permit publication only from a protected, approved GitHub Release.

## Scope

1. Delete the legacy combined verification-and-publish workflow.
2. Add `ci.yml` for PR, `main`, and manual verification with no package write permission and `push: false`.
3. Add `release-image.yml` triggered only by `release.published`.
4. Validate strict SemVer, `VERSION`, prerelease consistency, and membership of the tagged commit in `main`.
5. Require the protected `release` environment.
6. Build amd64 and arm64 images by digest and publish a multi-architecture manifest.
7. Publish exact versions for every release and `latest` only for stable releases.
8. Generate SBOM, provenance, and attestations; run a `/healthz` smoke test.
9. Pin third-party Actions to immutable commits and remove Node.js 20 deprecation warnings.
10. Delete the accidental public GHCR package and verify it no longer exists.
11. Add a protected `v*` tag ruleset.

## Release safety constraints

- No test tag or test Release may be created for verification.
- No upstream tag may be pushed.
- No failing check may be bypassed.
- Ordinary `main` pushes must not receive `packages: write`.
- A prerelease must never update `latest`.
- Architecture-specific temporary tags must not be publicly exposed.

## Acceptance criteria

- [x] Main and PR workflows build without publishing.
- [x] Release workflow has zero branch-push triggers.
- [x] `release` environment requires reviewer approval and disables admin bypass.
- [x] `v*` tag creation, update, deletion, and force-push are protected.
- [x] Accidental GHCR package is deleted.
- [x] All pull-request checks pass before squash merge.

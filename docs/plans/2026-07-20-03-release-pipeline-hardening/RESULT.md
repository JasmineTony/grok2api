# Iteration result: GHCR and release pipeline hardening

- Completed: 2026-07-20
- Status: Complete
- Pull request: `JasmineTony/grok2api#11`
- Squash commit: `7a168bef45ab8d7cc7b2e9cd3d1f7f74a8007a04`

## Delivered

- Replaced the legacy GHCR workflow with separate CI and Release workflows.
- CI verifies backend, Swagger, frontend, dependency security, and amd64/arm64 Docker builds without publishing.
- Release publication now requires `release.published`, strict version validation, the protected `release` environment, and package write permission scoped to release jobs.
- Stable Releases publish the exact version and `latest`; prereleases publish only the exact version.
- Added digest-based multi-architecture publishing, SBOM, provenance, attestation, and `/healthz` smoke testing.
- Upgraded pinned Actions, including Buildx v4 and pnpm setup v6, to eliminate Node.js 20 deprecation warnings.
- Deleted the accidentally created public GHCR package.

## GitHub protection delivered

- Environment: `release` (`18412242220`)
  - Reviewer: `JasmineTony`
  - Admin bypass: disabled
  - Deployment tag pattern: `v*`
- Ruleset: `Protect release tags` (`19185909`)
  - Active for `refs/tags/v*`
  - Restrict creation, update, and deletion
  - Block force pushes

## Verification results

| Check | Result |
| --- | --- |
| PR checks | 7/7 passed |
| Main CI run `29713436988` | Passed |
| Main CodeQL run `29713437002` | Passed |
| Node.js 20 Action warnings | None in final Verify job |
| Release workflow after main merge | Not triggered |
| Accidental GHCR package | Deleted |
| Remote version tags | None |

## Rollback

Reverting the squash commit would restore an unsafe publication path and must not be used as a routine rollback. If the new Release workflow fails, fix it in a reviewed branch while leaving branch publication disabled.

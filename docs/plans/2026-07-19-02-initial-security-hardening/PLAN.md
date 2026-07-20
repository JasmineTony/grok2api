# Iteration plan: initial compatibility and security hardening

- Date: 2026-07-19
- Owner: JasmineTony
- Status: Complete
- Base: upstream `v3.0.5` at `d74b15396686ae68b88c5a52e4e538d058c41d98`
- Working branch: `codex/initial-hardening`

## Objective

Establish a compatibility-first independent-maintenance baseline without changing the public API, configuration structure, database layout, or Go module path.

## Scope

1. Ignore repository-local test caches.
2. Update English and Chinese READMEs for independent maintenance, attribution, clone links, Issues, container guidance, contribution links, and upstream synchronization.
3. Default Docker Compose to building the current source until a target image is intentionally released.
4. Add `SECURITY.md` and an initial security audit record.
5. Add Dependabot coverage for Go modules, pnpm, and GitHub Actions.
6. Harden GitHub Actions permissions and immutable action references.
7. Run backend tests, vet, vulnerability checking, Swagger regeneration, frontend install/audit/lint/build, and Docker configuration review.
8. Fix only reproducible high-impact issues with a compatible path and regression coverage.

## Compatibility constraints

- Preserve module path `github.com/chenyme/grok2api/backend`.
- Preserve public API behavior and configuration semantics.
- Avoid architecture rewrites and speculative business-logic changes.
- Record breaking fixes or migrations for separate pull requests.

## Verification plan

Backend:

```text
go test ./...
go vet ./...
govulncheck ./...
```

Frontend:

```text
pnpm install --frozen-lockfile
pnpm audit --audit-level high
pnpm lint
pnpm build
```

Additional checks:

- Regenerate Swagger and require no unintended diff.
- Parse workflow YAML and validate action definitions.
- Build Docker images in GitHub Actions when local Docker is unavailable.

## Acceptance criteria

- [x] Independent-maintenance and upstream relationship are documented.
- [x] Security reporting and audit documents exist.
- [x] Dependabot is configured.
- [x] Required backend and frontend checks pass.
- [x] No public API, database, configuration, or module-path break is introduced.
- [x] Changes are merged through a checked pull request.

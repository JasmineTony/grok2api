# Iteration plan: upstream v3.1.0 integration and v3.5.0 release

- Date: 2026-08-05
- Sequence: 25
- Owner: JasmineTony
- Status: Local acceptance complete; PR and release pending
- Base commit: `4a1e97107e07e96c91c6b4482c41ed5527d873cb`
- Working branch: `sync/upstream-v3.1.0-v3.5.0-20260805`

## Objective

Merge the exact `chenyme/grok2api` v3.1.0 release into the independent repository while preserving upstream ancestry and all compatible JasmineTony reliability, settings, Egress, security, and release-governance layers, then publish stable independent release v3.5.0.

## Background

- Current independent `main` is `4a1e97107e07e96c91c6b4482c41ed5527d873cb`; published v3.4.1 remains immutable at release cut `2023755ecdc009d2b7ec43e110264af47c50f240`.
- Upstream v3.1.0 is exact commit `725ecf08997d37b8566100bfd62b97b768623f9a`, 50 commits after upstream v3.0.11.
- The independent repository already owns a historical tag named `v3.1.0`; the upstream tag is therefore stored only as isolated ref `refs/upstream-tags/v3.1.0` and must never overwrite or be pushed to origin.
- A read-only merge simulation reports 36 content conflicts across gateway, persistence, configuration, settings, accounts, routing, Egress, documentation, and version files.

## Scope

- Merge upstream v3.1.0 with a true two-parent merge commit.
- Integrate Build detection/failover, Egress quality guard, Egress/account filtering, account-isolated upstream pools, duplicate-target session stickiness, Build Composer discovery, Console reasoning compatibility, Anthropic thinking-token preservation, large-pool query hardening, and PostgreSQL URL configuration.
- Preserve independent APIs, database upgrade compatibility, account state machine, request policy, Egress operations, observability, security controls, settings-page boundaries, lazy routing, test governance, release-only GHCR publication, and Windows media durability.
- Reconcile upstream configuration and UI additions into the independent information architecture rather than replacing independent implementations wholesale.
- Set `VERSION=v3.5.0`, update release fixtures/documentation, publish a stable annotated tag and Release, and verify the multi-architecture GHCR image.

## Out of scope

- No force push, history replacement, existing tag movement, upstream tag mirroring, credential changes, or destructive data migration.
- Do not remove independent behavior merely because upstream uses a smaller or older implementation.
- Do not publish until the final merged branch, complete plan scope, verification suite, and RESULT record are accepted locally and in CI.

## Implementation steps

1. Record the exact base/upstream refs and create this plan branch without touching the unrelated `.claude/` directory.
2. Merge `refs/upstream-tags/v3.1.0` with `--no-commit`, preserving both parents.
3. Resolve conflicts by subsystem: repository metadata/version, backend application/domain/provider/persistence, configuration/Compose, and frontend routing/settings/pages/i18n.
4. Identify upstream commits already implemented independently and keep the more complete compatible implementation while adding missing behavior and tests.
5. Update v3.5.0 version references, release notes, E2E fixtures, and RESULT evidence.
6. Run focused tests after each conflict cluster, then the complete frontend/backend/repository/E2E/security gates.
7. Synchronize latest origin/main, perform final validation, create the merge commit, push once, and open the final PR.
8. After CI passes, merge the PR, create/push annotated `v3.5.0`, publish the Release, approve protected jobs, and verify amd64/arm64 aliases plus `/healthz` smoke.

## Security and compatibility constraints

- Preserve `/v1/*`, `/api/admin/v1/*`, configuration semantics, encryption keys, existing database data, and Go module path.
- Treat upstream database/schema changes as additive upgrades and retain redaction, backup, migration, and downgrade safety.
- Preserve request failure taxonomy, retry/cooldown controls, client-key restrictions, proxy isolation, and credential secrecy.
- Keep `v3.4.1` and the independent historical `v3.1.0` tag immutable.

## Verification

- Backend: focused conflict tests, `go test -p 1 ./...`, `go vet ./...`, race CI, `govulncheck`, Swagger no-drift.
- Frontend: format, typecheck, lint, unit coverage, production build, bundle/chunk/icon/UI audits, architecture/code/duplicate/unused audits, desktop/tablet/mobile plus Firefox/WebKit E2E.
- Repository: `git diff --check`, conflict scan, Markdown plan audit, actionlint, Gitleaks, Hadolint, Compose validation and container health smoke.
- Release: tag equals VERSION, tag commit belongs to main, all stable GHCR aliases share one OCI index containing amd64/arm64, protected release jobs and published-image smoke succeed.

## Risks and rollback

- Risk: 36 conflicts touch independently evolved core services; resolve by behavior and test contract, not `ours`/`theirs` wholesale selection.
- Risk: upstream quality guard and connection-pool isolation overlap independent Egress controls; keep data ownership and proxy-scope boundaries explicit.
- Rollback: revert the integration merge before publication. After publication, never move v3.5.0; deploy the verified v3.4.1 digest and issue a later corrective release.

## Delivery and push gate

- This PLAN.md is the delivery unit. Keep the branch local until every scoped behavior, test, acceptance criterion, and assumption/default is complete.
- Local checkpoint commits are allowed; do not create partial remote branches or intermediate pull requests.
- Record the final synchronization and verification pass before the first push.

## Assumptions and defaults

- Independent implementations take precedence when they are stricter, more observable, or more compatible, but missing upstream behavior must be integrated explicitly.
- v3.5.0 is the correct independent version because the upstream minor release adds substantial features and v3.4.1 is already immutable.
- Upstream ancestry is preserved with a merge commit; the upstream v3.1.0 tag itself remains isolated locally.

## Acceptance criteria

- [x] Exact upstream v3.1.0 commit is a parent/ancestor of integration merge `23963bc8d0e70fbbd0b7b9ae6d5837ced318ed59`.
- [x] All 36 simulated conflicts are resolved without losing independent or upstream-required behavior.
- [x] New upstream quality guard, routing, provider, database, configuration, and UI behaviors are covered by backend, frontend, and Linux-CI sidecar tests.
- [x] v3.5.0 version and release materials are consistent.
- [ ] Required local and CI checks pass.
- [x] RESULT.md and plan index record local acceptance before first push.
- [ ] Annotated tag, stable Release, GHCR multi-architecture aliases, and published-image smoke are verified.

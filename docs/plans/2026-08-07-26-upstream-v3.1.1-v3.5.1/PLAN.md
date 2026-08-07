# Iteration plan: upstream v3.1.1 integration, dependency stabilization, review, and v3.5.1 release

- Date: 2026-08-07
- Sequence: 26
- Owner: JasmineTony
- Status: In progress
- Base commit: `91cee12048726effa8abdcad54d94879ef3c1eae`
- Working branch: `sync/upstream-v3.1.1-v3.5.1-20260807`
- Exact upstream tag: `chenyme/grok2api v3.1.1` at `fee63588d76c36070fafd343cf8a4097249bb96d`

## Objective

Merge the exact upstream v3.1.1 release into the independently maintained repository with true ancestry, update eligible project dependencies without adopting packages released in the preceding 48 hours, review the merged code for correctness, security, performance, and regression risks, fix accepted findings, then publish stable independent release v3.5.1 with complete CI, Release, GHCR, and `/healthz` evidence.

## Background

- Current independent `main` is `91cee12048726effa8abdcad54d94879ef3c1eae`; release v3.5.0 remains immutable at `8e48ca77956407236cb8caa52770a4ead6b185d7` with annotated tag object `68d34ca9a5b3cdc2af0bce6e60465205602e2651`.
- Upstream v3.1.1 is exact commit `fee63588d76c36070fafd343cf8a4097249bb96d`; upstream `main` is currently later and is not the merge target.
- The repository contains untracked local `.claude/` and `.gomodcache/` directories that must remain uncommitted.
- Dependency updates must favor proven, compatible releases and avoid newly published versions that have not had at least 48 hours of ecosystem exposure.

## Scope

- Fetch upstream v3.1.1 into an isolated local upstream ref and merge it with a true two-parent merge commit.
- Resolve conflicts by preserving independent compatibility, settings boundaries, Egress, Quality Guard, security, observability, persistence, and release-governance layers while integrating upstream v3.1.1 fixes.
- Inventory Go, frontend, GitHub Actions, container, and tooling dependencies; update only compatible versions whose release timestamp is at least 48 hours old at selection time.
- Do not select a release published within the previous 48 hours; this stricter gate also excludes releases from the previous 24 hours.
- Run code review across backend, frontend, configuration, persistence, providers, concurrency, resource usage, query behavior, caching, error handling, security boundaries, and release workflows.
- Fix confirmed release-blocking or high-confidence defects and add regression tests where practical.
- Set `VERSION=v3.5.1`, update fixtures, README, release notes, plan/result evidence, and publish a stable annotated `v3.5.1` release.

## Out of scope

- Do not merge upstream `main` beyond v3.1.1.
- Do not adopt dependency releases younger than 48 hours, pre-releases, release candidates, beta/nightly builds, or compatibility-breaking major upgrades without a separately documented need.
- Do not move existing tags, rewrite published history, push isolated upstream refs, modify credentials, or perform destructive data migrations.
- Do not commit `.claude/`, `.gomodcache/`, caches, downloaded tools, generated credentials, or local browser state.

## Implementation steps

1. Record exact local/origin/upstream refs, create this plan, create the dedicated sync branch, and fetch v3.1.1 into `refs/upstream-tags/v3.1.1` without mirroring it to origin.
2. Compare v3.1.0..v3.1.1 and current main, identify already integrated changes, simulate the merge, then resolve conflicts with behavior-level review.
3. Inventory dependency manifests and lockfiles; query authoritative release metadata and prepare a timestamped allow/hold decision for each proposed update.
4. Apply eligible dependency updates, regenerate lockfiles deterministically, and run vulnerability/license/compatibility checks.
5. Perform backend, frontend, persistence, provider, concurrency, performance, security, configuration, and workflow review; fix confirmed findings and add targeted tests.
6. Update `VERSION=v3.5.1`, release fixtures, documentation, `RELEASE-NOTES.md`, and `RESULT.md`.
7. Run focused tests followed by the complete local backend/frontend/repository/security verification suite, recording platform-specific limitations separately.
8. Synchronize the latest origin/main, rerun final acceptance, create the final local commits, push once, and open one PR using merge-commit semantics.
9. After required CI and CodeQL pass, merge the PR, create/push annotated `v3.5.1`, publish the stable Release, approve protected release waves, verify GHCR aliases/platforms/digest, and confirm the published-image `/healthz` smoke.
10. Submit a documentation-only closeout PR if remote-only release evidence cannot be known before publication.

## Security and compatibility constraints

- Preserve `/v1/*`, `/api/admin/v1/*`, configuration semantics, encryption keys, database upgrade compatibility, Go module path, and existing persistent data.
- Keep failure taxonomy, retry/cooldown behavior, request policy, client-key boundaries, Egress isolation, Quality Guard protection, redaction, and audit behavior at least as strict as v3.5.0.
- Use authoritative package registries, upstream release/tag metadata, vulnerability scanners, and lockfile integrity; never substitute unverified mirrors.
- Preserve release-only GHCR publication and protected `release` environment approvals.
- Keep existing v3.1.0, v3.4.1, and v3.5.0 tags immutable.

## Verification

- Git: exact refs, true merge ancestry, no unmerged paths/conflict markers, `git diff --check`, and no unintended untracked files staged.
- Backend: focused regression tests, `go test -p 1 ./...`, `go vet ./...`, race CI, govulncheck, Swagger no-drift, persistence and provider tests.
- Frontend: install/lockfile integrity, format, typecheck, lint, unit coverage, production build, bundle/chunk/icon/UI, unused, duplicate, code, and architecture audits.
- Dependency safety: package release timestamps prove every selected new version was at least 48 hours old; vulnerability and compatibility results are recorded.
- Repository/security: Markdown audit, actionlint, Gitleaks, Hadolint, Compose validation, browser/visual matrix, and container health smoke.
- Release: VERSION/tag equality, annotated tag object and peeled commit, stable latest Release flags, all GHCR aliases on one OCI index with `linux/amd64` and `linux/arm64`, and published-image `/healthz` success.

## Risks and rollback

- Risk: upstream v3.1.1 may overlap independent v3.5.0 fixes; compare symbols/tests and preserve the more complete compatible behavior rather than selecting entire sides wholesale.
- Risk: dependency updates can introduce regressions despite passing audits; enforce the 48-hour minimum age, avoid major upgrades, update in small manifest groups, and retain lockfile rollback.
- Risk: performance fixes can change concurrency or retry semantics; require focused regression tests and preserve observability.
- Rollback before publication: revert the integration/dependency commits on the plan branch. After publication, keep v3.5.1 immutable, deploy the verified v3.5.0 digest, and issue a later corrective release.

## Delivery and push gate

- This PLAN.md is the delivery unit. Keep the branch local until scope, verification, acceptance criteria, and assumptions/defaults are complete.
- Local checkpoint commits are allowed; do not create partial remote branches or intermediate pull requests.
- Record the final synchronization and verification pass before the first push.

## Assumptions and defaults

- The exact merge target is upstream tag v3.1.1 at `fee63588d76c36070fafd343cf8a4097249bb96d`, not current upstream main.
- A dependency is eligible only when its selected release timestamp is at least 48 hours before the audit timestamp and it is not a prerelease.
- Patch/minor compatible updates are preferred; major upgrades require explicit evidence that the project already supports them and no migration is needed.
- Independent implementations take precedence when stricter or more compatible, but missing upstream v3.1.1 behavior must be integrated explicitly.
- v3.5.1 is the intended independent release version.

## Acceptance criteria

- [ ] Exact upstream v3.1.1 is preserved as an ancestor through a true merge commit.
- [ ] Merge conflicts and already-integrated changes are reconciled without losing required independent or upstream behavior.
- [ ] Every updated dependency is non-prerelease, compatible, and at least 48 hours old at selection time.
- [ ] Code review findings are triaged; accepted correctness, performance, security, and regression defects are fixed and tested.
- [ ] `VERSION=v3.5.1` and release materials are consistent.
- [ ] Required local and remote CI/CodeQL checks pass.
- [ ] Annotated tag, stable Release, GHCR aliases/platforms/digest, and published-image smoke are verified.
- [ ] Documentation and `RESULT.md` are complete and the plan branch was not pushed before final local acceptance.
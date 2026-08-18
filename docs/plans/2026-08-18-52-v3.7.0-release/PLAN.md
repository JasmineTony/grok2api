# Iteration plan: v3.7.0 reliability and observability release

- Date: 2026-08-18
- Sequence: 52
- Owner: JasmineTony
- Status: In progress
- Base commit: `5588f2232d035931ff1e78e7791d9f5f36b74980`
- Working branch: `fix/new-model-capability-failover-20260816`
- Previous release: `v3.6.1`
- Target release: `v3.7.0`
- Initial origin main: `4bb43245b12a455ff01c067ce1ce400edad7cb59`

## Objective

Integrate the completed reliability, account-lifecycle, high-traffic,
observability, configuration-boundary, and credential-normalizer iterations
with the latest maintained `main`, publish them as stable `v3.7.0`, and verify
the remote branch, pull request, annotated tag, GitHub Release, release
workflow, multi-architecture GHCR aliases, and published-image health.

## Background

Iterations 40 through 51 are locally complete and verified. The current
working branch is based on `5588f223`, while maintained `origin/main` has
advanced to `4bb43245`. The release must preserve both the completed local
changes and subsequent mainline account/provider fixes through a true merge,
without committing account exports, caches, screenshots, or local tooling
state.

## Scope

- Commit only the reviewed iteration 40-51 implementation, tests, fixtures,
  deployment assets, and plan records.
- Merge exact maintained `origin/main@4bb43245` and resolve overlaps
  semantically.
- Set release identity to `v3.7.0` in `VERSION`, README, E2E fixtures, About
  route assertions, release notes, and plan records.
- Run backend, frontend, release automation, Markdown, Swagger, workflow,
  secret, and Git hygiene gates available on this host.
- Push the accepted branch once, create and merge one release PR with the
  repository helper, create and push an annotated `v3.7.0` tag on the delivery
  merge commit, and publish the stable latest GitHub Release.
- Verify CI/CodeQL, release workflow jobs, GHCR aliases/platforms/digest, and
  published-image `/healthz` using remote evidence.

## Out of scope

- Reading or committing the three `2026-08-17.json` account exports.
- Committing `.claude`, Go module/cache directories, `.playwright-mcp`,
  Python bytecode, screenshots, coverage output, or browser reports.
- Rebasing or force-pushing `main`, moving an existing tag, deleting persistent
  data, or weakening security scanners.
- Claiming Docker/GHCR validation from this Windows host when the authoritative
  evidence is the protected GitHub Actions release workflow.

## Implementation steps

1. Stage the explicit reviewed allowlist and create a local checkpoint commit.
2. Merge latest `origin/main` with true ancestry and resolve all overlaps.
3. Update `v3.7.0` release metadata and write release notes.
4. Run the full locally available verification matrix and fix evidenced
   regressions only.
5. Fetch and synchronize latest `origin/main` immediately before delivery,
   repeat affected verification, and complete pre-push evidence.
6. Push the current branch and prove local/remote SHA parity.
7. Create the release PR, wait for all CI and CodeQL checks, and merge using a
   true merge commit.
8. Create and push annotated tag `v3.7.0`, publish the stable Release, and
   verify tag/main ancestry.
9. Wait for the protected release workflow and verify five aliases,
   amd64/arm64 manifests, one OCI index digest, and `/healthz`.
10. Complete `RESULT.md` with exact remote evidence and keep release SHA
    distinct from any later documentation-only closeout.

## Security and compatibility constraints

- Never print, persist, or commit GitHub credentials, upstream tokens, account
  exports, proxy URLs, cookies, or private configuration.
- Preserve encrypted credential storage, migration ordering, public API
  routes, JSON/SSE/WebSocket semantics, and old settings compatibility.
- `v3.7.0` must be an annotated immutable tag on a commit contained by remote
  `main`.
- Before upgrade, operators must back up configuration, database, media, and
  persistent volumes; rollback uses the verified `v3.6.1` digest and backup.

## Verification

- Git: no unmerged paths, exact ancestry, explicit staged allowlist, staged
  secret scan, `git diff --check`, and local/remote branch parity.
- Backend: `go test ./... -count=1`, `go vet ./...`, focused affected packages,
  and CI Linux race/govulncheck evidence.
- Frontend: repository-local TypeScript, ESLint, Vitest, build, and governance
  scripts; CI browser jobs remain authoritative for Firefox/WebKit.
- Repository: Swagger drift, Markdown audit, release-version audit, release
  automation tests, actionlint, and pinned Gitleaks.
- Release: PR checks, annotated tag object/peeled commit, Release flags/latest,
  five GHCR aliases, amd64/arm64, common OCI digest, and `/healthz`.

## Risks and rollback

- Mainline account/provider changes overlap the local account service and
  transport handlers. Resolve them semantically and rerun focused plus full
  tests; do not select whole-file ours/theirs.
- Remote authentication, branch protection, CI, or protected release approval
  may block publication. Stop at the failed prerequisite without rewriting
  history or exposing credentials.
- Before publication, rollback is leaving `main` and `v3.6.1` unchanged. After
  publication, never move `v3.7.0`; deploy the verified `v3.6.1` digest and
  prepare a new corrective release.

## Delivery and push gate

- This `PLAN.md` is the delivery unit. No release-specific push occurs until
  implementation, local verification, synchronization, and staged review are
  complete.
- The user explicitly authorized pushing the completed code to the current
  remote branch and publishing stable `v3.7.0`.
- Use the repository helper for PR, merge, tag validation, and Release
  publication so credentials remain in memory.

## Assumptions and defaults

- Delivery branch is exactly `fix/new-model-capability-failover-20260816`.
- Stable aliases are `v3.7.0`, `3.7.0`, `3.7`, `3`, and `latest`.
- Previous verified rollback release is `v3.6.1`.
- GitHub merge strategy is a true merge commit.
- The protected `release` environment and existing release-image workflow
  remain the authoritative GHCR publication path.

## Acceptance criteria

- [ ] Reviewed local changes and latest maintained main coexist without
      semantic regression.
- [ ] Release-facing metadata agrees on `v3.7.0`.
- [ ] Required local checks pass; host limitations are isolated.
- [ ] Delivery branch is pushed once with exact SHA parity.
- [ ] Release PR and required CI/CodeQL checks pass and merge to `main`.
- [ ] Annotated `v3.7.0` and stable latest GitHub Release point to the delivery
      merge commit.
- [ ] GHCR aliases/platforms/digest and published `/healthz` are verified.
- [ ] `RESULT.md` and the plan index contain exact final evidence.

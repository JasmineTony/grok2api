# Iteration plan: responsive administration layout and v3.6.0 release

- Date: 2026-08-12
- Sequence: 32
- Owner: JasmineTony
- Status: In progress
- Base main commit: `39f0db2361ff336f55ab4a804d96c32e1b99e1d3`
- Layout plan commit: `05daab08feb2e6a70eb00521a504262c07a6f734d`
- Layout implementation commit: `7afd3b1a92eb0e06736167e69a0a2756e23cdbf8`
- Working branch: `release/v3.6.0-20260812`
- Previous release: `v3.5.6`
- Target release: `v3.6.0`

## Objective

Publish the accepted responsive administration-layout refresh as stable `v3.6.0`, preserving the existing upstream `v3.1.2` integration baseline, public APIs, provider behavior, persistence contracts, security boundaries, and release-only GHCR workflow.

## Scope

- Deliver the completed AppShell, shared page scaffold/header/toolbar, settings navigation, Models, Dashboard, Creative Console, and layout-regression changes.
- Update canonical version identity, README, authenticated browser fixtures, about-route assertion, and release notes to `v3.6.0`.
- Run complete frontend, backend, repository, release automation, browser, and Git hygiene gates before the first remote push.
- Merge through a normal GitHub pull request using a merge commit.
- Create an immutable annotated `v3.6.0` tag at the accepted PR merge commit.
- Publish a stable latest GitHub Release and multi-architecture GHCR image aliases `v3.6.0`, `3.6.0`, `3.6`, `3`, and `latest`.
- Verify the Release flags, tag object/peeled commit, workflow jobs, OCI index aliases/platforms/digest, and published-image `/healthz`.
- Record immutable publication evidence through a documentation closeout after the release is proven.

## Out of scope

- New backend features, API changes, database migrations, or dependency upgrades unrelated to release acceptance.
- Rewriting the completed layout implementation after acceptance without a reproduced regression.
- Squash or rebase merge of the release PR.
- Moving or replacing previously published tags.
- Committing local caches, credentials, browser traces, screenshots, or test artifacts.

## Implementation steps

1. Verify local branch, merge state, unmerged paths, public remote `main`, latest Release, previous annotated tag, and open PR state.
2. Create this release plan and update `VERSION`, README, E2E fixtures, release identity assertion, and `RELEASE-NOTES.md`.
3. Run frontend formatting, type, lint, coverage, production build, bundle/chunk/icon/UI/Knip/code/architecture/duplicate audits, and focused Chromium layout tests.
4. Run backend test and vet with repository-local cache/temp paths; run repository Markdown, release-version, release-automation, Swagger, conflict-marker, and diff checks.
5. Synchronize explicitly from the public HTTPS `main` ref and require the accepted branch to contain the current remote main without conflicts.
6. Complete `RESULT.md` local acceptance, commit release materials, and perform the first remote push only after all local gates pass.
7. Create the GitHub PR, wait for all required CI/CodeQL checks, and merge with `merge_method=merge`.
8. Fetch the merged main, create and push an annotated `v3.6.0` tag at the PR merge commit, validate the remote tag object and peeled commit, then publish the stable latest Release.
9. Approve the protected `release` environment only through the authorized GitHub API/UI path when requested, and wait for all image jobs and smoke tests.
10. Verify GHCR aliases, common OCI digest, `linux/amd64` and `linux/arm64`, Release flags/latest status, and published-image health.
11. Update publication evidence in a docs-only closeout commit/PR and distinguish the release commit from the later documentation-only `main` SHA.

## Security and compatibility constraints

- Never print, persist, or commit GitHub credentials, registry tokens, application secrets, account credentials, or proxy credentials.
- GitHub credentials may be obtained only through the existing in-memory Git credential helper used by `scripts/github-release.py`.
- Preserve existing API routes, DTOs, settings semantics, database state, provider behavior, and Go module path.
- Keep the release tag annotated and immutable; it must peel to the accepted PR merge commit contained by remote `main`.
- GHCR publication remains triggered only by a published GitHub Release and protected `release` environment.

## Verification

- Frontend: Prettier, TypeScript, ESLint, Vitest coverage, Vite build, performance summary, icons/UI symbols, bundle/chunk, Knip, code, architecture, and duplication audits.
- Browser: focused Chromium responsive landmarks/settings navigation; GitHub desktop/tablet/mobile visual and Firefox/WebKit smoke matrix.
- Backend: `go test -p 1 ./...`, `go vet ./...`, Swagger drift; race/vulnerability checks through supported local or GitHub environments.
- Repository: Markdown audit, release-version audit, release automation unit tests, conflict-marker scan, unmerged-path check, `git diff --check`, and secret scan in CI.
- GitHub: required PR and CodeQL checks, merge SHA and main SHA.
- Release: annotated tag object, peeled commit, stable latest Release, protected workflow jobs, aliases `v3.6.0`, `3.6.0`, `3.6`, `3`, `latest`, shared OCI index, amd64/arm64 manifests, and `/healthz`.

## Acceptance criteria

- [x] `VERSION`, README, browser fixtures, about-route assertion, and release notes agree on `v3.6.0`.
- [x] Layout changes remain responsive at 375/768/1440 widths without page-root horizontal overflow.
- [x] Required local frontend, backend, repository, release, and Git hygiene gates pass.
- [x] The branch is synchronized with current public remote `main` before its first push.
- [x] The release PR is merged through a merge commit after all required GitHub checks pass.
- [x] Annotated `v3.6.0` tag and stable latest GitHub Release are published at the accepted merge commit.
- [x] GHCR aliases resolve to one multi-architecture OCI index with amd64/arm64 runtime images.
- [x] Published `v3.6.0` image passes `/healthz`.
- [ ] Documentation closeout records exact release and post-closeout main evidence.
- [ ] Local caches and credentials remain untracked and uncommitted.

## Delivery and push gate

Keep `release/v3.6.0-20260812` local until all release materials and applicable local gates are complete. Local checkpoint commits are allowed; no partial remote branch or PR is permitted before final local acceptance.

## Risks and rollback

- If local or PR validation fails before publication, correct the branch or abandon the release without touching `v3.5.6`.
- If publication fails after the immutable tag exists, keep the tag and fix automation through a new patch release rather than moving it.
- Deployments can remain pinned to the verified `v3.5.6` OCI digest until `v3.6.0` publication and health proof are complete.

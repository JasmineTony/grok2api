# Iteration plan: latest upstream integration and v3.6.1 release

- Date: 2026-08-14
- Sequence: 34
- Owner: JasmineTony
- Status: Release complete; closeout in progress
- Base commit: `17fa07b851d0e159840ad3cd8f6b6f5eeb4d42bd`
- Working branch: `release/v3.6.1-20260814`
- Closeout branch: `docs/v3.6.1-release-closeout-20260814`
- Previous release: `v3.6.0`
- Target release: `v3.6.1`
- Initial origin main: `9dd7d18243ebce7ca088549d9ffab4185107480a`
- Latest upstream main target: `86ae605717087c2df479dc8a268219d3ad8fe731`

## Objective

Integrate the 17 upstream `main` commits after `ec16d98c7f654ec74e05f04e4b727c4639c0f2ea` into the independently reviewed parity merge, publish the resulting code as stable `v3.6.1`, merge the complete delivery through a true GitHub merge commit, verify the Release and GHCR artifacts, and remove obsolete merged branches while preserving `main`, tags, upstream branches, data, and history.

## Background

Iteration 33 produced local two-parent merge `17fa07b851d0e159840ad3cd8f6b6f5eeb4d42bd`, integrating upstream through `ec16d98c7f654ec74e05f04e4b727c4639c0f2ea`. A live remote audit on 2026-08-14 found upstream `main` had advanced to `86ae605717087c2df479dc8a268219d3ad8fe731`, 17 commits ahead. The current `origin/main` remains `9dd7d18243ebce7ca088549d9ffab4185107480a`. All existing non-main `origin` branches are already strict ancestors of `origin/main`; they require deletion after the new release, not artificial empty merges.

## Scope

- Fetch and merge exact upstream `main` commit `86ae605717087c2df479dc8a268219d3ad8fe731` with true ancestry and semantic conflict resolution.
- Preserve the independent split frontend, iteration 33 defect fixes, settings/API contracts, migration safety, and security controls.
- Raise the repository release identity from `v3.6.0` to `v3.6.1` across `VERSION`, README, E2E fixtures/assertions, release notes, and documentation.
- Run the complete frontend, backend, browser, Swagger, vulnerability, workflow, Markdown, release-version, secret, and Git hygiene matrix.
- Synchronize the accepted branch with the latest `origin/main` immediately before the first push, without rebasing or flattening the upstream merge history.
- Push one final release branch, create one delivery PR, wait for all required CI/CodeQL checks, and merge with the GitHub merge strategy.
- Create and push an annotated `v3.6.1` tag at the delivery merge commit, publish a stable latest GitHub Release, complete protected release-environment approvals, and verify GHCR aliases/platforms/digest and `/healthz`.
- Close obsolete branch references only after proving each is contained in final `main`: delete all non-main branches owned by `JasmineTony/grok2api`, including the delivery and later closeout branches, and delete corresponding historical local branches. Do not delete or modify branches in `chenyme/grok2api`.
- Complete a docs-only release closeout on `main`, preserving the distinction between release commit and later closeout main SHA.

## Out of scope

- Squash/rebase integration, force-pushing `main`, moving an existing tag, or deleting any tag.
- Deleting upstream-owned branches, unmerged work, persisted deployment data, configuration, or the preserved untracked local cache/helper directories.
- Publishing before the complete delivery PR and post-merge main checks pass.
- Treating a successful build as publication proof without Release, tag, OCI index, platform, alias, and health verification.

## Implementation steps

1. Record the exact local, origin, upstream, tag, Release, PR, workflow, and branch inventory.
2. Merge latest upstream `86ae6057...`; resolve overlapping gateway, persistence, settings, media, clipboard, README, and test changes semantically.
3. Review all 17 upstream commits and changed-on-both paths for lost iteration 33 behavior or missing fields.
4. Update the v3.6.1 release identity, release notes, E2E fixtures, release plan, and plan index.
5. Run all local gates and fix only evidenced regressions; rerun every affected gate.
6. Re-read latest `origin/main`; merge any movement, rerun final verification, complete the pre-push RESULT evidence, and push the single release branch.
7. Create the delivery PR, wait for all required checks, fix failures on the same branch if needed, and merge with a true merge commit.
8. Verify delivery ancestry and post-merge main CI/CodeQL, then create and push the annotated tag and publish the GitHub Release.
9. Process protected release approvals in order; verify five release jobs, GHCR aliases, amd64/arm64 manifests, attestations, and published-image `/healthz`.
10. Create and merge a docs-only closeout, then delete only branch refs proven to be final-main ancestors; finish on local `main` tracking `origin/main`.

## Security and compatibility constraints

- Never print, persist, or commit credentials, GitHub tokens, registry tokens, subscription URLs, proxy secrets, or private configuration.
- Preserve exact database migration order, encryption keys, old-client omission semantics, public API routes, SSE/JSON behavior, and reversible schema compatibility.
- Upgrade notes must require backups because v3.6.1 includes automatic incremental database migrations.
- Release tag must be annotated, point to the delivery merge commit contained in remote main, and remain immutable after publication.
- Branch deletion is allowed only after an ancestor check against the final remote main succeeds; `main` and all tags are protected from deletion.
- `.claude/`, `.gomodcache/`, `.gopath/`, `backend/coverage`, Python bytecode, Playwright output, and other local artifacts remain outside Git.

## Verification

- Git: remote freshness, exact merge parents/ancestry, empty unmerged index, marker scan, diff checks, staged-snapshot secret scan, and branch containment before deletion.
- Frontend: full `verify` expansion, dependency audit, focused version/About/Changelog tests, complete Chromium matrix, Firefox/WebKit smoke and accessibility where supported.
- Backend: focused affected packages, `go test -p 1 -coverprofile=coverage.out ./...`, `go vet ./...`, govulncheck, Swagger deterministic generation/drift, and race/container evidence.
- Repository: Markdown audit, release-version audit, release automation tests, actionlint, gitleaks, workflow review, and `VERSION=v3.6.1`.
- PR: all CI and CodeQL checks pass before merge; merge commit contains both `origin/main` and accepted release head.
- Release: remote annotated tag object and peeled commit, Release published/non-draft/non-prerelease/latest flags, all five release jobs, shared OCI index for `v3.6.1`, `3.6.1`, `3.6`, `3`, and `latest`, amd64/arm64 runtime manifests, and `/healthz` success.

## Risks and rollback

- The latest 17 upstream commits overlap 23 iteration 33 paths. Use semantic review and focused tests; never replace whole frontend or gateway files.
- Remote authentication or protected-environment approval may block delivery. Stop at the failed remote prerequisite without rewriting local history or exposing credentials.
- If delivery CI fails, correct the same release branch locally and push only the required final corrections.
- Before publication, rollback is deleting the unmerged release branch and keeping `main`/`v3.6.0`. After publication, deploy the verified `v3.6.0` digest while preparing a new corrective version; never move `v3.6.1`.
- A branch that is not a final-main ancestor must not be deleted and must be listed as unresolved.

## Delivery and push gate

- This `PLAN.md` is the delivery unit. Keep the branch local until implementation, tests, review, assumptions, and the pre-push section of `RESULT.md` are complete.
- Do not push checkpoint commits or create intermediate PRs.
- Re-read and synchronize the latest `origin/main` immediately before the first push, then rerun the complete required verification suite.
- Remote writes, PR merge, annotated tag, Release publication, protected-environment approvals, and deletion of fully merged historical branches are explicitly authorized by the user for v3.6.1.

## Assumptions and defaults

- Stable release version is exactly `v3.6.1`; aliases are `v3.6.1`, `3.6.1`, `3.6`, `3`, and `latest`.
- Latest upstream target is pinned to `86ae605717087c2df479dc8a268219d3ad8fe731`; any later upstream movement requires an explicit recorded decision rather than silent inclusion.
- The only unmerged local delivery line initially is iteration 33 commit `17fa07b8...`; all historical origin branches are already in `origin/main`.
- “Close all previous branches” means delete non-main branches in the maintained origin repository and historical local branches after containment proof. It does not authorize deleting `main`, tags, upstream-owned branches, or any branch with unmerged commits.
- The GitHub merge strategy remains true merge; release publication uses the repository helper/workflows and protected `release` environment.

## Acceptance criteria

- [x] Exact latest upstream commit is integrated with ancestry preserved and no iteration 33 behavior regression.
- [x] `VERSION`, README, fixtures, assertions, release notes, and release metadata agree on `v3.6.1`.
- [x] Required local and remote checks pass, or a true external prerequisite is explicitly isolated.
- [x] Delivery PR is merged to `main` through a true merge commit.
- [x] Annotated tag and published latest stable Release point to the delivery merge commit.
- [x] GHCR aliases share one verified OCI index with amd64/arm64 images and passing `/healthz`.
- [ ] Release closeout documentation records exact remote evidence.
- [ ] Every deleted branch was first proven contained in final `main`; `main`, tags, upstream branches, and unmerged work are preserved.
- [ ] `RESULT.md` and plan index are complete.
- [x] The plan branch was not pushed before final local acceptance.

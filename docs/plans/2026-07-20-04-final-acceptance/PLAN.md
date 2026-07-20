# Iteration plan: final repository and release acceptance

- Date: 2026-07-20
- Owner: JasmineTony
- Status: Complete
- Expected main: `7a168bef45ab8d7cc7b2e9cd3d1f7f74a8007a04`

## Objective

Verify the merged remote repository, synchronize the local workspace, and confirm that no tag, package, branch, workflow, or setting contradicts the approved release model.

## Checks

1. Fetch remote heads without fetching tags.
2. Verify `origin/main`, `origin/legacy-initial`, hardening-branch deletion, and upstream ancestry.
3. Verify squash author and committer identities use noreply addresses.
4. Reset local `main` to `origin/main`, delete the local hardening branch, and require a clean worktree.
5. Confirm the target repository has no tags.
6. Confirm the GHCR package URL is absent.
7. Confirm `release-image.yml` has no workflow runs.
8. Confirm the merged main push triggered only CI and CodeQL.
9. Recheck the `release` environment and `Protect release tags` ruleset.
10. Inspect remaining Dependabot PRs and avoid closing security updates or merging breaking updates automatically.

## Acceptance criteria

- [x] Local and remote `main` are identical.
- [x] Worktree is clean.
- [x] `legacy-initial` remains available.
- [x] No target tags exist.
- [x] GHCR contains no package.
- [x] Release workflow has no unintended runs.
- [x] Environment and tag rules remain active.
- [x] Remaining dependency PRs are classified correctly.

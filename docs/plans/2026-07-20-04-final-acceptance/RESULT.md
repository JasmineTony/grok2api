# Iteration result: final repository and release acceptance

- Completed: 2026-07-20
- Status: Complete
- Final main: `7a168bef45ab8d7cc7b2e9cd3d1f7f74a8007a04`

## Git verification

- `origin/main` and local `HEAD` both resolve to `7a168bef45ab8d7cc7b2e9cd3d1f7f74a8007a04`.
- `origin/legacy-initial` resolves to `039c9f092610a4fe8e47b6471850bf5594d020c5`.
- Upstream baseline `d74b15396686ae68b88c5a52e4e538d058c41d98` is an ancestor of final `main`.
- Remote and local `codex/release-hardening` branches are deleted.
- The local worktree is clean and `main` tracks `origin/main`.
- `origin` remains SSH and `upstream` remains upstream HTTPS.
- Target repository has no remote tags.

## GitHub verification

- GHCR container page is absent after package deletion.
- `Release container image` shows zero workflow runs.
- The final `main` push ran CI and CodeQL successfully and did not run the release workflow.
- The `release` environment has required review enabled, admin bypass disabled, and tag pattern `v*`.
- The active release-tag ruleset restricts creation, update, deletion, and force-push for `v*` tags.

## Dependency PR disposition

Two routine grouped Dependabot pull requests remain open:

- `#7`: Go minor/patch updates.
- `#12`: frontend minor/patch updates.

They are not the obsolete major-update PRs and were therefore neither closed nor automatically merged. Each remains subject to its own compatibility review and CI.

## Final state

The repository is ready for continued development. Future image publication is possible only through an approved GitHub Release and protected release tag.

# Iteration plan: independent repository initialization

- Date: 2026-07-19
- Owner: JasmineTony
- Status: Complete
- Upstream baseline: `d74b15396686ae68b88c5a52e4e538d058c41d98` (`v3.0.5`)
- Target repository: `JasmineTony/grok2api`

## Objective

Create `E:\codex\grok2api` from the complete upstream history, preserve the target repository's original commit, and establish a safe independent-repository remote model.

## Initial state

- Upstream repository: `chenyme/grok2api` on `main`.
- Target repository contained one initialization commit: `039c9f092610a4fe8e47b6471850bf5594d020c5`.
- The target `main` needed to be replaced without losing that original history.
- GitHub account authentication had to use SSH rather than a GitHub password.

## Scope

1. Clone the complete upstream repository into `E:\codex\grok2api`.
2. Configure `upstream` and `origin` remotes.
3. Preserve the target repository's original `main` as `legacy-initial` locally and remotely.
4. Verify that target `main` had not changed since inspection.
5. Replace target `main` with the verified upstream baseline using `--force-with-lease` only after the backup was confirmed.
6. Configure repository-local Git author identity using the GitHub noreply address.
7. Keep upstream tags local; do not push them to the target repository.
8. Create a dedicated SSH key and verify that GitHub recognizes the intended account.

## Security constraints

- Do not read, save, repeat, or use any GitHub password shared outside Git.
- Use a passphrase-protected Ed25519 key or an already-approved SSH identity.
- Do not modify global Git identity.
- Do not discard an unknown remote commit.
- Do not create Releases or publish images during repository initialization.

## Acceptance criteria

- [x] Local project exists at `E:\codex\grok2api` with full upstream history.
- [x] `origin` points to `JasmineTony/grok2api` and `upstream` points to `chenyme/grok2api`.
- [x] `legacy-initial` preserves `039c9f092610a4fe8e47b6471850bf5594d020c5` remotely.
- [x] Target `main` contains the verified upstream baseline.
- [x] No upstream tags were pushed.
- [x] Repository commits use a GitHub noreply identity.

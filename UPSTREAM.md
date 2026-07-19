# Upstream Synchronization

This repository is independently maintained while preserving compatibility with `chenyme/grok2api`.

## Remotes

```text
origin   git@github.com:JasmineTony/grok2api.git
upstream https://github.com/chenyme/grok2api.git
```

## Safe synchronization procedure

1. Start from a clean, current `main`.
2. Fetch `origin` and `upstream`, including upstream tags for comparison only.
3. Create `sync/upstream-YYYYMMDD` from `origin/main`.
4. Merge the selected `upstream/main` commit into the synchronization branch. Do not force-push `main`.
5. Resolve conflicts while retaining this repository's security policy, release-only GHCR publishing, documentation, and independent-maintenance notice.
6. Run backend tests and vet, Swagger verification, frontend frozen install/lint/build, vulnerability checks, and Docker validation.
7. Push the synchronization branch and merge it through a reviewed pull request.

Upstream tags are not mirrored automatically. A release tag for this repository is created only after the synchronized code and local hardening changes pass this repository's checks.

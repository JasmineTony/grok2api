# Iteration result: v3.3.0 release and delivery closeout

- Date completed: 2026-07-27 UTC (2026-07-28 Asia/Shanghai)
- Status: Complete
- Base commit before release preparation: `048fd7c8efafb4ac1ee027ac064ab1eddfb82f41`
- Release preparation commit: `0dfae1f95a5549f82d6b36267a2ab8cd9d5cbe92`
- Release-preparation PR: #43 — <https://github.com/JasmineTony/grok2api/pull/43>
- Release-preparation squash merge: `fd3632212279257cba172a68e95ac8f365b8bf73`
- Closeout PR: #44 — created from `docs/v3.3.0-release-closeout`; its final squash SHA is recorded by GitHub after merge.
- Release: [Grok2API v3.3.0](https://github.com/JasmineTony/grok2api/releases/tag/v3.3.0)

## Delivered

- Advanced `VERSION` to `v3.3.0` without changing the public API, configuration semantics, database fields, or Go module path.
- Preserved the exact upstream `v3.0.10@c27f0545197b3edf41d5deedcc2c3c3597887766` ancestry.
- Finalized iteration 21 UI/settings parity and Lucide/OKLCH governance through PR #42 (`048fd7c8efafb4ac1ee027ac064ab1eddfb82f41`).
- Published only the annotated `v3.3.0` tag; no upstream tag was mirrored and no existing release tag was moved.
- Published stable release notes with compatibility, security, rollback, and container publication boundaries.

## Immutable release evidence

| Item | Evidence |
| --- | --- |
| Release tag object | `v3.3.0` is an annotated tag object `54b937c2fe8a7a847852c3deada1807da623b3b6`; peeled commit is `fd3632212279257cba172a68e95ac8f365b8bf73`. |
| Tag ancestry | `v3.3.0^{}` is exactly `origin/main` at publication time; `c27f0545197b3edf41d5deedcc2c3c3597887766` is an ancestor. |
| GitHub Release | Release database ID `360666486`, published `2026-07-27T19:40:15Z`, stable (not draft/prerelease). |
| Release workflow | Run `30299256809` succeeded: <https://github.com/JasmineTony/grok2api/actions/runs/30299256809>. |
| Release validation | Job `90087873453` validated tag and `VERSION`. |
| Architecture builds | arm64 job `90087899213` and amd64 job `90087899301` both built and pushed by digest, with provenance and SBOM enabled. |
| Final tags | Job `90089101672` published and inspected `v3.3.0`, `3.3.0`, `3.3`, `3`, and `latest`. |
| Final manifest | All five aliases resolve to `sha256:ec9bd8adef3ab80e4c3921b23647624524464d78fba720e6e30f783d40572414`. |
| arm64 member | `sha256:3e8f34aa58a7a4a5e4ddccdaaf371d049e66fd59c9f092fdf9151fe8d13a6707`. |
| amd64 member | `sha256:c1870ff9e3e474b71a7707fb0798c46f09b069a8449d61ff0b6b21339e30b5d5`. |
| Attestation manifests | OCI attestation manifests `524c341a5d70e85f901f332e706cf5bdce5200306967a0d4befe036089cdbfe8` (arm64) and `0027717682f6db5267bf8e7aefe52b87c867414689cc85cf873be59905e9b868` (amd64) contain `https://spdx.dev/Document` and `https://slsa.dev/provenance/v1` in-toto layers. |
| Provenance verification | `gh attestation verify` succeeded for build subjects `sha256:81d500b3d92538bf5c35f91c1dfa73166f1d6b4f5c27fab1c31613fdb5b0d949` and `sha256:3873f144dc03170034b9e6bc3f9369a62ba1b3d4bff4666bd606e35dd8031370`; both resolve to source `refs/tags/v3.3.0` and commit `fd3632212279257cba172a68e95ac8f365b8bf73`. |
| Smoke | Job `90089639033` pulled the published image and passed `/healthz`. |
| Environment approvals | Protected `release` approvals were recorded for deployment IDs `5628774438`, `5628774448`, `5628840204`, and `5628872382`. |

## Verification results

| Check | Result | Notes |
| --- | --- | --- |
| Release PR #43 | Passed | All required CI, CodeQL, race, browser, container, Verify, amd64, and arm64 checks succeeded; squash merged and remote branch deleted. |
| Post-merge main CI | Passed | CI `30298163623` and CodeQL `30298162985` succeeded for `fd3632212279257cba172a68e95ac8f365b8bf73`. |
| Frontend and browser acceptance | Passed | pnpm 11.15.1 frozen install; 14 test files / 39 tests; Chromium 1440x900, 768x1024, 375x812; WebKit smoke; GitHub Linux Firefox/WebKit smoke. |
| Frontend budgets | Passed | CSS 89.76 kB raw; main entry 154.49 kB raw / 52.10 kB gzip; Dashboard charts 339.25 kB raw / 91.59 kB gzip; 86 chunks with no cycle. |
| Backend acceptance | Passed | `go test -p 1 ./...`, `go vet ./...`, govulncheck v1.6.0 (zero affected vulnerabilities), and Swagger no drift. |
| Repository/security gates | Passed | actionlint, Markdown/UTF-8/link/index audit, diff check, conflict scan, staged Gitleaks, container configuration and health checks. |
| Dependency advisory boundary | Reviewed | `GHSA-qwww-vcr4-c8h2` was dismissed as `not_used`; this Vite browser SPA has no RSC/server-action path. Reopen and upgrade before introducing RSC. |
| Protected release workflow | Passed | Validation, both architecture builds, provenance, SPDX SBOM layers, final aliases, manifest inspection, and `/healthz` smoke all succeeded. |

## Compatibility and security boundaries

- `/v1/*` and `/api/admin/v1/*` were not removed or renamed.
- Existing configuration meanings, database fields, migrations, and `github.com/chenyme/grok2api/backend` remain compatible.
- No routine dependency refresh was mixed into this release.
- No credentials, cookies, Authorization values, private keys, raw traces, heap snapshots, screenshots, logs, or temporary databases are tracked.
- Rollback is by deploying the immutable previous `v3.2.0` digest and publishing a new patch release; `v3.3.0` is never moved or overwritten.

## Remote and workspace cleanup

- `origin/release/v3.3.0` was deleted by PR #43; local `release/v3.3.0` was deleted after merge.
- The closeout branch is the only remaining temporary branch and is deleted after PR #44 merges.
- `origin` remains `git@github.com:JasmineTony/grok2api.git`; `upstream` remains `https://github.com/chenyme/grok2api.git`.
- Origin contains `v3.3.0` plus the historical `v3.1.0`, `v3.1.1`, and `v3.2.0` tags; no `v3.0.10` upstream tag was pushed and no historical tag was moved.
- Trace, heap, log, database, and approval artifacts remain local `.cache` only and are not part of the closeout PR.

## Rollback

- Before publication, revert release preparation through a normal PR.
- After publication, deploy the immutable `v3.2.0` image digest and create a new patch version; never overwrite or move `v3.3.0`.

## Final acceptance

- [x] `VERSION=v3.3.0` and README/release notes are consistent.
- [x] PR #43 and final main CI/CodeQL are complete.
- [x] Annotated `v3.3.0` points to the final release main commit.
- [x] Stable Release, protected approvals, GHCR multi-architecture manifest, provenance, SBOM, aliases, and `/healthz` are verified.
- [x] Upstream tag was not pushed; historical tags were not moved.
- [x] Closeout documentation is ready for PR #44; after merge, all temporary branches and worktrees are clean.

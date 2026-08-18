# Iteration result: v3.7.0 reliability and observability release

- Date completed: 2026-08-18
- Sequence: 53
- Status: Complete
- Plan: [PLAN.md](./PLAN.md)
- Release published: `2026-08-18T14:55:22Z`
  (`2026-08-18T22:55:22+08:00`)
- Initial branch head: `5588f2232d035931ff1e78e7791d9f5f36b74980`
- Accepted release branch head: `d9107d50ec438a831f30dc50cfcc667a5bcb8b1f`
- Delivery branch: `fix/new-model-capability-failover-20260816`
- Delivery pull request:
  [#73](https://github.com/JasmineTony/grok2api/pull/73)
- Delivery merge commit: `dd54f6c43fc0ba62fa83d2097208524fbba5e4d0`
- Delivery merge parents: `4bb43245b12a455ff01c067ce1ce400edad7cb59`
  and `d9107d50ec438a831f30dc50cfcc667a5bcb8b1f`
- Release tag object: `293585d111e7b815b352620b2e52ea44561046ec`
- Release tag peeled commit:
  `dd54f6c43fc0ba62fa83d2097208524fbba5e4d0`
- GitHub Release:
  [Grok2API v3.7.0](https://github.com/JasmineTony/grok2api/releases/tag/v3.7.0)
  (ID `372433243`)
- Release workflow:
  [run 32151300228](https://github.com/JasmineTony/grok2api/actions/runs/32151300228)
- Closeout branch: `docs/v3.7.0-release-closeout-20260818`

## Delivered

- Integrated the completed account lifecycle, token refresh classification,
  provider routing, model synchronization, billing, WebSocket, configuration,
  observability, and frontend API-contract iterations with maintained
  `origin/main` through a true merge.
- Preserved provider-specific authentication, egress, quota, cookie,
  user-agent, retry, and account-health boundaries.
- Added bounded provider concurrency and WebSocket session controls,
  non-idempotent replay protection, outbound transport limits, billing
  reservation lifecycle metrics, and the Prometheus/Grafana deployment assets.
- Preserved compatibility with older account-import JSON/SSE terminal
  responses by normalizing a missing `skipped` field to zero at the stable
  frontend DTO boundary.
- Kept the three local `2026-08-17.json` account exports, caches, screenshots,
  browser reports, and local tool state outside Git.

## Verification results

| Check | Result | Evidence |
| --- | --- | --- |
| Git and ancestry | Passed | Release branch `d9107d50...` exactly matched its remote ref before PR creation; PR #73 produced true merge `dd54f6c4...` with both recorded parents; `origin/main` contains the accepted branch head |
| Backend local | Passed | `go test ./... -count=1` and `go vet ./...`; focused gateway regression tests passed after replacing a retired Web image public name in the provider-code audit fixture |
| Frontend local | Passed | TypeScript build, ESLint with zero warnings, Vitest `22` files / `81` tests, and production Vite build |
| Repository local | Passed | Release-version audit, `10` release-automation unit tests, Markdown audit over `155` tracked Markdown files, and `git diff --check` |
| Local host limitations | Isolated | GNU Make, Docker, and GCC were unavailable on this Windows host, so local Swagger generation, Compose/image smoke, and Go race execution were not claimed; their Linux CI jobs passed |
| PR checks | Passed | PR #73 CI run `32147608630` and CodeQL run `32147608599` completed successfully, including backend test/audit, race, frontend quality, repository code/workflow/secret audits, container health, Firefox/WebKit, Windows visual regression, Verify, and amd64/arm64 image builds |
| Release tag | Passed | Remote refs expose distinct annotated tag object `293585d1...` and peeled commit `dd54f6c4...`; the peeled commit is contained by remote `main` |
| GitHub Release | Passed | Release ID `372433243`, `draft=false`, `prerelease=false`; `/releases/latest` resolves to `v3.7.0` |
| Release workflow | Passed | Run `32151300228`: Validate `95757566869`, amd64 `95757633515`, arm64 `95757633444`, final tags `95759276661`, and smoke `95760295174` all completed successfully |
| GHCR image | Passed | OCI index `sha256:aee72975dbec409547b6f6428d29d194e071134a0c7f6c6b3072db6bd17af498`; linux/amd64 manifest `sha256:8f58334a5550293ad2a5432a800258043a7e8c68c70598ac3890e9a245283763`; linux/arm64 manifest `sha256:6aa0b17872afe4ed4a3199bb111dc3b74e17e3ed39d2b32d04f793c978b3df77` |
| GHCR aliases | Passed | `v3.7.0`, `3.7.0`, `3.7`, `3`, and `latest` all return the same OCI index digest |
| Published image health | Passed | The release workflow pulled the published `v3.7.0` image, started it, and completed the `/healthz` smoke job successfully |

## Publication evidence

- Immutable release commit:
  `dd54f6c43fc0ba62fa83d2097208524fbba5e4d0`.
- Immutable annotated release tag: `v3.7.0`.
- Stable image:
  `ghcr.io/jasminetony/grok2api@sha256:aee72975dbec409547b6f6428d29d194e071134a0c7f6c6b3072db6bd17af498`.
- Stable aliases: `v3.7.0`, `3.7.0`, `3.7`, `3`, and `latest`.
- Protected `release` environment approvals were applied separately to
  architecture publication, final manifest publication, and the published
  image smoke test.
- The release workflow's successful smoke job is the runtime `/healthz`
  evidence; local Docker availability was not inferred.

## Deviations

- The first local coverage command used PowerShell native-argument parsing in a
  way that also treated `.out` as a package. Every real Go package passed in
  that run, and the authoritative clean command `go test ./... -count=1`
  subsequently passed.
- `make swagger` could not run locally because GNU Make is not installed. The
  PR's Linux backend audit generated Swagger and passed the drift check.
- Local Docker/Compose and Go race execution were unavailable because Docker,
  GCC, and CGO prerequisites are absent. The protected CI container smoke and
  backend race jobs passed.

## Rollback

Never move or overwrite `v3.7.0`. If rollback is required, deploy the previously
verified `v3.6.1` digest together with the pre-upgrade configuration, database,
media, and persistent-volume backups, then prepare a new corrective release.

## Final acceptance

- [x] Reviewed implementation and maintained main coexist without semantic
      regression.
- [x] Release-facing metadata agrees on `v3.7.0`.
- [x] Local checks pass and host limitations are isolated by successful CI.
- [x] Delivery branch, PR, true merge, tag, Release, and latest status are
      independently verified.
- [x] GHCR aliases share one OCI index with amd64/arm64 runtime manifests.
- [x] Published-image `/healthz` verification passed.
- [x] Release evidence is recorded without moving the immutable tag.

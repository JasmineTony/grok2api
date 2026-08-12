# Iteration result: responsive administration layout and v3.6.0 release

- Date completed: 2026-08-12
- Status: Complete
- Base main commit: `39f0db2361ff336f55ab4a804d96c32e1b99e1d3`
- Layout implementation commit: `7afd3b1a92eb0e06736167e69a0a2756e23cdbf8`
- Release-material commit: `5d34b7ee324a6bba70958fcee1682d9ff11c203d`
- PR #58 head: `fe97539a451a129662ba3c61fb1ec463b710fe5c`
- Delivery merge commit: `8e41ccf450f355158f02220f841f09107ec59d65`
- Annotated tag object: `621ad55fa8e67b106e16ddfbc9871b102baf2a3b`
- Tag peeled commit: `8e41ccf450f355158f02220f841f09107ec59d65`
- Pull request: [#58](https://github.com/JasmineTony/grok2api/pull/58)
- Release: [Grok2API v3.6.0](https://github.com/JasmineTony/grok2api/releases/tag/v3.6.0)
- Release workflow: [run 31620488737](https://github.com/JasmineTony/grok2api/actions/runs/31620488737)
- GHCR OCI index: `sha256:e44d761a493e402cb2664d872d90e2ad0ee4e48b2cb6f49cf47c5edfb4f63141`

## Delivered

- Published the responsive administration-layout refresh built on the preserved upstream `v3.1.2` integration baseline.
- Unified AppShell, page scaffold, page headers, data-table toolbars, settings navigation, Models, Dashboard, and Creative Console responsive behavior.
- Added mobile layout regression coverage at 375/768/1440 widths and retained local table scrolling without document-root overflow.
- Updated `VERSION`, README, E2E release fixtures/assertions, release notes, and plan records to `v3.6.0`.
- Preserved public APIs, Provider behavior, persistence contracts, database compatibility, security boundaries, Go module path, and release-only GHCR publication.

## Verification results

| Check | Result | Evidence |
| --- | --- | --- |
| Local frontend | Passed | Prettier, `tsc -b`, ESLint, 16 Vitest files/47 tests, Vite build |
| Local frontend audits | Passed | Performance summary, Lucide/UI symbols, bundle budget, chunk cycles, Knip, code, architecture, jscpd |
| Local backend | Passed | `go test -p 1 ./...`, `go vet ./...` with repository-local cache/temp paths |
| Local repository | Passed | Swagger regeneration without diff, Markdown audit, release-version audit, 10 release automation tests, `git diff --check`, no unmerged paths/conflict markers |
| Focused Chromium | Passed | Network settings, responsive landmarks at 375/768/1440, settings hierarchy, about identity, changelog release notes |
| PR checks | Passed | All PR #58 CI/CodeQL checks passed, including Firefox/WebKit smoke, Visual regression, Backend race, Container health, Frontend quality, Repository audit, Workflow/secret audit, and all CodeQL languages |
| PR merge | Passed | PR #58 true merge; parents `39f0db2361ff336f55ab4a804d96c32e1b99e1d3` and `fe97539a451a129662ba3c61fb1ec463b710fe5c` |
| Release tag | Passed | Remote refs expose distinct annotated tag object and peeled merge commit |
| GitHub Release | Passed | Release ID `369398749`, published, non-draft, non-prerelease, `Grok2API v3.6.0`, latest endpoint switched to v3.6.0 |
| Release workflow | Passed | Run `31620488737`: Validate release, amd64 publish, arm64 publish, final tags, and smoke test all succeeded |
| GHCR image | Passed | Final-tag log reports OCI index `sha256:e44d761a493e402cb2664d872d90e2ad0ee4e48b2cb6f49cf47c5edfb4f63141`; runtime manifests `linux/arm64` `sha256:3a45f0e2142e22faa9ac743530f0f00378c4ceb763fe1cf5b2d0f0381a504bfe` and `linux/amd64` `sha256:691ac0f9e410f59543d511e4a72b7af7893ba7929f2d5741b85a55f9f120a587`; attestation manifests are separate `unknown/unknown` entries |
| GHCR aliases | Passed | Final-tag workflow pushed `v3.6.0`, `3.6.0`, `3.6`, `3`, and `latest` from the same two architecture sources; final `imagetools inspect` verified `v3.6.0` |
| Published image health | Passed | Smoke test pulled digest `sha256:e44d761a493e402cb2664d872d90e2ad0ee4e48b2cb6f49cf47c5edfb4f63141` and `/healthz` exited successfully |

## Publication evidence

- Remote `main`: `8e41ccf450f355158f02220f841f09107ec59d65`.
- Release tag `v3.6.0`: object `621ad55fa8e67b106e16ddfbc9871b102baf2a3b`, peeled commit `8e41ccf450f355158f02220f841f09107ec59d65`.
- GitHub Release: ID `369398749`, published `2026-08-12T17:00:51Z`, stable and latest.
- GHCR image: `ghcr.io/jasminetony/grok2api:v3.6.0` and aliases `3.6.0`, `3.6`, `3`, `latest`.
- The local Docker CLI is unavailable, so registry evidence comes from the successful protected workflow logs; the workflow itself pulled the exact digest and passed `/healthz`.

## Unresolved / follow-up

- Existing local untracked `.claude/`, `.gomodcache/`, `.gopath/`, `scripts/__pycache__/`, and `scripts/tests/__pycache__/` remain untouched and excluded from Git.
- Documentation closeout PR remains to be created so publication evidence can be recorded on `main` without moving the immutable release tag.

## Rollback

Keep deployments pinned to the previously verified `v3.5.6` digest if needed; never move `v3.6.0` tag. Any correction must ship as a new version.

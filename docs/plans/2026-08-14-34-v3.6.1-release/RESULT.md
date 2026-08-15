# Iteration result: latest upstream integration and v3.6.1 release

- Date completed: Pending
- Status: Release complete; closeout in progress
- Release published: `2026-08-14T15:00:54Z` (`2026-08-14T23:00:54+08:00`)
- Base commit: `17fa07b851d0e159840ad3cd8f6b6f5eeb4d42bd`
- Final release-candidate commit: `fea2badc7d5dfb6fae069272b1bf3851ba7f6615`
- Local upstream merge commit: `5a06d687ee12d5ffe0b3febbf81d64d2ebb51667`
- Delivery pull request: [#60](https://github.com/JasmineTony/grok2api/pull/60)
- Delivery merge commit: `00702c047e3dcbeed1970ab6a975ccda9b696f5a`
- Delivery merge parents: `9dd7d18243ebce7ca088549d9ffab4185107480a` and `fea2badc7d5dfb6fae069272b1bf3851ba7f6615`
- Release tag object: `1ea8bebca753b20f0bae447128d09d1f527daa2c`
- Release tag peeled commit: `00702c047e3dcbeed1970ab6a975ccda9b696f5a`
- GitHub Release: [Grok2API v3.6.1](https://github.com/JasmineTony/grok2api/releases/tag/v3.6.1) (ID `370647199`)
- Release workflow: [run 31812373032](https://github.com/JasmineTony/grok2api/actions/runs/31812373032)
- Closeout branch: `docs/v3.6.1-release-closeout-20260814`
- Closeout evidence commit: Pending
- Closeout pull request: Pending
- Final docs-only main commit: Pending

## Delivered

- Completed the semantic upstream merge through `86ae605717087c2df479dc8a268219d3ad8fe731` while preserving the independent split settings architecture, account-state behavior, Egress controls, precise invalidation, bounded video failover, safe media delivery, and existing API compatibility.
- Added the `routing.videoMaxAttempts` contract end to end with legacy missing/zero normalization to `999`, explicit `-1` unlimited support, finite limits through `65535`, bilingual UI, decoder/route/i18n tests, and browser coverage.
- Aligned the release identity and documentation to `v3.6.1`, including README, E2E fixtures/assertions, release notes, and the `nanoid 3.3.18` security override.
- Preserved true merge ancestry: upstream `86ae6057...` and the accepted release head are both ancestors of delivery merge `00702c047e...`; no squash, rebase, force-push, or tag movement was used.

## Verification results

| Check | Result | Evidence |
| --- | --- | --- |
| Baseline and Git state | Passed | `origin/main=00702c047e...`; no `MERGE_HEAD`; `git diff --name-only --diff-filter=U` empty; only `.claude/`, `.gomodcache/`, `.gopath/`, `backend/coverage`, and Python bytecode remain untracked and excluded |
| Backend | Passed | `go test -p=1 -coverprofile=coverage.out ./...`, `go vet ./...`, and `govulncheck@v1.6.0 ./...`; govulncheck reported 0 vulnerabilities |
| Swagger | Passed | Two deterministic generations produced stable SHA-256 values: `docs.go=53199291...`, `swagger.json=C872BDB2...`, `swagger.yaml=89BBCC49...` |
| Frontend | Passed | Prettier, `tsc -b`, ESLint with zero warnings, Vitest coverage (18 files / 59 tests), production build, performance/import/symbol/bundle/chunk/Knip/codebase/architecture/duplication audits, and `pnpm audit --audit-level high` |
| Browser | Passed with isolated host limitation | Chromium desktop/tablet/mobile suites passed (3 + 6 + 26); WebKit 28 passed; Firefox failed before page creation with host Playwright `browserContext.newPage` `_page` startup error |
| UI interaction | Passed | Three widths, filter/popover viewport bounds, network-proxy health filter and bulk cleanup preview/confirm, subscription sync/upstream proxy status, settings video attempts, About, Changelog, and split settings were verified |
| Repository | Passed | Release-version audit, 10 release automation tests, Markdown audit, actionlint v1.7.7, `git diff --check`, workflow/static audits, and staged-snapshot secret scan |
| PR checks | Passed | PR #60 CI run `31809939204` and CodeQL run `31809939554` succeeded, including backend test/audit and race, frontend quality, Chromium visual regression, Firefox/WebKit smoke, container health smoke, repository/workflow/secret audits, and amd64/arm64 build jobs |
| PR merge | Passed | PR #60 merged true-merge with parents `9dd7d182...` and `fea2badc...`; `origin/main` is `00702c047e...` |
| Release tag | Passed | Remote refs expose annotated tag object `1ea8bebc...` and peeled commit `00702c047e...` |
| GitHub Release | Passed | Release ID `370647199`, published `2026-08-14T15:00:54Z`, `draft=false`, `prerelease=false`; `/releases/latest` resolves to `v3.6.1` |
| Release workflow | Passed | Run `31812373032`: Validate release `94805826932`, Publish image (arm64) `94805878796`, Publish image (amd64) `94805878800`, Publish final tags `94806991051`, and Smoke test release image `94809060886` all completed successfully |
| GHCR image | Passed | `ghcr.io/jasminetony/grok2api` OCI index `sha256:409b41a5be15b80c939a2ee469b83fb4497ac2f4d08cd510b59d2d9076b28930`; runtime manifests `linux/arm64` `sha256:5a52f62bff6a33eae1e2149a1491e998e75dd148f1f927bd1ada15d404f54dee` and `linux/amd64` `sha256:03d1705ae3341984c2cd13e7e38a4fea2c76a5f519dadd12016d537e55259ecc`; SBOM/SLSA attestations reference run `31812373032` and revision `00702c047e...` |
| GHCR aliases | Passed | `v3.6.1`, `3.6.1`, `3.6`, `3`, and `latest` all return HTTP 200 OCI indexes with the same digest |
| Published image health | Passed | Smoke job pulled `ghcr.io/jasminetony/grok2api:v3.6.1`, started the published container, and passed `curl --fail --silent http://127.0.0.1:18000/healthz` |

## Publication evidence

- Remote `main` at release time: `00702c047e3dcbeed1970ab6a975ccda9b696f5a`.
- Release tag `v3.6.1`: object `1ea8bebca753b20f0bae447128d09d1f527daa2c`, peeled commit `00702c047e3dcbeed1970ab6a975ccda9b696f5a`.
- GitHub Release: ID `370647199`, stable and latest, URL above.
- GHCR image: `ghcr.io/jasminetony/grok2api:v3.6.1` and aliases `3.6.1`, `3.6`, `3`, `latest`.
- The release workflow's final smoke job is the runtime proof; the local Docker CLI was not required for this closeout.

## Pending branch containment and cleanup

- Branch deletion is gated on `git merge-base --is-ancestor <branch> <final origin/main>`.
- Upstream-owned refs under `chenyme/grok2api` remain untouched.
- Cleanup has not yet run. After the closeout PR merges, fetch final `origin/main`, repeat the ancestry check for every maintained-origin non-main branch, and delete only refs that return exit code 0.
- The final cleanup operation will preserve `main` and all tags.
- The immutable `v3.6.1` tag is never moved.

## Deviations

- Firefox local cross-browser execution remains isolated as a host Playwright startup defect because failures occur before `newPage` returns; CI Firefox/WebKit smoke passed.
- GitHub Actions emitted non-blocking Node.js 20 deprecation annotations for several pinned actions; all jobs still completed successfully.
- Repository-local untracked caches, coverage output, and Python bytecode remain deliberately excluded from Git.

## Rollback

Keep deployments pinned to the verified `v3.6.1` OCI digest; never move `v3.6.1`. Any correction must ship as a new version. If rollback is required, use the previously verified `v3.6.0` digest while preparing a corrective release.

## Final acceptance

- [x] Implementation matches the accepted scope.
- [x] Local and remote checks and security review are complete.
- [x] Exact upstream and delivery ancestry are preserved.
- [x] Release tag, Release flags, GHCR artifacts, and health evidence are verified.
- [ ] Closeout PR is merged and its final docs-only main SHA is recorded.
- [ ] Every deleted branch passed ancestry against that final main SHA.
- [ ] Local `main` tracks final `origin/main` after cleanup.
- [ ] Repository state and plan index are current.

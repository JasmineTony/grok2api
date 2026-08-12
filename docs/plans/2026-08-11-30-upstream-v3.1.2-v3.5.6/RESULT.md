# Iteration result: upstream v3.1.2 integration and v3.5.6 release

- Date completed: 2026-08-12
- Status: Complete
- Base commit: `cda4409d3e60aaea0b6140335f4422a2fe80926c`
- Upstream commit: `6e9eef7619b83899c82e24353177c8a819f15914`
- Integration commit: `a4046a2a5c1e681f4dea5ae60087ebfd349c2031`
- Accepted release-branch head: `7d5c8fb378a9a7ac135e2c75f771c02a88ff81cb`
- Release commit: `4cc820aadf8656d70654d541df2b89a0de44f377`
- Final closeout commit: Pending this documentation-only closeout
- Pull request: [#56](https://github.com/JasmineTony/grok2api/pull/56)
- Release: [Grok2API v3.5.6](https://github.com/JasmineTony/grok2api/releases/tag/v3.5.6)
- Release workflow: [run 31551376271](https://github.com/JasmineTony/grok2api/actions/runs/31551376271)

## Delivered

- Merged upstream `v3.1.2` with a true two-parent integration merge. Commit `a4046a2a5c1e681f4dea5ae60087ebfd349c2031` has independent parent `b278478a970619845efdfde8f638d5e24aec687b` and exact upstream parent `6e9eef7619b83899c82e24353177c8a819f15914`.
- Preserved the independent split settings routes, API-client boundaries, SSRF/media protections, release governance, Quality Guard, and compatibility layers while porting upstream Web Gateway/Responses streaming, Build bot-risk controls, stream-idle settings, transient media ingestion, subscription proxy, Console clock-skew handling, audit filters, and account detection progress UI.
- Updated the canonical version and release-facing fixtures/materials to `v3.5.6`.
- Corrected dashboard and usage-rollup success accounting so a request carrying an error code is failed even if its HTTP status is 2xx.
- Corrected the authenticated browser fixture after GitHub visual regression proved that the new required Build stream-idle field was absent from the settings snapshot; the focused browser scenarios and the complete CI matrix then passed.

## Verification results

| Check | Result | Notes |
| --- | --- | --- |
| Baseline and upstream identity | Passed | Independent base, upstream tag, exact commit, and merge base recorded in PLAN.md |
| True upstream merge ancestry | Passed | Integration commit has two parents and its second parent is exact upstream `v3.1.2` |
| Conflict-marker and diff hygiene | Passed | No conflict markers; `git diff --check` passed |
| Frontend format/type/lint | Passed | Prettier check, `tsc -b`, and ESLint zero warnings |
| Frontend tests/build | Passed | 16 files, 47 tests; coverage run and Vite production build passed |
| Frontend quality audits | Passed | Lucide/UI symbols, bundle budget, chunk cycles, code, architecture, Knip, and jscpd audits passed |
| Chromium focused regression | Passed | All five settings scenarios that failed in the first CI run passed locally after the fixture correction |
| Browser and platform CI | Passed | Visual regression, Firefox/WebKit smoke, and accessibility/route coverage passed in GitHub |
| Backend tests | Passed | `go test -p 1 ./...` passed with repository-local cache/temp directories |
| Backend vet/security | Passed | `go vet ./...` and govulncheck v1.6.0 reported no reachable vulnerabilities |
| Backend race | Passed in GitHub | Protected `Backend race` job completed successfully |
| Swagger drift | Passed | Regenerated with swag v1.16.6; backend Swagger output had no unexplained diff |
| Repository audits | Passed | Markdown audit, release-version audit, and 10 release-automation unit tests passed |
| Workflow and secret audit | Passed | actionlint v1.7.7 and the protected GitHub workflow/secret job passed |
| Secret scan | Passed | gitleaks v8.30.1 scanned the staged tracked snapshot with no leaks; the untracked dependency cache was excluded |
| Container configuration and health | Passed in GitHub | Container configuration/health CI and published-image `/healthz` smoke completed successfully |
| Delivery PR checks | Passed | All 15 final PR checks, including CodeQL and multi-architecture image builds, passed before merge |
| Post-merge main CI | Passed | Run `31551181883` completed successfully |

## Publication evidence

| Artifact | Verified value |
| --- | --- |
| Delivery merge | PR #56, merge commit `4cc820aadf8656d70654d541df2b89a0de44f377`, with former `main` `cda4409d3e60aaea0b6140335f4422a2fe80926c` and accepted release head `7d5c8fb378a9a7ac135e2c75f771c02a88ff81cb` as parents |
| Annotated tag object | `e9d90f4b7e1f536c3ba080b101bb6b4afac432ac` |
| Tag peeled commit | `4cc820aadf8656d70654d541df2b89a0de44f377` |
| GitHub Release | Release ID `368931825`; published, non-draft, non-prerelease, and selected as latest |
| Release workflow | Run `31551376271`; validation, amd64 publish, arm64 publish, final-tag publication, and release-image smoke all completed successfully |
| GHCR OCI index | `sha256:777704fdfadad6685f9726c7553d87f4b3defaba703b8bef3e5e8e4662ff5c81` |
| GHCR aliases | `v3.5.6`, `3.5.6`, `3.5`, `3`, and `latest` all return HTTP 200 and resolve to the same OCI index |
| Linux platforms | `linux/amd64` child `sha256:ddb9432b22bcf796775a2e0cc597dde11d61cf20e15be5c0957a0cd2a026303b`; `linux/arm64` child `sha256:a6b083a68c62c871e1ee1c4d3db2853449983a85c9ab27f919b2a8246e20439b` |
| Attestations | OCI index also carries architecture-specific attestation manifests; the two runtime image platforms remain exactly `linux/amd64` and `linux/arm64` |
| Published-image health | Release workflow started `ghcr.io/jasminetony/grok2api:v3.5.6` and its `/healthz` smoke passed |

## Assumptions and defaults verification

| Assumption/default | Result | Evidence |
| --- | --- | --- |
| Exact upstream target | Confirmed | `v3.1.2` resolves to `6e9eef7619b83899c82e24353177c8a819f15914` |
| `VERSION` is canonical | Confirmed | `VERSION` is `v3.5.6`; README, E2E fixtures, release notes, tag, and Release agree |
| Upstream ancestry is preserved | Confirmed | Integration commit retains exact upstream as its second parent; PR #56 used a true merge commit rather than squash/rebase |
| Release tag is annotated and immutable | Confirmed | Tag ref points to tag object `e9d90f4...`, which peels to release commit `4cc820a...` |
| `.claude/` and `.gomodcache/` remain out of Git | Confirmed | Neither directory was included in the release; local dependency/cache artifacts remain untracked |
| Docker and CGO authority may be delegated to GitHub | Confirmed | Protected container and race jobs completed successfully |

## Push gate evidence

- First release-branch push occurred only after the full local acceptance matrix completed.
- Final synchronization base before the first push: `cda4409d3e60aaea0b6140335f4422a2fe80926c`.
- Remote acceptance: all 15 final PR checks passed before merge.
- The first visual-regression run identified one incomplete test fixture rather than a production behavior defect; commit `7d5c8fb378a9a7ac135e2c75f771c02a88ff81cb` corrected the fixture, and every required check was rerun to success.

## Deviations from plan

- Local race and Docker checks were unavailable because the Windows host lacked a CGO compiler and Docker CLI; the corresponding protected GitHub jobs passed and are the authoritative evidence.
- The local gitleaks run used a staged tracked snapshot to avoid dependency test keys in the intentionally untracked Go module cache.
- The local Chromium test process did not terminate after the selected test cases reported success because the Windows Vite web-server teardown stayed alive; the GitHub Chromium matrix completed normally.
- Release environment protection required three explicit approvals: architecture publication, final manifest/aliases, and published-image smoke. Each preceding stage was verified successful before approving the next.

## Unresolved and follow-up work

- No release-blocking project finding remains open.
- Local cache directories and Python bytecode directories remain untracked and are not part of the release.

## Rollback

The published `v3.5.6` tag is immutable. If a production rollback is required, deploy the previously verified `v3.5.5` OCI image while preparing a new corrective version; never move `v3.5.6`.

## Final acceptance

- [x] Implementation matches the accepted scope.
- [x] Local checks and security review are complete.
- [x] The integration commit preserves exact upstream ancestry.
- [x] PR #56 is merged with a true merge commit and all required checks passed.
- [x] Stable Release, annotated tag, GHCR aliases/platforms/digest, attestations, and `/healthz` are verified.
- [x] Repository state and documentation closeout distinguish the immutable release commit from the later documentation-only `main` commit.
- [x] The plan index is updated to Complete.

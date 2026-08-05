# Iteration result: upstream v3.1.0 integration and v3.5.0 release

- Date completed: Release pending
- Status: Local acceptance passed; PR, CI, tag, Release, and GHCR publication pending
- Base commit: `4a1e97107e07e96c91c6b4482c41ed5527d873cb`
- Integration merge commit: `23963bc8d0e70fbbd0b7b9ae6d5837ced318ed59`
- Final main commit: Pending PR merge
- Pull request: Pending first push

## Delivered

- Preserved the exact upstream v3.1.0 commit `725ecf08997d37b8566100bfd62b97b768623f9a` as the second parent of a true merge commit.
- Integrated Quality Guard bootstrap, internal authentication, server-owned probe input, active/passive state, node policy management, optional Compose sidecar, and the `/quality-guard` administration page.
- Restored same-name route-target pool preflight and session selection, including unavailable-pool failover and persisted `ModelRouteID` ownership.
- Completed the forced-egress probe chain from Gateway input through selector, provider request, CLI context, and Egress manager; Quality Guard probes now fail closed instead of silently using a configured fallback node.
- Reconciled Build 403/quota/credit classification, exact invalidation-code normalization, request-scoped denial handling, unknown 403 traversal, and account-health side effects.
- Integrated large-account-pool fixed-shape persistence queries, batched quota recovery, Egress filters, redacted PostgreSQL errors, and compatible manual route-target schema migration.
- Preserved independent request policy, observability, settings-page boundaries, security controls, release-only GHCR governance, and Windows durability behavior.
- Set `VERSION=v3.5.0`, updated README/E2E release references, added bilingual Quality Guard translations, and added release notes.
- Split the Quality Guard UI into page, overview, editor, API, and utility modules so frontend code and architecture audits remain clean.

## Verification results

| Check | Result | Notes |
| --- | --- | --- |
| Repository baseline | Passed | HTTPS refresh confirmed `origin/main=4a1e97107e07e96c91c6b4482c41ed5527d873cb`; unrelated `.claude/` remains untracked |
| Upstream baseline | Passed | Isolated `refs/upstream-tags/v3.1.0` peels to `725ecf08997d37b8566100bfd62b97b768623f9a` |
| Merge ancestry | Passed | `23963bc` has parents `a3d3ce2` and `725ecf0`; upstream ancestor check passed |
| Conflict resolution | Passed | No unmerged paths or conflict markers; cached and worktree diff checks passed |
| Focused Gateway tests | Passed | Route-target failover, unknown Build 403, forced Egress selection, quota deltas, request denial, and failure classification |
| Backend full suite | Passed | `go test -p 1 ./...` |
| Backend static analysis | Passed | `go vet ./...` |
| Go vulnerability scan | Passed | govulncheck v1.6.0 found zero reachable/imported-package vulnerabilities; two required-module advisories are unreachable |
| Swagger | Passed | Regenerated with swag v1.16.6; `docs.go`, `swagger.json`, and `swagger.yaml` have no drift |
| Frontend verification | Passed | Prettier, TypeScript, ESLint, 42 unit tests with coverage, production build, performance summary, icon/UI/bundle/chunk, unused, code, architecture, and duplicate audits |
| Quality Guard scripts | Passed with platform split | Windows syntax compilation and Session Rotator tests passed; full fcntl-dependent suite is added to Linux CI |
| Workflow lint | Passed | actionlint v1.7.7 |
| Secret scan | Passed | Gitleaks v8.30.1 scanned an isolated snapshot of the complete Git index and found no leaks |
| Markdown audit | Passed | 82 tracked Markdown files; no removable files |
| Container/Hadolint/Compose smoke | Pending CI | Docker is unavailable on this Windows host; authoritative Linux `container-config` job must pass |
| Browser/E2E matrix | Pending CI | Authoritative Firefox/WebKit/visual jobs must pass |
| Release/GHCR | Pending | Requires merged main, annotated tag, Release workflow approvals, multi-arch manifest, aliases, and `/healthz` smoke |

## Assumptions and defaults verification

| Assumption/default | Result | Evidence |
| --- | --- | --- |
| Preserve upstream ancestry | Confirmed | Two-parent merge `23963bc`; upstream v3.1.0 is an ancestor |
| Independent compatibility layers retained | Confirmed locally | Full backend and frontend suites plus repository audits passed |
| v3.5.0 is the next release | Confirmed | User approval on 2026-08-05 and `VERSION=v3.5.0` |
| Upstream tag remains isolated | Confirmed | No upstream tag was pushed or used to overwrite the independent historical `v3.1.0` tag |

## Push gate evidence

- First remote push occurred only after final local acceptance: Not yet
- Final synchronization base: `origin/main=4a1e97107e07e96c91c6b4482c41ed5527d873cb`, refreshed over public HTTPS on 2026-08-05
- Final local verification run: 2026-08-05, after integration merge and Quality Guard fail-closed probe hardening
- Local tracked changes after this result update must be limited to this documentation closeout commit.

## Deviations from plan

- The Windows host cannot execute the fcntl-dependent Quality Guard test module or Docker/Hadolint/Compose smoke. The Linux CI workflow now runs the complete Quality Guard Python suite before container validation.
- SSH fetch authentication was unavailable in the managed shell, so the public `origin/main` synchronization check used the repository HTTPS URL. Push remains gated on the configured authenticated channel.

## Unresolved and follow-up work

- Push the completed branch and open the final PR using merge-commit semantics.
- Require all CI, CodeQL, browser, visual, container, and multi-architecture build checks to pass.
- Merge the PR, create the immutable annotated `v3.5.0` tag on merged `main`, publish the stable Release, approve each protected release wave, and verify all GHCR aliases and `/healthz`.

## Rollback

Before publication, revert integration merge `23963bc`. After publication, keep v3.5.0 immutable and deploy the verified v3.4.1 digest if rollback is required.

## Final acceptance

- [x] Implementation matches the accepted local scope.
- [x] Local checks and security review are complete.
- [x] Repository state and release materials are documented before first push.
- [x] The plan index is updated for local acceptance.
- [ ] Required remote CI checks pass.
- [ ] PR is merged and final main ancestry is verified.
- [ ] Annotated tag, stable Release, GHCR aliases, and published-image smoke are verified.

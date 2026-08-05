# Iteration result: upstream v3.1.0 integration and v3.5.0 release

- Date completed: 2026-08-05
- Status: Complete
- Base commit: `4a1e97107e07e96c91c6b4482c41ed5527d873cb`
- Integration merge commit: `23963bc8d0e70fbbd0b7b9ae6d5837ced318ed59`
- Final main commit: `8e48ca77956407236cb8caa52770a4ead6b185d7`
- Pull request: [#48](https://github.com/JasmineTony/grok2api/pull/48)
- Release: [Grok2API v3.5.0](https://github.com/JasmineTony/grok2api/releases/tag/v3.5.0)
- Annotated tag object: `68d34ca9a5b3cdc2af0bce6e60465205602e2651`
- Tagged commit: `8e48ca77956407236cb8caa52770a4ead6b185d7`

## Delivered

- Preserved the exact upstream v3.1.0 commit `725ecf08997d37b8566100bfd62b97b768623f9a` as an ancestor through a true two-parent merge chain.
- Integrated Quality Guard bootstrap, internal authentication, server-owned probe input, active/passive state, node policy management, optional Compose sidecar, and the `/quality-guard` administration page.
- Restored same-name route-target pool preflight and session selection, including unavailable-pool failover and persisted `ModelRouteID` ownership.
- Completed the forced-egress probe chain from Gateway input through selector, provider request, CLI context, and Egress manager; Quality Guard probes fail closed instead of silently using a configured fallback node.
- Reconciled Build 403/quota/credit classification, exact invalidation-code normalization, request-scoped denial handling, unknown 403 traversal, and account-health side effects.
- Integrated large-account-pool fixed-shape persistence queries, batched quota recovery, Egress filters, redacted PostgreSQL errors, and compatible manual route-target schema migration.
- Preserved independent request policy, observability, settings-page boundaries, security controls, release-only GHCR governance, and Windows durability behavior.
- Set `VERSION=v3.5.0`, updated README/E2E release references, added bilingual Quality Guard translations, and added release notes.
- Split the Quality Guard UI into page, overview, editor, API, and utility modules so frontend code and architecture audits remain clean.

## Verification results

| Check | Result | Notes |
| --- | --- | --- |
| Repository baseline | Passed | Release branch was based on `4a1e97107e07e96c91c6b4482c41ed5527d873cb`; unrelated `.claude/` and `.gomodcache/` remained untracked |
| Upstream baseline | Passed | Isolated `refs/upstream-tags/v3.1.0` peels to `725ecf08997d37b8566100bfd62b97b768623f9a` and was not pushed to origin |
| Merge ancestry | Passed | Integration merge `23963bc` preserves upstream v3.1.0 ancestry; PR merge `8e48ca7` has parents `4a1e971` and `7110a8e` |
| Conflict resolution | Passed | All 36 simulated conflicts were resolved; no unmerged paths or conflict markers remained |
| Local backend and frontend suites | Passed | Focused Gateway/provider/persistence tests, `go test -p 1 ./...`, `go vet ./...`, govulncheck, Swagger no-drift, frontend format/typecheck/lint/unit/build and governance audits passed |
| Pull request and required CI | Passed | PR #48 merged with merge-commit semantics; CI run `31016534093` and CodeQL run `31016534105` completed successfully, including backend, race, frontend, browser, visual, container, repository, amd64, and arm64 jobs |
| Release workflow | Passed | `Release container image` run `31018002485` completed successfully; all five jobs passed, including both architecture builds, final tags, and published-image smoke |
| Stable Release | Passed | Release `v3.5.0` is published, non-draft, non-prerelease, and current latest; published at `2026-08-05T14:59:23Z` |
| Annotated tag | Passed | Remote tag object `68d34ca9a5b3cdc2af0bce6e60465205602e2651` peels to final main commit `8e48ca77956407236cb8caa52770a4ead6b185d7` |
| GHCR aliases and platforms | Passed | `v3.5.0`, `3.5.0`, `3.5`, `3`, and `latest` resolve to OCI index `sha256:40c55d790f9898a9a299187c42b9139476d78f8cfb1ceb13e17324371ea1067d`, containing `linux/amd64` and `linux/arm64` images plus provenance attestations |
| Published-image health smoke | Passed | Job `92352182216` pulled `ghcr.io/jasminetony/grok2api:v3.5.0`, started the container, and completed the `/healthz` smoke successfully |

## Assumptions and defaults verification

| Assumption/default | Result | Evidence |
| --- | --- | --- |
| Preserve upstream ancestry | Confirmed | True merge ancestry is retained through integration commit `23963bc` and PR merge commit `8e48ca7` |
| Independent compatibility layers retained | Confirmed | Local suites, CI, CodeQL, browser/visual checks, container smoke, and release smoke all passed |
| v3.5.0 is the next release | Confirmed | `VERSION=v3.5.0`, PR #48 merged, and the stable latest Release is published |
| Upstream tag remains isolated | Confirmed | The independent historical `v3.1.0` tag was not moved and `refs/upstream-tags/v3.1.0` was not pushed |

## Push gate evidence

- The completed release branch was pushed at commit `7110a8e0e1f28fe26e854836b75058edfaad49dc` only after local acceptance was recorded.
- PR #48 merged the branch with an explicit merge commit, producing final `main` commit `8e48ca77956407236cb8caa52770a4ead6b185d7`.
- Required CI and CodeQL checks completed successfully before publication.
- The Release and protected GHCR workflow completed on the exact final main commit.

## Deviations from plan

- The Windows host could not run the fcntl-dependent Quality Guard suite or Docker-based checks locally; authoritative Linux CI executed the full Quality Guard, container, browser, visual, amd64, and arm64 validations successfully.
- SSH authentication was unavailable in the managed shell, so public HTTPS was used for read-only synchronization and the authenticated HTTPS credential channel was used for the final annotated-tag normalization.
- Publishing the GitHub Release initially created a lightweight `v3.5.0` ref on the correct final commit. The ref was safely replaced with the planned annotated tag using an exact `--force-with-lease`; the peeled release commit remained `8e48ca77956407236cb8caa52770a4ead6b185d7` throughout.

## Unresolved and follow-up work

- No release blocker remains.
- GitHub Actions reported non-blocking Node.js 20 deprecation warnings for several pinned actions that GitHub currently forces to Node.js 24; update those action revisions in a later maintenance iteration after validating compatible releases.

## Rollback

Keep v3.5.0 immutable. If operational rollback is required, deploy the previously verified v3.4.1 image digest and publish any corrective source changes as a new version rather than moving the v3.5.0 tag.

## Final acceptance

- [x] Implementation matches the accepted scope.
- [x] Local checks and security review are complete.
- [x] Required remote CI and CodeQL checks pass.
- [x] PR #48 is merged and final main ancestry is verified.
- [x] Annotated tag, stable latest Release, GHCR aliases, multi-architecture index, and published-image smoke are verified.

# Iteration result: upstream-aligned runtime settings UI and v3.5.2 release

- Date completed: 2026-08-09
- Status: Complete
- Base commit: `cfd25a99133537a8b7a10bfad84432938de520b6`
- Implementation commit: `ce6705957f3a5c2164fe16741fef0f776f004a53`
- Branch reconciliation commits: `b56f56d6dd89196ba978459c952823ec7b66eddc`, `c6fd41431e40b06ded3516ea3d7bdb64f4591a8a`
- Browser-test stabilization commit: `5def268`
- Accepted source/test tip: `3975014a4d77e00a2acdd3f703555020cbcdfc05`
- Local acceptance record commit: `b750990e4e87195d6ac809290d359007ccb5e384`
- Pull request: [#52](https://github.com/JasmineTony/grok2api/pull/52)
- Release merge commit: `3db29d6b5b5bb9b8d55ed3a607c094509106776b`
- Annotated tag object: `b633c645748e79d3e925b04ad953431225305274`
- Annotated tag peeled commit: `3db29d6b5b5bb9b8d55ed3a607c094509106776b`
- GitHub Release: [Grok2API v3.5.2](https://github.com/JasmineTony/grok2api/releases/tag/v3.5.2) (`366910304`)
- Release workflow: [31202835696](https://github.com/JasmineTony/grok2api/actions/runs/31202835696), attempt 2 successful
- Documentation closeout: [#53](https://github.com/JasmineTony/grok2api/pull/53)
- Closeout audit hardening: `4619e0305dd1967a0a725aff03a5f6e476366bc2` pins transitive `nanoid` to patched `3.3.17` (published 2026-08-03), removing `GHSA-2v37-7h3g-55p8` from the high-severity audit result

## Delivered

- Replaced the horizontal settings strip with a responsive upstream-aligned hierarchy headed by Runtime settings.
- `/settings` now redirects to `/settings/build`; provider order is Grok Build, Grok Web, and Grok Console.
- Media and Network proxy remain independent routes, separated from each other but positioned in the same delivery region.
- Runtime policies now retains Service capacity and Batch tasks ahead of Routing policy, Audit, and Client-key defaults; no settings form field was removed.
- Account maintenance remains an independent editable route.
- About now owns current release identity, maintained repository, and upstream lineage; Changelog independently owns update checks, latest release status, timestamps, and rendered release notes.
- Removed the obsolete General route/page and removed redundant permanent reset/save controls. Essential reset/save actions appear only while an editable form is dirty.
- Added semantic Lucide-only navigation, responsive active/focus behavior, reduced-motion-safe pane entry, and narrow-screen overflow coverage.
- Updated `VERSION`, README, E2E release fixtures, release notes, and the GitHub release helper for `v3.5.2` and merge-commit delivery.
- Reconciled the two previously unmerged historical origin branches through ancestry-only merges, preserving their history without applying superseded v3.4.1 source, dependency, version, or release state.

## Visual acceptance

- Desktop effect image: `C:\Users\kehon\.codex\visualizations\2026\08\07\019fdba1-b9ba-7ca0-8411-49f79464710c\settings-v3.5.2-desktop.png`
- Mobile effect image: `C:\Users\kehon\.codex\visualizations\2026\08\07\019fdba1-b9ba-7ca0-8411-49f79464710c\settings-v3.5.2-mobile.png`
- Desktop inspection confirms the upstream vertical hierarchy, independent split destinations, clean active treatment, and full editable Grok Build surface.
- Mobile inspection confirms a contained horizontal settings navigator and no page-level horizontal overflow.

## Verification results

| Check | Result | Notes |
| --- | --- | --- |
| Frontend format, TypeScript, and ESLint | Passed | Prettier clean; TypeScript build clean; ESLint zero warnings |
| Vitest coverage | Passed | 15 test files, 44 tests |
| Production build and performance summary | Passed | 103 assets; settings shell remains route-split; main application entry remains approximately 239.76 kB |
| CSS bundle budget | Passed | Production CSS is 94,904 raw bytes against the 95,000-byte budget |
| Icon and UI-symbol audits | Passed | Lucide-only runtime icons; no UI emoji or raw-icon regression |
| Bundle and chunk audits | Passed | Bundle budgets passed; 101 JavaScript chunks; graph is acyclic |
| Knip, code, architecture, and duplicate audits | Passed | 0 frozen code findings, 0 architecture regressions; duplicate baseline remains within configured limits |
| Chromium desktop/tablet/mobile E2E | Passed | 81/81 with two workers, including navigation order, redirect, responsive overflow, release split, and accessibility |
| WebKit serialized E2E | Passed | Final tree passed 25/25 with one worker |
| Firefox local smoke | Host limitation | Single-test reproduction fails before page creation with `browserContext.newPage: Cannot read properties of undefined (reading '_page')`; CI remains authoritative |
| Backend `go test -p 1 ./...` | Passed | All packages passed using repository-local Windows cache/temp paths |
| Backend `go vet ./...` | Passed | No findings |
| Swagger regeneration | Passed | Generated Go, JSON, and YAML documents have no tracked diff |
| pnpm dependency audit | Passed with reviewed exception | 1 high advisory found and ignored by the existing narrow `GHSA-qwww-vcr4-c8h2` RSC-only exception |
| Markdown audit | Passed | 91 tracked Markdown files before closeout; no removable files |
| Workflow and secret audit | Passed | actionlint passed; Gitleaks scanned the complete release diff and found no leaks |
| Diff and conflict-marker scan | Passed | `git diff --check` clean; no conflict markers outside the lockfile exclusion |
| Container configuration and smoke | Passed in CI | Docker is not installed on the Windows host; required CI passed Compose, Hadolint, image build, and health-smoke gates |
| PR CI and CodeQL | Passed | PR head `3975014a4d77e00a2acdd3f703555020cbcdfc05`; CI run `31201071073` and CodeQL run `31201071996` completed successfully |
| Merge ancestry | Passed | PR #52 used merge commit `3db29d6b5b5bb9b8d55ed3a607c094509106776b` with parents `cfd25a99133537a8b7a10bfad84432938de520b6` and `3975014a4d77e00a2acdd3f703555020cbcdfc05` |
| Annotated tag | Passed | Tag object `b633c645748e79d3e925b04ad953431225305274` peels to the release merge commit |
| GitHub Release | Passed | Release `366910304` is published, non-draft, non-prerelease, and latest |
| Release workflow | Passed after operational rerun | Run `31202835696` attempt 2 completed all five jobs successfully after the first attempt's two-day approval delay expired temporary digest artifacts |
| GHCR aliases and OCI index | Passed | `v3.5.2`, `3.5.2`, `3.5`, `3`, and `latest` resolve to `sha256:912a5acaa37cf123102385035c84f8c815695d0da547c186a02bcf45ae840f7e` |
| GHCR platforms and provenance | Passed | OCI index contains `linux/amd64` (`sha256:9f703e1925c7db60bf85cceb869a8e401a29c93a827490ef38e7ac5f5bb51b61`) and `linux/arm64` (`sha256:d8c67fea020517e7237531103fd48510bbef41bf06e0748cea015ced41b203ff`) plus both attestation manifests |
| Published-image `/healthz` | Passed | Release workflow job `93234379420` pulled the published image and completed `Start and check health endpoint` successfully |

## Branch reconciliation evidence

| Branch | Historical tip | Reconciliation | Tree effect |
| --- | --- | --- | --- |
| `feat/settings-general-boundaries` | `6ef9920b33060c834a578ef6bf31bed8fde40910` | `b56f56d6dd89196ba978459c952823ec7b66eddc` using `merge -s ours --no-ff` | None; tree remained `5b1afa6c2386789ae58f1d31811bc488cd8ab044` |
| `docs/v3.4.1-release-closeout` | `65107bf8f37155e773bd8305c78856bdcb35df1f` | `c6fd414` using `merge -s ours --no-ff` | None; tree remained `5b1afa6c2386789ae58f1d31811bc488cd8ab044` |

After reconciliation, every local branch and every `origin/*` delivery branch is an ancestor of the release branch. Upstream development branches are intentionally excluded because they are not independent-repository delivery branches.

## Assumptions and defaults verification

| Assumption/default | Result | Evidence |
| --- | --- | --- |
| Screenshot defines hierarchy rather than a pixel-copy mandate | Confirmed | Final desktop view preserves the supplied order in the project theme and typography |
| Media and Network remain independent | Confirmed | `/settings/media` and `/settings/network` are distinct routes and links |
| About and Changelog remain independent | Confirmed | Identity/lineage fields and update/release-note fields are rendered by separate route components |
| General modules must not be lost | Confirmed | Service capacity and Batch tasks are rendered under `/settings/policies`; the 58-field DTO partition test still passes |
| No backend schema/API change is required | Confirmed | Backend source is unchanged; complete Go test/vet and Swagger no-drift checks pass |
| Historical unmerged branches are obsolete | Confirmed | Patch review showed superseded v3.4.1 version/dependency/docs state; ancestry-only merges left the accepted tree unchanged |
| Version consistency | Confirmed locally and remotely | `VERSION=v3.5.2`; README, release notes, E2E fixture, release helper, annotated tag, Release, and GHCR aliases agree |

## Push gate evidence

- First remote push occurred only after final local acceptance; remote release branch head was `3975014a4d77e00a2acdd3f703555020cbcdfc05`.
- Final synchronization base before delivery was `origin/main=cfd25a99133537a8b7a10bfad84432938de520b6`.
- PR #52 passed 15 check runs, including the complete CI matrix and CodeQL, before merge.
- Merge commit `3db29d6b5b5bb9b8d55ed3a607c094509106776b` retains both the previous `main` and accepted delivery branch as parents.
- Final verification includes frontend complete quality gates; Chromium 81/81; WebKit 25/25; authoritative CI Firefox/container gates; Go test/vet; Swagger, Markdown, workflow, secret, diff, and conflict scans; Release/GHCR/health proof.

## Deviations from plan

- The first full four-worker Chromium matrix exposed Windows-host timing contention, not product failures. Multi-navigation E2E cases were decomposed to single-purpose checks, explicit 60-second test budgets were applied to expensive accessibility/navigation flows, and the authoritative final matrix passed 81/81 with two workers.
- Local Firefox continues to fail before application page creation with the previously observed Playwright host/runtime error. WebKit and Chromium are green, and GitHub CI remains required for Firefox.
- Docker is unavailable locally, so container configuration and image health evidence comes from required CI and the successful release workflow.
- Release workflow attempt 1 waited for the protected environment from 2026-08-07 until 2026-08-09; the one-day digest artifacts expired before `Publish final tags`. The workflow was rerun in full, all three approval rounds were completed promptly, and attempt 2 passed without changing source, tag, or Release identity.

## Unresolved and follow-up work

- No release-blocking work remains.
- `.claude/` and `.gomodcache/` remain intentionally untracked and must not be committed.

## Rollback

Before publication, revert or abandon the plan branch. After publication, keep `v3.5.2` immutable and deploy the verified `v3.5.1` image while preparing a corrective release.

## Final acceptance

- [x] Implementation matches the accepted local scope.
- [x] Local checks and security review are complete.
- [x] All independent delivery branches are represented in the release-branch ancestry without stale tree changes.
- [x] Local repository state is clean except the two intentional untracked directories.
- [x] The plan index is updated.
- [x] Remote PR and CI are complete.
- [x] `v3.5.2` Release and GHCR publication are verified.
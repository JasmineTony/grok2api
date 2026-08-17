# Iteration result: Provider client versions and account action parity

- Date completed: 2026-08-17
- Status: Complete
- Base commit: `a7f9736b4654f93eef9e0c61c6d7d50f87e58371`
- Upstream checkpoint commit: `043dc8bf6aba31bf495d87dce231989c82488ae6`
- Upstream merge commit: `6cab366f8401a1d5a995a334414f3050c2523300`
- Implementation commit: `dd6e6aea18856a8d7416b0a48125efd4a65764a1`
- Final commit: Documentation closeout after implementation commit `dd6e6aea18856a8d7416b0a48125efd4a65764a1`
- Pull request: `https://github.com/JasmineTony/grok2api/pull/new/fix/upstream-architecture-performance-20260817`

## Delivered

- Merged upstream `v3.1.3` commit `57746fc70289fcbab4bf33db33c521cf756ebbb9` with a true two-parent merge. The merge parents are checkpoint `043dc8bf6aba31bf495d87dce231989c82488ae6` and upstream `57746fc70289fcbab4bf33db33c521cf756ebbb9`.
- Resolved 11 merge conflicts semantically while preserving the split frontend, localized quota presentation, account failure state machine, batched quota loading, Anthropic thinking deltas, and fork security boundaries.
- Combined upstream reasoning-aware throughput calculations, paid Build shared-model support, Web tier-specific image-edit quota behavior, reasoning-start SSE observation, media regression coverage, and dashboard/rollup generation-window fixes with the fork architecture.
- Compared Build, Web, and Console provider request implementations against upstream `v3.1.3`. Build uses `1.0.4` and `grok-shell/1.0.4 (linux; x86_64)`; Web uses the Chrome 146 browser identity and current Connect headers; Console uses the upstream DPoP and usage contracts and has no separate SDK-version header.
- Normalized historical official Build client metadata from YAML and persisted runtime settings to the current reviewed defaults while preserving explicitly customized client identities.
- Corrected the account egress filter request contract from unsupported `assigned`/`unassigned` values to backend-supported `bound`/`unbound` values and made the frontend contract type-safe.
- Audited the complete administration request chain for all requested Build, Web, and Console actions. No other method, path, payload, field-name, single/batch routing, or response-contract drift was found.

## Account action audit

| Provider | Actions reviewed | Result |
| --- | --- | --- |
| Grok Build | Enable, disable, detection, billing/quota synchronization, quota reset, credential refresh, proxy policy, deletion, Device OAuth, SSO import | Frontend methods, paths, bodies, SSE handling, backend routes, and provider calls match the current contracts. |
| Grok Web | Enable, disable, conversion to Build/Console, account tools, quota synchronization, proxy policy, deletion, SSO import | Frontend and backend contracts match; terms, birthday, NSFW, script, conversion, and quota operations use the upstream-compatible provider requests. |
| Grok Console | Enable, disable, quota synchronization, proxy policy, deletion, SSO import | Frontend and backend contracts match; Console DPoP token, protected request, retry, and usage behavior match upstream. |
| Shared account list | Egress assignment filtering | Fixed confirmed HTTP 400 cause by sending `bound`/`unbound` instead of `assigned`/`unassigned`. |

## Verification results

| Check | Result | Notes |
| --- | --- | --- |
| Upstream baseline | Passed | Upstream `v3.1.3` is `57746fc70289fcbab4bf33db33c521cf756ebbb9`; merge commit `6cab366f8401a1d5a995a334414f3050c2523300` records exact ancestry. |
| Merge state | Passed | `git diff --name-only --diff-filter=U` returned no paths. |
| Build registry baseline | Passed | `npm view @xai-official/grok dist-tags version time --json` reported stable `latest`/`version` `1.0.4`; alpha `1.0.5` was not promoted into the stable default. |
| Focused backend tests | Passed | `go test ./internal/infra/config ./internal/application/settings` and the merge-sensitive gateway, relational, and inference packages passed. |
| Full backend tests | Passed | `go test ./...` passed with Go 1.26.6 and repository-local caches. |
| Backend static analysis | Passed | `go vet ./...` passed. |
| Frontend formatting and types | Passed | Prettier check and `tsc -b` passed using repository-local binaries. |
| Frontend lint and tests | Passed | ESLint passed; Vitest passed 22 files and 79 tests with coverage. |
| Frontend production build | Passed | Vite built 3,838 modules and completed the production build. |
| Frontend policy audits | Passed | Performance summary, Lucide imports, UI symbols, bundle budgets, 103-chunk acyclic graph, admin API contracts, architecture audit, and source audit passed. |
| Unused code and duplication | Passed | Knip found no unused exports or dependencies; only the existing `.css` configuration hint remained. JSCPD reported 10 existing clones, 0.47% duplicated lines, and 0.43% duplicated tokens. |
| Patch cleanliness | Passed | `git diff --check` and `git diff --cached --check` passed; generated Go caches were removed before commit. |

## Assumptions and defaults verification

| Assumption/default | Result | Evidence |
| --- | --- | --- |
| Latest upstream is the protocol reference | Verified | Provider implementations were compared with exact upstream commit `57746fc70289fcbab4bf33db33c521cf756ebbb9`. |
| Stable Build client is preferred over prerelease | Verified | The direct registry query reported stable `1.0.4` and alpha `1.0.5`; the default remains stable `1.0.4`. |
| Existing official metadata should advance | Verified | Historical official version/UA pairs are normalized at file-load and persisted-settings boundaries. |
| Explicit custom identities must remain intact | Verified | Custom Build UA/version pairs are preserved and covered by focused tests. |
| Provider clients explain database-only actions | Rejected | Enable, disable, edit, and delete use administration/database paths; their contracts were audited separately from provider calls. |
| Shared egress policy lookup requires a code change | Not demonstrated | The downstream lookup was reviewed, but no migration, query, or permission failure evidence justified weakening its isolation behavior. |

## Push gate evidence

- First remote push occurs only after this result, Markdown audit, clean worktree review, and remote branch comparison pass.
- Final synchronization base: upstream `v3.1.3` commit `57746fc70289fcbab4bf33db33c521cf756ebbb9`, merged by `6cab366f8401a1d5a995a334414f3050c2523300`.
- Final verification run: full backend tests/vet and the complete direct frontend verification sequence passed before documentation closeout.

## Deviations from plan

- The global pnpm wrapper recursively attempted to install pnpm and failed under the Windows job object. Verification used the repository-local `.cmd` binaries in the same required order instead; product code was not changed for this environment-only failure.
- Live provider OAuth/SSO acceptance was not attempted because no authorized test credentials were supplied. Repository request contracts, provider metadata, mocked behavior, and build/test gates were verified without exposing secrets.

## Unresolved and follow-up work

- Live Build Device OAuth and Build/Web/Console SSO imports remain conditional on an authorized provider account and credential-safe acceptance environment.
- Docker smoke image creation can still encounter transient Docker Hub `502 Bad Gateway` responses; that registry availability failure is independent of this source change.
- If deployed logs show `account_egress_policies` migration or query failures, diagnose the database/migration state before changing the shared egress policy gate.

## Rollback

Revert implementation commit `dd6e6aea18856a8d7416b0a48125efd4a65764a1` and merge commit `6cab366f8401a1d5a995a334414f3050c2523300` in reverse order if the complete iteration must be removed. No schema or persistent-data migration is included.

## Final acceptance

- [x] Implementation matches the accepted scope.
- [x] Checks and security review are complete.
- [x] Repository state is clean and documented.
- [x] The plan index is updated.

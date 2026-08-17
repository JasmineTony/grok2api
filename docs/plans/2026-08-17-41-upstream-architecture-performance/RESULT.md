# Iteration result: Upstream architecture and performance convergence

- Date completed: 2026-08-17
- Status: Complete
- Initial commit: `5cafe69cc772f7ba7cfbb1d0ee354236cc40aa9e`
- Reviewed upstream main: `f42ba1765fa520c6a587387daf8b22612168b397`
- Final implementation commit: `893ce52d84e5bf2c5fc95d737642c5507e39be1d`
- Delivery tip before this documentation update: `031301ceb4c2e9f34c7786ca1f530ff10edeacf7`
- Pull request: Not created; compare page is ready

## Delivered

- Reconciled the seven upstream commits after `f06d6fe7`: current Web image-edit `mediaGenInput` payloads, exact `fileMetadataId` attachment references, Imagine model/product mapping, Basic 720p video entitlement, quota reset prediction, model-route alias reconciliation, and soft cooldown failure baselines.
- Added quota-aware Web tier ordering so Basic accounts are admitted only for the confirmed 720p video product while paid video products retain Super/Heavy isolation.
- Separated media inspection from media content reads with `MediaObjectStorage.Stat`, `InspectVideo`, and `InspectInputAsset`.
- Changed video status polling and input preflight to inspect metadata/object existence without opening a body; content paths still open directly after metadata validation.
- Centralized Accounts query keys and extracted the invalidation hook. Account mutations now invalidate list, summary, state-event, deletion-preview, cleanup-preview, egress-policy, and audit-filter families without broad duplicate prefix invalidation.
- Updated frontend API documentation strings for current Web image models and direct `num_generations` mapping.
- Added focused regression coverage for image-edit protocol shape, model/quota mapping, cooldown persistence, media inspection/open separation, and account query-key families.

## Verification results

| Check                                 | Result | Evidence                                                                              |
| ------------------------------------- | ------ | ------------------------------------------------------------------------------------- |
| Focused backend tests                 | Passed | Gateway, media, local storage, Web provider, and relational model packages            |
| Backend full tests                    | Passed | `go test ./...` with Go 1.26.6 toolchain                                              |
| Backend static analysis               | Passed | `go vet ./...`                                                                        |
| Frontend tests                        | Passed | 22 files, 78 tests                                                                    |
| Frontend typecheck                    | Passed | `tsc -b`                                                                              |
| Frontend lint                         | Passed | ESLint, zero warnings                                                                 |
| Frontend production build             | Passed | Vite transformed 3,838 modules                                                        |
| Frontend Knip                         | Passed | No unused-export failure; only existing `.css` configuration hint                     |
| Frontend code/architecture/API audits | Passed | 0 frozen/regression findings; 112 calls, 109 contracts, 15 route groups, 0 unresolved |
| Bundle/chunk/icon/UI-symbol checks    | Passed | Budgets, acyclic 103-chunk graph, Lucide and UI-symbol audits                         |
| Duplication audit                     | Passed | 10 existing clones, 0.47% duplicated lines                                            |
| Formatting and diff hygiene           | Passed | Prettier check and final `git diff --check`                                           |

The first uncached backend run encountered one Windows SOCKS test connection abort; the test passed with `-count=10`, and the final uncached full backend test and vet pass completed successfully.

## Remote delivery

- Local branch: `fix/upstream-architecture-performance-20260817`.
- Remote branch: `origin/fix/upstream-architecture-performance-20260817`.
- Remote branch SHA before this documentation update: `031301ceb4c2e9f34c7786ca1f530ff10edeacf7`.
- Push verification: `git ls-remote` returned the same SHA for `refs/heads/fix/upstream-architecture-performance-20260817`.
- Authentication: GitHub OAuth device authorization completed as `JasmineTony`; HTTPS push used Git's OpenSSL transport.
- Pull request URL: `https://github.com/JasmineTony/grok2api/pull/new/fix/upstream-architecture-performance-20260817`.

## Deviations

- Upstream cosmetic quota labels/layout were not copied when they would regress the fork's localized UI; functional quota modes and protocol semantics were integrated.
- The upstream changes were applied semantically to the fork's existing architecture rather than replacing fork-specific files or creating a merge commit.
- The implementation branch is pushed; no release, tag, merge, or deployment side effect is included.

## Unresolved and follow-up work

- Live OAuth/SSO/media provider acceptance still requires authorized test accounts and was not run.
- The large account application service and gateway/provider files remain candidates for a later use-case split; this iteration extracted only boundaries with measurable behavior/performance value.
- The current delivery branch is ready for a pull request; protected-branch merge and CI remain GitHub-side actions.

## Rollback

Discard or revert the iteration changes. No schema migration, credential change, persistent-data rewrite, or deployment side effect is included.

## Final acceptance

- [x] Implementation matches the accepted scope.
- [x] Focused and full verification passes.
- [x] Security and compatibility review is complete.
- [x] `RESULT.md` and the plan index are current.
- [x] Delivery branch was pushed and verified.
- [ ] Pull request was opened and merged.

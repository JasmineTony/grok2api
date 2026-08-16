# Iteration result: Restore Grok 4.5/4.6 multi-account failover after first-account model sync

- Date completed: 2026-08-16
- Status: Complete
- Base commit: `f53bbaae`
- Final implementation commit: `7e91e609`
- Pull request: branch `fix/new-model-capability-failover-20260816`

## Delivered

1. Combined and layered routing now carry each account's latest successful capability snapshot time and apply the same timestamp-aware Build fallback rule.
2. When a same-entitlement peer observes a model after another account's missing or older snapshot, that account remains an unknown fallback candidate instead of being treated as explicitly unsupported.
3. Equal or newer negative snapshots remain authoritative, and Build Super and non-Super accounts remain isolated from each other.
4. Model support counts include only explicit capability observations. Tier-scoped model projections now retain missing or stale same-entitlement fallback accounts while excluding accounts with newer negative snapshots.
5. Manual synchronization still queries only the first enabled account for each provider. The regression suite proves that a request receiving HTTP 502 from the first `grok-4.6` account retries a stale same-entitlement peer and succeeds in the same request.

## Verification results

| Check                                                          | Result  | Notes                                                                                                                            |
| -------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Targeted model, repository, selector, scope, and gateway tests | Passed  | Covers missing, stale, equal, and newer snapshots; entitlement isolation; combined/layered parity; and same-request 502 failover |
| `go -C backend test ./...`                                     | Passed  | Final run after fetching `origin/main`; all backend packages passed                                                              |
| `go -C backend vet ./...`                                      | Passed  | No findings                                                                                                                      |
| `pnpm --dir frontend verify`                                   | Passed  | Formatting, lint, type checks, tests, production build, bundle checks, and architecture audits passed                            |
| `git diff --check`                                             | Passed  | No whitespace errors                                                                                                             |
| Independent review                                             | Passed  | Final review found no correctness issues after two earlier review rounds were addressed                                          |
| PostgreSQL integration                                         | Not run | `TEST_POSTGRES_DSN` was not configured; shared SQLite tests passed and PostgreSQL SQL structure was reviewed                     |

An earlier full backend run had one unrelated timing failure in `TestQualityGuardProfileWritesAreSerialized`, where a concurrent profile create returned `qualityGuardConfigWriteFailed`. The test then passed 10 consecutive repetitions, and the final full backend run passed without recurrence.

## Review corrections

1. The first review found that fresh explicit negatives could be downgraded incorrectly, model support/tier projections disagreed with routing, and the plan record needed more detail. The implementation was changed to compare `last_success_at` strictly, count only explicit support, align model projections, and complete the plan.
2. The second review found that accounts with no successful capability snapshot were omitted from tier-scoped projection even though gateway routing treated them as unknown fallback. The SQL and regression test were updated to include the missing-snapshot case.
3. The final review found no remaining correctness issues in timestamp semantics, entitlement isolation, combined/layered parity, support counts, scope filtering, or 502 retry behavior.

## Assumptions and defaults verification

| Assumption/default                                                    | Result    | Evidence                                                                                                      |
| --------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------- |
| Manual sync remains first-account-only by `priority DESC, id ASC`     | Confirmed | Model service regression test verifies that the lower-priority account is not queried                         |
| `last_success_at` represents the current complete capability snapshot | Confirmed | Repository paths use the timestamp written by `ReplaceAccountCapabilities`                                    |
| Build Super classification remains billing-or-override based          | Confirmed | Routing and SQL use the existing `account.IsBuildSuper`-equivalent predicates                                 |
| Unknown regular Build accounts cannot inherit Super capability        | Confirmed | Repository and layered selector tests cover both isolation directions                                         |
| Existing 5xx retry behavior is unchanged                              | Confirmed | End-to-end gateway test restores the second candidate and observes first-account 502 followed by peer success |

## Push gate evidence

- The branch remained local through implementation, review, main synchronization, and final verification: Yes.
- Final synchronization base: `f53bbaae`; `origin/main` had not advanced when fetched on 2026-08-16.
- Final verification run: backend full test and vet, frontend full verify, and `git diff --check`, all passed before the first push.

## Deviations from plan

- No functional scope deviations. The timestamp-aware rule required aligning support counts and tier-scoped projections so administrative model visibility would not contradict gateway routing; this work was added to the accepted plan before closeout.

## Unresolved and follow-up work

- PostgreSQL integration tests remain to be executed in CI or another environment with `TEST_POSTGRES_DSN` configured. No PostgreSQL-only defect is currently known.

## Security notes

- No local mock certificates, private keys, tokens, account material, or unredacted logs were committed or copied into this record.
- Existing unrelated generated artifacts and caches were excluded from staging.

## Rollback

Revert implementation commit `7e91e609`. The change has no database migration, configuration change, or persistent data conversion; documentation closeout can be reverted separately if required.

## Final acceptance

- [x] Implementation matches the accepted scope.
- [x] Checks and security review are complete.
- [x] Repository state is clean apart from pre-existing untracked generated artifacts, which are documented and excluded.
- [x] The plan index is updated.

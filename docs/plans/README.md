# Project plans and iteration archive

This directory is the canonical home for project plans, implementation iterations, and their completion records.

## Required structure

Each iteration must use its own directory:

```text
docs/plans/
└── YYYY-MM-DD-NN-short-slug/
    ├── PLAN.md
    └── RESULT.md
```

- `PLAN.md` is created before implementation and records scope, exclusions, ordered work, verification, risks, and acceptance criteria.
- `RESULT.md` is completed before the iteration is declared finished and records delivered changes, commits/PRs, tests, deviations, unresolved work, and rollback guidance.
- Optional supporting records such as `DECISIONS.md`, `MIGRATION.md`, or diagrams must stay inside the same iteration directory.
- Never include credentials, private keys, tokens, personal secrets, or unredacted sensitive logs.

Templates are available in [`templates/`](./templates/).

## Project-level plan

- [Project plan](./PROJECT-PLAN.md)

## Iterations

| Iteration                                          | Plan                                                            | Result                                                              | State    |
| -------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------- | -------- |
| 2026-07-19 01 — Repository initialization          | [Plan](./2026-07-19-01-repository-initialization/PLAN.md)       | [Result](./2026-07-19-01-repository-initialization/RESULT.md)       | Complete |
| 2026-07-19 02 — Initial security hardening         | [Plan](./2026-07-19-02-initial-security-hardening/PLAN.md)      | [Result](./2026-07-19-02-initial-security-hardening/RESULT.md)      | Complete |
| 2026-07-20 03 — Release pipeline hardening         | [Plan](./2026-07-20-03-release-pipeline-hardening/PLAN.md)      | [Result](./2026-07-20-03-release-pipeline-hardening/RESULT.md)      | Complete |
| 2026-07-20 04 — Final acceptance                   | [Plan](./2026-07-20-04-final-acceptance/PLAN.md)                | [Result](./2026-07-20-04-final-acceptance/RESULT.md)                | Complete |
| 2026-07-20 05 — Plan documentation standard        | [Plan](./2026-07-20-05-plan-documentation-standard/PLAN.md)     | [Result](./2026-07-20-05-plan-documentation-standard/RESULT.md)     | Complete |
| 2026-07-20 06 — SSH agent and Chinese-first README | [Plan](./2026-07-20-06-ssh-agent-readme-simplification/PLAN.md) | [Result](./2026-07-20-06-ssh-agent-readme-simplification/RESULT.md) | Complete |
| 2026-07-20 07 — Reliability platform foundation    | [Plan](./2026-07-20-07-reliability-platform-foundation/PLAN.md) | [Result](./2026-07-20-07-reliability-platform-foundation/RESULT.md) | Complete |

| 2026-07-20 08 — Reliability platform roadmap completion | [Plan](./2026-07-20-08-reliability-platform-roadmap/PLAN.md) | [Result](./2026-07-20-08-reliability-platform-roadmap/RESULT.md) | Complete |
| 2026-07-21 09 — Remote branch maintenance | [Plan](./2026-07-21-09-remote-branch-maintenance/PLAN.md) | [Result](./2026-07-21-09-remote-branch-maintenance/RESULT.md) | Complete |
| 2026-07-21 10 — Exact upstream v3.0.6 sync | [Plan](./2026-07-21-10-upstream-v3.0.6-sync/PLAN.md) | [Result](./2026-07-21-10-upstream-v3.0.6-sync/RESULT.md) | Complete |

| 2026-07-21 11 — Chrome DevTools MCP performance | [Plan](./2026-07-21-11-chrome-devtools-performance/PLAN.md) | [Result](./2026-07-21-11-chrome-devtools-performance/RESULT.md) | Complete |

| 2026-07-21 12 — Frontend architecture, UI, build and v3.1.0 release | [Plan](./2026-07-21-12-frontend-architecture-ui-build-release/PLAN.md) | [Result](./2026-07-21-12-frontend-architecture-ui-build-release/RESULT.md) | Complete |

| 2026-07-22 13 — Release smoke remediation | [Plan](./2026-07-22-13-release-smoke-remediation/PLAN.md) | [Result](./2026-07-22-13-release-smoke-remediation/RESULT.md) | Complete |
| 2026-07-22 14 — Frontend governance and component foundation | [Plan](./2026-07-22-14-frontend-governance-component-foundation/PLAN.md) | [Result](./2026-07-22-14-frontend-governance-component-foundation/RESULT.md) | Complete |
| 2026-07-22 15 — Feature architecture and performance convergence | [Plan](./2026-07-22-15-feature-architecture-performance/PLAN.md) | [Result](./2026-07-22-15-feature-architecture-performance/RESULT.md) | Complete |
| 2026-07-23 16 — Upstream v3.0.7 sync and dependency policy | [Plan](./2026-07-23-16-upstream-v3.0.7-dependency-policy/PLAN.md) | [Result](./2026-07-23-16-upstream-v3.0.7-dependency-policy/RESULT.md) | Complete |
| 2026-07-23 17 — v3.1.1 release closeout | [Plan](./2026-07-23-17-v3.1.1-release-closeout/PLAN.md) | [Result](./2026-07-23-17-v3.1.1-release-closeout/RESULT.md) | Complete |

| 2026-07-26 18 - Upstream v3.0.8-hotfix.1/v3.0.9 sync and settings split | [Plan](./2026-07-26-18-upstream-v3.0.9-settings-split/PLAN.md) | [Result](./2026-07-26-18-upstream-v3.0.9-settings-split/RESULT.md) | Complete |

| 2026-07-26 19 - v3.2.0 release and upstream v3.0.9 closeout | [Plan](./2026-07-26-19-v3.2.0-release/PLAN.md) | [Result](./2026-07-26-19-v3.2.0-release/RESULT.md) | Complete |

## Push and PR gate

- The accepted PLAN.md is the delivery unit. Keep its branch local until all scope, tests and acceptance, and assumptions/defaults are complete.
- Local checkpoint commits are allowed; do not push partial implementation or create intermediate PRs.
- Complete RESULT.md and the final verification pass before the first push.

## Creating the next iteration

1. Determine the next sequence number for the date.
2. Copy both templates into a new iteration directory.
3. Finish `PLAN.md` before implementation starts.
4. Add the directory to the table above.
5. Keep `RESULT.md` current as verification and delivery are completed.

| 2026-07-27 20 - Exact upstream v3.0.10 sync | [Plan](./2026-07-27-20-upstream-v3.0.10-sync/PLAN.md) | [Result](./2026-07-27-20-upstream-v3.0.10-sync/RESULT.md) | Complete |

| 2026-07-27 21 - Immersive UI and settings parity | [Plan](./2026-07-27-21-immersive-ui-settings-parity/PLAN.md) | [Result](./2026-07-27-21-immersive-ui-settings-parity/RESULT.md) | Complete |

| 2026-07-27 22 - v3.3.0 release and delivery closeout | [Plan](./2026-07-27-22-v3.3.0-release/PLAN.md) | [Result](./2026-07-27-22-v3.3.0-release/RESULT.md) | Complete |

| 2026-07-29 23 - Upstream v3.0.11 sync, defect fixes, settings split, v3.4.0 | [Plan](./2026-07-29-23-upstream-v3.0.11-sync-v3.4.0/PLAN.md) | [Result](./2026-07-29-23-upstream-v3.0.11-sync-v3.4.0/RESULT.md) | Complete |
| 2026-08-01 24 - Settings general boundaries and v3.4.1 release | [Plan](./2026-08-01-24-settings-general-boundaries/PLAN.md) | [Result](./2026-08-01-24-settings-general-boundaries/RESULT.md) | Complete |
| 2026-08-05 25 - Upstream v3.1.0 integration and v3.5.0 release | [Plan](./2026-08-05-25-upstream-v3.1.0-v3.5.0/PLAN.md) | [Result](./2026-08-05-25-upstream-v3.1.0-v3.5.0/RESULT.md) | Complete |
| 2026-08-07 26 - Upstream v3.1.1 integration, dependency stabilization, review, and v3.5.1 release | [Plan](./2026-08-07-26-upstream-v3.1.1-v3.5.1/PLAN.md) | [Result](./2026-08-07-26-upstream-v3.1.1-v3.5.1/RESULT.md) | Complete |
| 2026-08-07 27 - Immersive UI, Lucide governance, and full-stack performance architecture audit | [Plan](./2026-08-07-27-immersive-performance-architecture/PLAN.md) | [Result](./2026-08-07-27-immersive-performance-architecture/RESULT.md) | Complete |

| 2026-08-07 28 - Upstream-aligned runtime settings UI and v3.5.2 release | [Plan](./2026-08-07-28-runtime-settings-ui-v3.5.2/PLAN.md) | [Result](./2026-08-07-28-runtime-settings-ui-v3.5.2/RESULT.md) | In progress |

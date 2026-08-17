# Project plans and iteration archive

This directory is the canonical home for project plans, implementation iterations, and their completion records.

## Required structure

Each iteration must use its own directory:

```text
docs/plans/
鈹斺攢鈹€ YYYY-MM-DD-NN-short-slug/
    鈹溾攢鈹€ PLAN.md
    鈹斺攢鈹€ RESULT.md
```

- `PLAN.md` is created before implementation and records scope, exclusions, ordered work, verification, risks, and acceptance criteria.
- `RESULT.md` is completed before the iteration is declared finished and records delivered changes, commits/PRs, tests, deviations, unresolved work, and rollback guidance.
- Optional supporting records such as `DECISIONS.md`, `MIGRATION.md`, or diagrams must stay inside the same iteration directory.
- Never include credentials, private keys, tokens, personal secrets, or unredacted sensitive logs.

Templates are available in [`templates/`](./templates/).

## Project-level plan

- [Project plan](./PROJECT-PLAN.md)

## Iterations

| Iteration                                           | Plan                                                            | Result                                                              | State    |
| --------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------- | -------- |
| 2026-07-19 01 鈥?Repository initialization          | [Plan](./2026-07-19-01-repository-initialization/PLAN.md)       | [Result](./2026-07-19-01-repository-initialization/RESULT.md)       | Complete |
| 2026-07-19 02 鈥?Initial security hardening         | [Plan](./2026-07-19-02-initial-security-hardening/PLAN.md)      | [Result](./2026-07-19-02-initial-security-hardening/RESULT.md)      | Complete |
| 2026-07-20 03 鈥?Release pipeline hardening         | [Plan](./2026-07-20-03-release-pipeline-hardening/PLAN.md)      | [Result](./2026-07-20-03-release-pipeline-hardening/RESULT.md)      | Complete |
| 2026-07-20 04 鈥?Final acceptance                   | [Plan](./2026-07-20-04-final-acceptance/PLAN.md)                | [Result](./2026-07-20-04-final-acceptance/RESULT.md)                | Complete |
| 2026-07-20 05 鈥?Plan documentation standard        | [Plan](./2026-07-20-05-plan-documentation-standard/PLAN.md)     | [Result](./2026-07-20-05-plan-documentation-standard/RESULT.md)     | Complete |
| 2026-07-20 06 鈥?SSH agent and Chinese-first README | [Plan](./2026-07-20-06-ssh-agent-readme-simplification/PLAN.md) | [Result](./2026-07-20-06-ssh-agent-readme-simplification/RESULT.md) | Complete |
| 2026-07-20 07 鈥?Reliability platform foundation    | [Plan](./2026-07-20-07-reliability-platform-foundation/PLAN.md) | [Result](./2026-07-20-07-reliability-platform-foundation/RESULT.md) | Complete |

| 2026-07-20 08 鈥?Reliability platform roadmap completion | [Plan](./2026-07-20-08-reliability-platform-roadmap/PLAN.md) | [Result](./2026-07-20-08-reliability-platform-roadmap/RESULT.md) | Complete |
| 2026-07-21 09 鈥?Remote branch maintenance | [Plan](./2026-07-21-09-remote-branch-maintenance/PLAN.md) | [Result](./2026-07-21-09-remote-branch-maintenance/RESULT.md) | Complete |
| 2026-07-21 10 鈥?Exact upstream v3.0.6 sync | [Plan](./2026-07-21-10-upstream-v3.0.6-sync/PLAN.md) | [Result](./2026-07-21-10-upstream-v3.0.6-sync/RESULT.md) | Complete |

| 2026-07-21 11 鈥?Chrome DevTools MCP performance | [Plan](./2026-07-21-11-chrome-devtools-performance/PLAN.md) | [Result](./2026-07-21-11-chrome-devtools-performance/RESULT.md) | Complete |

| 2026-07-21 12 鈥?Frontend architecture, UI, build and v3.1.0 release | [Plan](./2026-07-21-12-frontend-architecture-ui-build-release/PLAN.md) | [Result](./2026-07-21-12-frontend-architecture-ui-build-release/RESULT.md) | Complete |

| 2026-07-22 13 鈥?Release smoke remediation | [Plan](./2026-07-22-13-release-smoke-remediation/PLAN.md) | [Result](./2026-07-22-13-release-smoke-remediation/RESULT.md) | Complete |
| 2026-07-22 14 鈥?Frontend governance and component foundation | [Plan](./2026-07-22-14-frontend-governance-component-foundation/PLAN.md) | [Result](./2026-07-22-14-frontend-governance-component-foundation/RESULT.md) | Complete |
| 2026-07-22 15 鈥?Feature architecture and performance convergence | [Plan](./2026-07-22-15-feature-architecture-performance/PLAN.md) | [Result](./2026-07-22-15-feature-architecture-performance/RESULT.md) | Complete |
| 2026-07-23 16 鈥?Upstream v3.0.7 sync and dependency policy | [Plan](./2026-07-23-16-upstream-v3.0.7-dependency-policy/PLAN.md) | [Result](./2026-07-23-16-upstream-v3.0.7-dependency-policy/RESULT.md) | Complete |
| 2026-07-23 17 鈥?v3.1.1 release closeout | [Plan](./2026-07-23-17-v3.1.1-release-closeout/PLAN.md) | [Result](./2026-07-23-17-v3.1.1-release-closeout/RESULT.md) | Complete |

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

| 2026-08-07 28 - Upstream-aligned runtime settings UI and v3.5.2 release | [Plan](./2026-08-07-28-runtime-settings-ui-v3.5.2/PLAN.md) | [Result](./2026-08-07-28-runtime-settings-ui-v3.5.2/RESULT.md) | Complete |
| 2026-08-10 29 - Project audit, release hardening, and v3.5.5 | [Plan](./2026-08-10-29-project-audit-v3.5.5/PLAN.md) | [Result](./2026-08-10-29-project-audit-v3.5.5/RESULT.md) | Complete |

| 2026-08-11 30 - Upstream v3.1.2 integration and v3.5.6 release | [Plan](./2026-08-11-30-upstream-v3.1.2-v3.5.6/PLAN.md) | [Result](./2026-08-11-30-upstream-v3.1.2-v3.5.6/RESULT.md) | Complete |

| 2026-08-12 31 - 页面布局优化与交互视觉改进 | [Plan](./2026-08-12-31-page-layout-optimization-v3.5.7/PLAN.md) | [Result](./2026-08-12-31-page-layout-optimization-v3.5.7/RESULT.md) | Complete |

| 2026-08-12 32 - Responsive administration layout and v3.6.0 release | [Plan](./2026-08-12-32-v3.6.0-layout-release/PLAN.md) | [Result](./2026-08-12-32-v3.6.0-layout-release/RESULT.md) | Complete |
| 2026-08-14 33 - Upstream main parity and administration defect remediation | [Plan](./2026-08-14-33-upstream-main-parity-defect-remediation/PLAN.md) | [Result](./2026-08-14-33-upstream-main-parity-defect-remediation/RESULT.md) | Complete |
| 2026-08-14 34 - Latest upstream integration and v3.6.1 release | [Plan](./2026-08-14-34-v3.6.1-release/PLAN.md) | [Result](./2026-08-14-34-v3.6.1-release/RESULT.md) | Complete |
| 2026-08-16 35 - Grok Build client version sync, accounts encoding fix, first-account model sync, and 502 remediation | [Plan](./2026-08-16-35-client-sync-encoding-fixes/PLAN.md) | [Result](./2026-08-16-35-client-sync-encoding-fixes/RESULT.md) | Complete |
| 2026-08-16 36 - Upstream parity merge, interface/code audit, and UI polish | [Plan](./2026-08-16-36-upstream-parity-code-audit-ui/PLAN.md) | [Result](./2026-08-16-36-upstream-parity-code-audit-ui/RESULT.md) | Complete |
| 2026-08-16 37 - Dashboard chart spacing fix and 502-vs-upstream diagnosis | [Plan](./2026-08-16-37-dashboard-spacing-502-diagnosis/PLAN.md) | [Result](./2026-08-16-37-dashboard-spacing-502-diagnosis/RESULT.md) | Complete |
| 2026-08-16 38 - Grok 4.5/4.6 stale-capability failover restoration | [Plan](./2026-08-16-38-new-model-capability-failover/PLAN.md) | [Result](./2026-08-16-38-new-model-capability-failover/RESULT.md) | Complete |
| 2026-08-17 39 - Gitleaks gateway test fixture correction | [Plan](./2026-08-17-39-gitleaks-test-fixture/PLAN.md) | [Result](./2026-08-17-39-gitleaks-test-fixture/RESULT.md) | Complete |
| 2026-08-17 40 - Account request parity and interface remediation | [Plan](./2026-08-17-40-account-request-parity/PLAN.md) | [Result](./2026-08-17-40-account-request-parity/RESULT.md) | Complete |
| 2026-08-17 41 - Upstream architecture and performance convergence | [Plan](./2026-08-17-41-upstream-architecture-performance/PLAN.md) | [Result](./2026-08-17-41-upstream-architecture-performance/RESULT.md) | Complete |

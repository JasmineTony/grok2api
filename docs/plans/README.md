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

| Iteration | Plan | Result | State |
| --- | --- | --- | --- |
| 2026-07-19 01 — Repository initialization | [Plan](./2026-07-19-01-repository-initialization/PLAN.md) | [Result](./2026-07-19-01-repository-initialization/RESULT.md) | Complete |
| 2026-07-19 02 — Initial security hardening | [Plan](./2026-07-19-02-initial-security-hardening/PLAN.md) | [Result](./2026-07-19-02-initial-security-hardening/RESULT.md) | Complete |
| 2026-07-20 03 — Release pipeline hardening | [Plan](./2026-07-20-03-release-pipeline-hardening/PLAN.md) | [Result](./2026-07-20-03-release-pipeline-hardening/RESULT.md) | Complete |
| 2026-07-20 04 — Final acceptance | [Plan](./2026-07-20-04-final-acceptance/PLAN.md) | [Result](./2026-07-20-04-final-acceptance/RESULT.md) | Complete |
| 2026-07-20 05 — Plan documentation standard | [Plan](./2026-07-20-05-plan-documentation-standard/PLAN.md) | [Result](./2026-07-20-05-plan-documentation-standard/RESULT.md) | Complete |
| 2026-07-20 06 — SSH agent and Chinese-first README | [Plan](./2026-07-20-06-ssh-agent-readme-simplification/PLAN.md) | [Result](./2026-07-20-06-ssh-agent-readme-simplification/RESULT.md) | Complete |

## Creating the next iteration

1. Determine the next sequence number for the date.
2. Copy both templates into a new iteration directory.
3. Finish `PLAN.md` before implementation starts.
4. Add the directory to the table above.
5. Keep `RESULT.md` current as verification and delivery are completed.

# Iteration plan: durable plan documentation standard

- Date: 2026-07-20
- Owner: JasmineTony
- Status: Complete
- Base commit: `7a168bef45ab8d7cc7b2e9cd3d1f7f74a8007a04`

## Objective

Persist every known project plan and implementation iteration as Markdown in a predictable project directory, and make the same requirement mandatory for future iterations.

## Scope

1. Create the canonical `docs/plans/` directory.
2. Add a project-level plan and an indexed iteration archive.
3. Reconstruct the repository initialization, initial hardening, release hardening, and final acceptance plans and results.
4. Add reusable plan and result templates.
5. Add repository instructions that require future agents and maintainers to create the corresponding iteration directory and documentation.
6. Link the plan archive from the main READMEs.

## Directory rule

Every future iteration must use:

```text
docs/plans/YYYY-MM-DD-NN-short-slug/
├── PLAN.md
└── RESULT.md
```

Supporting design, migration, and decision records must remain in the same iteration directory.

## Acceptance criteria

- [x] All known iterations are represented by `PLAN.md` and `RESULT.md`.
- [x] The plan index links to every record.
- [x] Templates exist for future work.
- [x] Repository-level instructions make the policy mandatory.
- [x] No sensitive credential is copied into the archive.
- [x] Main READMEs link to the archive.

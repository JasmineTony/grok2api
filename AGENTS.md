# Repository instructions

## Plan and iteration records

Every implementation iteration in this repository must be documented under `docs/plans/`.

1. Before changing code or repository settings, create a dedicated directory named `YYYY-MM-DD-NN-short-slug`.
2. Put the intended scope, constraints, ordered work, tests, and acceptance criteria in that directory's `PLAN.md`.
3. After the iteration, add or update `RESULT.md` with commits, pull requests, verification output, deviations, unresolved items, and rollback notes.
4. Update `docs/plans/README.md` so the new iteration is discoverable.
5. Keep project-wide plans in `docs/plans/`; do not create ad-hoc plan files in the repository root.
6. If a plan is first agreed in chat or an issue, persist a faithful Markdown copy before or alongside implementation.
7. Security-sensitive values, credentials, tokens, private keys, and unredacted logs must never be copied into plan records.
8. A future agent must not declare an iteration complete until its `RESULT.md` and the plan index are current.

Use the templates in `docs/plans/templates/` for every new iteration.

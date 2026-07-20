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

## Push and pull request gate

1. Treat the currently accepted PLAN.md as the delivery unit. Do not push a branch or create an intermediate pull request for partial files, modules, checkpoints, or sub-phases.
2. Local checkpoint commits are allowed, but the plan branch stays local until every in-scope implementation item, test and acceptance criterion, and assumption/default check is complete.
3. After final local acceptance, synchronize with the latest main, run the complete verification suite, update RESULT.md, then push once and create the final pull request.
4. If CI fails, fix locally and push only the required final-plan corrections to the same branch; do not create additional partial-delivery branches.
5. Exceptions require a separate plan and explicit user approval, such as an urgent security fix or external validation that cannot be performed locally.

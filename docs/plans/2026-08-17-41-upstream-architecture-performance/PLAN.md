# Iteration plan: Upstream architecture and performance convergence

- Date: 2026-08-17
- Sequence: 41
- Owner: JasmineTony
- Status: Complete
- Initial commit: `5cafe69cc772f7ba7cfbb1d0ee354236cc40aa9e`
- Working branch: `fix/account-request-parity-20260817`

## Objective

Audit the latest upstream data and request contracts, then implement bounded frontend and backend architecture changes that remove confirmed protocol drift and avoid unnecessary requests or media body opens.

## Scope

- Review and integrate upstream through `f42ba1765fa520c6a587387daf8b22612168b397`.
- Preserve the independent frontend, API, security, routing, and persistence architecture while reconciling upstream behavior.
- Add a media metadata/existence inspection boundary for video status polling and local video input preflight.
- Centralize Accounts React Query keys and invalidate only the affected account query families.
- Add focused regression tests and run full frontend/backend verification.
- Record analysis, implementation evidence, unresolved items, and rollback guidance.

## Out of scope

- Live OAuth, SSO, media generation, or quota calls using real credentials.
- Database schema migrations or destructive data rewrites.
- Whole-file splitting based only on line count.
- Release, tag, GHCR publication, remote push, or pull request without a separate user request.

## Ordered work

1. Reconcile the seven upstream media, catalog, quota, and cooldown commits.
2. Resolve merge conflicts without replacing fork-specific architecture or security behavior.
3. Add explicit media inspection operations below the gateway boundary.
4. Replace status/preflight body opens with metadata and object-existence inspection.
5. Introduce typed Accounts query-key factories and precise invalidation helpers.
6. Add focused tests for upstream contracts, media inspection, and query-key separation.
7. Run targeted tests, full tests, static analysis, architecture/API audits, builds, and diff hygiene.
8. Complete `RESULT.md` and the iteration index.

## Constraints

- Never log or persist OAuth codes, SSO tokens, cookies, API keys, or provider credentials.
- Maintain route, payload, response, error, quota, and cooldown compatibility with reviewed upstream behavior.
- Preserve media expiry and object-existence checks when avoiding content opens.
- Keep content download paths on the existing `OpenVideo` and `OpenInputAsset` APIs.
- Do not weaken authorization, client-key ownership, egress isolation, or audit finalization.

## Verification

- Upstream ancestry and changed-file review are recorded.
- Focused gateway/media/provider/model tests pass.
- `go test ./...` and `go vet ./...` pass.
- Frontend typecheck, lint, unit tests, build, Knip, code/architecture/API/duplication audits, bundle, chunk, icon, and UI-symbol checks pass.
- `git diff --check` passes.
- Final diff contains no secrets, generated artifacts, or unrelated changes.

## Risks and rollback

- Upstream integration can conflict with fork-specific routing or persistence changes; resolve each conflict semantically and retain both compatible behaviors.
- Media inspection must still detect missing files and expired temporary inputs; tests must cover these cases.
- Query-key changes can leave stale cache entries; all Accounts queries and cache writes in scope must use the centralized factory.
- Roll back by reverting the iteration changes; no schema or persistent-data migration is planned.

## Acceptance criteria

- [x] Upstream `f42ba176` is integrated and semantically reviewed.
- [x] Image edit, Imagine model, Web video quota, and cooldown changes are covered.
- [x] Video status polling no longer opens content bodies.
- [x] Video input preflight no longer opens content bodies.
- [x] Accounts mutations invalidate only the affected list, summary, state, preview, policy, and audit-filter families.
- [x] Focused and full verification passes.
- [x] `RESULT.md` and the plan index are current.

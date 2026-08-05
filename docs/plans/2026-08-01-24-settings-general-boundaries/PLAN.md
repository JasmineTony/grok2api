# Iteration plan: Settings general boundaries and v3.4.1 release

- Date: 2026-08-01
- Sequence: 24
- Owner: JasmineTony
- Status: Complete
- Scope extended: 2026-08-02 (v3.4.1 release requested after page acceptance)
- Base commit: `91c11a75fe164000b82e4c5b25ca51c35e279b55`
- Working branch: `feat/settings-general-boundaries`

## Objective

Split the remaining mixed general settings surface into explicit General, Runtime policies, and Account maintenance routes while preserving the upstream v3.0.11 settings contract, then publish the accepted page adjustment as independent release v3.4.1.

## Background

The current settings shell already isolates Build, Web, Console, Media, Network, About, and Changelog. The `/settings` route still combines the upstream Policies and Accounts domains. Upstream `v3.0.11@090104504b403d65675a01dab9c92b3a235ee832` remains the fetched upstream main/tag baseline at plan start. Fetching `origin` is currently blocked locally by SSH public-key authentication; no remote operation is attempted until that is restored.

## Scope

- Keep `/settings` as the compatible General page for service capacity and batch-task controls.
- Add `/settings/policies` for routing, audit, and client-key default controls.
- Add `/settings/accounts` for Build-forbidden reauthentication and account-cleanup controls.
- Preserve the same field paths, labels, validation, confirmation behavior, complete DTO save, shared form lifetime, dirty-form exit protection, lazy loading, and route prefetching.
- Add route/navigation/contract tests and update the plans index and result record.
- Set the independent repository version to `v3.4.1`, publish a stable GitHub Release, and verify the protected multi-architecture GHCR workflow.

## Out of scope

- No backend, database, OpenAPI, `/v1/*`, or `/api/admin/v1/*` changes.
- No dependency refresh, upstream tag push, force push, reset/clean operation, or change to the release workflow trigger/permissions.
- The only new version tag is `v3.4.1`; it is created from the final merged `main` after CI passes.
- No change to Build/Web/Console provider User-Agent, cookie, or network-scope isolation.

## Implementation steps

1. Record the plan and inspect the current/upstream settings grouping and field contract.
2. Extract service and batch controls into a General panel, and extract routing/audit/client-key controls into a Runtime policies panel.
3. Register lazy `/settings/policies` and `/settings/accounts` routes, prefetch handlers, navigation entries, and localized labels.
4. Extend route tests so every original General field is represented exactly once across General, Policies, and Accounts and shared-form navigation remains non-blocking inside settings.
5. Run focused TypeScript/tests first, then the complete frontend/backend/repository quality gates; document actual evidence in `RESULT.md` before any first push.
6. Update `VERSION`, current-version documentation, E2E release fixtures, and release notes to `v3.4.1`.
7. Push the completed plan branch once, merge its PR after required checks pass, then create and publish the annotated `v3.4.1` tag/Release from final `main`.
8. Verify amd64/arm64 image publication, provenance/SBOM, stable aliases, and published-image `/healthz` smoke.

## Security and compatibility constraints

- Do not expose secrets or change sensitive field write-only/redaction behavior.
- Preserve revision-aware full-DTO updates so partial settings pages cannot overwrite sibling values.
- Keep dangerous unlimited-retry and account-cleanup confirmations intact.
- Do not use module-level mutable business state, direct `fetch`, direct `localStorage`, dangerous execution APIs, or unhandled async errors.

## Verification

- Frontend: format, typecheck, lint, unit coverage, build, icon/UI-symbol, bundle/chunk, architecture/code/duplicate/unused audits, and browser E2E.
- Backend: `go test -p 1 ./...`, `go vet ./...`, `govulncheck`, and Swagger no-drift verification.
- Repository: `git diff --check`, UTF-8/Markdown plan-link checks, conflict/sensitive-pattern scans, actionlint, Gitleaks, Hadolint, and Compose validation.
- Release: tag equals `VERSION`, tag commit is on final `main`, Release workflow and published-image smoke succeed.

## Risks and rollback

- Risk: a route split can omit a form field or accidentally remount form state. Prevent with explicit field-partition tests and the existing shell-level `FormProvider`.
- Rollback: revert this iteration's commits; no data migration or API behavior changes are involved. A published tag is immutable; rollback deployment by pinning the verified `v3.4.0` digest and issue a later corrective version rather than moving `v3.4.1`.

## Delivery and push gate

- This PLAN.md is the delivery unit. Keep the branch local until scope, verification, acceptance criteria, and assumptions/defaults are complete.
- Local checkpoint commits are allowed; do not create partial remote branches or intermediate pull requests.
- Record the final synchronization and verification pass before the first push.

## Assumptions and defaults

- `/settings` remains a stable editable URL and is not redirected.
- The upstream grouping is mapped as: Build/Web/Console remain dedicated pages; Delivery remains Media and Network; Policies and Accounts become dedicated pages.
- If `origin` SSH authentication is still unavailable after local acceptance, record the block rather than bypassing the normal push gate.
- `v3.4.1` is a patch release for the settings information-architecture change; no routine dependency update is included.

## Acceptance criteria

- [ ] General, Runtime policies, and Account maintenance have dedicated editable routes with no field omission or duplication.
- [ ] Shared form state and full compatible DTO saving are preserved across all settings subroutes.
- [ ] Navigation, lazy loading, prefetch, localization, and tests include the two new routes.
- [ ] Required local checks pass or any environmental block is documented precisely.
- [ ] Documentation is updated and `RESULT.md` is complete before a first push.
- [ ] `VERSION`, release notes, tag, GitHub Release, and GHCR aliases consistently identify `v3.4.1`.
- [ ] Published multi-architecture images and `/healthz` smoke are verified.
- [ ] The plan branch has not been pushed before final acceptance.

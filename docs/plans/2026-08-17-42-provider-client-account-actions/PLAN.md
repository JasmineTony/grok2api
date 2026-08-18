# Iteration plan: Upstream v3.1.3 merge and provider client parity

- Date: 2026-08-17
- Sequence: 42
- Owner: JasmineTony
- Status: Complete
- Base commit: `a7f9736b4654f93eef9e0c61c6d7d50f87e58371`
- Working branch: `fix/upstream-architecture-performance-20260817`

## Objective

Merge upstream `v3.1.3` into the independent branch with a true merge commit, resolve conflicts semantically, and audit the current Grok Build, Grok Web, and Grok Console client identities and account-operation request contracts so every supported account action uses the current compatible method, path, payload, headers, response handling, and provider client version.

## Background

Iterations 40 and 41 restored onboarding compatibility and reconciled upstream media, quota, and cooldown behavior. Upstream has advanced from the shared ancestor to tag `v3.1.3` at `57746fc70289fcbab4bf33db33c521cf756ebbb9`. Operators still report request failures across existing-account actions, while the latest upstream returns normally. The suspected drift includes provider client versions or identities and the administration request chain from the split frontend through backend handlers and provider clients.

## Scope

- Merge and record upstream tag `v3.1.3` from the latest upstream `main` commit before implementation.
- Review every merge conflict and every changed-on-both file; preserve fork-specific behavior and security boundaries.
- Compare Grok Build, Grok Web, and Grok Console client versions, user agents, product identifiers, required headers, cookies, request bodies, endpoints, and response decoding with upstream.
- Audit Build enable, disable, detection, quota synchronization, quota reset, credential refresh, proxy configuration, and deletion.
- Audit Web enable, disable, conversion, account tools, quota synchronization, proxy configuration, and deletion.
- Audit Console enable, disable, quota synchronization, proxy configuration, and deletion.
- Trace each action through frontend mutation, administration route, handler/service, persistence, and provider request.
- Repair confirmed request-contract or client-version drift without replacing the independent frontend, API, security, routing, or persistence architecture.
- Add focused regression tests and update request-contract audit coverage.

## Out of scope

- Using or storing real OAuth codes, SSO tokens, cookies, account credentials, or proxy secrets.
- Destructive production data changes, live deployment, release, tag, or GHCR publication.
- Unrelated UI redesign or wholesale replacement with upstream frontend files.
- Declaring live provider acceptance without authorized test accounts and direct execution evidence.

## Implementation steps

1. Fetch latest origin and upstream references and record exact SHAs.
2. Create a true `v3.1.3` merge checkpoint and enumerate conflicts.
3. Resolve conflicts semantically, retaining split frontend/API/security behavior.
4. Build an action matrix for Build, Web, and Console from UI to provider.
5. Diff provider client identities and request builders against upstream.
6. Reproduce confirmed failures with focused contract tests or safe local mocks.
7. Centralize versioned provider client metadata and shared request invariants where appropriate.
8. Fix frontend/backend action contracts and provider-specific request behavior.
9. Run focused tests, full frontend/backend checks, audits, builds, and diff review.
10. Complete `RESULT.md` with evidence, deviations, unresolved items, and rollback notes.

## Security and compatibility constraints

- Never print, persist, or add fixtures containing usable provider credentials or session material.
- Preserve authorization middleware, account ownership checks, CSRF/origin protections, redaction, egress isolation, and failure classification.
- Match upstream protocol fields and behavior while retaining the independent split frontend and bounded backend architecture.
- Do not invalidate credentials for unknown proxy, DNS, timeout, or provider 5xx failures.
- Keep backward-compatible response parsing only where it is bounded, tested, and does not duplicate non-idempotent requests.

## Verification

- Exact upstream commit and changed-file review are recorded.
- Focused tests cover every corrected Build, Web, and Console account action.
- Frontend account API tests and administration route-contract audit pass.
- Frontend typecheck, lint, unit tests, production build, Knip, architecture, duplication, bundle, chunk, icon, and UI-symbol checks pass.
- Backend focused tests, `go test ./...`, and `go vet ./...` pass.
- `git diff --check` passes and no secret or generated artifact is added.

## Risks and rollback

- Provider versions can drift independently of repository releases; centralize reviewed defaults and make tests assert exact active metadata.
- Shared account-action helpers can accidentally erase provider-specific behavior; preserve typed provider boundaries and test each action independently.
- Some upstream operations may require live provider state; local tests must prove the repository contract, while live acceptance remains explicitly conditional.
- Roll back by reverting the iteration commit; no schema or persistent-data migration is planned.

## Delivery and push gate

- This `PLAN.md` is the delivery unit. Do not push additional iteration changes until all scope, tests, acceptance criteria, and assumptions/defaults are complete.
- Local checkpoint commits are allowed; do not create a partial pull request.
- Synchronize with the latest `main`, run the complete verification suite, complete `RESULT.md`, then push only the accepted plan result.

## Assumptions and defaults

- The latest upstream implementation is the compatibility reference for provider client identities and request contracts, subject to preserving the fork's security and architecture invariants.
- The merge must retain ancestry to `57746fc70289fcbab4bf33db33c521cf756ebbb9`; do not squash the upstream merge into a linear patch.
- Existing administration routes remain rooted at `/api/admin/v1`.
- Reported failures can be isolated with code comparison and safe mocked provider tests without exposing live credentials.
- The current branch already contains iterations 40 and 41 and their completed compatibility changes.

## Acceptance criteria

- [x] Upstream `v3.1.3` is merged with a true merge commit and exact ancestry is recorded.
- [x] Latest upstream and current branch provider metadata are compared by exact commit.
- [x] All listed Build, Web, and Console account actions have a documented request-chain audit.
- [x] Confirmed client-version and request-contract defects are fixed.
- [x] Regression tests cover every corrected action.
- [x] Required frontend and backend checks pass.
- [x] Security, consistency, and architecture review is complete.
- [x] Documentation and `RESULT.md` are current.
- [x] Assumptions and defaults are verified.

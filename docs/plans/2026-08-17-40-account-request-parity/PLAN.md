# Iteration plan: Account request parity and interface remediation

- Date: 2026-08-17
- Sequence: 40
- Owner: JasmineTony
- Status: Complete
- Initial base commit: `d04c5ef13a3c034326f7684201e5db0b214d1630`
- Final synchronized base: `5588f2232d035931ff1e78e7791d9f5f36b74980`
- Working branch: `fix/account-request-parity-20260817`

## Objective

Restore the Accounts page Grok Build OAuth, Grok Web SSO, and Grok Console SSO request flows by matching the current upstream request contracts, then audit and repair request-contract defects across the remaining administration pages.

## Background

The independent repository already contained upstream `main` commit `369de6fd648b695a70dfab1587cfa956bb4f5c83` when the iteration started, but all three account onboarding actions failed from the split frontend. The investigation preserves the independent frontend/API/security architecture while keeping routes, methods, payloads, response parsing, authentication, and error semantics compatible with upstream. Before final acceptance, upstream advanced to `f06d6fe79fd51b002b3a25b2f0be7532a455a298`; that delta was reviewed and only changes image-edit routing and quota fencing.

## Scope

- Compare the three Accounts onboarding flows with upstream handlers and request code.
- Verify frontend routes, HTTP methods, payloads, headers, response decoders, and asynchronous polling or streaming behavior.
- Audit frontend API calls on other administration pages against backend route registration and handler contracts.
- Fix confirmed contract mismatches without replacing the split frontend architecture.
- Add focused backend/frontend tests for each corrected request contract.
- Run review, contract-consistency checks, and applicable build/test gates.

## Out of scope

- Credential rotation, live account secrets, production database changes, and remote deployment.
- UI redesign unrelated to request correctness.
- Release, push, pull request, merge, tag, or GHCR publication without a separate delivery decision.

## Implementation steps

1. Map Accounts actions from UI event to frontend client, backend route, service, and upstream implementation.
2. Reproduce or test the failing request contracts and identify exact incompatibilities.
3. Build a frontend-request versus backend-route matrix for all administration pages.
4. Implement minimal compatibility fixes in the split architecture.
5. Add regression tests for corrected methods, paths, payloads, responses, and error handling.
6. Run frontend and backend focused tests, full builds, static checks, and diff review.
7. Record results, deviations, unresolved items, and rollback guidance.

## Security and compatibility constraints

- Never print or persist OAuth codes, SSO tokens, cookies, API keys, proxy credentials, or unredacted request logs.
- Preserve existing authorization middleware, CSRF/origin protections, and generic client-facing error messages.
- Keep upstream-compatible fields and behavior even when the frontend presentation differs.
- Do not restore upstream monolithic frontend files over the independent split frontend.
- Do not modify the original worktree or its in-progress iteration 39 files.

## Verification

- Focused Accounts API and handler tests cover Build OAuth, Web SSO, and Console SSO.
- Automated route-contract audit reports no unmatched frontend administration requests.
- Frontend typecheck, unit tests, lint, and production build pass.
- Backend targeted and full `go test` plus `go vet` pass.
- `git diff --check` passes and the final diff contains no credentials or unrelated files.

## Risks and rollback

- Upstream request behavior may depend on asynchronous device-flow state or provider availability; tests must validate local contracts without requiring real credentials.
- A shared HTTP-client fix can affect all pages; constrain changes with endpoint-specific tests and a full request-route audit.
- Roll back by reverting the iteration commit; no schema or persistent-data migration is planned.

## Delivery and push gate

- This PLAN.md is the delivery unit. Keep the branch local until scope, verification, acceptance criteria, and assumptions/defaults are complete.
- Local checkpoint commits are allowed; do not create partial remote branches or intermediate pull requests.
- Record the final synchronization and verification pass before the first push.

## Assumptions and defaults

- `upstream/main` at investigation start is `369de6fd648b695a70dfab1587cfa956bb4f5c83`; the final reviewed upstream baseline is `f06d6fe79fd51b002b3a25b2f0be7532a455a298`.
- The three failures are reproducible from request-contract inspection or local tests without exposing real account credentials.
- Backend administrative routes remain rooted at `/api/admin/v1`.
- Existing uncommitted iteration 39 changes in the original worktree are unrelated and remain untouched.

## Acceptance criteria

- [x] All three Accounts onboarding actions use backend-compatible request contracts.
- [x] Other administration-page requests have been audited and confirmed defects fixed.
- [x] Regression tests cover every corrected request contract.
- [x] Required frontend and backend checks pass.
- [x] Security and compatibility review is complete.
- [x] Documentation is updated.
- [x] Assumptions and defaults are verified.
- [x] `RESULT.md` is complete.
- [x] The plan branch was pushed only after final local acceptance.

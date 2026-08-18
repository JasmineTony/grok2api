# Iteration plan: Live account request root-cause verification

- Date: 2026-08-18
- Sequence: 44
- Owner: JasmineTony
- Status: Complete
- Base commit: `03d4cef294dbe999bbf73dcb51d9ca3a56bb4b7e`
- Final synchronization base: `4a2fd1a5d5ae8bb0065321816e6b3ae2e9a0a7b0`
- Working branch: `fix/upstream-architecture-performance-20260817`

## Objective

Reproduce the reported Grok Build, Grok Web, and Grok Console account-action failures with the three dated account exports, distinguish application defects from account or upstream failures, and fix every reproducible client/API contract defect.

## Background

The previous iteration preserved SSE application error status codes, but the deployed account page is still reported to return 502 or other failures for enable, disable, detection, quota, credentials, proxy, conversion, tools, and deletion actions. The test must therefore cover real frontend routes, backend handlers, provider clients, and live upstream responses rather than relying only on unit tests.

## Scope

- Compare the current branch with `fork/main`, `upstream/main`, and the integrated upstream client implementation.
- Import the three `*2026-08-17.json` account exports into an isolated disposable database.
- Exercise Grok Build, Grok Web, and Grok Console account actions and inference routes.
- Capture sanitized HTTP status, SSE event, application error code, and provider classification.
- Fix reproducible frontend, backend, provider-client, or error-mapping defects.
- Add regression coverage and run the complete repository verification suite.

## Out of scope

- Changing provider quotas, account eligibility, upstream rate limits, or blocked-account state.
- Persisting, printing, committing, or uploading account credentials and personal data.
- Modifying production databases, encryption keys, proxies, or live deployments.
- Completing interactive device authorization without explicit user interaction.

## Implementation steps

1. Audit repository state, upstream ancestry, account routes, and provider clients.
2. Create a local-only configuration and disposable SQLite database.
3. Import each account export through its matching HTTP endpoint.
4. Run the account-action and provider inference request matrices.
5. Trace every failure through frontend, transport, application, and provider layers.
6. Implement focused fixes and regression tests for confirmed defects.
7. Run backend, frontend, security, architecture, and repository cleanliness checks.
8. Remove every temporary credential-bearing artifact before delivery.
9. Synchronize with current `main`, document results, commit once, push, and verify the remote SHA.

## Security and compatibility constraints

- Never echo credential values, cookies, identity fields, raw request bodies, or unsanitized responses.
- Use a disposable database and repository-local temporary directory excluded from Git.
- Stop the local service and remove the temporary configuration, database, tokens, logs, and captures after testing.
- Preserve backward compatibility for SSE consumers that do not provide an explicit status field.
- Do not weaken security scans, fail-open proxy selection, or provider authentication validation.

## Verification

- Targeted backend transport/provider tests.
- Targeted frontend account-task API tests.
- `go test ./...`
- `go vet ./...`
- Frontend formatting, typecheck, lint, Vitest, production build, bundle, architecture, duplication, and unused-code audits.
- `git diff --check`
- Remote branch SHA parity after the final push.

## Risks and rollback

- Real credentials may trigger upstream refresh or quota calls; isolate storage, sanitize output, and remove all artifacts immediately after testing.
- Account-side rate limits may be confused with application defects; retain only status/code classifications and correlate them with server-side error types.
- Revert the iteration commits to restore the previous error-handling behavior; no persistent production data is changed.

## Delivery and push gate

- This PLAN.md is the delivery unit. Keep the branch local until scope, verification, acceptance criteria, and assumptions/defaults are complete.
- Local checkpoint commits are allowed; do not create partial remote branches or intermediate pull requests.
- Record the final synchronization and verification pass before the first push.

## Assumptions and defaults

- The three dated exports correspond to Build, Web, and Console respectively and remain structurally compatible.
- The local test host can reach the same provider endpoints used by the application.
- Provider quota or rate-limit responses are not remapped to 502 by the current client or UI.
- `fork/main` and the integrated upstream client contain no newer unmerged account-request contract.

## Acceptance criteria

- [x] All three account exports are imported into a disposable database.
- [x] Every listed account action is exercised or explicitly documented as interactive-only.
- [x] Every failure has a sanitized root-cause classification.
- [x] Confirmed client/API contract defects are fixed with regression tests.
- [x] Required checks pass, except the documented Windows race-detector environment limitation.
- [x] Temporary credentials and test artifacts are removed.
- [x] Documentation is updated.
- [x] Assumptions and defaults are verified.
- [x] `RESULT.md` is complete.
- [x] The plan branch has not been pushed before final acceptance.

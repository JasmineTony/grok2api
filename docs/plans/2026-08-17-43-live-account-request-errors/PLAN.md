# Iteration plan: Live account request error diagnosis

- Date: 2026-08-17
- Sequence: 43
- Owner: JasmineTony
- Status: Complete
- Base commit: `cd5ca92ad7da142a070ffe2597fadc03e359a5d1`
- Working branch: `fix/upstream-architecture-performance-20260817`

## Objective

Import the supplied Grok Build, Grok Web, and Grok Console account documents into an isolated local instance, exercise the account administration and inference request chains, distinguish provider/account failures from application defects, and correct confirmed error-reporting behavior without exposing credentials.

## Scope

- Read the three `*2026-08-17.json` account files from the adjacent local worktree without copying them into Git.
- Import each document into a disposable SQLite instance using the matching Build, Web, or Console endpoint.
- Test single-account, batch, all-account, conversion, Web account-tool, quota, refresh, detection, proxy-policy, deletion-preview, and inference paths.
- Record only redacted status, error-code, quota, and audit evidence.
- Fix confirmed frontend/backend request-contract or error-classification defects.
- Add focused backend and frontend regression tests.
- Remove the disposable database, credentials, response captures, and local configuration after verification.

## Constraints

- Never print or commit access tokens, refresh tokens, SSO tokens, cookies, client-key secrets, or account email addresses.
- Do not reuse or mutate a production database.
- Provider-side mutations are limited to already-established idempotent Web settings in the supplied account state.
- Do not reinterpret genuine provider quota or rate-limit responses as source defects.

## Verification

- All three imports reach a terminal `complete` event.
- Account management action results are recorded by status and safe error code.
- Build, Web, and Console inference routes are bound to the original imported account IDs before comparison.
- Focused backend and frontend tests pass.
- Full relevant frontend/backend checks pass.
- `git diff --check` and Markdown audit pass.
- Temporary plaintext and encrypted credential artifacts are deleted.

## Acceptance criteria

- [x] Local import and request matrix is complete.
- [x] Genuine provider/account failures are separated from application defects.
- [x] Confirmed defects are fixed with regression coverage.
- [x] Temporary credential-bearing artifacts are removed.
- [x] Documentation and verification evidence are complete.

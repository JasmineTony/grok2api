# 2026-08-18-41 Full Remediation

## Scope

Continue the account-audit remediation after iteration 40:

1. Add structured observability for account imports, bulk refreshes, Web Lite
   parser misses, WebSocket lifecycle, and billing reservations.
2. Add a safe Web Lite parser diagnostic path and regression fixtures using
   existing redacted protocol shapes only; do not guess a new upstream schema.
3. Add CI coverage for race/static checks and document the Windows/Linux
   prerequisite boundary.
4. Preserve all account JSON files, credentials, and existing provider
   behavior.

## Constraints

- Never copy credentials, tokens, cookies, or unredacted upstream payloads.
- Do not change the three user-provided `2026-08-17.json` files.
- Do not alter production account records or local audit databases.
- A parser behavior change requires a redacted fixture and a focused test.
- Existing metrics labels must remain bounded and identity-free.

## Ordered Work

1. Inspect current perfmetrics, HTTP metrics, account bulk logging, Web Lite
   parser diagnostics, WebSocket lifecycle, and GitHub Actions workflows.
2. Add a plan-local test/fixture strategy before implementation.
3. Add bounded metrics and structured events for the audited paths.
4. Add parser diagnostics and tests without changing successful parsing rules.
5. Update CI to run `go vet`, race tests on a Linux toolchain, and frontend
   verification.
6. Run backend/frontend tests, static checks, diff checks, and secret scans
   available on the host.
7. Record exact deviations and external fixture requirements in `RESULT.md`.

## Verification

- `go test ./... -count=1`
- `go vet ./...`
- Focused Web Lite, account, gateway, transport, and observability tests
- Frontend TypeScript, ESLint, Vitest, and Vite build
- `git diff --check`
- Inspect CI YAML for race/static/frontend gates

## Acceptance Criteria

- Audited operations expose bounded provider/operation/outcome metrics without
  account identity or credential material.
- Web Lite parser misses are diagnosable through an error code and metrics,
  while existing successful fixtures remain unchanged.
- CI contains a Linux race/static job and frontend verification.
- No secrets appear in source, plan records, fixtures, metrics, or logs.
- The unresolved external Web Lite schema is explicitly documented rather than
  guessed.

## Rollback

Revert only the files in this iteration. No database migration is required.

# 2026-08-18-40 Account Audit Fixes

## Scope

Implement the highest-confidence fixes discovered during the local account audit:

1. Route the documented `serve` CLI subcommand correctly.
2. Make administrator login rate limiting proxy-aware without trusting forwarded
   headers by default.
3. Harden WebSocket origins and reserve/settle streaming STT billing before/after
   WebSocket sessions.
4. Add focused regression tests and preserve the Web Lite image parser failure
   as an explicit unresolved protocol fixture requirement.

## Constraints

- Do not copy credentials, tokens, cookies, or unredacted upstream payloads.
- Do not change the three user-provided `2026-08-17.json` files.
- Do not alter account records or production configuration.
- Preserve the current default behavior when no trusted proxy is configured.

## Ordered Work

1. Inspect current CLI, server config, admin authentication, client-key billing,
   and voice WebSocket abstractions.
2. Add tests that fail before the implementation.
3. Implement the CLI dispatch fix.
4. Add an optional `server.trustedProxies` setting and use Gin's trusted
   `ClientIP` only when configured.
5. Reject cross-host WebSocket origins and add a bounded streaming STT billing
   reservation with idempotent settlement.
6. Run backend unit, race, and static checks; run frontend checks already
   available without pnpm bootstrap.
7. Record deviations and unresolved Web Lite protocol details in `RESULT.md`.

## Verification

- `go test ./... -count=1`
- `go test -race ./internal/application/gateway ./internal/transport/http/adminauth ./internal/cli`
- `go vet ./...`
- Frontend TypeScript, ESLint, Vitest, and Vite build through repository-local
  binaries.
- A local smoke test for `serve --config`, trusted-proxy IP behavior, and capped
  streaming STT billing.

## Acceptance Criteria

- `grok2api serve --config <path>` starts the same server as the flag-only form.
- Forwarded client IPs are honored only for configured trusted proxy networks.
- An STT WebSocket cannot create usage beyond a capped client-key billing limit
  without receiving a rate/billing rejection.
- Successful and failed WebSocket finalization cannot leak a billing reservation.
- No secret appears in source, tests, plan records, or logs.

## Rollback

Revert the implementation commit and remove the optional trusted-proxy setting.
No database migration is required. Restore the pre-test SQLite copy if a local
smoke test mutates it.

# 2026-08-18-47 Browser transport pool limits

## Scope

Complete the remaining P1 outbound connection-pool safeguard for Grok Web and
Grok Console browser transports.

1. Configure bounded `tls-client` transport pools for every cached browser
   client.
2. Limit total idle connections, idle connections per host, active connections
   per host, and idle lifetime.
3. Preserve browser TLS fingerprints, account isolation, proxy binding,
   Clearance state, and WebSocket dial behavior.
4. Keep the existing aggregate client-cache capacity and provider/account
   semaphores as independent outer bounds.

## Constraints

- Do not read, copy, or modify the three user-provided `2026-08-17.json`
  credential files.
- Use the installed `tls-client v1.15.1` native `WithTransportOptions` API.
- Do not replace the browser transport with Go's standard transport.
- Do not disable keep-alive or HTTP/2.

## Ordered Work

1. Define conservative browser transport limits and a testable options helper.
2. Apply the options during browser client construction.
3. Add focused tests for every configured bound.
4. Run focused/full backend tests, `go vet`, Markdown audit, and diff checks.

## Acceptance Criteria

- Browser transports have non-zero total/per-host idle and active connection
  limits plus an idle timeout.
- Existing browser profile and proxy construction tests continue to pass.
- No API, database, or persisted runtime-settings schema changes are required.
- All local verification gates pass.

## Rollback

Revert only the iteration 47 source, tests, and plan records. No database or
account-data rollback is required.

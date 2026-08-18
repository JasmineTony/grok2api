# 2026-08-18-46 Non-idempotent outer replay guard

## Scope

Close the remaining P1 high-traffic safety gap in the gateway account-failover
loop. The egress lease already stops transport-level proxy retries after
`httptrace.WroteRequest`; this iteration extends the same safety boundary to
the outer account traversal for Web and Console POST inference requests.

1. Treat upstream 5xx responses from non-idempotent Web/Console POST requests as
   indeterminate and return the original response without selecting another
   account.
2. Preserve existing account failover for explicit 402/403/429 classification,
   Build requests with the generated idempotency key, and local account-health
   handling.
3. Keep response body ownership and audit finalization unchanged.
4. Add focused unit tests for Web/Console 5xx stop behavior and Build replay
   compatibility.

## Constraints

- Do not read, copy, or modify the three user-provided `2026-08-17.json`
  credential files.
- Do not change provider-specific upstream protocol behavior.
- Do not disable account rotation for explicit quota or account-block signals.
- Do not retry any request after the response body has been consumed unless it
  is restored before the common finalization path.

## Ordered Work

1. Add a provider response replay-safety signal and a gateway helper that
   permits Build idempotent requests while blocking Web/Console 5xx outer
   replay.
2. Mark Build Responses adapter results as replay-safe when an idempotency key
   is present.
3. Gate the outer retry branch and preserve the original response path.
4. Add regression tests and run focused/full backend gates.

## Acceptance Criteria

- Web/Console POST 5xx responses are returned once and never trigger a second
  account lease.
- Build requests retain existing retry behavior because the same idempotency
  key is forwarded upstream.
- Web/Console 402/403/429 behavior remains unchanged.
- All local tests, `go vet`, Markdown audit, and diff checks pass.

## Rollback

Revert only the iteration 46 source, tests, and plan records. No database or
account-data rollback is required.

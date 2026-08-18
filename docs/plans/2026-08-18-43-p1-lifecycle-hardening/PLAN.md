# 2026-08-18-43 P1 Lifecycle Hardening

## Scope

Continue the unfinished P1 items from the account audit with changes that can
be proved locally:

1. Add reusable, fully redacted Web Lite stream fixtures for duplicate final
   cards and partial-only completion, without guessing a new upstream schema.
2. Normalize imported seed providers before deduplication and expose explicit
   provider-scoped import summaries while counting request-local duplicates as
   skipped.
3. Make Build OAuth failure classification code-first, redact extracted
   messages before persistence, and replace the fixed retry ladder with an
   exponential backoff whose `Retry-After` value is a lower bound.
4. Export billing settlement/queue observability and track reservation age
   samples without exposing account IDs, event IDs, or credentials.

## Constraints

- Do not read, copy, or modify the three user-provided `2026-08-17.json`
  credential files.
- Do not add a parser rule based on an unredacted or unverified live payload.
- Do not persist OAuth response bodies or messages containing tokens.
- Keep existing API fields backward compatible; new summary fields are
  additive.
- Keep Prometheus labels bounded to provider/operation/outcome/stage.
- No database schema migration in this iteration.

## Ordered Work

1. Add plan-local fixture files and parser regression tests.
2. Normalize import seeds, count skipped duplicates, and extend import SSE DTOs
   with provider-scoped summaries.
3. Add OAuth code/status classification tests and safe diagnostic normalization.
4. Add billing settle/writer-unavailable/queue-depth/age metrics and tests.
5. Run focused tests, full backend tests, `go vet`, frontend type/API checks
   if DTO types change, Markdown audit, and diff checks.
6. Record deviations and external prerequisites in `RESULT.md`.

## Acceptance Criteria

- Web Lite duplicate final URLs are emitted once; partial-only streams end in a
  bounded parser failure with no fabricated image URL.
- Import results identify the provider, count request-local duplicate seeds as
  skipped, and include `byProvider` details without changing old fields.
- `invalid_grant` is permanent regardless of status; temporary OAuth codes do
  not become permanent solely because of HTTP 400; persisted messages are
  redacted.
- Retry delay grows exponentially and never precedes a valid `Retry-After`.
- Billing metrics cover reserve, settle, cancel, cleanup, writer-unavailable,
  queue depth, and reservation age with low-cardinality labels.
- All local verification gates pass and account JSON files remain untouched.

## Rollback

Revert only the iteration 43 source, tests, fixture files, and plan records.
No account-data, credential, database, or configuration rollback is required.

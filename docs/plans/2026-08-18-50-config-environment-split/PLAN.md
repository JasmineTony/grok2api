# 2026-08-18-50 Config environment split

## Scope

Separate environment override parsing from YAML loading while preserving the
existing configuration contract and validation behavior.

1. Move `GROK2API_DATABASE_URL` parsing and PostgreSQL URL validation into a
   dedicated `environment.go` module.
2. Keep `Load` responsible for YAML decoding, path resolution, environment
   application orchestration, and final validation.
3. Preserve exact error messages and existing environment variable semantics.
4. Add focused tests for the extracted module boundary.

## Constraints

- Do not read, copy, or modify the three user-provided `2026-08-17.json`
  credential files.
- Do not change any configuration key, default, or runtime behavior.
- Do not expose environment secrets in logs or tests.

## Ordered Work

1. Extract environment functions and imports.
2. Add direct validation tests for accepted and rejected DSNs.
3. Run focused/full backend tests, `go vet`, Markdown audit, and diff checks.

## Acceptance Criteria

- `config.Load` behavior is unchanged.
- Environment parsing is testable without YAML or filesystem setup.
- All local verification gates pass.

## Rollback

Revert only the iteration 50 source, tests, and plan records. No database or
account-data rollback is required.

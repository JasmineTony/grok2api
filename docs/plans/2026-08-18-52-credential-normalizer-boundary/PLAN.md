# 2026-08-18-51 Credential normalizer boundary

## Scope

Separate persisted credential construction from the account service orchestration
so provider importers remain responsible for parsing provider-specific formats
while the application layer owns encryption, defaults, and identity metadata.

1. Move `Service.credentialFromSeed` into a dedicated account normalizer module.
2. Preserve provider fallback, `Provider + SourceKey` identity semantics, token
   encryption, Cloudflare cookie sanitization, and Build risk metadata behavior.
3. Add focused regression coverage for the extracted boundary.

## Constraints

- Do not read, copy, or modify the three user-provided `2026-08-17.json`
  credential files.
- Do not change database schema, public DTOs, or import protocol behavior.
- Do not expose credentials, cookies, or encrypted values in tests or logs.

## Ordered Work

1. Add `credential_seed.go` with the existing normalizer implementation.
2. Remove the duplicate implementation from `service.go`.
3. Run focused account tests, the full backend suite, `go vet`, Markdown audit,
   and patch checks.

## Acceptance Criteria

- `credentialFromSeed` has one implementation in the dedicated module.
- Existing import, device OAuth, conversion, and Web-to-Console sync tests pass.
- No public behavior or credential storage semantics change.

## Rollback

Revert only the iteration 52 source, tests, and plan records. No database or
account-data rollback is required.

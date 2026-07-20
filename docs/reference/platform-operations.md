# Platform operations

## Request policies

Management endpoints:

- /api/admin/v1/request-policies
- /api/admin/v1/request-policies/evaluate

Rules are ordered by priority and id. With no rules, requests remain allowed. dryRun=true records hits without blocking. Denials use the stable error code request_policy_denied.

## Upgrade preflight and backups

- GET /api/admin/v1/system/upgrade/preflight
- grok2api backup create <directory>
- grok2api backup verify <directory>
- grok2api backup restore <directory> <database>

SQLite uses a consistent snapshot. PostgreSQL and Redis are not presented as local full backups. backup.externalHook can point to an external executable; it is invoked without a shell as verify <database-driver> <runtime-driver>.

## Request snapshots and protocol preview

- POST /api/admin/v1/request-snapshots
- GET /api/admin/v1/request-snapshots/:id
- POST /api/admin/v1/request-snapshots/:id/replay
- POST /api/admin/v1/protocol/conversions/preview

Snapshots are disabled by default. When enabled they are redacted, compressed, encrypted with AES-256-GCM, limited to 256 KiB, and retained for 24 hours by default. Replay is dry-run only until a separate security review.

## CLI and MCP

The no-subcommand startup form remains compatible. Supported commands include serve, version, doctor, config validate/export/plan/apply, backup, egress check, and mcp serve.

MCP uses local stdio and is read-only. It must never return credentials, tokens, cookies, client keys, proxy passwords, or complete request bodies.

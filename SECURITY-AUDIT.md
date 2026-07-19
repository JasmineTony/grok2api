# Initial Security Hardening Audit

Audit date: 2026-07-19
Upstream baseline: `chenyme/grok2api@d74b15396686ae68b88c5a52e4e538d058c41d98` (`v3.0.5`)

## Scope

The audit covered backend tests and static analysis, reachable Go vulnerabilities, frontend lint/build and dependency advisories, media file durability on Windows, GitHub Actions permissions and dependency pinning, release behavior, documentation, and deployment defaults. Public APIs, configuration keys, database schemas, and the Go module path were intentionally kept unchanged.

## Confirmed findings and fixes

### 1. Reachable Go vulnerabilities

The initial `govulncheck` run reported reachable vulnerabilities in the local Go 1.26.1 standard library, `github.com/quic-go/quic-go@v0.59.0`, and `github.com/jackc/pgx/v5@v5.6.0`.

Remediation:

- require Go `1.26.5`, which includes the applicable standard-library security fixes;
- upgrade `quic-go` to `v0.59.1`;
- upgrade `pgx/v5` to `v5.9.2`.

The post-remediation scan reports zero vulnerabilities reachable from project code. One advisory remains in a required module, but `govulncheck` found no reachable call path.

### 2. Windows media upload durability failure

`LocalStore.CommitVideoUpload` reopened a completed temporary upload with a read-only handle before calling `os.File.Sync`. Windows implements this through `FlushFileBuffers`, which requires a writable handle and returned `Access is denied`. This caused video upload, deletion, and range-serving regression tests to fail on Windows.

Remediation:

- reopen the temporary upload with `os.O_RDWR` before syncing;
- retain the existing atomic hard-link/no-replace commit behavior.

The existing media application and HTTP tests now pass on Windows and cover the affected flows.

### 3. Workflow supply-chain and release exposure

The upstream workflows referenced mutable major-version tags and published GHCR images on every `main` push.

Remediation:

- pin every GitHub Action to an immutable commit SHA;
- reduce default permissions and grant write permissions only to the jobs that need them;
- verify backend, frontend, Swagger, vulnerabilities, and Docker builds on PRs and `main`;
- publish images only from explicit `v*.*.*` tags;
- publish `latest` only for non-prerelease version tags;
- add weekly Dependabot checks for Go, pnpm, and GitHub Actions.

## Verification results

- `go test ./...`: passed with Go 1.26.5.
- `go vet ./...`: passed.
- `govulncheck@v1.6.0 ./...`: zero reachable vulnerabilities.
- Swagger regeneration: no generated-document drift.
- `pnpm install --frozen-lockfile`: passed.
- `pnpm lint`: passed.
- `pnpm build`: passed.
- `pnpm audit --audit-level high`: no known vulnerabilities.
- `actionlint@v1.7.12`: passed.
- Docker: the local host has no Docker installation; amd64 and arm64 builds remain mandatory GitHub Actions checks.

## Deferred items

- No API, configuration, database, or Go module namespace migration was attempted.
- Upstream tags are not mirrored automatically.
- Broader architectural changes require separate pull requests and must preserve compatibility or include an explicit migration plan.

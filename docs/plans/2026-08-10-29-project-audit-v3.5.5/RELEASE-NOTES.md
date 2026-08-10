# Grok2API v3.5.5

## Project audit and release hardening

- Consolidated duplicated frontend runtime response validators so single-object and list decoders share one authoritative schema.
- Consolidated identical trusted-service URL validation while preserving internal HTTP and external HTTPS rules.
- Added an executable release-version consistency audit for `VERSION`, README, browser fixtures, release notes, and release-helper metadata.
- Reworked the GitHub release helper to derive the active branch and release notes from validated repository state instead of a previous release's hard-coded values.
- Failed pull-request merges now fail the helper process rather than printing a false-success result.
- GitHub Release creation now requires a remote annotated tag whose peeled commit matches both the local tag and `origin/main`.
- Release workflow preflight now rejects lightweight tags.
- Multi-architecture digest artifacts are retained for 14 days so protected-environment approvals cannot outlive the manifest inputs.
- Manifest publication now validates exactly two well-formed SHA-256 digest files and reports actionable diagnostics.

## Compatibility

- Public API routes and response contracts are unchanged.
- Configuration and database schemas are unchanged.
- The upstream-aligned runtime-settings routes and layout are unchanged.
- The Go module path remains `github.com/chenyme/grok2api/backend`.

## Container images

Use `ghcr.io/jasminetony/grok2api:v3.5.5` after the release workflow completes. The aliases `3.5.5`, `3.5`, `3`, and `latest` are expected to resolve to the same multi-architecture OCI index for `linux/amd64` and `linux/arm64`.

## Upgrade

No data migration is required. Back up configuration and persistent data as usual, then replace the running image or rebuild from this tag.

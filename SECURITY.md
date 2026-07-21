# Security Policy

## Supported versions

Security fixes are applied to the current `main` branch and the latest release produced by this repository. Historical upstream releases are not independently supported here.

## Reporting a vulnerability

Do not open a public issue for vulnerabilities, leaked credentials, authentication bypasses, or reports containing private deployment data. Use GitHub's **Report a vulnerability** form under the repository Security tab to open a private security advisory.

Include only the minimum information needed to reproduce the issue:

- affected commit or release;
- deployment mode and relevant sanitized configuration;
- reproduction steps and expected impact;
- logs with tokens, cookies, account identifiers, upstream credentials, proxy URLs, and client API keys removed;
- a proposed fix, if available.

Never submit working Grok credentials, session cookies, API keys, private SSH keys, database files, or production configuration. Rotate any credential that may have been exposed before submitting the report.

## Response process

Maintainers will acknowledge a complete report, validate it privately, prepare a compatibility-preserving fix where possible, and coordinate disclosure after a patched release is available. Reports that require a breaking API, configuration, or database change will be handled in a separate, explicitly documented release.

## Security boundaries

This project proxies third-party services and stores sensitive credentials. Operators remain responsible for access control, secret generation, encrypted backups, network exposure, provider terms, and applicable law. Production deployments should keep Swagger disabled, use strong bootstrap credentials, restrict the administration interface, and avoid logging request bodies or credentials.

## Additional controls

Request snapshots are disabled by default. When enabled, snapshots are redacted, compressed, encrypted, bounded to 256 KiB, and expire after the configured TTL. Actual replay is disabled until a separate security review.

External backup hooks are executed directly without a shell and receive only driver metadata. Do not put credentials in hook arguments or output. The local MCP server is read-only and must not return credentials, client API keys, proxy passwords, or complete request bodies.

# 2026-08-18-49 Observability stack assets

## Scope

Provide deployable Prometheus and Grafana assets for the P2 monitoring plan
without changing the default application deployment.

1. Add an optional Compose overlay for Prometheus and Grafana.
2. Add a Prometheus scrape configuration and bounded alert rules.
3. Add Grafana provisioning for the Prometheus data source and dashboard.
4. Cover account health, token refresh failures, Provider 429s, active
   WebSockets, billing reservation leaks, audit queue pressure, and physical
   upstream calls.
5. Document the required in-container metrics listener and exact commands.

## Constraints

- Do not read, copy, or modify the three user-provided `2026-08-17.json`
  credential files.
- Keep the observability profile disabled by default.
- Bind Prometheus and Grafana host ports to `127.0.0.1`.
- Do not persist credentials in repository configuration.
- Do not modify or delete the application data volume.

## Ordered Work

1. Add the Compose overlay and Prometheus configuration.
2. Add alert rules with conservative defaults.
3. Add Grafana provisioning and the operational dashboard.
4. Expand the observability reference documentation.
5. Validate Compose configuration, JSON/YAML syntax, Markdown, and repository
   diff checks.

## Acceptance Criteria

- The base Compose file remains unchanged and starts no monitoring containers.
- The optional overlay resolves with `docker compose config`.
- Grafana automatically provisions the Prometheus data source and dashboard.
- All requested operational risk areas have at least one panel or alert.
- No secret or external network exposure is introduced by default.

## Rollback

Remove only the iteration 50 observability assets and plan records. Existing
application configuration, containers, and data volumes are unaffected.

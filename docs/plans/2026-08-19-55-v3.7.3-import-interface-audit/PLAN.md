# Iteration plan: v3.7.3 account import, interface audit, and x.ai catalog sync

- Date: 2026-08-19
- Sequence: 55
- Owner: JasmineTony
- Status: Planned
- Base commit: `b9ba1190`
- Working branch: `release/v3.7.3-import-interface-audit-20260819`

## Objective

Import the three exported account credential files into a local development
service, audit every registered HTTP interface against that live account pool,
correct the interface and request defects the audit exposes, resynchronize the
model catalog metadata with the current x.ai documentation, refresh stale
project documentation, and publish v3.7.3.

## Background

`grok2api-grok-build-accounts-2026-08-17.json`,
`grok2api-grok-web-accounts-2026-08-17.json`, and
`grok2api-grok-console-accounts-2026-08-17.json` sit untracked in the
repository root. They are provider export files produced by
`GET /api/admin/v1/accounts/export` and contain plaintext access, refresh, and
SSO tokens. No `.gitignore` rule covered them, so any `git add -A` would have
committed live credentials.

The repository had no `config.yaml`, so no local service existed to audit
against. Release v3.7.1 closed out on 2026-08-19 and `VERSION` still reads
`v3.7.1`. The x.ai model table has been revised since the catalog metadata was
last reviewed, and the project's own `grok-4.3` entry already disagreed with its
`grok-4.20` entries on context-window size.

## Scope

- Create a local development `config.yaml` and import all three export files
  through the provider-specific admin import endpoints.
- Exercise every registered read-only admin interface plus the public
  OpenAI-, Anthropic-, and Codex-compatible surfaces against live accounts.
- Correct the `grok-4.20` family context-window metadata to match the official
  x.ai model table.
- Add `.gitignore` coverage for account credential exports and the remaining
  workspace tool caches.
- Verify pricing, reasoning-effort levels, `vad_threshold`, and `service_tier`
  against current x.ai release notes and record the outcome.
- Refresh `README.md`, `docs/reference/architecture-and-routing.md`, and the
  plan index; publish v3.7.3 release notes.

## Out of scope

- Adding `grok-4.6` to the Grok Console static catalog. Console model support
  cannot be discovered remotely and the shared upstream team is rate limited,
  so the route cannot be verified in this iteration.
- Changing `DefaultReasoningEffort` for `grok-4.3` and `grok-4.5`. The
  project-wide `prefer medium` policy is deliberate and altering it changes
  client billing.
- Implementing the x.ai Files API (`image_file_id`, `storage_options`). The
  compatibility layer already rejects `storage_options` with an explicit
  `unsupported_parameter` error.
- Recovering the expired Grok Build OAuth refresh tokens in the export file.

## Implementation steps

1. Generate development secrets, write `config.yaml` from `config.example.yaml`,
   build the backend, and start the service.
2. Import Build, Web, and Console exports through
   `POST /api/admin/v1/accounts/import`, `/accounts/web/import`, and
   `/accounts/console/import`; record created, synced, and failed counts.
3. Sweep every read-only admin interface and the public `/v1` surface, then
   issue live inference, error-path, and protocol-variant requests.
4. Classify each non-2xx result as by-design, upstream data state, or defect.
5. Correct the confirmed metadata defect and add the `.gitignore` rules.
6. Compare the catalog against the x.ai model table and release notes.
7. Bump the release-facing version literals and write the release records.
8. Run the backend, frontend, and repository verification suites.

## Security and compatibility constraints

- Credential export files, tokens, SSO values, and the development
  `credentialEncryptionKey` must never be committed or copied into plan records.
- `config.yaml` is already ignored; development secrets stay local.
- The context-window correction is metadata only and must not change routing,
  pricing, or reasoning-effort behavior.
- Release-facing version literals must satisfy `scripts/audit-release-version.py`.

## Verification

- `go test ./... -count=1`, `go vet ./...`, and `gofmt` report no new failures.
- `python scripts/audit-release-version.py` passes for `v3.7.3`.
- `node scripts/audit-markdown.mjs` passes over tracked Markdown.
- `git check-ignore` confirms all three credential exports are ignored.
- `GET /v1/models?client_version=1.0.4` reports a 1,000,000-token context window
  for every `grok-4.20` model.

## Risks and rollback

- Risk: a metadata change alters client behavior. Prevention: the field feeds
  only the Codex catalog response; no test pinned the previous value. Rollback:
  restore the three map entries.
- Risk: importing live credentials into a local database leaks tokens.
  Prevention: `/config.yaml`, `/data/`, and the new export rule are ignored.
- Risk: publishing a release that disagrees with release-facing literals.
  Prevention: the release-version audit gates the push.

## Delivery and push gate

- This PLAN.md is the delivery unit. Keep the branch local until scope,
  verification, acceptance criteria, and assumptions/defaults are complete.
- Local checkpoint commits are allowed; do not create partial remote branches or
  intermediate pull requests.
- Record the final synchronization and verification pass before the first push.

## Assumptions and defaults

- The x.ai model table is authoritative for context-window metadata.
- Grok Build sync failures in the export are upstream credential expiry rather
  than an import defect.
- The Grok Console `429` responses are upstream team-scoped rate limits rather
  than a local limiter defect.
- `TestPinnedHTTPSClientSOCKS5HReceivesPinnedIP` is a pre-existing Windows
  flake unrelated to this iteration.

## Acceptance criteria

- [ ] Objective is delivered.
- [ ] Required checks pass.
- [ ] Documentation is updated.
- [ ] Assumptions and defaults are verified.
- [ ] `RESULT.md` is complete.
- [ ] The plan branch has not been pushed before final acceptance.

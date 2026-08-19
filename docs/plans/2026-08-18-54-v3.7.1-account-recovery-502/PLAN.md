# Iteration plan: v3.7.1 account recovery and Grok Build 502 verification

- Date: 2026-08-18
- Sequence: 54
- Owner: JasmineTony
- Status: In Progress
- Base commit: `73ebb446`
- Working branch: `fix/v3.7.1-account-recovery-502-20260818`

## Objective

Verify the v3.5.1-to-v3.7.0 deployment boundary, reproduce the reported
credential-decryption and Grok Build `grok-4.6` request failures without
exposing account material, fix any confirmed request or error-contract defect,
and publish a verified stable `v3.7.1`.

## Background

The current checkout contains the completed v3.7.0 release closeout. Historical
evidence shows that Compose mounts, startup entrypoints, AES-256-GCM credential
format, and the persistent-data contract did not materially change from
v3.5.1. A deployed account page still reports credential decryption failure
during Grok Build quota sync, while `grok-4.6` inference is reported as HTTP
502. The prior fixes already classify decryption failures as HTTP 409 and
restore same-entitlement 5xx failover, so this iteration must distinguish
deployment state from a remaining source defect.

## Scope

- Compare v3.5.1 and v3.7.0 deployment, configuration, migration, and release
  smoke behavior.
- Reproduce account quota-sync and `grok-4.6` request chains in a disposable
  local instance using sanitized status/code/audit evidence only.
- Verify effective Build client metadata, model capability candidates, retry
  classification, and credential-key error mapping.
- Add focused regression coverage and operator diagnostics only for confirmed
  defects or missing observability.
- Update release metadata and notes to `v3.7.1`, then verify tag, Release,
  GHCR aliases, multi-architecture manifests, and published-image `/healthz`.

## Out of scope

- Recovering an unavailable `credentialEncryptionKey` from ciphertext.
- Mutating production databases, credentials, proxies, quotas, or persistent
  volumes.
- Moving or overwriting immutable tags `v3.5.1`, `v3.6.1`, or `v3.7.0`.
- Treating upstream quota, account revocation, or proxy-provider failures as
  application defects without source-level evidence.

## Implementation steps

1. Create a delivery branch and inspect merge, tag, and remote state.
2. Compare deployment artifacts and trace the two reported request paths.
3. Reproduce failures locally with disposable encrypted state and redacted
   request/audit assertions.
4. Implement the smallest confirmed fix and focused regression tests.
5. Update v3.7.1 metadata, release notes, plan result, and plan index.
6. Run backend, frontend, repository, security, and release-version gates.
7. Synchronize with remote main, push the final branch, and complete the
   annotated-tag, Release, GHCR, and published-image health checks.

## Security and compatibility constraints

- Preserve the original `secrets.credentialEncryptionKey` when reusing a
  database; never log or commit the key, account exports, tokens, cookies,
  proxy credentials, or raw upstream bodies.
- Keep existing `/v1/*`, `/api/admin/v1/*`, SSE, WebSocket, database, and
  encrypted-credential compatibility.
- Use a disposable SQLite database for account/request reproduction and remove
  all credential-bearing temporary artifacts before staging.
- Keep `v3.7.0` immutable and use the repository release workflow as the only
  GHCR publication path.

## Verification

- `go test ./... -count=1`, `go vet ./...`, focused affected-package tests.
- Frontend local TypeScript, lint, tests, build, and contract/governance gates.
- Release-version, Markdown, secret-scan, and `git diff --check` audits.
- Remote annotated tag object/peeled commit, Release flags/latest status,
  workflow jobs, GHCR alias/index/platform digests, and published `/healthz`.

## Risks and rollback

- A wrong key or wrong Compose volume can mimic a source regression; prove the
  effective config path and database identity before changing code.
- A provider 429/401/403 or egress failure can surface near a 502; retain the
  sanitized audit error code and upstream status to prevent misclassification.
- Before publication, discard only the delivery branch. After publication,
  keep `v3.7.1` immutable and roll back with the verified `v3.7.0` image plus
  the pre-upgrade configuration/database/media backups.

## Delivery and push gate

- This PLAN.md is the delivery unit. Keep the branch local until scope,
  verification, acceptance criteria, and assumptions/defaults are complete.
- Local checkpoint commits are allowed; do not push partial implementation or
  create an intermediate pull request.
- Record the final synchronization and verification pass before the first push.

## Assumptions and defaults

- Delivery repository is `JasmineTony/grok2api`.
- Delivery branch is `fix/v3.7.1-account-recovery-502-20260818`.
- Stable aliases are `v3.7.1`, `3.7.1`, `3.7`, `3`, and `latest`.
- Previous verified rollback release is `v3.7.0`.
- Release publication requires the existing protected-environment workflow.

## Acceptance criteria

- [ ] Deployment comparison and both reported failures have a documented
      evidence-based classification.
- [ ] Any confirmed source defect is fixed with focused regression coverage.
- [ ] Required local checks pass or environment limits are documented.
- [ ] Release-facing metadata and notes agree on `v3.7.1`.
- [ ] Annotated `v3.7.1`, GitHub Release, GHCR aliases/platforms, and published
      image health are independently verified.
- [ ] `RESULT.md` is complete and the plan index is current.

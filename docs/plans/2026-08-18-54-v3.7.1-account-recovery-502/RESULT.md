# Iteration result: v3.7.1 account recovery and Grok Build 502 verification

- Date updated: 2026-08-19
- Status: Delivery Ready
- Base commit: `73ebb446`
- Implementation commit: `d4e68fbe6cbeb1c65f6f7d3dbdd656047b21768e`
- Final commit: `<pending>`
- Pull request: `<pending>`

## Delivered

- Confirmed that v3.5.1 and later releases retain the same effective Docker
  entrypoint, `/run/grok2api/config.yaml` mount, `/app/data` persistence
  boundary, and AES-256-GCM credential-key contract. No deployment-method
  change explains the reported decryption failure.
- Confirmed the deployed readiness endpoint still reports Grok Build as
  unavailable while Grok Console is ready and Grok Web is degraded. The live
  account pool therefore cannot serve `grok-4.6` until the original
  `credentialEncryptionKey` is restored or affected Build accounts are
  re-imported.
- Fixed provider request preparation failures caused by credential decryption
  being classified as network `502 upstream_network_error`.
- Public OpenAI and Anthropic endpoints now return a sanitized
  `503 upstream_unavailable`; internal audit records retain
  `credential_decryption_failed` without exposing the key, ciphertext, token,
  or provider error.
- Preserved the admin quota-sync `409 credentialDecryptionFailed` response so
  operators continue receiving the actionable restore-or-reimport instruction.
- Applied the same classification and audit behavior to REST voice and realtime
  voice WebSocket credential preparation.
- Re-ran the `grok-4.6` gateway path with disposable accounts and confirmed
  same-provider failover still attempts the observer account and its stale
  capability peer without applying transport cooldown for a local decryption
  failure.
- Isolated the cross-browser CI cancellation to
  `playwright install --with-deps`: the Ubuntu Noble runner spent almost six
  hours retrying its Azure APT mirror before GitHub canceled the operation, so
  Firefox and WebKit tests never started.
- Replaced runtime browser/system-package installation with the version-matched
  official Playwright `v1.62.1-noble` OCI image, pinned to its multi-platform
  index digest, and added a 30-minute job timeout.

## Verification results

| Check | Result | Notes |
| --- | --- | --- |
| Deployment comparison | Passed | v3.5.1 and v3.7.0 Compose/config/data/key contracts have no material difference related to this incident |
| Live public health | Passed with production issue isolated | `/healthz` returned `200`; `/readyz` returned `200`, `ready=true`, overall `degraded`, and `grok_build=unavailable` at `2026-08-18T17:09:32Z` |
| Focused interface regression | Passed | `grok-4.6`, REST voice, realtime voice WebSocket, OpenAI error, and Anthropic error tests all return the intended credential classification |
| Backend | Passed | After synchronizing remote `main`, `go test ./... -count=1`, `go vet ./...`, `govulncheck v1.6.0`, and normalized `gofmt` checks passed |
| Frontend | Passed | Prettier, TypeScript, ESLint, `22` Vitest files / `81` tests, production build, bundle/chunk, icon, UI symbol, API contract, and architecture checks |
| Repository | Passed | Actionlint, release-version audit, `10` release-automation tests, Markdown audit over `158` tracked files, clean-tree gitleaks scan, Swagger consistency, and `git diff --check` |
| Security review | Passed | Independent review found and triggered remediation of the Voice WebSocket `EnsureCredential` path; client-facing credential details remain redacted |
| Cross-browser CI preparation | Remediated locally | Firefox/WebKit now use the digest-pinned Playwright image and avoid runtime APT; workflow rerun remains pending |
| Remote publication | Pending | Branch push, PR checks, true merge, annotated tag, Release, GHCR, and published-image smoke remain gated on final synchronization |

## Assumptions and defaults verification

| Assumption/default | Result | Evidence |
| --- | --- | --- |
| Previous verified rollback release is `v3.7.0` | Passed | Existing immutable Release/tag/image evidence remains recorded in iteration 53 |
| Existing database requires its original credential key | Passed | Wrong-key ciphertext remains intentionally unrecoverable; source changes only correct error classification |
| Delivery branch is `fix/v3.7.1-account-recovery-502-20260818` | Passed | Local branch matches the plan |

## Push gate evidence

- First remote push occurred only after final local acceptance: Pending
- Final synchronization base:
  `2918e08bb563a56a610d6cb0e343c7885dbf9af8`
- Synchronization merge:
  `b9898847d8b5036774e26063b2fd174048fc3e65`
- Final verification run: backend, frontend, vulnerability, workflow,
  repository, secret, Swagger, formatting, and release-version checks passed
  after synchronization.

## Deviations from plan

- The production host was not reachable through an available SSH profile, so no
  configuration, database, volume, credential, or account mutation was
  attempted.
- The user-level pnpm tool directory was not writable. Frontend checks were run
  with repository-local `.cmd` binaries and passed.
- Docker is not installed on the Windows validation host, so the containerized
  Firefox/WebKit job must be proven by the protected GitHub Actions rerun.
- The Windows Go toolchain has `CGO_ENABLED=0` and no C compiler, so
  `go test -race -p 1 ./...` remains a Linux CI gate rather than local evidence.
- Windows Firefox reproduced the known host/runtime
  `browserContext.newPage ... '_page'` startup failure. WebKit exercised the
  same smoke suite, but the authoritative combined Firefox/WebKit result
  remains the Linux container job.

## Unresolved and follow-up work

- Production Grok Build remains unavailable until an operator with target-host
  access restores the exact original `credentialEncryptionKey` used for the
  mounted database or re-imports the affected accounts. Publishing v3.7.1 does
  not and must not attempt to derive that key from ciphertext.
- Remote release evidence will replace the pending fields after protected CI
  and release workflows complete.

## Rollback

Use the verified `v3.7.0` image and the pre-upgrade configuration/database/media
backups; never move the immutable `v3.7.1` tag after publication.

## Final acceptance

- [x] Implementation matches the accepted scope.
- [x] Local checks and security review are complete.
- [x] Local-only account exports, caches, screenshots, and tool state remain
      outside Git.
- [x] The plan index is current for the delivery-ready state.
- [ ] Remote branch, PR, merge, tag, Release, GHCR, and image smoke are complete.

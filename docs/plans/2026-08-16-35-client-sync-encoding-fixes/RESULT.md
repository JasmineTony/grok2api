# Iteration result: Grok Build client version sync, accounts encoding fix, first-account model sync, and 502 remediation

- Date completed: 2026-08-16
- Status: Complete
- Base commit: `61ed11fb`
- Final commit: `80ef1c65`
- Pull request: branch `fix/build-client-and-sync-20260816` pushed; PR creation URL: https://github.com/JasmineTony/grok2api/pull/new/fix/build-client-and-sync-20260816 (no `gh` CLI/token in the local environment)

## Delivered

1. **Grok Build client version → `1.0.4`**
   - `backend/internal/infra/config/config.go:31` `RecommendedBuildClientVersion = "1.0.4"`; `RecommendedBuildUserAgent` recomputes to `grok-shell/1.0.4 (linux; x86_64)`.
   - Runtime settings recommendation (`RecommendedProviderBuild`) and the default provider config inherit the constant, so deployments without an explicit `provider.build.clientVersion` adopt `1.0.4` automatically after upgrade.
   - Test fixtures refreshed: `backend/internal/infra/config/config_test.go`, `backend/internal/transport/http/settings/security_test.go`, `frontend/src/features/settings/settings-api.test.ts`.
2. **Accounts page mojibake fix**
   - `frontend/src/features/accounts/account-page-utils.ts`: `readQuickImportFile` now reads bytes and decodes via `decodeImportFileBytes` — UTF-16 LE/BE BOM first, then UTF-8 BOM strip, then strict (fatal) UTF-8, falling back to GBK only when the payload cannot be valid UTF-8. GBK/UTF-16 token files exported from Windows no longer become mojibake account names/emails.
   - New unit tests cover UTF-8 (plain + BOM), UTF-16 LE/BE, GBK, and the `File` path.
3. **Model sync restricted to the first account per provider**
   - `backend/internal/application/model/service.go` `syncAllAccounts` now appends only `values[0]` of each provider's `ListEnabled` result (ordered `priority DESC, id ASC`), so the models page sync button issues at most 3 upstream syncs (one per provider) instead of the entire pool.
   - `TestSyncAggregatesCapabilitiesFromAllAccounts` rewritten as `TestSyncSyncsOnlyFirstAccountPerProvider`: higher-priority account is synced, lower-priority account's capability snapshot stays unknown, web pool contributes its single account, discovered-model count unchanged.
   - Per-account endpoints (`SyncAccount`), bulk startup catchup (`SyncAccounts`), and import-time sync are unchanged by design.
4. **502 diagnosis and remediation** (details below).

## 502 analysis

Where the gateway produces 502 (`backend/internal/application/gateway/failure.go`):

| Path | Code | Meaning |
| --- | --- | --- |
| `:218` transport error | `upstream_network_error` | TCP/TLS/HTTP2 failure to upstream or proxy; only header/idle timeouts become 504 |
| `:240` credential unusable | `upstream_credential_unavailable` | token refresh failed or account not active |
| `:137` upstream status `<400`/`>599` | `upstream_error` | non-standard upstream status forced to 502 |
| `service.go:1321` stream break after 2xx | audited 502 | mid-stream failure |
| `cli/responses_compaction_forward.go:458` | `compaction_failed` | Build compaction failure, `X-Should-Retry: false` |

Account-pool exhaustion returns **503**, not 502, so a steady 502 points at the network/credential/upstream layer.

**Root cause addressed this iteration**: the gateway announced client version `0.2.119` (set 2026-08-04). xAI's official CLI (`@xai-official/grok`) has since published `0.2.120` (08-03), `0.2.121` (08-05), `1.0.0`–`1.0.4` (08-07…08-13). When xAI deprecates a client version, the typical failure modes are OAuth refresh rejections (→ all credentials unavailable → `upstream_credential_unavailable` 502 on every request) and edge-level connection interference (→ transport 502). Version verification against the published `1.0.4` linux-x64 binary:

- base URL `https://api.x.ai/v1`; paths `v1/responses`, `v1/models` unchanged;
- OAuth endpoints `/oauth2/device/code`, `/oauth2/token` unchanged; scope still contains `offline_access`;
- headers `x-grok-client-version` / `x-grok-client-identifier` (`grok-shell`) / `x-grok-client-mode` (`headless` still valid) identical to what the gateway already sends — so the constant bump is protocol-safe with no request-shape changes.

**Operator follow-ups if 502 persists after deploying this change**:

1. If the deployment pins `provider.build.clientVersion` in `config.yaml` or saved runtime settings, update it in 运行设置（构建） or clear the pin so the `1.0.4` recommendation applies.
2. Filter the 请求审计 page for `status_code=502` and check `error_code`: `upstream_network_error` → inspect 出口节点 health/proxies; `upstream_credential_unavailable` → re-auth accounts; `compaction_failed` → upstream-side issue.
3. v3.6.1 changed large-pool selection and health invalidation (`c7ddda23`); if 502s cluster on specific accounts, verify those accounts' egress bindings.

## Verification results

| Check | Result | Notes |
| --- | --- | --- |
| `cd backend && go build ./...` | Passed | exit 0 |
| `cd backend && go test ./...` | Passed | full suite, exit 0 |
| `cd frontend && pnpm typecheck` | Passed | `tsc -b` clean |
| `cd frontend && pnpm lint` | Passed | `eslint . --max-warnings 0` clean |
| `cd frontend && pnpm test` | Passed | 18 files / 60 tests |
| `cd frontend && pnpm build` | Passed | production build in 1.84s |
| npm evidence for `1.0.4` | Confirmed | `@xai-official/grok` dist-tags: latest=1.0.4 (2026-08-13), alpha=1.0.5 |

## Assumptions and defaults verification

| Assumption/default | Result | Evidence |
| --- | --- | --- |
| `1.0.4` is the newest stable release | Confirmed | npm dist-tag `latest`; `1.0.5` tagged `alpha` (published 2026-08-16) |
| `1.0.4` is protocol-compatible | Confirmed | binary string inspection: same endpoints/headers/identifier/mode |
| First account = first row of `ListEnabled` | Confirmed | `account_repository.go` orders `priority DESC, id ASC` |
| In-repo frontend sources are mojibake-free | Confirmed | scans for U+FFFD, GBK-as-UTF-8 and 锟斤拷 patterns returned nothing; `index.html` declares UTF-8 |
| Other-page mojibake audit | Confirmed | request-audits base64 bodies render by design; creative-console decodes UTF-8 JSON only; no other page renders raw non-UTF-8 bytes |

## Push gate evidence

- First remote push occurred only after final local acceptance: Yes (full backend+frontend verification passed on commit 26ecfed0 before push)
- Final synchronization base: `61ed11fb`
- Final verification run: backend `go build ./... && go test ./...`; frontend `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
- CI correction: the first CI run failed `prettier --check` on `account-page-utils.test.ts` (commit `80ef1c65` applied Prettier and re-ran the full `pnpm verify` locally with exit 0 before pushing the correction to the same branch)

## Deviations from plan

- None.

## Unresolved and follow-up work

- Runtime auto-sync of the client version from npm is intentionally not implemented (external dependency/supply-chain surface); recommended value is surfaced in runtime settings for one-click adoption.
- Already-corrupted account rows in existing deployments are not migrated; re-import the token file with the fixed reader to repair names/emails.
- If 502s persist post-deploy, follow the operator steps above; no further in-repo cause was identifiable statically.

## Rollback

Revert the iteration commit: restores `0.2.119` constants/fixtures, `file.text()` import reading, full-pool model sync, and the previous test expectations. No database migrations were introduced.

## Final acceptance

- [x] Implementation matches the accepted scope.
- [x] Checks and security review are complete.
- [x] Repository state is clean and documented.
- [x] The plan index is updated.

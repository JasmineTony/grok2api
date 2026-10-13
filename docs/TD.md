# grok2api 技术设计文档（TD）

## 0. 文档信息与定位

| 项 | 值 |
| --- | --- |
| 文档类型 | 派生设计文档（derived design documentation），描述**已实现**的设计与**待演进**的设计 |
| 目标读者 | 后端/前端工程师、架构审查人、验收人 |
| 覆盖范围 | 设计目标与约束、系统上下文、总体架构与依赖规则、技术栈、运行时、推理网关、Provider 适配、数据、接口契约、安全、一致性/并发/幂等、可观测性、前端设计、质量保障、交付部署、已知设计缺口；不含产品需求（见 PRD）与规则 SSOT（见 AGENTS.md） |
| 文档状态 | 派生文档（非规则 SSOT）；规则以 `AGENTS.md` 为准，实测值以两个 `AUDIT.md` 为准 |
| 基线提交 | `45838afe`（`main`，2026-10-12）；历史基线 `c6206d50` 因远端仓库重建/历史重写已不可解析，引用其行号时需按当前文件重新定位 |
| 版本载体 | `VERSION` = `v0.1.1`；`frontend/package.json.version` = `0.1.1` |
| 权威边界 | 本文件不是规则 SSOT（`AGENTS.md`）也不是证据 SSOT（`frontend/AUDIT.md`、`backend/AUDIT.md`）。设计冲突时以代码与那三者为准 |
| 事实口径 | `文件:行` 引用相对基线提交；标注「未确认」的条目未经逐行核验 |

配套文档：`docs/PRD.md`（需求）、`docs/implementation-plan.md`（落地顺序）。

**入口说明**：本文是派生文档，不是规则 SSOT；规则见 `AGENTS.md`，当前状态见 `frontend/AUDIT.md` 与 `backend/AUDIT.md`。三份文档的阅读顺序：`docs/PRD.md` → `docs/TD.md` → `docs/implementation-plan.md`。

---

## 1. 设计目标与约束

| 编号 | 目标/约束 | 体现 |
| --- | --- | --- |
| G-1 | 对外协议与上游实现解耦 | Provider 能力声明 + 小接口组合适配器，网关侧协议归一 |
| G-2 | 上游协议变更可在适配层内吸收 | `infra/provider/{cli,web,console}` 各自封装私有协议 |
| G-3 | 单二进制、零外部强依赖可运行 | 默认 SQLite + memory 运行态 + 本地媒体 |
| G-4 | 多副本可扩展（非默认） | Redis 运行态 + 共享媒体目录 + 集群标记校验 |
| G-5 | 不因内部重构改变对外契约 | `apicheck` 契约基线 + Swagger 精确 diff + E2E |
| G-6 | 结构熵与审查成本有机器上限 | 文件 ≤600 行、函数 ≤50 行、嵌套 ≤3 层、覆盖率 ≥76%（阈值唯一来源与规则编号见 §14.1 注；规则 `AGENTS.md` 的 `REV-1`/`REV-2`/`REV-3`/`TEST-1`） |
| G-7 | 失败必须显式 | 就绪门、账本 enforce、配置校验、fail-closed 开关 |

---

## 2. 系统上下文

```
                    ┌───────────────────────────────────────────────┐
   接入开发者        │                  grok2api                     │
   (OpenAI / Anthropic│  ┌─────────────────────────────────────────┐  │
    /Codex/Claude Code)│  │ /v1/*  网关面（客户端密钥鉴权）          │  │
        ─── HTTPS ───┼─▶│  ┌─────────────────────────────────────┐ │  │
                    │  │  │ application/gateway（路由/选号/重试/  │ │  │
   运营者（浏览器）    │  │  │ 流式转发/结算）                      │ │  │
        ─── HTTPS ───┼─▶│  └──────────────┬──────────────────────┘ │  │
                    │  │ /api/admin/v1  │                          │  │
                    │  │ （单管理员会话）│                          │  │
                    │  └─────────────────┼─────────────────────────┘  │
                    │                    ▼                            │
                    │  ┌──────────────────────────────────────────┐  │
                    │  │ Provider 适配层                          │  │
                    │  │  cli(Build) │ web(Web) │ console(Console)│  │
                    │  └──────┬──────────────┬───────────────┬─────┘  │
                    │         │              │               │        │
                    │  ┌──────▼──────┐ ┌─────▼─────┐ ┌───────▼────┐  │
                    │  │ 出口管理器   │ │ 关系型存储 │ │ 运行态存储  │  │
                    │  │ egress      │ │ sqlite/pg │ │ memory/redis│ │
                    │  └──────┬──────┘ └───────────┘ └────────────┘  │
                    └─────────┼──────────────────────────────────────┘
                              ▼
              ┌──────────────┬──────────────┬───────────────┐
              │ 代理/隧道     │ FlareSolverr │ Statsig signer │
              │ HTTP/SOCKS/  │ (可选)       │ (Web 池)       │
              │ Resin/Trojan/│              │                │
              │ VLESS/SS/VMess│             │                │
              └──────────────┴──────────────┴───────────────┘
                              ▼
                  Grok 上游（Build / Web / Console）
```

可选 sidecar：`tools/egress-quality-guard`（Python 3.12，仅标准库）通过共享卷 + 受限内部 API 与主服务交互，不接触管理员密码。

---

## 3. 总体架构与依赖规则

### 3.1 后端分层

```
cmd/grok2api ─▶ internal/cli ─▶ internal/app（唯一装配入口）
                                    │
                    ┌───────────────┼────────────────┐
                    ▼               ▼                ▼
             transport/http   application/*     infra/*（实现）
                    │               │                │
                    └──────▶ domain/* ◀──────────────┘
                                ▲
                        repository/*（Port 契约）
                        ports/provider/*（Provider 契约）
                        pkg/*（通用库，无业务依赖）
```

- **依赖方向**：`transport → application → domain`；`repository` 与 `ports/provider` 定义契约，`infra/*` 提供实现，`app` 负责装配（`backend/internal/app/assemble.go`）。
- **domain 层**：10 个包，纯业务类型与规则，不含基础设施（`domain/{account,admin,audit,clientkey,dashboard,egress,inference,media,model,settings}`）。
 - **application 层**：14 个包，用例编排（`account`、`accountsync`、`adminauth`、`audit`、`clientkey`、`dashboard`、`egress`、`gateway`、`invalidation`、`media`、`model`、`quotarecovery`、`settings`、`updatecheck`）。
- **infra 层**：`persistence/relational`、`runtime/{memory,redis}`、`provider/{cli,web,console,conversation}`、`egress`、`media`、`security`、`config`、`observability`、`qualityguard`、`buildtransport`。
- **已知例外**：`application → infra` 仍有 27 文件 / 29 对生产依赖未收敛，当前以门禁例外冻结，只允许下降（见 §16 GAP-2）。

### 3.2 前端分层与机器校验

```
app（路由/外壳/Providers）
 ├─▶ features/*（11 个业务特性）
 │      └─▶ entities/*（领域契约 + api + hooks）
 └─▶ shared/*（api / auth / config / hooks / i18n / lib / components）
        components/ui（基础原语，无业务依赖）
```

- 由 `frontend/.dependency-cruiser.cjs` 强制：`no-circular`、`not-to-unresolvable`、`lower-layers-must-not-import-upper`、按 feature 生成 `no-cross-feature-*`。
- `frozenCrossFeatureDebt` 当前为空对象：任何新增跨 feature 直接依赖即违规（`pnpm check:architecture`）。

### 3.3 前端数据流

- 服务端状态：TanStack Query（`retry: 1`、`staleTime: 15s`、`refetchOnWindowFocus: false`、mutation `retry: 0`）。
- 客户端状态：zustand（认证 store）；会话态模块内持有 access token，不落 localStorage。
- HTTP：自研 `shared/api/client.ts` 封装（统一信封 `{data}` / `{error:{code,message,requestId}}`、手写解码器、SSE 用原生 `fetch` + `ReadableStream`）。

---

## 4. 技术栈与选型

| 层 | 选型 | 依据 |
| --- | --- | --- |
| 后端语言 | Go 1.26（`backend/go.mod`） | 单二进制、并发模型适合长连接流式转发 |
| HTTP 框架 | Gin（`gin.ReleaseMode`） | 路由分组与中间件链清晰 |
| ORM/存储 | GORM + `glebarez/sqlite`（纯 Go）/ `pgx` 系 Postgres | 免 CGO 交叉编译；两种 driver 同一 schema |
| 运行态 | Redis（全 Lua 原子脚本）或 memory | 单实例免外部依赖；多副本可切 Redis |
| 配置 | `config.yaml` + 环境变量覆盖 + 运行时设置热更新 | 静态引导配置与可热改参数分离 |
| 前端 | React 19 + Vite 8 + TypeScript 6 + Tailwind 4 + shadcn（new-york） | 静态构建嵌入后端 |
| 前端状态 | zustand + TanStack Query + react-hook-form + zod | 客户端/服务端状态分离，表单校验可声明 |
| i18n | i18next（zh-CN / en，首屏 3 域 + 懒加载 12 域） | 首屏体积可控 |
| 图表 | Recharts | 仪表盘与质量守护统计 |
| 测试 | Go 标准测试 + node:test（纯逻辑）+ Vitest（jsdom 组件）+ Playwright（全栈 E2E） | 按运行环境分层，双运行器为已决策接受项 |
| sidecar | Python 3.12（仅标准库） | 零第三方依赖，镜像极小 |

---

## 5. 运行时设计

### 5.1 启动装配（16 步，顺序敏感）

`internal/app/assemble.go` 的 `New` 按固定顺序装配，任一步失败走 `fail()`（先关运行态再关数据库）：

```
openPersistence → loadPersistedSettings → openRuntimeStore → assembleProviders
→ assembleAdminAuth → assembleBatchPools → assembleAccountService
→ restoreQuotaRecoveryWindows → assembleModelService → assembleAccountSyncAndEgress
→ assembleClientKeys → assembleAuditAndDashboard → assembleGateway
→ assembleSettings → assembleStartupAndReadiness → assembleHTTPServer
```

设计要点：**持久化与运行态先就绪**，再构造依赖它们的服务；启动恢复（`reconcileStartup`）在放流量之前完成。

### 5.2 生命周期与后台任务

`internal/app/lifecycle.go`：

1. `audits.Start()`（审计写入 worker 先起，保证后续操作可记账）
2. 启动 HTTP 监听（goroutine）
3. `reconcileStartup`（启动恢复，**先于放流量**）
 4. `startBackgroundTasks`（24 个受监督后台任务，任务名清单见 `internal/app/lifecycle.go`）
5. `queueDueWebQuotaRefresh`
6. `awaitShutdown`（ctx 取消后 10s 优雅关闭）

后台任务类别（`lifecycle.go`）：

| 类别 | 任务 |
| --- | --- |
| 一致性 | `invalidation_publisher` / `subscriber`、`settings_reconcile`(30s)、`settings_change_listener` |
| 凭据与额度 | `credential_refresh`、`quota_recovery`、`quota_refresh`、`web_quota_startup_catchup`、`console_quota_stale_catchup` |
| 清理 | `billing_reservation_cleanup`(10m)、`model_cooldown_cleanup`(10m)、`response_ownership_cleanup`(5m)、`audit_retention_cleanup`(1h)、`media_cleanup`、`account_auto_clean` |
| 媒体/视频 | `video_recovery`、`video_workers` |
| 出口 | `clearance_refresh`(1m)、`egress_operations`(1m) |
| 其他 | `performance_metrics`(1m)、`release_check`(24h)、`statsig_warmup`、`model_catalog_startup_catchup`、`console_usage_migration` |

所有任务经 `runSupervisedTask`（捕 panic + 指数退避至 30s）或 `runPeriodicTask` 包装：**后台任务崩溃不得拖垮进程**。

### 5.3 就绪与放流量

- `GET /healthz`：进程存活。
- `GET /readyz`：分层快照（`runtime_store`、`billing_ledger`、`grok_build`、`grok_web`、`statsig`），未就绪 503（`internal/app/startup.go`）。
- `/v1` 独立放流量门：`phase != running` 时 503 `service_reconciling`。
- `preflightDeployment`（`internal/app/topology.go`）：`replicas > 1` 时必须校验共享媒体目录集群标记 `.grok2api-cluster` 且写回探针通过。

---

## 6. 推理网关设计（核心）

### 6.1 请求状态机（9 阶段）

入口 `application/gateway` 的 `createResponseAt`（`service_request.go`）：

```
initializeRequest            egress trace / eventID / 会话 scope / 公开模型路由 / previous_response_id 归属
  ▼
applyResolvedRoute           公开模型 ID 固化 + 别名 effort 重写
  ▼
prepareTimingAndAuditBase    计时与审计基线
  ▼
writeDisallowedModelAudit    未授权模型 → 403 model_not_allowed（并记账）
  ▼
prepareBuildSessionIdentity  会话身份与亲和键派生
  ▼
resolveResponseAdapter       选择 Provider 适配器
  ▼
prepareAttemptPolicy         质量保持 / 尝试策略 / 账本就绪检查 / 预扣费
  ▼
runAttemptLoop               尝试循环（选号 → 转发 → 决策）
  ▼
drainQualityFallback / finalizeUnavailableRequest   收尾与不可用结算
```

三种对外协议（Responses / Chat Completions / Messages）**全部收敛到上游 `/responses`**；Console 不支持 stored responses 时降级为无状态重放。

### 6.2 路由与账号选择

- 公开模型 → 候选路由：`resolvePublicModelRoutes` + `eligibleConversationRoutes`；同名目标用 `routeTargetSeed(input)` 打散顺序。
- 按客户端密钥的模型/账号范围过滤：`selectConversationRoute`。
- 选号：`gateway.Selector.Acquire*` 按 Provider、modelRouteID、quotaMode、affinityKey、`excluded`、AccountScope、强制出口节点筛选。
- 粘滞：`StickySessionRepository.Bind` 原子保留未过期绑定。
- 亲和：`resolveBuildSessionIdentity` 派生，按模型隔离。
- 并发隔离键：`account:<id>`（同账号请求可被隔离，避免上游单账号并发过高）。

### 6.3 尝试循环与失败分类

```
取并发租约 → applyQuotaProbeRecovery（付费额度探测恢复）
→ ensureAttemptCredential（校验/强制刷新凭据）
→ forwardAttemptResponse → adapter.ForwardResponse(...)
```

- 决策枚举：`attemptProceed | attemptNext | attemptStop | attemptReuse | attemptRehandledResponse | attemptHandedOff`。
- 失败分类：传输失败可重试判定、SSO 凭据被拒 → 标记重认证、团队模型 429（`upstream_team_model_rate_limit_active`）、响应级失败健康惩罚、非账号指纹上限 16、流空闲上限 2（`service_ratelimit.go`）。
- 设计意图：**重试必须有界且可解释**，每次尝试都进审计尝试链。

### 6.4 流式转发与结算

- `handoffResponse` 把上游 body 包成 `firstByteReadCloser` + `finalizingBody`，`Finalize` 用 `sync.Once` 保证**只结算一次**。
- `finalizeResponse` 落 usage 审计、账号健康、`ResponseOwnership`（TTL 30 天）与额度状态。
- 传输层另有流空闲守卫（`infra/provider/streamidle`）与错误分类（`pkg/neterror`）。

### 6.5 会话与缓存

| 机制 | 实现 | 设计要点 |
| --- | --- | --- |
| 上游会话归属 | `domain/inference.ResponseOwnership` + `response_ownership` 表 | 只存归属不存正文；跨账号不串会话 |
| 上下文压缩 | `/responses/compact` + `classifyResponsesCompactionRequest` | 区分 compaction 与 TUI；TUI 跳过质量保持 |
| 提示缓存亲和 | `gateway/prompt_cache.go` | 亲和键按模型隔离 |
| 推理上下文重放 | `pkg/reasoningreplay` + `ReasoningReplayRepository` | **只由显式会话信号派生 key**，软锚点不驱动（防跨会话泄漏） |
| 结果缓存 | `pkg/resultcache`（TTL + 最旧淘汰 + singleflight） | **不在推理链路**，只服务 dashboard 聚合、审计汇总、选号并发快照 |

### 6.6 幂等与请求身份

- 每请求生成 `eventID`（审计唯一键）与 `idempotencyID`（18 字节随机）。
- `requestSessionScope = eventID`，防止客户端复用 ID 串联会话。

---

## 7. Provider 适配层设计

### 7.1 能力声明是唯一权威

`ports/provider/definition.go` 的 `Definition` 声明：Provider 身份、模型命名空间、目录类型（remote/static）、模型能力、`QuotaKind`（billing/remote_window/local_window）、`CredentialSurface`、`ConversationSurface`（Responses/ChatCompletions/Messages/Compact/StoredResponses）、`MediaSurface`（ImageGeneration/ImageEdit/VideoGeneration/TTS/STT/Realtime）、`InferencePolicy`（Usage 权威性、`RetryForbiddenAsEgress`）。

`Validate()` 强制自洽：Compact/StoredResponses 依赖 Responses；媒体声明须与模型能力一致；非 OAuth 不得声明 Refresh/DeviceOAuth。

### 7.2 小接口组合（而非巨型接口）

 `ports/provider/adapter.go` 定义 29 个窄接口（含基础 `Adapter`），按需实现：`ResponseAdapter`、`ModelCatalogAdapter`、`BillingAdapter`、`CredentialRefreshAdapter`、`DeviceOAuthAdapter`、`CredentialCodecAdapter`、`CredentialImportPreparer`、`AccountIdentityAdapter`、`BuildCredentialConverter`、`QuotaAdapter`/`QuotaGroupAdapter`/`QuotaRefreshMetadataAdapter`、`WebAccountSettingsAdapter`、`ImageGenerationAdapter`/`ImageEditAdapter`/`ImageAssetStore`、`VideoAdapter`/`VideoContentDownloader`、`TTSAdapter`/`STTAdapter`/`VoiceWebSocketAdapter`、`RoutingMetadataAdapter`/`QuotaTierOrderAdapter`、`ModelAliasAdapter`、`PricingMetadataAdapter`。

注册表 `infra/provider/provider.go` 的 `Validate()` 校验「已实现 Definition 声明的每个能力接口」——**当前为运行时校验**（见 §16 GAP-7）。

### 7.3 三 Provider 差异矩阵

| 维度 | Grok Build（`grok_build`） | Grok Web（`grok_web`） | Grok Console（`grok_console`） |
| --- | --- | --- | --- |
| 目录 | remote（按账号发现） | static（按 tier） | static |
| 凭据 | OAuth（Import/Refresh/DeviceOAuth） | SSO（仅 Import） | SSO |
| 会话 | Responses/Chat/Messages/Compact/**StoredResponses** | Responses/Chat/Messages（无 Compact） | Responses/Chat/Messages（**无 StoredResponses**） |
| 额度 | billing | remote_window | remote_window |
| 用量权威 | upstream | estimated | upstream |
| 媒体 | Video | Image/ImageEdit/Video | Image/ImageEdit/Video/TTS/STT/Realtime |
| 出口策略 | 默认 | `RetryForbiddenAsEgress=true` | `RetryForbiddenAsEgress=true`（403 视为出口挑战而非凭据失效） |
| 私有协议 | OAuth device flow、Responses 归一、Codex 工具兼容、compaction、加密 reasoning 恢复 | Statsig 签名、SSO→Build 转换、三协议流式重编码、图像 WS、额度分模式 | DPoP（ECDSA）、协议归一、语音（含 WS） |

跨 Provider 关系：`account_provider_links` / `web_console_account_links` 只做同一上游用户的**弱关联**（出口身份与管理端展示），**不共享**额度、健康与路由。

### 7.4 客户端协议兼容

`transport/http/inference/prompt_cache.go` 从 `X-Claude-Code-Session-Id`、Codex 头、`prompt_cache_key`/`session_id`/`conversation_id` 及多种反代头抽取会话种子；Claude Code 的 title 辅助请求**强制降级为软身份**以防 reasoning 泄漏。`infra/provider/conversation` 提供 Anthropic Messages / OpenAI Chat 与 Responses 的双向编解码（含 server-side web search）。

---

## 8. 数据设计

### 8.1 关系型模型（32 张表）

`internal/infra/persistence/relational/schema.go` 的 `schemaModels` 共 32 个模型：

| 域 | 表 |
| --- | --- |
| 管理员 | `admin`、`admin_sessions` |
| 出口 | `egress_subscription_sources`、`egress_proxy_profiles`、`egress_nodes`、`egress_operations_config` |
| 账号 | `provider_accounts`、`account_credentials`、`account_provider_links`、`web_console_account_links`、`web_account_profiles` |
| 额度与计费 | `account_quota_windows`、`account_billings`、`account_quota_recoveries`、`account_egress_lease_blocks`、`billing_reservations` |
| 模型 | `model_routes`、`model_route_aliases`、`model_route_accounts`、`account_model_capabilities`、`account_model_sync_states`、`account_model_quota_blocks` |
| 密钥 | `client_keys`、`client_key_models` |
| 审计 | `request_audits`、`request_audit_attempts`、`response_ownership`、`web_response_states` |
| 媒体 | `media_jobs`、`media_assets`、`media_upload_tickets` |
| 设置 | `runtime_settings` |

约 56 条索引（`schema.go`），含 partial unique `idx_audits_event_id`、`uidx_model_routes_managed_public_capability`、partial `idx_client_keys_internal_kind`。

### 8.2 存储实现要点

- **SQLite**：`glebarez/sqlite`（纯 Go）；DSN 强制 `busy_timeout(5000)`、`journal_mode(WAL)`、`foreign_keys(1)`、`_txlock=immediate`；连接池 16/16。
- **Postgres**：连接错误对 DSN 脱敏；池大小取配置。
- GORM `TranslateError` 开启，`NowFunc` 固定 UTC。

### 8.3 Schema 演进（当前实现）

`InitializeSchema` = `AutoMigrate(schemaModels)` + 幂等 `CREATE INDEX IF NOT EXISTS` + 显式迁移/回填函数（`migrateLegacySchemaColumns`、`migrateSchemaConstraints`、`migrateMediaJobSchema`、`finalizeSchemaMigration`）：

- Postgres 用 `pg_advisory_xact_lock(...)` 串行化迁移。
- SQLite 迁移期间临时关闭外键重建表。

**缺口**：无版本化迁移表、无 down/回滚路径、无迁移耗时与锁等待指标（见 §16 GAP-3）。

### 8.4 运行态存储能力矩阵

`repository/runtime.go` 统一契约，`memory` 与 `redis` 两实现：

| 能力 | 用途 | Redis 实现要点 |
| --- | --- | --- |
| `RateLimiter` | 密钥 RPM、管理员登录限流 | Lua 原子脚本 |
| `ConcurrencyLimiter` | 账号/实例并发租约 | acquire/releaseLease Lua；租约 TTL = `requestTimeout + 1m` |
| `StickySessionRepository` | 会话粘滞 | setSticky 带 ZSET 索引与淘汰 |
| `ReasoningReplayRepository` | 推理上下文重放 | memory 侧有 maxSize/evictBatch |
| `DeviceSessionRepository` | 设备码登录会话 | — |
| `DistributedLock` | 跨实例互斥（清理、媒体、凭据刷新） | releaseLock CAS |
| `SettingsChangeBus` | 设置变更广播 | — |
| `QuotaRecoveryQueue` | 额度恢复到期队列 | — |
| `QuotaRefreshCoordinator` | 额度刷新去重 | — |
| `ObservedModelState` | 观测到的模型状态 | — |
| `InvalidationBus` | 跨实例失效广播 | — |

**缺口**：`memory` driver 在多副本下静默退化为每实例独立限流/粘滞/锁（见 §16 GAP-4）。

---

## 9. 接口契约

### 9.1 三面结构（共 151 条路由注册）

| 面 | 前缀 | 条数 | 鉴权 | 中间件链 |
| --- | --- | --- | --- | --- |
| 根/系统 | `/healthz`、`/readyz`、可选 `/swagger/*any` | 3 | 公开 | 全局链 |
| 管理面（公开） | `/api/admin/v1/auth/{login,refresh,logout}` | 3 | 公开（登录限流） | 全局链 |
| 管理面（受保护） | `/api/admin/v1/**` | 110 | Bearer access JWT（Cookie 回退） | 全局链 + `AdminAuth` |
| 内部面 | `/api/internal/v1/quality-guard/**` | 9 | 进程级 HMAC 令牌 | 全局链 + `QualityGuardAuth` |
| 网关面 | `/v1/**` | 23 | `Bearer g2a_<prefix>_<secret>` 或 `X-API-Key` | 全局链 + `ConcurrencyGate` + `ObserveBodyMemory` + `TrafficReady` + `ClientAuth` |
| 公开媒体 | `GET /v1/media/{images,videos}/{assetId}`、`PUT /v1/media/uploads/{token}` | 3 | 无（依赖不可猜 ID / 一次性票据） | 全局链 |

全局中间件链（`server.go`）：`Recovery → RequestID → ClientIP → SecurityHeaders → MaxBodyBytes → Timeout → AccessLog`。

管理面按域分布：account 37、egress 37、model 9、media 8、clientkey 7、audit 4、system 3、adminauth 2、settings 2、dashboard 1。

### 9.2 鉴权设计

| 通道 | 机制 | 关键约束 |
| --- | --- | --- |
| 管理员 | HS256 JWT（claims：adminId/sessionId，issuer `grok2api`）；refresh 为落库 opaque token | Cookie 回退需 `Sec-Fetch-Site: same-origin`，否则非安全方法要求 `Origin.Host == Request.Host` |
| 客户端密钥 | 按 prefix 查库 + SHA-256 + `subtle.ConstantTimeCompare` | 校验顺序：余额 → RPM → 并发租约；失败映射 401/429/503 |
| 内部 | HMAC-SHA256(jwtSecret, 域分隔常量) | 仅质量守护 sidecar 使用 |

Cookie 属性（`transport/http/adminsession/cookies.go`）：`grok2api_admin_access`（path `/api/admin/v1`）、`grok2api_admin_refresh`（path `/api/admin/v1/auth`）；`SameSite=Strict`、`HttpOnly`、`Secure = 配置 || TLS`。

### 9.3 错误契约

| 面 | 形状 |
| --- | --- |
| 管理面 | `{error:{code,message,requestId}}`（`shared/response/response.go`） |
| 网关面 | OpenAI 风格错误对象 |
| `/v1/messages` | Anthropic 风格错误对象 |
| 限流/过载 | 429 / 503 `server_overloaded` + `Retry-After: 1` |
| 启动期 | 503 `service_reconciling` |

### 9.4 契约冻结机制

| 机制 | 工具 | 语义 |
| --- | --- | --- |
| 导出 API 面 | `go run ./tools/apicheck` | 导出名 + 归一化签名与 `backend/api-baseline.txt` 逐条比对；任何差异 exit 1，只有 `--update` 可重冻 |
| 公开 HTTP 协议 | `make swagger` + `git diff --exit-code -- backend/docs/{docs.go,swagger.json,swagger.yaml}` | 注释变更必须同步产物 |
| 端到端行为 | `pnpm test:e2e` + `pnpm test:results:e2e` | 必需用例必须真实执行且未跳过 |
| 结构约束 | `structurecheck` / `check-structure.mjs` | 与 `structure-baseline.json` 棘轮比对 |

---

## 10. 安全设计

| 面 | 设计 | 实现位置 |
| --- | --- | --- |
| 凭据静态加密 | AES-256-GCM，密钥为 Base64 的 32 字节；密文 `base64.RawStdEncoding(nonce‖sealed)` | `infra/security/cipher.go` |
| 加密范围 | 账号凭据、出口代理 URL、`runtime_settings` | 各仓储写入路径 |
| SSRF 防护 | 拒绝非 GlobalUnicast、私有、环回、link-local、multicast、unspecified 及 `0.0.0.0/8`、`100.64/10`、`192.0.2/24`、`198.18/15`、`203.0.113/24`、`240/4`、IPv6 转换/文档网段 | `pkg/netguard` |
| 签名 URL 白名单 | Statsig signer URL 仅允许公网 HTTPS:443 或管理员显式配置的内网地址 | `pkg/signerurl` |
| 客户端 IP | 仅在 `trustedProxies` 内信任转发头；禁止通配 | `middleware.ClientIP` + 配置校验 |
| 安全响应头 | `X-Content-Type-Options`、`X-Frame-Options`、`Referrer-Policy`、`Permissions-Policy` | `middleware/request.go` |
| 请求体限制 | 全局默认 32 MiB；`PUT /v1/media/uploads/` 放宽至 256 MiB | `middleware/request.go` |
| sidecar 最小权限 | 共享卷输出**仅限 guard 的派生凭据**；sidecar 不读管理员密码 | `infra/qualityguard/bootstrap.go` |
| 敏感数据不进日志 | E2E 断言日志与 trace 不含真实秘密 | `frontend/e2e/*` |
| 会话失效广播 | `subscribeSessionInvalidated`；401 自动刷新一次，刷新不可用抛 503 `sessionRefreshUnavailable` | `shared/api/client.ts` |

---

## 11. 一致性、并发与幂等

### 11.1 审计账本

- 异步有界队列 + 批量写入；worker 崩溃由 `batch.Do` 重启。
- 健康判据：连续失败阈值 / 队列高水位 / 丢事件；`CheckLedgerReady` 在 `enforce` 模式或已确认丢数据时**阻塞请求**，`observe` 模式只告警。
- 事件唯一性由 partial unique `idx_audits_event_id` 保证。

### 11.2 计费

```
请求前：ReserveBilling
  → billing_reservations 插入 + client_keys.reserved_usage_usd_ticks 原子自增（同一事务）

审计提交：同一事务内
  → 扣预留 + 加已计费 + MaxInt64 饱和

兜底：CleanupExpiredBilling 周期回收（跳过进程内活跃集）
```

**缺口**：无乐观并发版本号列，靠 DB 事务 + 饱和表达式；崩溃遗留预留最长回收窗口 = 10 分钟周期（见 §16 GAP-5）。

### 11.3 额度与封锁

- `account_quota_windows` + `account_quota_recoveries`：到期恢复事件由 `ClaimDueQuotaRecoveries` 原子认领，`reconcileDue` 每分钟对齐。
- 模型级封锁 `account_model_quota_blocks`（`PruneExpiredModelQuotaBlocks` 周期清理）。
- 出口租约封锁 `account_egress_lease_blocks`。
- 冷却写入用 `CASE WHEN cooldown_until > ?`，**只延长不缩短**。

### 11.4 并发控制

| 层 | 机制 | 超限行为 |
| --- | --- | --- |
| 实例 | `middleware.ConcurrencyGate` | 503 `server_overloaded` + `Retry-After: 1` |
| 账号 | `ConcurrencyLimiter` 租约 | 换号或等待 |
| 密钥 | `RateLimiter`（RPM） | 429 |
| 跨实例互斥 | `DistributedLock`（响应清理、媒体、凭据刷新） | 单实例执行 |
| 上游限流记忆 | 团队模型 429 记忆 | 短期排除该模型/账号组合 |

### 11.5 失效广播

仓储写入经 `SetInvalidationObserver` 通知 → `Notify` **先同步应用本地** → 再有界队列（2048）合并后远端发布；订阅端跳过自身 source。投递尽力而为，本地 TTL / 30s 轮询兜底。**缺口**：无一致性 SLO（见 §16 GAP-6）。

---

## 12. 可观测性

| 手段 | 现状 |
| --- | --- |
| 日志 | slog JSON → stdout，含 requestID；访问日志中间件 |
| 存活/就绪 | `/healthz`、`/readyz`（分层组件快照） |
| 请求关联 | `requestID` + `eventID` 贯穿审计与出口 trace |
| 审计查询 | 管理面列表/详情/汇总（含尝试链、耗时、用量、计费） |
| 性能 | `pkg/perfmetrics` 写日志与内存 gauge，**无导出端点** |
| 全链路 trace | 无（仅 `egress.Trace` 与 requestID/eventID 关联） |
| 前端错误 | 路由级 `errorElement` 可恢复界面；会话不可用有独立状态页 |

**缺口**：无 SLO 定义、无指标导出端点、无请求级全链路 trace（见 §16 GAP-8）。

---

## 13. 前端设计

### 13.1 路由与外壳

| 路径 | 页面 | 访问 |
| --- | --- | --- |
| `/login` | `LoginPage` | 匿名（已登录跳 `/dashboard`） |
| `/` | 重定向 `/dashboard` | — |
| `/dashboard` | 仪表盘 | 需登录 |
| `/accounts` | 账号池 | 需登录 |
| `/models` | 模型路由 | 需登录 |
| `/client-keys` | 客户端密钥 | 需登录 |
| `/gallery`、`/video-gallery` | 媒体库 | 需登录（沉浸式布局） |
| `/request-audits` | 请求审计 | 需登录 |
| `/quality-guard` | 出口质量守护 | 需登录 |
| `/creative-console` | 创作台 | 需登录（沉浸式布局） |
| `/docs/:category/:endpoint` | API 文档 | 需登录 |
| `/settings` | 设置中心 | 需登录 |
| `*` | 重定向 `/dashboard` | — |

- 侧栏主导航 9 项（`shell-nav-config.ts`）；文档导航 4 组 16 个端点（Chat 3 / Image 2 / Video 4 / Voice 7）。
- 认证边界四态：`restoring`（Spinner）→ `anonymous`（跳 `/login`，携带 `state.from`）/ `unavailable`（会话不可用重试页）/ `authenticated`（Outlet）。
- 12 个页面与 `AppShell` 全部 `React.lazy`，与 `loadDeferredResources()` 并发 resolve 后才渲染（避免未翻译 key 闪现）。
- **无角色分级**：登录态对象仅 `{id, username}`；全仓无 role 字段。

### 13.2 特性模块与实体依赖

| feature | 产品能力 | 依赖的 entity |
| --- | --- | --- |
| `auth` | 管理员登录 | — |
| `dashboard` | 调用量/趋势/模型 Top/Provider 分布/资源/热力图 | `system` |
| `accounts` | 三类账号池全生命周期 | `accounts`、`egress` |
| `models` | 模型路由维护与同步 | `model` |
| `client-keys` | 密钥与范围管理 | `client-keys`、`model` |
| `audits` | 请求审计明细与汇总 | `accounts`、`client-keys`、`model` |
| `media` | 图片/视频库 | 自持 `media-api` |
| `quality-guard` | 出口巡检与降级治理 | `egress`、`accounts` |
| `settings` | 8 个设置分页 + 出口治理 | `egress`、`system` |
| `creative-console` | 对话/图像/视频/语音创作 | `model`、`client-keys`、`media` |
| `docs` | 对外 API 参考 | `model`、`system` |

### 13.3 设计系统与国际化

 - 21 个 shadcn 原语（`components/ui`）；`components.json`：`style: new-york`、`baseColor: neutral`、`cssVariables: true`、`iconLibrary: lucide`。
- Design token：`index.css` 的 `:root` 与 `.dark` 两套 oklch 变量（含 `--sidebar*`），经 `@theme inline` 映射为 Tailwind 色板；`--radius: 0.5rem`。Tailwind v4（`@import "tailwindcss"` + `tw-animate-css`）。
- i18n：zh-CN（默认，fallback）与 en；首屏同步 3 域（`common`、`auth`、`api-errors`），懒加载 12 域；key 组织为「领域.子域.项」；持久化键 `grok2api:language`。

### 13.4 前端测试与门禁

- 双运行器：`pnpm test` = node:test（`src/**/*.test.ts`，Node 环境，纯逻辑）；`pnpm test:ui:coverage` = Vitest（`src/**/*.test.tsx`，jsdom）。
 - Vitest 覆盖率：全局 76/76/76/76 且 **`perFile: true`**；31 个自定义 hook 逐文件 100%（条目直接读 `frontend/vitest.config.ts` 的 `thresholds`）。
- E2E：Playwright，projects `chromium`（Desktop Chrome）与 `mobile-chromium`（Pixel 5，`grepInvert /@desktop/`），`retries: 0`，timeout 90s；每 worker 独立后端进程/端口/临时目录/合成凭据；globalSetup 用内容指纹判定 dist 与后端二进制新鲜度。

---

## 14. 质量保障体系

### 14.1 门禁矩阵

| 门禁 | 命令 | 判定 | 规则 |
| --- | --- | --- | --- |
| 版本载体一致 | `pnpm check:version` | `VERSION == "v" + package.json.version` | `DEV-4` |
| 格式 | `pnpm format:check` | Prettier | `DEV-5` |
| Lint | `pnpm oxlint`、`pnpm lint` | correctness + TS/React/Hooks 语义 | `DEV-5`、`DEV-2` |
| 类型 | `pnpm typecheck`、`pnpm typecheck:e2e` | 显式契约、禁新增 `any` | `DEV-2` |
| 纯逻辑测试 | `pnpm test` + `pnpm test:results:node` | 必需用例执行且无未登记跳过 | `DEV-4`、`TEST-3` |
| 组件测试与覆盖率 | `pnpm test:ui:coverage` + `pnpm test:results` | 逐文件 76% / hook 100% | `TEST-1`、`TEST-2` |
| 架构 | `pnpm check:architecture` | 依赖方向 + 无跨 feature | `DEV-3` |
| 结构 | `pnpm check:structure` | 600/50/3 | `REV-1`、`REV-2`、`REV-3` |
| 门禁自测 | `pnpm test:gates` | 每个门禁的负样本必须失败 | `EVID-3` |
| 构建与体积 | `pnpm build` + `pnpm check:budget` | 5 项体积预算 | `REV-5` |
| 全栈 E2E | `pnpm test:e2e` + `pnpm test:results:e2e` | 真实 Go 后端 + 生产前端产物 | `TEST-5`、`TEST-3` |
| 后端构建/静态检查 | `go build ./...`、`go vet ./...` | 退出 0 | `TEST-6` |
| 后端结构 | `go run ./tools/structurecheck` | 600/50/3（基线棘轮） | `REV-1`、`REV-2`、`REV-3` |
| 后端契约 | `go run ./tools/apicheck` | 与 `api-baseline.txt` 逐条一致 | `TEST-6` |
| 容器输入 | `go run ./tools/dockerfilecheck` | COPY 覆盖 + 未被 ignore + 源存在 | `TEST-6` |
| 后端测试 | `go test ./... -count=1` | 全绿 | `TEST-6` |

**阈值唯一来源**：体积预算 `frontend/bundle-budget.json`；结构基线 `frontend/structure-baseline.json`、`backend/structure-baseline.json`；覆盖率 `frontend/vitest.config.ts`。规则见 `AGENTS.md` 的 `REV-1`/`REV-2`/`REV-3`/`REV-5`、`TEST-1`/`TEST-2`；门禁清单 SSOT 是 `AGENTS.md` 的 BIND-4（前端 `DEV-4`、后端 `TEST-6`）。本表只作矩阵索引，不复制命令清单。

### 14.2 一键入口

- 前端：`pnpm verify`（串行执行，步骤清单 SSOT：`AGENTS.md` 的 BIND-4 / DEV-4）→ `pnpm verify:full`（+ E2E + E2E 报告门禁）。
- 后端：`bash scripts/verify.sh`（**必须 cwd = `backend/`**，否则 exit 2；步骤清单 SSOT：`AGENTS.md` 的 BIND-4 / TEST-6）。

### 14.3 CI（`.github/workflows/ghcr-image.yml`）

job 结构：`verify`（PG17 + Redis7 service）→ `check_ghcr_image`（PR，仅构建）/ `build_ghcr_image`（push，推镜像）→ `merge`（合成 manifest list 并断言同时含 amd64/arm64）。

`verify` job 的关键顺序：Checkout → Go → 版本载体一致 → 后端测试 → **必需集成用例断言** → race → vet → 结构与 API 契约 → Dockerfile 输入 → Swagger 精确 diff → pnpm/Node → `pnpm verify` → 预算 artifact → Playwright → 全栈 E2E → **必需前端用例断言** → 产物上传。

另有 `codeql.yml`（actions/go/js-ts，含每日 cron）与 `stale.yml`。

---

## 15. 交付与部署

### 15.1 镜像（`Dockerfile`，三阶段）

```
frontend-builder (node:22-alpine)  →  pnpm build → /src/frontend/dist
backend-builder  (golang:1.26-alpine) → CGO_ENABLED=0 go build -trimpath -ldflags="-s -w"
runtime          (alpine:3.23)     → /app/grok2api + /app/frontend/dist + /app/VERSION
```

- 非 root 用户 `grok2api`（uid 10001）；预建 `/app/data`、`/run/grok2api`、`/var/lib/grok2api-quality-guard`。
- `ENV TZ=Asia/Shanghai`、`GROK2API_CONFIG_SOURCE=/run/grok2api/config.yaml`。
- `EXPOSE 8000`；`HEALTHCHECK` 打 `/healthz`；CMD `--config /app/config.yaml --listen 0.0.0.0:8000`。
- **`COPY VERSION /app/VERSION` 是镜像内唯一版本源**，由 `buildinfo.CurrentVersion()` 读取。

### 15.2 Compose

- 主服务：镜像 `${GROK2API_IMAGE:-ghcr.io/chenyme/grok2api:latest}`、`restart: unless-stopped`、`init: true`、`stop_grace_period: 30s`、`no-new-privileges`。
- 卷：配置只读挂载 + `grok2api-data` + `quality_guard_state`。
- 环境变量：`TZ`、`GROK2API_DATABASE_URL`（非空则覆盖 DSN 并启用 postgres）、`GROK2API_QUALITY_GUARD_DIR`。
- profile：`quality-guard`（已启用定义，默认不启动）、`warp`/`flaresolverr`（注释示例）。

### 15.3 配置分组（`config.example.yaml`）

`server`、`auth`、`secrets`、`bootstrapAdmin`、`frontend`、`database`、`runtimeStore`、`deployment`、`media`、`routing`、`audit`、`qualityGuard`。

高风险默认值：`secrets.*` 与 `bootstrapAdmin.password` 必改；`audit.ledgerMode: enforce`（账本不可用即阻塞）；`qualityGuard.enabled: false`；`server.swaggerEnabled: false`；`trustedProxies: []`。

### 15.4 发布流程

① 维护分支 fast-forward 合并 `main` 并推送 → ② annotated tag `vX.Y.Z` → ③ GitHub Release → ④ 等 `ghcr-image.yml` 产出多架构镜像与 manifest list → ⑤ 在两个 `AUDIT.md` 登记 tag/commit/run id/digest。

不可逆操作（合并 `main`、tag/Release、推镜像、删除重建远端仓库）**逐次单独授权**。

---

## 16. 已知设计缺口与演进方向

优先级口径：P1 阻塞阶段验收/发布；P2 已登记不扩张；P3 建议项。

| 编号 | 缺口 | 影响 | 建议方向 | 优先级 |
| --- | --- | --- | --- | --- |
| GAP-1 | 发布路径无真实远端证据（CI 的两条断言 step 从未执行） | 无法声称发布前置达成 | 推送交付分支取得 run 证据并登记 | P1 |
| GAP-2 | `application → infra` 生产依赖 27 文件 / 29 对未收敛 | 分层边界弱化、替换成本高 | 逐项引入 Port 并收敛，例外数只降不升 | P2 |
| GAP-3 | 无版本化迁移（无版本表、无 down、无迁移指标） | 生产升级与回滚缺乏依据 | 引入迁移版本记录 + 迁移耗时/锁等待日志 | P2 |
| GAP-4 | `memory` 运行态在多副本下静默退化 | 多副本限流/粘滞/锁失效且无告警 | `replicas > 1` + `memory` 组合 fail-closed 或显式告警 | P2 |
| GAP-5 | 计费预留无乐观并发；崩溃遗留预留回收窗口 10 分钟 | 超收/漏收窗口未定义 | 定义并登记最长窗口；评估加版本号列 | P2 |
| GAP-6 | 失效广播与设置广播为 best-effort，无一致性 SLO | 跨实例状态可能短暂不一致 | 定义一致性 SLO 与观测手段 | P2 |
| GAP-7 | Provider 能力声明仅运行时校验 | 漏改只在启动暴露 | 以接口断言测试或代码生成把校验前移 | P3 |
| GAP-8 | 无 SLO、无指标导出端点、无全链路 trace | 排障依赖日志拼接，容量规划缺数据 | 定义 SLO + 至少一个指标导出端点 | P2 |
| GAP-9 | 选号公平性/饥饿无集中契约（分散在 10+ 文件） | 行为难以整体推理 | 集中描述不变量并加断言测试 | P3 |
| GAP-10 | `/readyz` 仅二值，无「部分能力可用」降级声明 | 单 Provider 不可用时无法表达 | 扩展就绪快照语义并接入路由排除 | P3 |
| GAP-11 | `application/gateway` 单包 40+ 文件、多个 440+ 行文件 | 单包认知负荷高 | 按「选号/转发/结算/媒体」边界拆分，门禁保持全绿 | P3 |
| GAP-12 | 外部依赖（FlareSolverr / Statsig signer / ipinfo 探针）无熔断与灰度流程文档 | 外部故障影响面不清 | 明确超时、重试、降级、回滚流程 | P3 |
| GAP-13 | 认证后首屏体积 282.30 KiB 超 260 KiB 且未入门禁；`runtime-config.js` 漏算；嵌套 `import()` 不可见 | 体积预算口径不完整 | 收口口径或显式登记豁免 | P2 |

---

## 17. 附录

### 17.1 关键环境变量

| 变量 | 作用 |
| --- | --- |
| `GROK2API_DATABASE_URL` | 覆盖 Postgres DSN（非空即启用 postgres） |
| `GROK2API_QUALITY_GUARD_DIR` | 与质量守护 sidecar 交换 bootstrap/state/runtime-config 的目录 |
| `GROK2API_VERSION` | 版本覆盖（`buildinfo`） |
| `GROK2API_AUTO_ASSIGN_MAX_NODE_SHARE` / `..._MIGRATION_SHARE` | 出口自动分配占比上限 |
| `GROK2API_CONFIG_SOURCE` | 镜像内配置来源路径（Dockerfile 设置） |

### 17.2 CLI

仅 `--config` 与 `--listen`，**无子命令**；默认配置路径 `config.yaml` 或 `../config.yaml`。

### 17.3 关键常量（示例）

| 常量 | 值 | 位置 |
| --- | --- | --- |
| 响应归属 TTL | 30 天 | `application/gateway/service.go` |
| 并发租约 TTL | `requestTimeout + 1m` | `app/assemble.go` |
| 失效广播队列上限 | 2048 | `application/invalidation/service.go` |
| 非账号指纹尝试上限 | 16 | `application/gateway/service_ratelimit.go` |
| 流空闲尝试上限 | 2 | 同上 |
| 审计默认批量 | 256 / 250ms | `config.example.yaml` |
| 上传体积放宽 | 256 MiB | `middleware/request.go` |

### 17.4 未确认项

- `domain/dashboard` 与 `domain/model/upstream_profile.go` 的完整字段语义。
- `infra/egress/lease.go` 的租约分配算法细节。
- `infra/provider/console/normalize.go` 的协议映射细节。
- 生产注入脚本 `/runtime-config.js` 的实际内容（前端仓库内无该文件）。

### 17.5 复现命令

```powershell
# 路由与模型规模
# 路由注册条数（字节级读取；`AGENTS.md` DEV-5 禁止用 shell 文本工具做编码/行数敏感判定）
Get-ChildItem backend\internal\transport\http -Recurse -File -Filter *.go |
  Where-Object { $_.Name -notmatch '_test' } |
  ForEach-Object { [System.IO.File]::ReadAllText($_.FullName,[System.Text.Encoding]::UTF8) } |
  ForEach-Object { ([regex]::Matches($_, '\.(GET|POST|PUT|PATCH|DELETE)\("')).Count } |
  Measure-Object -Sum
# 关系型模型数量：schemaModels 字面量定位（同一字节级口径）
$schema = (Resolve-Path backend\internal\infra\persistence\relational\schema.go).Path
[regex]::Matches([System.IO.File]::ReadAllText($schema,[System.Text.Encoding]::UTF8), 'schemaModels\s*=\s*\[\]any\{') | Measure-Object

# 契约与结构
cd backend; go run ./tools/apicheck; go run ./tools/structurecheck; go run ./tools/dockerfilecheck
# 前端门禁
cd frontend; pnpm verify
```

§9.1 的路由条数由本节第一条命令复现；§8.1 的模型数按同一字节级口径统计 `schemaModels` 字面量内的条目（第二条命令只定位该字面量），以避免 shell 文本工具的行数/编码口径差异（`AGENTS.md` META-2 / DEV-5）。本文是规范命令的唯一副本。

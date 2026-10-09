# 后端审计与验收报告

本文件记录后端验收矩阵、测试与性能基线、架构审计结论与问题清单。
规则唯一事实来源是根目录 [`AGENTS.md`](../AGENTS.md)；本文件只记录**实际证据**与状态。

- 基线提交：`7c0493a2`
- 维护分支：`maint/modular-quality-audit`
- 环境：Windows 11 Pro (10.0.26300)，Go `1.26.1 windows/amd64`，`CGO_ENABLED=0`，`GOFLAGS=-mod=readonly`，`GOPROXY=off`（模块缓存已就绪）
- 模块：`github.com/chenyme/grok2api/backend`，`go 1.26`
- 基线采集时已清空 `TEST_POSTGRES_DSN`、`TEST_POSTGRES_ADMIN_DSN`、`TEST_REDIS_ADDRESS`，未连接任何真实服务

## 1. 验收矩阵

| 编号 | 验收项 | 判定命令 | 基线状态 |
| --- | --- | --- | --- |
| BE-A1 | 单元/集成测试 | `go test ./... -count=1` | Passed（63 包，2820 用例，0 失败，20 跳过） |
| BE-A2 | 静态检查 | `go vet ./...` | Passed |
| BE-A3 | 编译 | `go build ./...` | Passed |
| BE-A4 | 竞态检测 | `go test -race ./...` | Passed（CI，见 §8）；本机 **Blocked**（`-race requires cgo`，无 C 编译器） |
| BE-A5 | PostgreSQL 集成 | 隔离 CI 服务 | Passed（CI，17 个用例真实执行） |
| BE-A6 | Redis 集成 | 隔离 CI 服务 | Passed（CI，3 个用例真实执行） |
| BE-A7 | 性能基准 | `-bench . -benchmem -count=5` | **Pending**（本轮测量中） |
| BE-A8 | 账号分页聚合基准 | 新增 benchmark | **Pending**（当前不存在，见 §3） |
| BE-A9 | Swagger 精确 diff | `make swagger` + `git diff --exit-code` | **Pending**（阶段 7 复核） |

`Blocked` 与 `Skipped` 均不记为通过。BE-A4/BE-A5/BE-A6 已由 CI 隔离服务补齐，证据见 §8；本机仍不具备 race 与外部存储条件。

## 2. 测试基线明细

- 包级：`pass=63`，`fail=0`，`skip=11`
- 用例级：`pass=2820`，`fail=0`，`skip=20`
- 耗时：`go test -json ./... -count=1` 118.6s；`go vet` 4.7s；`go build` 6.1s
- 跳过的 20 个用例全部是外部存储集成测试，缺少环境变量即跳过：

| 包 | 用例数 | 依赖 |
| --- | ---: | --- |
| `internal/infra/persistence/relational` | 17 | `TEST_POSTGRES_DSN` / `TEST_POSTGRES_ADMIN_DSN` |
| `internal/infra/runtime/redis` | 2 | `TEST_REDIS_ADDRESS` |
| `internal/application/account` | 1 | `TEST_REDIS_ADDRESS` |

其中包含并发与一致性关键用例（如 `TestPostgresBillingReservationAndAuditSettlementConcurrency`、`TestPostgresAuditBatchUsesStableClientKeyLockOrder`、`TestPostgresAccountLinkMutationLockSerializesTransactions`、`TestRedisQuotaRefreshCrossInstanceTrailing`）。本机无证据；**阶段 2 已在 CI 隔离服务中真实执行**，见 §8。

已有可复用的隔离机制：`postgres_integration_test.go` 的 `TestMain` 支持用 `TEST_POSTGRES_ADMIN_DSN` 自动创建并回收临时数据库（`grok2api_phase0_<纳秒>`），CI 应直接复用而不是另建一套。

## 3. 性能基线

- 已存在的 benchmark（共 12 个，Grep `^func Benchmark` 实测）：

| 文件 | Benchmark |
| --- | --- |
| `internal/infra/persistence/relational/routing_projection_benchmark_test.go` | `BenchmarkRoutingAccountBaseProjectionWithLargePayloads`（300 账号 + 大 JSON 负载）、`BenchmarkSelectedCredentialHydration` |
| `internal/application/gateway/selector_layered_benchmark_test.go` | `BenchmarkSelectorMultiModelCandidateLoad`（300 账号 × 2/8 模型） |
| `internal/application/gateway/selector_test.go` | `BenchmarkSelectorCandidatePlanning` |
| `internal/application/gateway/selector_segmented_active_test.go` | `BenchmarkSelectorSegmentedCandidatePlanning` |
| `internal/application/audit/service_benchmark_test.go` | `BenchmarkAuditServiceSQLite` |
| `internal/infra/persistence/relational/dashboard_repository_test.go` | `BenchmarkDashboardUsageAggregate` |
| `internal/infra/egress/manager_test.go` | `BenchmarkManagerAcquireCachedBuild` |
| `internal/transport/http/inference/handler_test.go` | `BenchmarkFirstTokenInspection` |
| `internal/transport/http/middleware/request_test.go` | `BenchmarkRequestBodyObservation` |
| `internal/infra/runtime/memory/store_test.go` | `BenchmarkConcurrencyLimiterCurrentMany` |
| `internal/pkg/perfmetrics/registry_test.go` | `BenchmarkRegistryParallel` |

- **缺口**：`internal/application/account` 包不存在任何 benchmark（Grep `func Benchmark` 命中 0，已核实）。而账号列表是全站最重的读路径——`Service.List` 每页要执行 6 次批量查询（账号分页、审计 token 汇总、billing、quota recovery、quota windows、model quota blocks）。阶段 4 必须补一个分页聚合基准，否则"优化"没有可比对象。
- 基准命令（后续阶段必须用同一命令对比）：

```bash
go test ./internal/application/gateway ./internal/application/audit ./internal/infra/persistence/relational -run "^$" -bench . -benchmem -count=5
go test ./internal/infra/egress ./internal/infra/runtime/memory ./internal/pkg/perfmetrics ./internal/transport/http/inference ./internal/transport/http/middleware -run "^$" -bench . -benchmem -count=5
```

- 实测中位数（5 次取第 3 位；Go 1.26.1 windows/amd64，GOMAXPROCS=8，CGO_ENABLED=0）：

| Benchmark | ns/op | B/op | allocs/op |
| --- | ---: | ---: | ---: |
| `SelectorMultiModelCandidateLoad/models_2` | 15,413,665 | 2,814,369 | 34,890 |
| `SelectorMultiModelCandidateLoad/models_8` | 22,938,981 | 5,485,970 | 50,860 |
| `SelectorSegmentedCandidatePlanning/3000/full` | 2,202,993 | 483,879 | 5,924 |
| `SelectorSegmentedCandidatePlanning/3000/active_segmented_64` | 1,348,750 | 77,638 | 157 |
| `SelectorSegmentedCandidatePlanning/3000/active_segmented_64_full_fallback` | 4,209,020 | 709,670 | 6,000 |
| `SelectorSegmentedCandidatePlanning/10000/full` | 7,594,783 | 1,782,851 | 19,951 |
| `SelectorSegmentedCandidatePlanning/10000/active_segmented_64` | 4,690,615 | 224,372 | 159 |
| `SelectorSegmentedCandidatePlanning/10000/active_segmented_64_full_fallback` | 11,245,722 | 2,512,185 | 20,078 |
| `SelectorCandidatePlanning` | 617,059 | 343,678 | 5,907 |
| `AuditServiceSQLite/attempts_0` | 427,659 | 10,853 | 91 |
| `AuditServiceSQLite/attempts_2` | 515,894 | 17,810 | 156 |
| `DashboardUsageAggregate/legacy` | 78,285,147 | 13,556 | 113 |
| `DashboardUsageAggregate/performance` | 103,834,920 | 22,242 | 130 |
| `RoutingAccountBaseProjectionWithLargePayloads` | 73,725,580 | 3,126,136 | 62,248 |
| `SelectedCredentialHydration` | 279,813 | 143,174 | 155 |
| `ManagerAcquireCachedBuild` | 1,883 | 1,633 | 12 |
| `ConcurrencyLimiterCurrentMany` | 266,380 | 219,412 | 32 |
| `RegistryParallel` | 319.8 | 0 | 0 |
| `FirstTokenInspection/responses` | 1,319 | 320 | 7 |
| `FirstTokenInspection/responses_custom_tool` | 1,748 | 336 | 7 |
| `FirstTokenInspection/chat` | 2,743 | 504 | 11 |
| `FirstTokenInspection/anthropic` | 2,401 | 408 | 10 |
| `RequestBodyObservation/plain` | 3,156 | 5,383 | 15 |
| `RequestBodyObservation/observed` | 4,446 | 5,449 | 16 |

- **噪声警告**：`DashboardUsageAggregate`（performance 子用例 5 次区间 97.8M–118.7M ns/op）与 `RoutingAccountBaseProjectionWithLargePayloads` 波动较大；后续对比必须先评估噪声水平，不能把单次差异当作优化收益。
- 分段选号收益的现有证据：3000 候选下 `active_segmented_64` 相对 `full` 为 1.35M vs 2.20M ns/op、157 vs 5,924 allocs/op；10000 候选下为 4.69M vs 7.59M ns/op、159 vs 19,951 allocs/op。这是**已有实现**的基线，不是本轮优化成果。

## 4. 架构审计

### 4.1 分层与依赖方向

目标方向：Transport → Application → Domain；Repository/Ports 定义契约，Infra 实现；`internal/app` 为装配入口。

静态扫描（247 个非测试 Go 文件）结果：

- `internal/domain/**` → 无越界依赖。**方向正确。**
- `internal/repository/**` → 无越界依赖（仅依赖 domain）。**方向正确。**
- `internal/application/**` → 存在 **28 处**对 infra 的依赖，需登记并逐步收敛：

| 目标 infra 包 | 引用位置（示例） | 判定 |
| --- | --- | --- |
| `infra/provider` | account、accountsync、gateway/{attempt,failure,image,service,video,voice,voice_ws}、model | provider 包内含大量**能力契约**（`Adapter`、`BillingAdapter`、`CredentialCodecAdapter`…约 30 个接口），契约与实现同包是根因；应把契约收敛到独立 ports 包 |
| `infra/security` | account、adminauth、clientkey、egress、gateway/{quality_probe,service,video} | `Cipher`/`TokenService` 为具体实现，application 直接依赖具体类型 |
| `infra/egress` | gateway/{egress_audit,image,quality_probe,quality_retry,service,video,voice,voice_ws} | 同上 |
| `infra/config` | settings | 配置结构体被应用层直接消费 |

处理原则：**区分"契约放错层"与"真实实现耦合"**。优先把确属公共能力的 provider 契约迁到 `internal/ports/provider/`；security/config/egress 的依赖按消费者数量与隔离价值逐项评估，只在确有收益时引入窄接口，不做全库机械搬迁。

### 4.2 结构与体量基线

- 源码文件：247 个（不含 `_test.go`）。
- 最大的文件：

| 文件 | 行数 |
| --- | ---: |
| `internal/application/account/service.go` | 4717 |
| `internal/infra/persistence/relational/account_repository.go` | 2846 |
| `internal/infra/provider/web/chat.go` | 2733 |
| `internal/transport/http/inference/handler.go` | 2475 |
| `internal/infra/egress/manager.go` | 2342 |
| `internal/application/gateway/selector.go` | 2247 |
| `internal/application/gateway/service.go` | 2194 |
| `internal/infra/provider/web/image.go` | 1850 |
| `internal/transport/http/account/handler.go` | 1642 |
| `internal/transport/http/egress/handler.go` | 1579 |
| `internal/infra/provider/provider.go` | 1468 |
| `internal/application/egress/service.go` | 1443 |
| `internal/application/gateway/video.go` | 1414 |
| `internal/infra/persistence/relational/model_repository.go` | 1327 |
| `internal/infra/provider/cli/adapter.go` | 1308 |
| `internal/infra/persistence/relational/audit_repository.go` | 1133 |

- 装配入口 `internal/app/application.go`（865 行）：单个 `New()` 内完成数据库、运行态存储、三个 Provider 适配器、全部应用服务与 HTTP 路由装配；`Run()`（约 180 行）串行启动 20+ 个后台任务。属于"职责正确但函数过长"，需按数据库/运行态、Provider、应用服务、HTTP、后台生命周期拆分。
- `internal/app/startup.go` 的 `readinessSnapshot` 约 135 行，混合了就绪判定与组件状态拼装。

### 4.3 已具备且不应重复建设的能力

- Provider 能力接口 + `Registry` 注册校验（重复注册、别名指向、规范路由 ID 校验）。
- 选号分层与分段（`segmentedSelectorEnabled`，3000 候选阈值、窗口 64）、原子并发门禁、粘滞路由、额度优先级。
- 事务与并发控制：账号关联变更使用行锁（`clause.Locking{Strength:"UPDATE"}`）、审计批次稳定加锁顺序、分布式锁（memory/redis 双实现）。
- 批量能力：`pkg/batch` 共享池与子池（import/conversion/sync/refresh 并发度可热更新）。
- 审计账本：`observe`/`enforce` 模式、队列水位、不可恢复判定与就绪联动。
- 就绪模型：`/readyz` 返回分层组件状态，空池/无可用账号为 `not_ready`（生产语义，测试不得放宽）。
- 运行态双实现：memory 与 redis 共享同一 `repository` 契约。
- 结论：性能与稳定性优化必须复用上述能力，不新增平行调度器、第二套重试框架或重复锁。

## 5. 问题清单

| 编号 | 证据 | 现有/新增 | 影响 | 优先级 | 阶段 | 验证方法 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| BE-01 | `application/account/service.go` 4717 行等 16 个 >1000 行文件 | 现有 | 可维护性、审查成本 | P2 | 4–6 | 按用例/读写/调度拆分 | Pending |
| BE-02 | 28 处 application → infra 依赖（§4.1） | 现有 | 分层模糊，契约与实现同包 | P2 | 3 | 契约迁 ports + 边界测试 | Pending |
| BE-03 | 账号列表已按页批量（6 次查询），非 N+1 | 现有 | 不应虚构缺陷 | P2 | 4 | 补查询次数断言与基准 | Pending |
| QA-01 | 20 个 PostgreSQL/Redis 集成用例在本机跳过，含并发/锁/账本不变量 | 现有 | 关键一致性无本地证据 | P1 | 1、7 | CI 隔离 service 真实执行 | **Passed**（CI 0 跳过 / 2842 通过，并暴露并修复 1 个用例缺陷） |
| QA-02 | `go test -race` 本机 Blocked（无 cgo） | 现有 | 竞态检测缺失 | P1 | 7 | Linux CI 执行 | **Passed**（CI `go test -race ./... -count=1` success） |
| QA-03 | `internal/application/account` 无 benchmark | 现有 | 最重读路径无可比基线 | P2 | 4 | 新增分页聚合基准 | Pending |
| BE-04 | `app.New()`/`Run()` 单函数过长，装配与生命周期混合 | 现有 | 变更风险集中 | P2 | 3 | 拆分后回归装配与关闭顺序 | Pending |
| BE-05 | `infra/provider/provider.go` 1468 行含约 30 个能力接口 | 现有 | 契约与实现同包 | P2 | 3 | 迁至 ports 并同步调用方 | Pending |

## 6. 强制保留的前轮修复（回归清单）

架构改造必须保持以下已修复行为，不得在拆分中丢失：

1. 未知 Build 403 沿用既有指纹上限（16 次）终止；**不新增**对未知 403 的账号惩罚或冷却。
2. 视频任务按 ClientKey `AccountScope()` 限制（`AcquirePinnedForKey` + `beginSelectionSessionForKey`）；`ClientKeyID==0` 保持不受限。
3. Voice/STT WebSocket 观察请求取消与截止时间；传输失败仍对已确认时长计费（`usageConfirmed`）。
4. 质量拦截（`shouldHoldQualityStream`）仅作用于 Build 路由，排除 Console 加密推理误判。
5. Build SSO 同意页解析 `consent_token`，保留 HTTP 状态，`Origin`/`Referer` 由同意页 URL 推导。
6. 模型级额度封锁在账号视图与前端可见（`GetModelQuotaBlocks`）。
7. 代理 URL 支持 IPv4 `IP:Port:User:Pass`，且 `{account}` 占位替换**先于**解析以保持粘滞语义。
8. 持久化的低于 `1.0.13` 的 Build 客户端版本回填为推荐版本。

## 7. 后续阶段与回滚

- 阶段顺序与文件范围见 `.pi/plan/前后端全量审计与分阶段模块化升级计划-20261009-1947.md`。
- 回滚：按阶段提交回滚源码与文档；本阶段不涉及生产数据迁移，无需数据回滚。公开协议（路由、DTO、Swagger）必须保持，若确需变更则单独确认。

## 8. CI 真实验证（阶段 2）

`maint/modular-quality-audit` 的草稿 PR #1 触发真实 GitHub Actions（GHCR Image run #4，sha `6f762fb7`），工作流 **conclusion=success**，`Verify` job 全部步骤 success：

| 步骤 | 结果 | 说明 |
| --- | --- | --- |
| Test backend | success | `go test ./... -count=1 -json`，**0 跳过**，2842 通过 |
| Assert required integration tests ran | success | 20 个外部依赖集成用例全部真实执行（断言未被跳过） |
| Race backend | success | `go test -race ./... -count=1`，补齐本机 Blocked 的 BE-A4 |
| Vet backend | success | `go vet ./...` |
| Verify Swagger document | success | `make swagger` + 精确 diff |
| Verify frontend | success | `pnpm verify`（含依赖边界、结构、门禁自测、覆盖率、体积预算） |
| Install Playwright browser / Run full-stack E2E | success | 真实全栈 E2E |
| Build image (amd64 / arm64) | success | PR 模式镜像构建 |

隔离服务：`postgres:17-alpine`（`pg_isready` 健康检查）、`redis:7-alpine`（`redis-cli ping`），`TEST_POSTGRES_ADMIN_DSN` / `TEST_REDIS_ADDRESS` / `TEST_REDIS_DATABASE=9` 只指向本 job 容器，不触碰任何真实服务。

### 首次运行即暴露的用例缺陷（已修复）

`TestPostgresRoutingProjectionAndCredentialHydration` 此前从未在 CI 运行。首次真实执行即失败：用例创建 **Web** 账号，却用 **Build** 池调用 `UpdateMany` 并把返回的 `ErrAccountPoolMismatch` 当作失败。

`UpdateMany` 在 provider 不匹配时返回该错误是**有意的守卫**（`account_repository.go:1625-1632`），另有 `TestAccountRepositoryUpdateManyRejectsMixedProviderBeforeWriting` 专门断言。因此这是**测试期望写错，不是产品缺陷**。修复方式：显式断言跨池更新被拒绝（为 PostgreSQL 侧新增该守卫覆盖），再用正确的 Web 池禁用账号并验证凭据不可用——原意图保留且覆盖增强。

### CI-01：main 的镜像发布因 pnpm 供应链策略失败（既有问题，非本分支引入）

- 现象：`main` @ `7c0493a2` 的 `Publish image (amd64/arm64)` 在 `Build and publish` 失败；同一 commit 的 `Verify` job 通过。该失败自 run #1（`51acd5da`）起持续存在。
- 根因（Docker 内日志）：`pnpm fetch` 触发 `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`，`1 lockfile entries failed verification (433 entries in 2.9s)`。
- 策略来源：仓库未显式配置 `minimumReleaseAge`（`pnpm config get minimumReleaseAge` 返回 `undefined`），约束来自 pnpm 12 的内置默认值；`frontend/pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude: [vite@8.3.4]` 说明此前已命中过一次。
- 时间依赖：本地与 CI 的 `pnpm install` 会缓存校验结果（"verified 1h ago"），Docker 内为全新校验；本分支 PR 模式的镜像构建（同一 Dockerfile、`push: false`）**通过**，说明当前 lockfile 在本次校验时满足策略。
- 处置：**不通过降低安全约束绕过**。登记为 P2 待处理项；push 模式无法在未合并 `main` 的前提下验证，因此不声称已修复。

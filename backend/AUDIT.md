# 后端审计与验收报告

本文件记录后端验收矩阵、测试与性能基线、架构审计结论与问题清单。
规则唯一事实来源是根目录 [`AGENTS.md`](../AGENTS.md)；本文件只记录**实际证据**与状态。

- 基线提交：`7c0493a2`
- 维护分支：`maint/modular-quality-audit`
- 环境：Windows 11 Pro (10.0.26300)，Go `1.26.1 windows/amd64`，`CGO_ENABLED=0`，`GOFLAGS=-mod=readonly`，`GOPROXY=off`（模块缓存已就绪）
- 模块：`github.com/chenyme/grok2api/backend`，`go 1.26`
- 基线采集时已清空 `TEST_POSTGRES_DSN`、`TEST_POSTGRES_ADMIN_DSN`、`TEST_REDIS_ADDRESS`，未连接任何真实服务

## 1. 验收矩阵

| 编号  | 验收项            | 判定命令                                | 基线状态                                                                   |
| ----- | ----------------- | --------------------------------------- | -------------------------------------------------------------------------- |
| BE-A1 | 单元/集成测试     | `go test ./... -count=1`                | Passed（63 包，2820 用例，0 失败，20 跳过）                                |
| BE-A2 | 静态检查          | `go vet ./...`                          | Passed                                                                     |
| BE-A3 | 编译              | `go build ./...`                        | Passed                                                                     |
| BE-A4 | 竞态检测          | `go test -race ./...`                   | Passed（CI，见 §8）；本机 **Blocked**（`-race requires cgo`，无 C 编译器） |
| BE-A5 | PostgreSQL 集成   | 隔离 CI 服务                            | Passed（CI，17 个用例真实执行）                                            |
| BE-A6 | Redis 集成        | 隔离 CI 服务                            | Passed（CI，3 个用例真实执行）                                             |
| BE-A7 | 性能基准          | `-bench . -benchmem -count=5`           | **Pending**（本轮测量中）                                                  |
| BE-A8 | 账号分页聚合基准  | 新增 benchmark                          | **Pending**（当前不存在，见 §3）                                           |
| BE-A9 | Swagger 精确 diff | `make swagger` + `git diff --exit-code` | **Pending**（阶段 7 复核）                                                 |

`Blocked` 与 `Skipped` 均不记为通过。BE-A4/BE-A5/BE-A6 已由 CI 隔离服务补齐，证据见 §8；本机仍不具备 race 与外部存储条件。

## 2. 测试基线明细

- 包级：`pass=63`，`fail=0`，`skip=11`
- 用例级：`pass=2820`，`fail=0`，`skip=20`
- 耗时：`go test -json ./... -count=1` 118.6s；`go vet` 4.7s；`go build` 6.1s
- 跳过的 20 个用例全部是外部存储集成测试，缺少环境变量即跳过：

| 包                                      | 用例数 | 依赖                                            |
| --------------------------------------- | -----: | ----------------------------------------------- |
| `internal/infra/persistence/relational` |     17 | `TEST_POSTGRES_DSN` / `TEST_POSTGRES_ADMIN_DSN` |
| `internal/infra/runtime/redis`          |      2 | `TEST_REDIS_ADDRESS`                            |
| `internal/application/account`          |      1 | `TEST_REDIS_ADDRESS`                            |

其中包含并发与一致性关键用例（如 `TestPostgresBillingReservationAndAuditSettlementConcurrency`、`TestPostgresAuditBatchUsesStableClientKeyLockOrder`、`TestPostgresAccountLinkMutationLockSerializesTransactions`、`TestRedisQuotaRefreshCrossInstanceTrailing`）。本机无证据；**阶段 2 已在 CI 隔离服务中真实执行**，见 §8。

已有可复用的隔离机制：`postgres_integration_test.go` 的 `TestMain` 支持用 `TEST_POSTGRES_ADMIN_DSN` 自动创建并回收临时数据库（`grok2api_phase0_<纳秒>`），CI 应直接复用而不是另建一套。

## 3. 性能基线

- 已存在的 benchmark（共 12 个，Grep `^func Benchmark` 实测）：

| 文件                                                                         | Benchmark                                                                                                                   |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `internal/infra/persistence/relational/routing_projection_benchmark_test.go` | `BenchmarkRoutingAccountBaseProjectionWithLargePayloads`（300 账号 + 大 JSON 负载）、`BenchmarkSelectedCredentialHydration` |
| `internal/application/gateway/selector_layered_benchmark_test.go`            | `BenchmarkSelectorMultiModelCandidateLoad`（300 账号 × 2/8 模型）                                                           |
| `internal/application/gateway/selector_test.go`                              | `BenchmarkSelectorCandidatePlanning`                                                                                        |
| `internal/application/gateway/selector_segmented_active_test.go`             | `BenchmarkSelectorSegmentedCandidatePlanning`                                                                               |
| `internal/application/audit/service_benchmark_test.go`                       | `BenchmarkAuditServiceSQLite`                                                                                               |
| `internal/infra/persistence/relational/dashboard_repository_test.go`         | `BenchmarkDashboardUsageAggregate`                                                                                          |
| `internal/infra/egress/manager_test.go`                                      | `BenchmarkManagerAcquireCachedBuild`                                                                                        |
| `internal/transport/http/inference/handler_test.go`                          | `BenchmarkFirstTokenInspection`                                                                                             |
| `internal/transport/http/middleware/request_test.go`                         | `BenchmarkRequestBodyObservation`                                                                                           |
| `internal/infra/runtime/memory/store_test.go`                                | `BenchmarkConcurrencyLimiterCurrentMany`                                                                                    |
| `internal/pkg/perfmetrics/registry_test.go`                                  | `BenchmarkRegistryParallel`                                                                                                 |

- **缺口**：`internal/application/account` 包不存在任何 benchmark（Grep `func Benchmark` 命中 0，已核实）。而账号列表是全站最重的读路径——`Service.List` 每页要执行 6 次批量查询（账号分页、审计 token 汇总、billing、quota recovery、quota windows、model quota blocks）。阶段 4 必须补一个分页聚合基准，否则"优化"没有可比对象。
- 基准命令（后续阶段必须用同一命令对比）：

```bash
go test ./internal/application/gateway ./internal/application/audit ./internal/infra/persistence/relational -run "^$" -bench . -benchmem -count=5
go test ./internal/infra/egress ./internal/infra/runtime/memory ./internal/pkg/perfmetrics ./internal/transport/http/inference ./internal/transport/http/middleware -run "^$" -bench . -benchmem -count=5
```

- 实测中位数（5 次取第 3 位；Go 1.26.1 windows/amd64，GOMAXPROCS=8，CGO_ENABLED=0）：

| Benchmark                                                                    |       ns/op |      B/op | allocs/op |
| ---------------------------------------------------------------------------- | ----------: | --------: | --------: |
| `SelectorMultiModelCandidateLoad/models_2`                                   |  15,413,665 | 2,814,369 |    34,890 |
| `SelectorMultiModelCandidateLoad/models_8`                                   |  22,938,981 | 5,485,970 |    50,860 |
| `SelectorSegmentedCandidatePlanning/3000/full`                               |   2,202,993 |   483,879 |     5,924 |
| `SelectorSegmentedCandidatePlanning/3000/active_segmented_64`                |   1,348,750 |    77,638 |       157 |
| `SelectorSegmentedCandidatePlanning/3000/active_segmented_64_full_fallback`  |   4,209,020 |   709,670 |     6,000 |
| `SelectorSegmentedCandidatePlanning/10000/full`                              |   7,594,783 | 1,782,851 |    19,951 |
| `SelectorSegmentedCandidatePlanning/10000/active_segmented_64`               |   4,690,615 |   224,372 |       159 |
| `SelectorSegmentedCandidatePlanning/10000/active_segmented_64_full_fallback` |  11,245,722 | 2,512,185 |    20,078 |
| `SelectorCandidatePlanning`                                                  |     617,059 |   343,678 |     5,907 |
| `AuditServiceSQLite/attempts_0`                                              |     427,659 |    10,853 |        91 |
| `AuditServiceSQLite/attempts_2`                                              |     515,894 |    17,810 |       156 |
| `DashboardUsageAggregate/legacy`                                             |  78,285,147 |    13,556 |       113 |
| `DashboardUsageAggregate/performance`                                        | 103,834,920 |    22,242 |       130 |
| `RoutingAccountBaseProjectionWithLargePayloads`                              |  73,725,580 | 3,126,136 |    62,248 |
| `SelectedCredentialHydration`                                                |     279,813 |   143,174 |       155 |
| `ManagerAcquireCachedBuild`                                                  |       1,883 |     1,633 |        12 |
| `ConcurrencyLimiterCurrentMany`                                              |     266,380 |   219,412 |        32 |
| `RegistryParallel`                                                           |       319.8 |         0 |         0 |
| `FirstTokenInspection/responses`                                             |       1,319 |       320 |         7 |
| `FirstTokenInspection/responses_custom_tool`                                 |       1,748 |       336 |         7 |
| `FirstTokenInspection/chat`                                                  |       2,743 |       504 |        11 |
| `FirstTokenInspection/anthropic`                                             |       2,401 |       408 |        10 |
| `RequestBodyObservation/plain`                                               |       3,156 |     5,383 |        15 |
| `RequestBodyObservation/observed`                                            |       4,446 |     5,449 |        16 |

- **噪声警告**：`DashboardUsageAggregate`（performance 子用例 5 次区间 97.8M–118.7M ns/op）与 `RoutingAccountBaseProjectionWithLargePayloads` 波动较大；后续对比必须先评估噪声水平，不能把单次差异当作优化收益。
- 分段选号收益的现有证据：3000 候选下 `active_segmented_64` 相对 `full` 为 1.35M vs 2.20M ns/op、157 vs 5,924 allocs/op；10000 候选下为 4.69M vs 7.59M ns/op、159 vs 19,951 allocs/op。这是**已有实现**的基线，不是本轮优化成果。

## 4. 架构审计

### 4.1 分层与依赖方向

目标方向：Transport → Application → Domain；Repository/Ports 定义契约，Infra 实现；`internal/app` 为装配入口。

静态扫描（247 个非测试 Go 文件）结果：

- `internal/domain/**` → 无越界依赖。**方向正确。**
- `internal/repository/**` → 无越界依赖（仅依赖 domain）。**方向正确。**
- `internal/application/**` → 存在 **28 处**对 infra 的依赖，需登记并逐步收敛：

| 目标 infra 包    | 引用位置（示例）                                                                          | 判定                                                                                                                                                     |
| ---------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `infra/provider` | account、accountsync、gateway/{attempt,failure,image,service,video,voice,voice_ws}、model | provider 包内含大量**能力契约**（`Adapter`、`BillingAdapter`、`CredentialCodecAdapter`…约 30 个接口），契约与实现同包是根因；应把契约收敛到独立 ports 包 |
| `infra/security` | account、adminauth、clientkey、egress、gateway/{quality_probe,service,video}              | `Cipher`/`TokenService` 为具体实现，application 直接依赖具体类型                                                                                         |
| `infra/egress`   | gateway/{egress_audit,image,quality_probe,quality_retry,service,video,voice,voice_ws}     | 同上                                                                                                                                                     |
| `infra/config`   | settings                                                                                  | 配置结构体被应用层直接消费                                                                                                                               |

处理原则：**区分"契约放错层"与"真实实现耦合"**。优先把确属公共能力的 provider 契约迁到 `internal/ports/provider/`；security/config/egress 的依赖按消费者数量与隔离价值逐项评估，只在确有收益时引入窄接口，不做全库机械搬迁。

### 4.2 结构与体量基线

- 源码文件：247 个（不含 `_test.go`）。
- 最大的文件：

| 文件                                                          | 行数 |
| ------------------------------------------------------------- | ---: |
| `internal/application/account/service.go`                     | 4717 |
| `internal/infra/persistence/relational/account_repository.go` | 2846 |
| `internal/infra/provider/web/chat.go`                         | 2733 |
| `internal/transport/http/inference/handler.go`                | 2475 |
| `internal/infra/egress/manager.go`                            | 2342 |
| `internal/application/gateway/selector.go`                    | 2247 |
| `internal/application/gateway/service.go`                     | 2194 |
| `internal/infra/provider/web/image.go`                        | 1850 |
| `internal/transport/http/account/handler.go`                  | 1642 |
| `internal/transport/http/egress/handler.go`                   | 1579 |
| `internal/infra/provider/provider.go`                         | 1468 |
| `internal/application/egress/service.go`                      | 1443 |
| `internal/application/gateway/video.go`                       | 1414 |
| `internal/infra/persistence/relational/model_repository.go`   | 1327 |
| `internal/infra/provider/cli/adapter.go`                      | 1308 |
| `internal/infra/persistence/relational/audit_repository.go`   | 1133 |

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

| 编号  | 证据                                                            | 现有/新增 | 影响                     | 优先级 | 阶段 | 验证方法                 | 状态                                                           |
| ----- | --------------------------------------------------------------- | --------- | ------------------------ | ------ | ---- | ------------------------ | -------------------------------------------------------------- |
| BE-01 | `application/account/service.go` 4717 行等 16 个 >1000 行文件   | 现有      | 可维护性、审查成本       | P2     | 4–6  | 按用例/读写/调度拆分     | Pending                                                        |
| BE-02 | 28 处 application → infra 依赖（§4.1）                          | 现有      | 分层模糊，契约与实现同包 | P2     | 3    | 契约迁 ports + 边界测试  | Pending                                                        |
| BE-03 | 账号列表已按页批量（6 次查询），非 N+1                          | 现有      | 不应虚构缺陷             | P2     | 4    | 补查询次数断言与基准     | Pending                                                        |
| QA-01 | 20 个 PostgreSQL/Redis 集成用例在本机跳过，含并发/锁/账本不变量 | 现有      | 关键一致性无本地证据     | P1     | 1、7 | CI 隔离 service 真实执行 | **Passed**（CI 0 跳过 / 2842 通过，并暴露并修复 1 个用例缺陷） |
| QA-02 | `go test -race` 本机 Blocked（无 cgo）                          | 现有      | 竞态检测缺失             | P1     | 7    | Linux CI 执行            | **Passed**（CI `go test -race ./... -count=1` success）        |
| QA-03 | `internal/application/account` 无 benchmark                     | 现有      | 最重读路径无可比基线     | P2     | 4    | 新增分页聚合基准         | Pending                                                        |
| BE-04 | `app.New()`/`Run()` 单函数过长，装配与生命周期混合              | 现有      | 变更风险集中             | P2     | 3    | 拆分后回归装配与关闭顺序 | Pending                                                        |
| BE-05 | `infra/provider/provider.go` 1468 行含约 30 个能力接口          | 现有      | 契约与实现同包           | P2     | 3    | 迁至 ports 并同步调用方  | Pending                                                        |

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

| 步骤                                            | 结果    | 说明                                                          |
| ----------------------------------------------- | ------- | ------------------------------------------------------------- |
| Test backend                                    | success | `go test ./... -count=1 -json`，**0 跳过**，2842 通过         |
| Assert required integration tests ran           | success | 20 个外部依赖集成用例全部真实执行（断言未被跳过）             |
| Race backend                                    | success | `go test -race ./... -count=1`，补齐本机 Blocked 的 BE-A4     |
| Vet backend                                     | success | `go vet ./...`                                                |
| Verify Swagger document                         | success | `make swagger` + 精确 diff                                    |
| Verify frontend                                 | success | `pnpm verify`（含依赖边界、结构、门禁自测、覆盖率、体积预算） |
| Install Playwright browser / Run full-stack E2E | success | 真实全栈 E2E                                                  |
| Build image (amd64 / arm64)                     | success | PR 模式镜像构建                                               |

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

## 9. 阶段 3 成果（后端契约分层）

- 新增 `internal/ports/provider`：12 个非测试文件 / 1554 行，35 个接口 + 值类型 + 错误类型 + `Registry` 契约接口
- `internal/infra/provider/provider.go`：1468 → **466 行**（仅剩 Registry 实现与编译期断言 `var _ ports.Registry = (*Registry)(nil)`）
- 删除已整体迁移的 `infra/provider/{definition,rate_limit,account_block}.go`
- `internal/application/**` **生产代码**对 `infra/provider` 的依赖：12 个文件 / 206 处 → **0**；94 个消费者文件同步更新
- 新增标准库边界测试 `internal/ports/provider/import_boundary_test.go`：domain / repository / ports 不得 import `internal/infra/`，application 生产代码不得 import `infra/provider`；已用注入违规反证其会失败

验证：`go build ./...`、`go vet ./...`、`go test ./... -count=1` 全部 exit 0（64 包，0 FAIL，20 个外部存储集成用例按预期跳过）；24 个 benchmark 全部编译；`pnpm verify:full` exit 0（6 个 E2E 使用迁移后的后端二进制）。

### 阶段 3 遗留（已登记，非隐藏）

- 22 个 `internal/application/**` **测试**文件仍 import `infra/provider`（仅用 `NewRegistry`），边界测试显式允许；生产代码已为 0。
- 未消除的存量依赖：`infra/security`（7 文件）、`infra/egress`（8 文件）、`infra/config`（1 文件）。本轮只处理确属公共能力契约的 provider，其余逐项判断见阶段报告。
- `Registry.Validate` 仍为 86 行（REV-2 超限），本轮未改动。
- `internal/infra/provider/web/sso_build_test.go` 存在与 HEAD 逐字一致的 gofmt 对齐偏差（存量，未夹带修复）。
- 观察到一个与本改动无关的偶发失败（`infra/egress` 的 `TestPinnedHTTPSClientSOCKS5HReceivesPinnedIP`，Windows loopback reset），单独重跑 3 次通过，该包不在 diff 内。

## 10. 阶段 4 成果（账号模块拆分）

| 文件                                                          |   前 |                                         后 |
| ------------------------------------------------------------- | ---: | -----------------------------------------: |
| `internal/application/account/service.go`                     | 4717 |     **294**（+ 13 个按用例分组的同包文件） |
| `internal/infra/persistence/relational/account_repository.go` | 2846 | **47**（+ 8 个按数据访问关注点分组的文件） |

- 未引入新包，`Service` / `AccountRepository` 的公开方法签名零改动，transport 与 `internal/app` 无需修改
- 拆分等价性以「函数体行多重集比对」证明：`service.go` 4439 = 4439、`account_repository.go` 2706 = 2706，无代码丢失或重复
- application 侧分组：查询与视图组装、导入、Provider 转换、导出、凭据刷新、billing、quota、quota 刷新队列、批量任务、管理操作、检测、观察模型
- 仓储侧分组：分页查询、单账号读取、路由投影（候选/基础 + 路由侧装载）、写入（事务与行锁）、批量更新与清理、状态写入、billing 与 quota

### 新增基准与不变量（QA-03 / BE-03）

- `BenchmarkServiceListPageAggregation`（300 账号 + billing + 额度恢复 + 额度窗口 + 模型封锁 + 审计 token）：**8.60 / 9.81 / 9.61 ms/op，1.573–1.613 MB/op，19 233–19 642 allocs/op**。该包此前**没有任何 benchmark**，这是首个可比基线。
- `TestListPageAggregationQueryCountIsPageSizeIndependent`：pageSize ∈ {1, 20, 50, 300} 时，`Service.List` 的仓储调用序列恒为 `List → SumTokensByAccountsSince → GetBillings → GetQuotaRecoveries → GetQuotaWindows → GetModelQuotaBlocks`（固定 6 次），且每个批量方法只调用一次并收到整页 ID，即调用数不随页大小增长，**不存在 N+1**。计数在仓储边界实现（`relational.Database` 不暴露 GORM 句柄，SQL 级计数需为测试新增生产 API，故采用等价的调用级证据）。
- 回归检查：`BenchmarkRoutingAccountBaseProjectionWithLargePayloads` 拆分后 99.2 / 90.4 / 96.6 ms/op、3 107–3 128 KB/op、62 223–62 270 allocs/op；同机 HEAD 基线 124.3 / 176.5 / 111.5 ms/op、3 083–3 128 KB/op、62 220–62 272 allocs/op → **内存与分配完全一致，无回归**（ns/op 抖动来自本机负载）。

验证：`go build ./...`、`go vet ./...`、`go test ./... -count=1` 全部 exit 0；20 个外部存储集成用例按预期跳过；`pnpm verify` 与 `pnpm test:e2e`（6/6）全绿。

### 阶段 4 遗留（如实登记）

- `infra/persistence/relational/account_links.go` 仍 **776 行**（>600），属存量基线债务，不在本轮两个目标文件范围内。
- 测试文件仍超 600 行：`quota_refresh_test.go` 1434、`credential_refresh_test.go` 909、`account_links_test.go` 753 等，本阶段未拆分。
- 行为完全保持意味着 `Service.List` 仍是 6 次 SQL 往返；本轮**未**做合并优化（属需求外，且需先有实测收益证据）。
- `Registry.Validate` 仍 86 行（REV-2 超限），未改动。

### CI-01 更正与最终诊断（重跑后确认）

上文的「供应链策略」只是**第一层、且是瞬时的**原因；重跑后它已自愈，暴露出真正持续的阻塞。

**证据链**

| 运行                      | Publish 任务耗时           | 结果                                                                                                          |
| ------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------- |
| main run #1（`51acd5da`） | 32s（10:57:11→10:57:43）   | 在早期 `pnpm fetch` 失败（`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`）                                          |
| main run #2 重跑          | ~2min（15:31:43→15:33:16） | 供应链检查已通过（`✓ Lockfile passes supply-chain policies (433 entries in 3.1s)`），构建完成后在**推送**失败 |

**真正的阻塞**（持续、非时间依赖）

```
ERROR: failed to push ghcr.io/jasminetony/grok2api:main-arm64: denied: permission_denied: write_package
```

**根因**：`JasmineTony/grok2api` 是 **2026-10-09T10:34:12Z 重新创建**的（此前被删除并重建），而 GHCR 命名空间下的 `jasminetony/grok2api` 包由**旧仓库实例**创建、在仓库删除后成为**孤立包**。新仓库的 `GITHUB_TOKEN` 对该包没有写权限，因此 `packages: write` 请求被拒。仓库 `default_workflow_permissions` 为 `read`，进一步说明该仓库的 Actions 权限是收紧配置。

注意：工作流本身**是正确的**——`build_ghcr_image` 已声明 `permissions: { contents: read, packages: write }`。因此这不是 YAML 缺陷，无法靠改代码修复。

**为什么分支看起来是绿的**：PR 事件只跑 `check_ghcr_image`（`push: false`，仅构建不推送），永远不会触发推送，因此碰不到该拒绝。分支**无法**修复此问题。

**所需操作（需要 GitHub 设置或具备包作用域的凭据，当前 token 缺少 `read:packages`，包 API 返回 403，我无法代为执行）**

1. 打开 GitHub → 个人头像 → **Packages** → `grok2api` → Package settings → **Connect repository** → 选择 `JasmineTony/grok2api`；随后重跑 main 的失败任务。
2. 或**删除该孤立包**，让新仓库在下一次推送时重新创建并持有它。
3. 可选：Settings → Actions → General → Workflow permissions 改为 "Read and write"，消除歧义（job 级 `packages: write` 仍然保留）。

**已完成的持久修复（本分支）**：`frontend/pnpm-workspace.yaml` 显式固定 `minimumReleaseAge: 1440`（原为 pnpm 12 内置默认值，值不变、行为不变），使这条隐形策略变成可审查的仓库配置，避免同类失败再次以「不可见原因」出现。

## 11. 阶段 5 成果（后端出口与设置拆分）与 CI 状态

维护分支 `d5cc4597`，**CI run #12 = success**；此前 #10（`53f51d63`）、#11（`990bc954`）同为 success。

- `infra/egress/manager.go` 2342 → 拆为 clearance / clearance_refresh / client_cache / fallback / health / lease / node_select / probe
- `application/egress/service.go` 1443 → nodes / binding / proxy_profiles / proxy_url / quality_lease
- `transport/http/egress/handler.go` 1579 → nodes / proxy_profiles / sources / quality_guard / quality_guard_lease
- `application/settings/service.go` → config_apply / editable_config
- 同包内分文件，公开签名零改动；`go build` / `go vet` / `go test ./... -count=1` 全部 exit 0

### CI 运行语义（排障须知）

`.github/workflows/ghcr-image.yml` 配置了 `concurrency.cancel-in-progress`：连续推送会让先前的运行被判为 `cancelled`（不是失败），只有最后一次推送的运行代表当前状态。

### main 分支的持久阻塞（需人工在 GitHub 操作）

`Publish image (amd64/arm64)` 始终失败：

`ERROR: failed to push ghcr.io/jasminetony/grok2api:main-amd64: denied: permission_denied: write_package`

根因：`JasmineTony/grok2api` 于 2026-10-09T10:34:12Z 重建，而 GHCR 包由旧仓库实例创建、成为孤立包，新仓库的 `GITHUB_TOKEN` 无写权限；仓库 `default_workflow_permissions = read`。工作流 YAML 正确（`packages: write` 已声明），改代码无法修复。

先前观察到的 `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` 是第一层**瞬时**原因（pnpm 12 内置 24h 供应链策略），重跑后已自愈；本分支已在 `frontend/pnpm-workspace.yaml` 显式固定 `minimumReleaseAge: 1440`（值不变）使该策略可审查。

修复方式：Packages → grok2api → Package settings → Connect repository → 选 `JasmineTony/grok2api`；或删除孤立包；然后重跑 main 的失败任务。

## 12. 阶段 6 成果（Gateway / 推理传输 / Web Provider 拆分）

本阶段把后端三条最重的执行链按职责拆分文件，并做函数级 REV-2 分解。全部为**行为等价搬移**：导出符号、HTTP 契约、SSE 分帧、状态码、错误文案、脱敏与计费/审计顺序均未改变；既有 `*_test.go` 零修改（只新增测试文件）。

### 12.1 文件级拆分

下表「前」为 HEAD `236175e4` 实测，「后」为当前工作树实测（均为文件实际行数）。阶段 6 的工作树叠加了两轮改动（按职责拆文件 + 函数分解），因此部分文件的「后」比拆分当次更大——那是后续函数分解回填所致，不是回退。

| 包 / 文件                              |   前 |      后 | 新增按职责文件                                                                                                                                                                                                                                                   |
| -------------------------------------- | ---: | ------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `application/gateway/service.go`       | 2194 |    1951 | `service_routes.go` 340                                                                                                                                                                                                                                          |
| `application/gateway/selector.go`      | 2247 |    1063 | `selector_cache.go` 678、`selector_health_cache.go` 664                                                                                                                                                                                                          |
| `application/gateway/video.go`         | 1414 |    1304 | `video_tasks.go` 123                                                                                                                                                                                                                                             |
| `application/gateway/voice.go`         |  552 |     304 | `voice_execution.go` 357                                                                                                                                                                                                                                         |
| `application/gateway/quality_retry.go` |  611 |     361 | `quality_decision.go` 258                                                                                                                                                                                                                                        |
| `application/gateway/image.go`         |  378 |     111 | `image_execution.go` 398                                                                                                                                                                                                                                         |
| `transport/http/inference/handler.go`  | 2475 |  **91** | 12 个：`video_handler` 484、`stream_inspector` 421、`stream_copy` 312、`errors` 270、`image_handler` 278、`stream_usage` 206、`response_writer` 226、`media_response` 144、`responses_handler` 157、`models_handler` 100、`chat_handler` 100、`request_types` 97 |
| `infra/provider/web/chat.go`           | 2733 | **439** | 10 个：`chat_search` 396、`chat_response` 368、`anthropic_stream` 337、`chat_parse` 355、`chat_request` 293、`chat_sse` 246、`chat_openai_stream` 280、`chat_card` 198、`chat_types` 141、`web_wire` 99                                                          |
| `infra/provider/web/image.go`          | 1850 | **336** | 8 个：`image_upload` 367、`image_ws_stream` 361、`image_collector` 234、`image_assets` 227、`image_edit_stream` 202、`image_edit` 209、`image_chat` 168、`image_params` 58                                                                                       |

职责划分（一句话/文件）：

- gateway：`service_routes`=公开模型解析与别名、会话候选过滤、媒体路由与可调度媒体路由选择、路由排序；`selector_cache`=分层候选读取、路由 base/overlay 版本与陈旧快照回退、快照裁剪与失效；`selector_health_cache`=冷却/软失败/missing-thinking 惩罚、额度窗口与消费、free/model/payment 封锁标记；`video_tasks`=固定 Worker 池、入队、认领、恢复；`voice_execution`=TTS/STT 共用执行体（账号选择→上游转发→用量/审计结算）；`quality_decision`=加密推理下限、快速 flush/突发 dump 识别与 `ClassifyQualityHold`/`DecideQualityRetry`/`CommitQualityHold`；`image_execution`=图像用例主体。
- inference：`handler.go` 只剩装配 + `Register`（24 条路由原样）+ 共享常量；`request_types`=请求 DTO；`media_response`=媒体响应写出/安全头/写截止时间；`stream_copy`=流与 JSON 拷贝、中止 trailer、内部标记过滤；`stream_inspector`=上游流巡检与安全诊断投影；`stream_usage`=usage 解析/归一/合并；`errors`=错误分类与响应映射。
- provider/web：`chat.go`=Web chat 编排（`ForwardResponse`/`openChat`/状态保存）；`chat_parse`=上游帧解析；`chat_search`=搜索/工具/引用/hosted search；`chat_sse`=Chat SSE 帧与停止序列；`web_wire`=跨协议线上原语；`image_collector`=Imagine 收集器；`image_upload`=上传与回执解码；`image_assets`=资产持久化与 URL。

**零改写证据（非目测）**：非空白非 import 代码行**多重集前后逐条相同**（inference handler 2322 行、web chat 2574、web image 1741）；顶层声明集合（kind+限定名）一致（inference 302=302、web 694=694）；gateway 按文件声明行配对一致（`selector.go` 144=144、`video.go` 49=49、`voice.go` 15=15、`quality_retry.go` 36=36、`image.go` 8=8）；`createResponseAt` 拆分前后均 908 行、逐行 0 差异；脚本直接切片的文件 gofmt 后正文哈希与源一致。

### 12.2 函数级分解（REV-2）

**结论：本轮把三个包的超限函数从 88 降到 18（降幅 80%），且无一处行数增大。**
下表的「分解前」由 HEAD `236175e4` 的独立 worktree 实测得出（AST 统计，`count` 为包内 >50 行函数总数），「本轮后」为当前工作树实测，两者由同一工具测量，可直接比较：

| 包                         | 分解前 >50 行 | 本轮后 >50 行 |   消除 |   剩余 |
| -------------------------- | ------------: | ------------: | -----: | -----: |
| `application/gateway`      |            32 |             9 |     23 |      9 |
| `transport/http/inference` |            18 |         **0** |     18 |      0 |
| `infra/provider/web`       |            38 |             9 |     29 |      9 |
| **合计**                   |        **88** |        **18** | **70** | **18** |

达标示例：`handleVideoCreate` 199→30、`transcribeSpeechRequest` 170→33、`editImage` 108→（≤50）、`sanitizeResponsesEvent` 100→（≤50）、`handleOpenAISpeech` 95→（≤50）、`streamOpenAIResponse` 201→≤50、`ForwardResponse` 184→≤50、`generateWSImageAttempt` 126→≤50、`editImageAttempt` 114→≤50、`generateLiteImageURL` 112→≤50、`buildOpenAIResult` 124→≤50、`executeImage` 259→66、`executeVoice` 237→64、`acquirePinned` 92→≤50、`beginSelectionSessionForKey` 101→≤50、`acquireSegmentedCandidates` 111→≤50、`planCandidateIndexesWithHints` 94→≤50、`segmentedCandidateCohorts` 86→≤50、`ProbeEgressQuality` 153→≤50。

仍超限函数**逐项登记**（实测行数，不隐藏、未强行拆）：

- gateway（9）：`createResponseAt` 908、`runVideoJob` 284、`OpenVoiceWebSocket` 247、`acquire` 246、`CreateVideo` 144、`executeImage` 66、`executeVoice` 64、`ClassifyQualityHold` 58、`peekQualityStream` 51
- inference：**0**（`handler.go` 2475→91 后 18 个超限函数全部消除）
- web（9）：`openGatewayChat` 93、`SyncQuotaMode` 85、`runGatewayStream` 79、`streamImageEdit` 72、`doWithFollow` 67、`executeWebAccountSetting` 60、`postJSONWithReferer` 58、`DownloadVideo` 53、`pollToken` 53

**行数未增大的证据**：`createResponseAt` 在 HEAD 与本轮工作树均为 **908** 行（未改动，未强行拆）；`runVideoJob` 284（HEAD 284）、`OpenVoiceWebSocket` 247（HEAD 247）、`acquire` 246（HEAD 246）、`CreateVideo` 144（HEAD 144）逐项持平。表内「消除」来自其余 70 个函数被真正分解，而非把行数搬进新函数。

未拆理由（真实原因，不声称「不可拆」）：gateway 的 `createResponseAt`（908 行）含 `attemptLoop`/`handleResponse`/`afterTeamRateLimit` 三处跨块 `goto`，`err`/`selection`/`fallback`/`qualityAccountAttempts`/`timingHandedOff` 与 `defer` 交织，需先按 image/voice 的返回码枚举方式等价改写控制流；`runVideoJob`/`OpenVoiceWebSocket`/`acquire` 为多锁段 + singleflight 内外双检缓存的分层状态机，需逐个核对锁边界与版本判定；web 侧 9 个含闭包捕获、goroutine 生命周期与超时/取消时序（上游协议与鉴权路径），等价提取风险高于收益。**这 18 个是阶段 6 仍未完成的 REV-2 范围，不记为「已通过」。**

验证：三包 `go test` 全通过（inference 138 / provider-web 229 / gateway 311+192 子测试，0 FAIL / 0 SKIP）；`go build ./...`、`go vet ./...` exit 0。测试通过只证明被现有断言覆盖的行为未变，未被断言覆盖的分支不做等价性声明。

### 12.3 强制回归项自检（§6 清单逐条落点）

| 回归项                                             | 阶段 6 后的落点                                                                                                | 结论 |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---- |
| 未知 Build 403 指纹上限、不对未知 403 账号新增惩罚 | `application/gateway/failure.go`（未改），调用点在 `service.go`                                                | 未变 |
| 视频请求 ClientKey AccountScope                    | `video.go::runVideoJob` 内 `AcquirePinnedForKey` / `beginSelectionSessionForKey`（`video_scope_test.go` 未改） | 未变 |
| WebSocket 截止时间与已确认 STT 用量结算            | `voice_ws.go`、`transport/http/inference/voice_ws_handler.go`（未改）                                          | 未变 |
| Build-only 质量拦截                                | `quality_retry.go::shouldHoldQualityStream`（未搬移）                                                          | 未变 |
| consent token 与各状态码处理                       | `quality_probe.go`、`response_media_audit.go`、`provider/web/sso_build.go`（未改）                             | 未变 |
| 模型级额度封锁判定与展示                           | `selector_health_cache.go` 逐行搬移；`models_handler.go::filterModelRoutesForClientKey`                        | 未变 |
| `{account}` 占位符先于代理解析                     | `infra/egress`（未改）                                                                                         | 未变 |
| Build 客户端版本回填                               | `provider/web` 对应文件逐行搬移                                                                                | 未变 |
| 取消/超时不放行后续尝试、不重复计费                | `stream_copy.go` 中止 trailer、`errors.go::classifyCopyError`、gateway 各 `ctx.Err()`/`context.Canceled` 分支  | 未变 |

### 12.3.1 独立审查发现并处理的问题

对 12 个提交做过一次独立只读审查，结论与处置：

| 发现 | 核实方式 | 处置 |
| --- | --- | --- |
| `image_execution.go` 连续两次 `checkLedgerReady()`（复制残留） | 对照 HEAD `236175e4:gateway/image.go` 实测**只有 1 次** | **已删除重复调用**（该检查幂等只读，行为等价且恢复与基线一致）；`go build`/`vet`/gateway 包测试 exit 0 |
| `voice_execution.go`/`image_execution.go` 尝试循环把上一轮 `err` 带入下一轮，`if err == nil` 可能跳过 `Acquire` | 对照 HEAD `236175e4:gateway/voice.go:357-363`：基线**同样是循环外 `var err error` + `if err == nil` 守卫**，结构逐行一致 | **判定为既有行为被忠实保留，非本轮引入**；未改动（改它会改变既有重试语义，超出「等价搬移」范围）。已登记为**未覆盖风险**：voice/image 执行链目前无「第 1 账号传输失败 → 第 2 账号成功」的用例，`voice_ws.go` 亦复用同一写法，三者并存 |
| `§12.1`「后」列行数过时（叠加了后续函数分解） | 用文件实际行数重新实测 | **已更新全表**，并注明「后」为工作树实测、部分数值大于拆分当次是函数分解回填所致 |
| `§12.2` 结论「86 → 18」与同节表格「88 → 18」矛盾 | 复核 HEAD 基线实测为 88 | **已更正为 88 / 降幅 80%** |
| `§12.4` 新增用例数「47（16/13/18）」与文件实际不符 | 实测 `^func Test` 为 22/34/18 | **已更正为 74（22/34/18）** |

审查同时确认无问题：`voice_ws.go` 的 WebSocket 截止时间、`sso_build.go` 的 consent token、`quality_retry.go` 的 Build-only 拦截、`stream_copy.go` 的中止 trailer 与 `errors.go::classifyCopyError` 均未被改写；`selector_cache.go`/`selector_health_cache.go` 未见 `defer` 与显式 `Unlock` 混用导致的重复解锁。

### 12.4 验证

- `go build ./...` exit 0；`go vet ./...` exit 0
- `go test ./... -count=1` exit 0：**64 包 ok / 0 FAIL / 2879 PASS / 20 SKIP**（20 条为 PostgreSQL·Redis 集成用例，本机无隔离服务，属预期；CI 提供隔离服务后必须 0 skip）
- 新增测试 3 文件 / 74 个顶层用例：`application/gateway/refactor_helpers_test.go` 22、`transport/http/inference/refactor_helpers_test.go` 34、`infra/provider/web/refactor_helpers_test.go` 18；覆盖提取出的定价估算、STT 格式化（text/json/verbose_json/rawjson）、媒体 JSON 解码、选择失败码、流分帧与 EOF 处理、导入凭据归一、图像/编辑校验拒绝路径（计数为 `^func Test` 实测，`inference` 侧含 2 处 `t.Run` 子用例）
- `-race` 本机无 cgo，**Blocked**，由 CI 覆盖

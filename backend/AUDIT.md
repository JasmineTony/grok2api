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

- 已存在的 benchmark（阶段 0 基线为 12 个；当前工作树 Grep `^func Benchmark` 实测 **19 个**，含阶段 4 新增的 `BenchmarkServiceListPageAggregation` 与 §13.2 新增的 6 个 `infra/provider/web` 基准）：

| 文件                                                                         | Benchmark                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `internal/infra/persistence/relational/routing_projection_benchmark_test.go` | `BenchmarkRoutingAccountBaseProjectionWithLargePayloads`（300 账号 + 大 JSON 负载）、`BenchmarkSelectedCredentialHydration`                                                                                                                      |
| `internal/application/gateway/selector_layered_benchmark_test.go`            | `BenchmarkSelectorMultiModelCandidateLoad`（300 账号 × 2/8 模型）                                                                                                                                                                                |
| `internal/application/gateway/selector_test.go`                              | `BenchmarkSelectorCandidatePlanning`                                                                                                                                                                                                             |
| `internal/application/gateway/selector_segmented_active_test.go`             | `BenchmarkSelectorSegmentedCandidatePlanning`                                                                                                                                                                                                    |
| `internal/application/audit/service_benchmark_test.go`                       | `BenchmarkAuditServiceSQLite`                                                                                                                                                                                                                    |
| `internal/infra/persistence/relational/dashboard_repository_test.go`         | `BenchmarkDashboardUsageAggregate`                                                                                                                                                                                                               |
| `internal/infra/egress/manager_test.go`                                      | `BenchmarkManagerAcquireCachedBuild`                                                                                                                                                                                                             |
| `internal/transport/http/inference/handler_test.go`                          | `BenchmarkFirstTokenInspection`                                                                                                                                                                                                                  |
| `internal/transport/http/middleware/request_test.go`                         | `BenchmarkRequestBodyObservation`                                                                                                                                                                                                                |
| `internal/infra/runtime/memory/store_test.go`                                | `BenchmarkConcurrencyLimiterCurrentMany`                                                                                                                                                                                                         |
| `internal/pkg/perfmetrics/registry_test.go`                                  | `BenchmarkRegistryParallel`                                                                                                                                                                                                                      |
| `internal/infra/provider/web/benchmark_test.go`                              | 阶段 6 收尾新增 6 个：`BenchmarkConsumeJSONObjects`、`BenchmarkParseUpstreamFrame`、`BenchmarkNormalizeOpenAIInput`、`BenchmarkBuildOpenAIChatResult`、`BenchmarkParseWeeklyCreditsResponse`、`BenchmarkInferWebTierFromQuota`（实测值见 §13.2） |

- **缺口**：`internal/application/account` 包不存在任何 benchmark（阶段 0 核实；**已由阶段 4 的 `list_page_benchmark_test.go::BenchmarkServiceListPageAggregation` 补齐**，见 §10）。而账号列表是全站最重的读路径——`Service.List` 每页要执行 6 次批量查询（账号分页、审计 token 汇总、billing、quota recovery、quota windows、model quota blocks）。阶段 4 已补分页聚合基准，见 §10 与 §13.2。
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

| 编号  | 证据                                                                                                                                                                      | 现有/新增                           | 影响                                        | 优先级 | 阶段   | 验证方法                                   | 状态                                                                                                                                                  |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------- | ------ | ------ | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| BE-01 | `application/account/service.go` 4717 行等 16 个 >1000 行文件                                                                                                             | 现有                                | 可维护性、审查成本                          | P2     | 4–6    | 按用例/读写/调度拆分                       | Pending                                                                                                                                               |
| BE-02 | 28 处 application → infra 依赖（§4.1）                                                                                                                                    | 现有                                | 分层模糊，契约与实现同包                    | P2     | 3      | 契约迁 ports + 边界测试                    | Pending                                                                                                                                               |
| BE-03 | 账号列表已按页批量（6 次查询），非 N+1                                                                                                                                    | 现有                                | 不应虚构缺陷                                | P2     | 4      | 补查询次数断言与基准                       | **Passed**（阶段 4：`TestListPageAggregationQueryCountIsPageSizeIndependent` 断言 pageSize 1–300 恒为固定 6 次批量调用；§10）                         |
| QA-01 | 20 个 PostgreSQL/Redis 集成用例在本机跳过，含并发/锁/账本不变量                                                                                                           | 现有                                | 关键一致性无本地证据                        | P1     | 1、7   | CI 隔离 service 真实执行                   | **Passed**（CI 0 跳过 / 2842 通过，并暴露并修复 1 个用例缺陷）                                                                                        |
| QA-02 | `go test -race` 本机 Blocked（无 cgo）                                                                                                                                    | 现有                                | 竞态检测缺失                                | P1     | 7      | Linux CI 执行                              | **Passed**（CI `go test -race ./... -count=1` success）                                                                                               |
| QA-03 | `internal/application/account` 无 benchmark                                                                                                                               | 现有                                | 最重读路径无可比基线                        | P2     | 4      | 新增分页聚合基准                           | **Passed**（阶段 4 新增 `BenchmarkServiceListPageAggregation`：8.60 / 9.81 / 9.61 ms/op；§10）                                                        |
| BE-04 | `app.New()`/`Run()` 单函数过长，装配与生命周期混合                                                                                                                        | 现有                                | 变更风险集中                                | P2     | 3      | 拆分后回归装配与关闭顺序                   | Pending                                                                                                                                               |
| BE-05 | `infra/provider/provider.go` 1468 行含约 30 个能力接口                                                                                                                    | 现有                                | 契约与实现同包                              | P2     | 3      | 迁至 ports 并同步调用方                    | Pending                                                                                                                                               |
| BE-06 | 媒体尝试循环跨轮携带 `err`，判定换号/重试后下一轮跳过 `Acquire`，健康账号仍在池中却返回 503 `ErrNoAvailableAccount`（`gateway/voice_execution.go`、`image_execution.go`） | 现有（基线即有，阶段 6 收尾前未修） | 单账号凭据失效/传输抖动被放大为下游可见 503 | P1     | 6 收尾 | 两账号夹具回归测试断言第二个账号被真正租用 | **Passed**（§13.1：改为每轮独立 `acquireErr`；`media_attempt_loop_test.go` 3 条断言；`go build`/`vet`/`go test ./... -count=1` exit 0，64 包 0 FAIL） |
| BE-07 | `.github/workflows/ghcr-image.yml` 两个 `Docker metadata` 步骤未设 `flavor`；run `38054220100` job `114229640946` 日志 `ERROR: ghcr.io/jasminetony/grok2api:latest-arm64: not found` | 新增（2026-10-10 发布时暴露） | tag 推送时 `Merge image` 必然失败；per-arch 另推单架构裸 `latest` | P1 | 发布 | 加 `flavor: latest=false` 并用临时 tag 实测 tag 推送路径 | **Passed**（`b4068303`；tag 推送 run `38060494037`、main 推送 run `38060467337` 全部 job success，§11/§14） |
| BE-08 | `merge` 的 `Create manifest list` 循环缺 `set -euo pipefail`，管道退出码只反映 `while` 最后一次迭代 | 新增（只读代码审查发现） | 前面的 `imagetools create` 失败可被后续成功掩盖，留下陈旧标签却报绿 | P3 | 发布 | 在 `run:` 首行加 `set -euo pipefail` | **Passed**（`a4f58384`；两条路径 CI 全绿，§11/§14） |

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

根因：`JasmineTony/grok2api` 于 2026-10-09T10:34:12Z 重建，而 GHCR 包由旧仓库实例创建、成为孤立包，新仓库的 `GITHUB_TOKEN` 无写权限；仓库 `default_workflow_permissions = read`。工作流 YAML 正确（`packages: write` 已声明），改代码无法修复。**2026-10-10 复核确认**：run `37921816518`（`main`，`7c0493a2`）与 run `38054220100`（tag `v0.1.1`，`b2123a7d`）的 Publish job 日志中 `GITHUB_TOKEN Permissions` 段均已列出 `Packages: write`，却仍以同一条 `permission_denied: write_package` 失败——拒绝发生在**包级授权**，不是 token 权限或工作流声明。另需注意：本仓库只在 `main` 与 `v*.*.*` tag 上触发 push 事件，因此 `maint/modular-quality-audit` 分支上的历史 `GHCR Image` 运行全部是 PR 事件（`Publish`/`Merge` 按 `if` 条件 skipped），从未真正执行过镜像推送，早期「main 的持久阻塞」只在 `main` 推送时可见。

**2026-10-10 已解除（实测）**：`GET /users/JasmineTony/packages/container/grok2api` 显示 `repository = null`、162 个版本全部来自重建前的旧实例，证实「孤立包」。经维护线负责人授权，用带 `read:packages` + `delete:packages` 的 OAuth device flow 凭据执行 `DELETE /users/JasmineTony/packages/container/grok2api` → **HTTP 204**（复查 404），再由 CI 重建：新包 2026-10-10T13:57:17Z 创建、`visibility=public`、`repository=JasmineTony/grok2api`。随后重跑 run `38054220100` 的失败任务，`Publish image (amd64)` 与 `(arm64)` 成功；重跑 run `38055278879`（`main`）后 `Publish` 与 `Merge image` 全部 success。注册表实测 9 个 tag（`v0.1.1`、`v0.1.1-amd64`、`v0.1.1-arm64`、`main`、`main-amd64`、`main-arm64`、`latest`、`latest-amd64`、`latest-arm64`），`v0.1.1`/`main`/`latest` 均为 linux/amd64 + linux/arm64 的 `application/vnd.oci.image.index.v1+json`，匿名拉取 HTTP 200。**原「修复方式」中的 UI 连接仓库路径仍然有效，但本次采用删除孤立包并重建，无需人工 UI 操作。**
先前观察到的 `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` 是第一层**瞬时**原因（pnpm 12 内置 24h 供应链策略），重跑后已自愈；本分支已在 `frontend/pnpm-workspace.yaml` 显式固定 `minimumReleaseAge: 1440`（值不变）使该策略可审查。

修复方式：Packages → grok2api → Package settings → Connect repository → 选 `JasmineTony/grok2api`；或删除孤立包；然后重跑 main 的失败任务。

**2026-10-10 后续修复（工作流缺陷，与孤立包无关）**：孤立包解除后暴露出独立缺陷——tag 推送时 `Merge image` 必然失败。根因：`docker/metadata-action@v5` 未设 `flavor`，默认 `latest=auto` 对 `type=ref,event=tag` **无条件**标记 latest（自动 latest 只继承 `flavor.prefix/suffix`、不继承条目级 `suffix=`），因此 per-arch 步骤在 tag 推送时另推一个单架构裸 `latest`，merge 步骤去找不存在的 `latest-amd64`/`latest-arm64` 而报 `latest-arm64: not found`。已在 `b4068303` 给两个 `Docker metadata` 步骤加 `flavor: latest=false`，并在 `a4f58384` 给 `Create manifest list` 循环加 `set -euo pipefail`（只读审查发现的 P3）。实测：临时 tag `v0.1.1-verify.1` 的 run `38060494037` 与 main 推送 run `38060467337` 全部 job success；验证后已删除临时 tag 与其 3 个镜像版本。登记见 §5 `BE-07`/`BE-08`。

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

**结论：本阶段把三个包的超限函数从 88 降到 18（降幅 80%）；阶段 6 收尾的后续函数分解把它进一步降到 7（累计降幅 92%），且无一处行数增大。**
下表的「分解前」由 HEAD `236175e4` 的独立 worktree 实测得出（AST 统计，`count` 为包内 >50 行函数总数），「阶段 6 本轮后」为该阶段的记录值，「当前工作树实测」为阶段 6 收尾后由同口径工具重新统计：

| 包                         | 分解前 >50 行（HEAD `236175e4`） | 阶段 6 本轮后 | 当前工作树实测 | 累计消除 |
| -------------------------- | -------------------------------: | ------------: | -------------: | -------: |
| `application/gateway`      |                               32 |             9 |          **7** |       25 |
| `transport/http/inference` |                               18 |         **0** |          **0** |       18 |
| `infra/provider/web`       |                               38 |             9 |          **0** |       38 |
| **合计**                   |                           **88** |        **18** |          **7** |   **81** |

达标示例：`handleVideoCreate` 199→30、`transcribeSpeechRequest` 170→33、`editImage` 108→（≤50）、`sanitizeResponsesEvent` 100→（≤50）、`handleOpenAISpeech` 95→（≤50）、`streamOpenAIResponse` 201→≤50、`ForwardResponse` 184→≤50、`generateWSImageAttempt` 126→≤50、`editImageAttempt` 114→≤50、`generateLiteImageURL` 112→≤50、`buildOpenAIResult` 124→≤50、`executeImage` 259→66、`executeVoice` 237→64、`acquirePinned` 92→≤50、`beginSelectionSessionForKey` 101→≤50、`acquireSegmentedCandidates` 111→≤50、`planCandidateIndexesWithHints` 94→≤50、`segmentedCandidateCohorts` 86→≤50、`ProbeEgressQuality` 153→≤50。

当前仍超限函数**逐项登记**（当前工作树 AST 实测行数，不隐藏、未强行拆）：

- gateway（7）：`createResponseAt` 908、`runVideoJob` 284、`OpenVoiceWebSocket` 247、`acquire` 246、`executeImage` 57、`executeVoice` 54、`CreateVideo` 52
- inference：**0**（`handler.go` 2475→91 后 18 个超限函数全部消除，本阶段无回升）
- web：**0**（阶段 6 收尾拆掉 `openGatewayChat` 93、`SyncQuotaMode` 85、`runGatewayStream` 79、`streamImageEdit` 72、`doWithFollow` 67、`executeWebAccountSetting` 60、`postJSONWithReferer` 58、`DownloadVideo` 53、`pollToken` 53 共 9 个；该包已无 >50 行函数）

结构分布：扣除 `createResponseAt`（908 行，已登记为不强行拆）后剩 6 个——其中 3 个仍是多锁段/状态机量级（`runVideoJob` 284、`OpenVoiceWebSocket` 247、`acquire` 246），3 个仅轻微超限（`executeImage` 57、`executeVoice` 54、`CreateVideo` 52）。

**行数未增大的证据**：`createResponseAt` 在 HEAD 与当前工作树均为 **908** 行（未改动，未强行拆）；`runVideoJob` 284（HEAD 284）、`OpenVoiceWebSocket` 247（HEAD 247）、`acquire` 246（HEAD 246）逐项持平；`executeImage` 与 `executeVoice` 由阶段 6 记录值 66/64 降到 57/54（收尾修复顺手收敛，非搬行）。表内「消除」来自被真正分解的函数，而非把行数搬进新函数。

未拆理由（真实原因，不声称「不可拆」）：gateway 的 `createResponseAt`（908 行）含 `attemptLoop`/`handleResponse`/`afterTeamRateLimit` 三处跨块 `goto`，`err`/`selection`/`fallback`/`qualityAccountAttempts`/`timingHandedOff` 与 `defer` 交织，需先按 image/voice 的返回码枚举方式等价改写控制流；`runVideoJob`/`OpenVoiceWebSocket`/`acquire` 为多锁段 + singleflight 内外双检缓存的分层状态机，需逐个核对锁边界与版本判定，等价提取风险高于收益；`CreateVideo`（52）与 `executeImage`（57）/`executeVoice`（54）为整段事务与结算顺序，拆分会引入跨函数状态传递。**这 7 个是 REV-2 仍未完成的剩余范围，不记为「已通过」。**

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

| 发现                                                                                                            | 核实方式                                                                                                                 | 处置                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `image_execution.go` 连续两次 `checkLedgerReady()`（复制残留）                                                  | 对照 HEAD `236175e4:gateway/image.go` 实测**只有 1 次**                                                                  | **已删除重复调用**（该检查幂等只读，行为等价且恢复与基线一致）；`go build`/`vet`/gateway 包测试 exit 0                                                                                                                                                                                                                       |
| `voice_execution.go`/`image_execution.go` 尝试循环把上一轮 `err` 带入下一轮，`if err == nil` 可能跳过 `Acquire` | 对照 HEAD `236175e4:gateway/voice.go:357-363`：基线**同样是循环外 `var err error` + `if err == nil` 守卫**，结构逐行一致 | **当次判定为既有行为被忠实保留，非本轮引入**，未在等价搬移范围内改动，并登记为**未覆盖风险**（voice/image 执行链无「第 1 账号失败 → 第 2 账号成功」用例，`voice_ws.go` 亦复用同一写法）。**后续已在 §13.1 作为 P1 缺陷正式修复并补回归测试**；原判断（基线即有）成立，但「既有」不等于「可接受」，修正在等价搬移之外单独提交 |
| `§12.1`「后」列行数过时（叠加了后续函数分解）                                                                   | 用文件实际行数重新实测                                                                                                   | **已更新全表**，并注明「后」为工作树实测、部分数值大于拆分当次是函数分解回填所致                                                                                                                                                                                                                                             |
| `§12.2` 结论「86 → 18」与同节表格「88 → 18」矛盾                                                                | 复核 HEAD 基线实测为 88                                                                                                  | **已更正为 88 / 降幅 80%**                                                                                                                                                                                                                                                                                                   |
| `§12.4` 新增用例数「47（16/13/18）」与文件实际不符                                                              | 实测 `^func Test` 为 22/34/18                                                                                            | **已更正为 74（22/34/18）**                                                                                                                                                                                                                                                                                                  |

审查同时确认无问题：`voice_ws.go` 的 WebSocket 截止时间、`sso_build.go` 的 consent token、`quality_retry.go` 的 Build-only 拦截、`stream_copy.go` 的中止 trailer 与 `errors.go::classifyCopyError` 均未被改写；`selector_cache.go`/`selector_health_cache.go` 未见 `defer` 与显式 `Unlock` 混用导致的重复解锁。

### 12.4 验证

- `go build ./...` exit 0；`go vet ./...` exit 0
- `go test ./... -count=1` exit 0：**64 包 ok / 0 FAIL / 2879 PASS / 20 SKIP**（20 条为 PostgreSQL·Redis 集成用例，本机无隔离服务，属预期；CI 提供隔离服务后必须 0 skip）
- 新增测试 3 文件 / 74 个顶层用例：`application/gateway/refactor_helpers_test.go` 22、`transport/http/inference/refactor_helpers_test.go` 34、`infra/provider/web/refactor_helpers_test.go` 18；覆盖提取出的定价估算、STT 格式化（text/json/verbose_json/rawjson）、媒体 JSON 解码、选择失败码、流分帧与 EOF 处理、导入凭据归一、图像/编辑校验拒绝路径（计数为 `^func Test` 实测，`inference` 侧含 2 处 `t.Run` 子用例）
- `-race` 本机无 cgo，**Blocked**，由 CI 覆盖

## 13. 阶段 6 收尾（P1 缺陷修复 / 函数分解收敛 / benchmark / 去重）

本节记录阶段 6 收尾轮次的实测结果。除下述明确列出的改动外，公开协议（路由、DTO、状态码、错误文案、SSE 分帧、计费/审计顺序）未变。

### 13.1 P1 修复：媒体尝试循环在多账号池下跳过 `Acquire`，把可自愈失败放大为 503

**缺陷（`backend/internal/application/gateway/voice_execution.go`、`image_execution.go`）**：两个尝试循环把 `err` 声明在循环外且每轮不重置，本轮以错误结束并判定需要换号/重试时，下一轮 `if err == nil` 为假 → 跳过 `beginSelectionSessionForKey` + `selection.Acquire`，随即返回 503 `ErrNoAvailableAccount`。**即使账号池中仍有健康账号，第二个账号也从未被租用或尝试**——单账号凭据失效或一次性传输抖动会被放大为下游可见的 503。

**修复**：每轮改用独立 `acquireErr`（`voice_execution.go:161-174`、`image_execution.go:241-251` 各带注释说明「selection 只在第 1 轮建立，其后轮次的租约获取不应受上一轮错误影响」）；`applyVoiceExecutionError` 返回值由 `(retry, carriedErr, fatalErr)` 收敛为 `(retry, err)`，消除跨轮携带错误的载体本身。

**回归测试**：新增 `backend/internal/application/gateway/media_attempt_loop_test.go`（两账号夹具；`mediaAttemptLoopLimiter` 记录每个账号并发槽位的真实获取次数，作为「本轮是否重新获取租约」的可观察证据；`Current` 恒返回 0 避免夹具自身制造饱和假象）：

| 用例                                                            | 断言                                                                                                                                        |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `TestRunVoiceAttemptsReacquiresLeaseAfterRetryableAttemptError` | ① SSO 被拒后第二个账号被**真正租用**并成功返回 200；② 可重试传输失败在**同一账号**上重试 3 次（出口绑定语义保持），且第二个账号一次未被租用 |
| `TestRunImageAttemptsRetryableAttemptErrorSwitchesAccount`      | ③ image 循环 SSO 换号成功、transport 失败以 502 终态（**不是**池耗尽）                                                                      |

**验证**：`go build ./...`、`go vet ./...` exit 0；`go test ./... -count=1` 64 包 ok / 0 FAIL。影响面与回滚：单包单文件修复 + 新增测试，回滚即恢复旧循环语义（会退回 503 放大行为，不建议）。

### 13.2 `infra/provider/web` 新增 6 个基准（解析/归一热点此前无可比基线）

`backend/internal/infra/provider/web/benchmark_test.go` 新增 6 个基准。测量条件：**Go 1.26.1 windows/amd64、`-benchmem -count=3`、未固定 CPU**，下表为三次代表值区间：

| Benchmark                             |         ns/op |    B/op | allocs/op |
| ------------------------------------- | ------------: | ------: | --------: |
| `BenchmarkConsumeJSONObjects`         |   425k – 563k | 180,256 |         4 |
| `BenchmarkParseUpstreamFrame`         |  8.8k – 10.8k |   3,289 |        48 |
| `BenchmarkNormalizeOpenAIInput`       |   191k – 196k |  56,088 |       680 |
| `BenchmarkBuildOpenAIChatResult`      | 14.8k – 20.7k |  10,320 |        85 |
| `BenchmarkParseWeeklyCreditsResponse` |   1.0k – 1.6k |     376 |         7 |
| `BenchmarkInferWebTierFromQuota`      |     172 – 188 |       0 |         0 |

口径说明：未固定 CPU 且未做 5 次中位数，因此**区间值只作基线量级参考**，不作为「优化收益」证据；后续对比必须同机、同 `-count` 重复测量。全仓 `^func Benchmark` 计数由阶段 0 的 12 增至 **19**（`infra/provider/web/benchmark_test.go` 内 6 个，另含阶段 2–4 新增的 1 个账号分页聚合基准）。

### 13.3 后端去重：删除纯转发包装

`internal/infra/provider/web/account_settings.go`：删除纯转发包装 `runWebAccountSetting`（仅把参数原样转给 `runWebAccountSettings`，无附加语义），三处调用点（同文件 55、88、108 行）改为直接调用 `runWebAccountSettings`。行为等价、减少一层无价值间接；无新增依赖。

### 13.4 阶段 6 收尾验证

- `go build ./...` exit 0；`go vet ./...` exit 0
- `go test ./... -count=1`：**64 包 ok / 0 FAIL**
- 函数级 REV-2：三包合计 **7**（详见 §12.2 更新后的表格与逐项登记），未记为全部达标
- `-race` 本机无 cgo，**Blocked**，由 CI 覆盖（本轮未重跑）

### 13.5 P2 修复：`runVideoJob` 固定账号获取失败时跳过换号回退（与 §13.1 同类）

**缺陷（`backend/internal/application/gateway/video.go:499-505`，HEAD 既有，非本轮拆分引入）**：`runVideoJob` 的重试循环把固定账号（首轮为 `job.AccountID`，其后为 403 出口重试的同一账号）的 `AcquirePinnedForKey` 失败错误写回循环级 `err`，随后的回退门 `if lease == nil { ... if err == nil { selection.Acquire(...) } }` 因此被判假 → 跳过会话租约获取，直接 `failVideoJob(..., "account_unavailable", lastErr, ...)`。触发条件：固定账号在重试轮次前被禁用/冷却/能力失效，而账号范围内仍有其它健康账号；任务被误判为账号池耗尽，审计写入的 `error_code=account_unavailable` 还会与从上一轮上游错误解析出的 HTTP 状态自相矛盾。

**归属证据**：`git diff HEAD -- backend/internal/application/gateway/video.go` 只覆盖 `CreateVideo` 的拆分（旧 59–194 行）；`runVideoJob`（421–704）本次未改动，故为基线既有行为，与 §13.1 的 voice/image 循环是同一类缺陷的第三处。

**修复**：固定账号获取失败只排除该账号，不再把错误写回 `err`（`video.go:499-509`），使 `selection.Acquire` 回退按循环注释「Create-stage failures may switch accounts」的既有语义执行。

**回归测试**：新增 `TestVideoPinnedAccountUnavailableFallsBackWithinScope`（`video_scope_test.go`）。夹具扩为三账号（Super 200 / Free 100 / Spare 50），并给 `videoCreateFailoverAdapter` 增加 `onAttempt` 回调，用于在两次尝试之间禁用账号：

| 步骤    | 事件                                                                                                                   |
| ------- | ---------------------------------------------------------------------------------------------------------------------- |
| 前置    | 禁用 Super；`job.AccountID = Super`                                                                                    |
| 第 1 轮 | Super 固定获取失败 → 建立 selection 会话并租到 Free；Free 返回 create 阶段 403 → 固定 Free 重试；`onAttempt` 禁用 Free |
| 第 2 轮 | Free 固定获取失败 → **回退租用 Spare 并成功**                                                                          |

断言：`attempts == [Free, Spare]`，终态 `completed` 且 `AccountID == Spare`。**反向验证**：临时把 `video.go` 还原为旧写法后该用例失败（`attempts=[Free]`，任务以 `account_unavailable` 终止），确认用例确实钉住该缺陷。

**验证**：`go build ./...`、`go vet ./...` exit 0；`go test ./internal/application/gateway -count=1` exit 0（38.4s）；全量结果见 §13.6。回滚：还原该 5 行即回到旧语义（会退回误判池耗尽行为，不建议）。

### 13.6 阶段 7 独立复核与复验（本轮实测）

- **独立只读审查**（针对未提交的 gateway / provider-web 拆分 diff）：确认质量判定与持有扫描、SSE 分帧、403/Statsig 重放、SSO 轮询、额度解码、视频帧解析在 HEAD 测试基线下行为等价；`quality_decision.go` 的四类指纹与 `BoundQualityRetry` 逐条复算无差异；`doWithFollow`/`pollToken`/`syncWeeklyCredits` 的 body 关闭与 timer 停止配对正确；`BenchmarkBuildOpenAIChatResult` 复用 `parsed` 不产生跨迭代污染。发现 1 个 P2（已修复，§13.5）与 3 项 P3（登记如下）。
- **P3 登记（未修改，如实记录）**：① `gateway/video.go:658-661` 的 `if lease == nil` 防御分支在当前 attempt 策略下不可达（`allows(attempt)` 与 `hasNext(attempt)` 互斥），属死代码而非缺陷；② `infra/provider/web/gateway.go:617-619` 的 `collectGatewayToolResult` 注释在拆分时错位到 `gatewayActionSource` 上方；③ `refactor_helpers_test.go` 中 `TestVoiceQuotaModeOnlyResolvesWhenQuotaConsumed` 只覆盖 `consumesQuota=false` 分支，`BenchmarkInferWebTierFromQuota` 的 fixture 全部解析为同一 tier，未进入 `rank[candidate] < rank[detected]` 分支。三者均不改变对外行为，未据「建议」扩大改动。
- **复验结果**：`go build ./...` exit 0；`go vet ./...` exit 0；`go test ./... -count=1` = **64 包 ok / 0 FAIL / 11 包 no test files**；20 个 PostgreSQL·Redis 集成用例 **Skipped**（本机无隔离服务，`TEST_POSTGRES_DSN`/`TEST_REDIS_ADDRESS` 为空，CI 提供后必须 0 skip）；`go test -race` 本机 `CGO_ENABLED=0` **Blocked**，由 Linux CI 覆盖。
- **REV-2 独立复测**：用 stdlib `go/ast` 自建工具重测三包 >50 行函数 = **7**（gateway 7 / inference 0 / provider-web 0），与 §12.2 逐项一致；口径校验用 `createResponseAt` = 908 行（与登记值相同）。
- **基准复测注意**：本次 6 个 `infra/provider/web` 基准是在**两个前端覆盖率进程并行占满 CPU** 的条件下测得（如 `ConsumeJSONObjects` 927k ns/op，§13.2 为 425k–563k），因此不写入基线；§13.2 的区间仍是未并行负载下的参考值，后续对比必须同机同负载。

## 14. 发布登记：v0.1.1（2026-10-10）

维护线首次发布，按 `AGENTS.md` §8 流程执行。**后端验收、CI Verify、容器镜像发布与工作流缺陷修复（P1/P3）均经实测 `Passed`。**

| 项目          | 事实                                                                                                                                                                                                                                                                                          |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 版本与提交    | 根 `VERSION` = `v0.1.1`（此前 `v3.1.6`，`Dockerfile:66` 复制进镜像 `/app/VERSION`）；`frontend/package.json` 同步为 `0.1.1`；发布提交 `b2123a7d0e250948f9f23b941f5a9acd2640ba35`（`main`，由 `maint/modular-quality-audit` fast-forward 合并）                                              |
| tag / Release | annotated `v0.1.1`（tag 对象 `db20ef9638fc27cee5bc915dc7afa84724a34610`）；Release https://github.com/JasmineTony/grok2api/releases/tag/v0.1.1 （本仓库首个 Release，非草稿、非预发布）                                                                                                          |
| 本机验证      | `go build ./...`、`go vet ./...`、`go test ./... -count=1` 均 **exit 0**（75 包：64 ok / 11 无测试文件 / 0 FAIL）；21 个 PostgreSQL·Redis 集成用例因本机无隔离服务 **Skipped**（非 Passed），`-race` 本机 **Blocked**（无 cgo），两者由 Linux CI 覆盖                                       |
| 远端 CI       | run `38054220100`（tag `v0.1.1`）与 run `38054197912`（`main`）的 Verify job **18 步全部 success**：Test backend、Assert required integration tests ran（PostgreSQL/Redis 用例 **0 跳过**）、Race backend、Vet backend、Swagger 精确 diff、前端 `pnpm verify`、全栈 E2E                            |
| 镜像发布      | **Passed**：删除未链接的孤立包（HTTP 204）后，run `38054220100` attempt 2 的 `Publish image (amd64/arm64)` 成功，run `38055278879`（`main`）attempt 2 全绿；注册表实测 `ghcr.io/jasminetony/grok2api` 9 个 tag，`v0.1.1` / `main` / `latest` 均为 amd64 + arm64 多架构索引，匿名拉取 HTTP 200。详见 §11 与 `frontend/AUDIT.md` §14 |
| 已修复缺陷（P1/P3）| **P1**：tag 推送时 `Merge image` 必然失败——`docker/metadata-action` 默认 `flavor: latest=auto` 会对 `type=ref,event=tag` 无条件生成 `latest`，而 `latest-amd64`/`latest-arm64` 只在 `main` 推送时存在，故 `docker buildx imagetools create` 报 `latest-arm64: not found` → `b4068303` 给两个 `Docker metadata` 步骤加 `flavor: latest=false`。**P3**：`Create manifest list` 循环缺 fail-fast，前面的 `imagetools create` 失败可被后续成功掩盖 → `a4f58384` 加 `set -euo pipefail`。**实测**：tag 推送 run `38060494037`（临时 tag `v0.1.1-verify.1`）与 main 推送 run `38060467337` 全部 job success。完整证据见 `frontend/AUDIT.md` §14 |
| 回滚点        | 源码与配置随提交回退到 `7c0493a2`（发布前的 `main`）；tag `v0.1.1` 与对应 Release 需一并删除。本次不涉及生产数据迁移，无需数据回滚                                                                                              |

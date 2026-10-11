# 前端审计与验收报告

本文件记录前端验收矩阵、质量门禁现状、架构审计结论、性能基线与问题清单。
规则唯一事实来源是根目录 [`AGENTS.md`](../AGENTS.md)；本文件只记录**实际证据**与状态。

- 基线提交：`7c0493a2`；阶段 0 提交：`7636acca`
- 维护分支：`maint/modular-quality-audit`
- 环境：Windows 11 Pro (10.0.26300)，Node `24.0.1`，pnpm `12.10.1`，TypeScript `6.0.3`，Vite `8.3.4`，Vitest `5.0.3`，CPU Intel i5-10210U（8 逻辑核）
- 锁文件：`frontend/pnpm-lock.yaml` SHA256 `E0819D57485E3353C99C160B7EF7FFED39BC33D25057E4EC156543178AB64CAF`（阶段 0 基线值；阶段 1 新增 `dependency-cruiser` 后变更）
- 单位约定：KiB = 1024 B；gzip 使用 `zlib` level 9；Vite 自身输出的 “kB” 按 1000 B 计，两者不可混用

## 1. 验收矩阵

状态取值：`Passed` / `Failed` / `Skipped`（缺环境跳过）/ `Blocked`（环境不支持）/ `Pending`（尚未执行）。
不允许用 `Skipped`、`Blocked` 或"配置已写好"代替 `Passed`。

| 编号   | 验收项             | 判定命令                             | 状态                                                                                                                                                                          |
| ------ | ------------------ | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FE-A1  | 格式一致           | `pnpm format:check`                  | Passed（阶段 7 复跑：All matched files use Prettier code style）                                                                                                              |
| FE-A2  | 类型契约           | `pnpm typecheck`（`tsc -b --force`） | Passed（无输出）                                                                                                                                                              |
| FE-A3  | Oxlint correctness | `pnpm oxlint`                        | Passed（0 warnings / 0 errors，500 文件 / 96 规则）                                                                                                                           |
| FE-A4  | ESLint 语义        | `pnpm lint`                          | Passed（0 problem）                                                                                                                                                           |
| FE-A5  | 纯逻辑单测         | `pnpm test`（node:test）             | Passed（68 tests / 37 suites / 0 fail / 0 skip）                                                                                                                              |
| FE-A6  | 组件单测 + 覆盖率  | `pnpm test:ui:coverage`              | Passed（113 文件 / 1394 tests；全局 97.66 / 93.77 / 97.95 / 98.36；已开启 `thresholds.perFile`，321 个纳入文件逐文件四项均 ≥76%，最低 stmts/lines/funcs 77.77、branch 76.36） |
| FE-A7  | 生产构建           | `pnpm build`                         | Passed（阶段 7 热构建 1.32s）                                                                                                                                                 |
| FE-A8  | 依赖边界与循环     | `pnpm check:architecture`            | Passed（406 模块 / 1825 依赖 / 0 违规）                                                                                                                                       |
| FE-A9  | 结构约束           | `pnpm check:structure`               | Passed（380 源码文件；0 超限文件 / 29 超限函数 = 冻结基线）                                                                                                                   |
| FE-A10 | 门禁自测           | `pnpm test:gates`                    | Passed（9 用例，含 4 个必须失败）                                                                                                                                             |
| FE-A11 | 产物体积预算       | `pnpm check:budget`                  | Passed（首屏 193.31 / 260；全部 JS 621.23 / 650；CSS 16.65 / 20；最大 chunk 457.17 / 500 原始；路由增量 ≤129.12 / 180）                                                       |
| FE-A12 | 构建可复现性       | 同工具链三次构建产物哈希一致         | Passed（阶段 1 实测 86 文件逐文件 SHA256 零差异；阶段 7 未重跑）                                                                                                              |
| FE-A13 | 真实全栈 E2E       | `pnpm test:e2e`                      | Passed（4 spec / 16 用例，实测 16 passed / 0 failed / 36.8s / 4 workers / `retries: 0`，见 §12.1）                                                                            |
| FE-A14 | 聚合全量门禁       | `pnpm verify:full`                   | Passed（`pnpm verify` exit 0 + E2E 16/16）                                                                                                                                    |

`pnpm verify` 实测 exit 0，链路为：
`format:check → oxlint → lint → typecheck → typecheck:e2e → test → test:ui:coverage → check:architecture → check:structure → test:gates → build → check:budget`（E2E 由 `verify:full` 追加，见 `frontend/README.md`）。

## 2. 质量门禁与检查范围

- **格式**：Prettier 3.9.9，`frontend/.prettierrc`（`printWidth 120`、`trailingComma all`、`endOfLine auto`）。仓库存储换行由根 `.gitattributes` 统一为 LF；工作区 CRLF 来自 `core.autocrlf=true`，两者不冲突。
- **类型**：`tsconfig.app.json`（`src`，排除测试）、`tsconfig.node.json`（`vite.config.ts`、`vitest.config.ts`）、`tsconfig.test.json`（测试与 `src/types/*.d.ts`）。E2E 独立 tsconfig 属阶段 2。
- **Lint**：ESLint 10.6.0 + `typescript-eslint` 8.63.0（`@typescript-eslint/no-explicit-any: error`）；Oxlint 1.87.0 仅 `correctness`。排除范围一致：`dist`、`coverage`、`src/components/ui`。
- **测试**：`*.test.ts` 由 `node --experimental-strip-types --test` 运行；`*.test.tsx` 由 Vitest（jsdom）运行。
- **覆盖率**：`@vitest/coverage-v8`；`coverage.include` 为 17 条「已重构模块整目录 + `virtual-table-body.tsx`」，`exclude` 14 条（测试分层、纯 re-export barrel、测试支撑）；全局门槛 **76** 并已开启 `thresholds.perFile`（Vitest 5 默认只做聚合检查，见 §15），另有 **20 个自定义 hook** 单独声明四项 100（TEST-2，条目见 `vitest.config.ts` 的 `thresholds`）。
- **依赖边界**：dependency-cruiser 18.5.0，`.dependency-cruiser.cjs`：循环、不可解析导入、下层反向依赖、跨 feature（存量例外显式冻结）。
- **结构与预算**：`scripts/check-structure.mjs`、`scripts/check-bundle-budget.mjs`，基线分别是 `structure-baseline.json`、`bundle-budget.json`。
- **门禁自测**：`scripts/self-test-gates.mjs` 用临时装置验证门禁在违规输入下确实非零退出。

### 覆盖率实测（`pnpm test:ui:coverage`，阶段 7 复跑）

`pnpm verify` 内实测：**113 文件 / 1394 用例全过**（492s 为阶段 7 值，`maxWorkers: 2`、`testTimeout: 20000`；最终复测见 §15）。

| 范围                        | Stmts | Branch | Funcs | Lines |
| --------------------------- | ----: | -----: | ----: | ----: |
| All files（321 个纳入文件） | 97.66 |  93.77 | 97.95 | 98.36 |

逐文件口径：**四项全部 ≥76%**（阶段 6 登记的「约 32 个文件 <76%」已归零，见 §13.2）；另有 **39 个**含可执行语句却报 0/0/0/0 的模块（5 个类型/DTO + 34 个 i18n 纯数据模块），属 V8 转换管线统计假象，根因与证据见 §15。仍不可驱动的是若干死分支/工具语义不可达分支，逐项见 §13.3。

### 真实全栈 E2E（阶段 2）

`pnpm test:e2e` = Playwright 1.64.0（自带 Chromium 156.0.8078.4）+ 生产 `frontend/dist` + 真实 Go 二进制（临时 SQLite、Memory 运行态）。每 worker 独占一个后端进程，`fullyParallel`、`retries: 0`（不用重试掩盖缺陷）。

隔离机制（均经反向验证，不是仅靠配置）：

| 约束               | 实现                                                                                                 | 验证证据                                                                                                             |
| ------------------ | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 不触碰真实上游     | 子进程设 `HTTP_PROXY`/`HTTPS_PROXY=http://127.0.0.1:9`（未监听端口），`NO_PROXY=127.0.0.1,localhost` | 启动期版本检查报 `proxyconnect ... 127.0.0.1:9 ... refused`（非致命），管理 API 仍返回 200                           |
| 不继承真实服务配置 | 启动前剔除全部 `GROK2API_*` 与 `TEST_POSTGRES_*`/`TEST_REDIS_*`                                      | 父进程注入假 `GROK2API_DATABASE_URL`（postgres）与 `GROK2API_QUALITY_GUARD_DIR` 后，后端仍以 sqlite 正常启动并可登录 |
| 每 worker 独立     | 动态空闲端口 + 独立 `%TEMP%\grok2api-e2e-*`（config.yaml / backend.db / media）                      | 两个 worker 分别监听 127.0.0.1:1879 / 1878，临时目录互不重叠                                                         |
| 只清理自有资源     | 结束只杀自己启动的进程、删除自己的临时目录                                                           | 运行后 0 残留进程、0 残留临时目录                                                                                    |
| 测的是当前代码     | globalSetup 在 dist 缺失**或早于任一构建输入**时重建前端；后端二进制每次重建                         | 把 `dist/index.html` mtime 置为 2000-01-01 后运行：触发重建（6 passed）；随后再运行：零构建（6 passed）              |

当前覆盖（阶段 6 收尾后共 **4 个 spec / 16 用例**，实测 `npx playwright test` **16 passed / 0 failed**，37.4s、4 workers、`retries: 0`）：

| spec                        | 用例数 | 覆盖内容                                                                                                                                  |
| --------------------------- | -----: | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `e2e/auth.e2e.ts`           |      6 | 未登录访问受保护路由被重定向、错误密码登录失败、正确登录后刷新仍保持、注销后不可回访、表单可访问名称                                      |
| `e2e/client-keys.e2e.ts`    |      4 | 创建（含校验失败路径）、编辑停用后徽标与筛选同步、删除、未登录重定向                                                                      |
| `e2e/request-audits.e2e.ts` |      3 | 未登录重定向；空池下渲染真实零值与空态且筛选/周期控件可用（并用管理 API 交叉验证服务端 `items=[]`）；状态筛选改变激活计数、清除后恢复空态 |
| `e2e/settings.e2e.ts`       |      3 | 未登录重定向；未修改时保存/重置禁用、修改后启用、重置后恢复禁用；分页面板按标签显隐                                                       |

空账号池下 `/readyz` 返回 503 `not_ready` 属预期生产语义，管理面可用性单独断言，未放宽生产门槛。

- **E2E 层面**尚未覆盖（非验收阻塞：`FE-A13` 的判据是 `pnpm test:e2e` 门禁存在且 16/16 通过，不声称流程覆盖完整）：账号导入与列表、设置保存的版本冲突、模型/出口页面、Quality Guard 未启用状态、创作台与媒体流程、语言主题与移动视口。其中前 5 类**已在 Vitest 组件/集成层覆盖**——账号导入 `src/features/accounts/accounts-page.test.tsx:256`、`use-accounts-task-flows.test.tsx:530`；设置版本冲突 `src/features/settings/settings-page.test.tsx:277`（注入 `ApiError(409, "revisionConflict")` 并断言错误文案与草稿保留）、`use-settings.test.tsx:215`；模型 `src/features/models/*.test.tsx` 9 个、出口 `src/features/settings/egress-*.test.tsx` 9 个；Quality Guard 未启用 `src/features/quality-guard/quality-guard-page.test.tsx:76`；创作台与媒体 `src/features/creative-console/*.test.tsx`、`src/features/media/*.test.tsx`；语言/主题 `src/shared/i18n/language-memory.test.tsx:51`、`src/app/shell-account-control.test.tsx:113`。**只有「移动视口」在任何层都无覆盖**：`playwright.config.ts:25` 仅有 `chromium` + `Devices["Desktop Chrome"]`，无移动 project，spec 内也无 `setViewportSize`。

## 3. 生产产物与体积预算

量化口径：`scripts/check-bundle-budget.mjs`，AST 解析 dist 内的相对 `import`/`export-from` 与懒加载 `import(...)` 字面量。

| 指标                                          |            实测 |    阈值 | 余量                   |
| --------------------------------------------- | --------------: | ------: | ---------------------- |
| 首屏关键 JS 闭包（2 文件：入口 + 共享运行时） | 193.31 KiB gzip | 260 KiB | 66.69 KiB（占 74.35%） |
| 最大路由新增闭包（`dashboard-page`）          | 129.12 KiB gzip | 180 KiB | 50.88 KiB              |
| 全部生产 JS（77 文件去重）                    | 621.23 KiB gzip | 650 KiB | 28.77 KiB              |
| 全部生产 CSS（1 文件）                        |  16.65 KiB gzip |  20 KiB | 3.35 KiB               |
| 最大单 chunk（`index-*.js`）                  | 457.17 KiB 原始 | 500 KiB | 42.83 KiB              |

阶段 7 实测（`pnpm verify` 内的 `pnpm check:budget`，exit 0）；**2026-10-10 FE-10 修复后复测**（§15）：首屏 193.31 KiB / 2 文件、全部 JS 621.23 KiB / 77 文件。**2026-10-11 基线重定后**（§15.6）新冻结基线的原始与 Brotli 参考值：全部 JS raw 2210794 B / brotli 545744 B；首屏闭包 raw 633892 B / brotli 172222 B；最大 chunk raw 468141 B / brotli 123976 B；CSS raw 102080 B / brotli 13845 B。

13 个路由新增闭包（gzip KiB，2026-10-10 实测；其中 `deferred-*.js` 是 i18n 非首屏文案 chunk，因 `shared/i18n/index.ts` 的 `import("./resources/deferred")` 位于首屏 chunk 内而被门禁按「懒加载入口」归类，见 §15）：dashboard 129.12、creative-console 81.60、accounts 81.05、settings 79.11、client-keys 76.58、quality-guard 67.77、request-audits 60.50、models 50.79、video-gallery 46.66、gallery 33.01、app-shell 31.43、api-docs 29.07、deferred（i18n）57.25。

**关键结论（2026-10-11 基线重定后）**：首屏闭包余量 **66.69 KiB（25.65%）**，较修复前的 10.01 KiB 大幅扩大（§15）；`全部生产 JS` 相对 2026-10-09 冻结基线的 **+4.72%（+28655 B / 27.98 KiB）** 已按 §15.6 完成归因并重定基线（新基线 636140 B / 77 文件，`generatedAt = 2026-10-11T02:27:32.159Z`），**硬阈值 260 / 180 / 650 / 20 / 500 KiB 与 `growthTolerancePercent: 5` 一字未改**，容差余量由 1.68 KiB 恢复为 5%（≈31 KiB）。后续任何进入生产 JS 的增长仍须先说明体积影响，**不得再次以 `--update` 静默吸收**。

### 构建可复现性

冷构建（删除 `dist`、`.cache`、`node_modules/.vite`）16.4s（vite 段 942ms，3734 modules）；热构建 1.15–2.56s。三次构建共 86 个产物文件，文件集合与逐文件 SHA256 **零差异**，即字节级可复现。

## 4. 架构审计

### 4.1 分层与依赖方向

- 目录职责：`app`（路由/壳层/Provider）、`features`（业务能力）、`entities`（领域 DTO 与只读查询）、`shared`（API/鉴权/配置/组件/工具）、`components/ui`（shadcn 原语）。
- dependency-cruiser 实测（阶段 7：406 模块 / 1825 依赖）：**0 循环、0 不可解析导入、0 下层反向依赖、0 未冻结的跨 feature 依赖**。
- 门禁反向验证：注入 `features/models → features/settings` 后立即报 `no-cross-feature-models` 并 exit 1，删除后恢复 exit 0。
- 已冻结的 9 处跨 feature 依赖（`.dependency-cruiser.cjs` 的 `frozenCrossFeatureDebt`，阶段 3 整改，只允许删除条目）：

| 来源 feature       | 允许目标（存量债务）      | 判定                                           |
| ------------------ | ------------------------- | ---------------------------------------------- |
| `accounts`         | `settings`                | 账号页消费出口节点/订阅源 DTO，应下沉到 entity |
| `audits`           | `accounts`、`client-keys` | 审计筛选需要账号/密钥选项，应下沉到 entity     |
| `creative-console` | `client-keys`、`media`    | 创作台选择密钥与上传，同上                     |
| `dashboard`        | `system`                  | 复用版本更新组件，应下沉到 `shared`            |
| `quality-guard`    | `accounts`、`settings`    | 守护面板列出账号、需要出口节点                 |
| `settings`         | `system`                  | 同上                                           |

### 4.2 结构与体量基线

结构门禁实测：**102 个源码文件**（`src` 下非测试、非 `.d.ts`），其中 **18 个超过 600 行**、**80 个具名函数超过 50 行**（作为参数内联的匿名回调不计入，见脚本说明）。

| 文件                                                  | 行数 |
| ----------------------------------------------------- | ---: |
| `shared/i18n/index.ts`                                | 4150 |
| `features/accounts/accounts-page.tsx`                 | 3864 |
| `features/creative-console/creative-console-page.tsx` | 3018 |
| `features/settings/settings-page.tsx`                 | 1604 |
| `features/quality-guard/quality-guard-page.tsx`       | 1579 |
| `features/settings/egress-nodes.tsx`                  | 1560 |
| `features/client-keys/client-keys-page.tsx`           | 1370 |
| `features/audits/request-audits-page.tsx`             | 1259 |
| `features/accounts/accounts-api.ts`                   | 1076 |
| `features/models/models-page.tsx`                     | 1043 |
| `features/settings/egress-operations.tsx`             | 1004 |
| `features/settings/settings-api.ts`                   |  880 |
| `features/docs/api-docs-page.tsx`                     |  803 |
| `features/creative-console/creative-console-api.ts`   |  777 |
| `features/audits/request-audit-detail-dialog.tsx`     |  670 |
| `features/settings/settings-model.ts`                 |  666 |
| `features/media/video-gallery-page.tsx`               |  647 |
| `features/quality-guard/degrade-accounts-panel.tsx`   |  636 |

最严重的具名超限函数：`AccountsPage`(3391)、`SettingsPage`(1411)、`EgressNodes`(1086)、`ClientKeysPage`(1060)、`ModelsPage`(776)、`ChatPanel`(758)、`VideoPanel`(651)。

这些是**存量债务**，按 `AGENTS.md` §5 分阶段消减；未完成阶段只允许持平或下降，新增代码不得引入新的超限项（门禁已强制）。

### 4.3 已具备且不应重复建设的能力

- 路由级懒加载（`app/deferred-pages.tsx`）与 `Suspense` 回退。
- 大表虚拟化（`shared/components/virtual-table-body.tsx`，>20 行启用，含 `ResizeObserver` 与滚动监听清理）。
- 服务端状态统一走 TanStack Query；会话状态走 Zustand store。
- 统一 API 客户端（401 刷新重试、`navigator.locks` 并发刷新、SSE 解析、`ApiError` 语义）与解码器。
- 结论：性能优化必须以实测收益为准，不得以"新增虚拟化/懒加载/缓存"冒充改进。

## 5. 问题清单

| 编号   | 证据                                                                                                                                                                                                                                                                                                         | 现有/新增 | 影响                             | 优先级 | 阶段 | 验证方法                                            | 状态                                                                                                          |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- | -------------------------------- | ------ | ---- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| FE-01  | `pnpm verify` 原本无 E2E/预算/架构/结构检查                                                                                                                                                                                                                                                                  | 现有      | 关键路径与体积无自动门禁         | P1     | 1    | 新增四类门禁并实测通过                              | **Passed**（E2E 属 FE-A13，阶段 2）                                                                           |
| FE-02  | 规范 `>75%` 与阈值 `75` 边界不一致；include 仅 3 文件                                                                                                                                                                                                                                                        | 现有      | 覆盖率口径歧义、覆盖面过窄       | P1     | 1    | 阈值改 76 并实测通过                                | **Passed**（扩大 include 逐阶段推进）                                                                         |
| FE-03  | `AGENTS.md` 债务清单为 11 个/过时行数                                                                                                                                                                                                                                                                        | 现有      | 基线不可信                       | P2     | 0    | 已按 18 个文件更正                                  | **Passed**                                                                                                    |
| FE-04  | 文件级：18 个超限文件 → **0**（阶段 3–6 已归零）；函数级：80 → **29** 项存量，冻结于 `frontend/structure-baseline.json` 的 `functions` 字段且未扩张                                                                                                                                                          | 现有      | 可维护性与审查成本               | P2     | 3–6  | 逐模块拆分并收缩基线                                | Pending（P2 计划内债务，不阻塞发布）                                                                          |
| FE-05  | `vite.config.ts` 无条件 `define` 注入 `VITE_DEV_API_TARGET`，可能进入生产公开地址回退                                                                                                                                                                                                                        | 现有      | 开发地址污染生产回退             | P1     | 1    | 改为仅 `serve` 注入，构建期固定空串                 | **Passed**                                                                                                    |
| FE-06  | 9 处跨 feature 依赖冻结于 `.dependency-cruiser.cjs` 的 `frozenCrossFeatureDebt`（accounts→settings、audits→accounts/client-keys、creative-console→client-keys/media、dashboard→system、quality-guard→accounts/settings、settings→system），门禁只允许收缩、不允许扩张                                        | 现有      | 领域契约位置不清晰               | P2     | 3    | 下沉 entity 并删除冻结例外                          | Pending（P2 计划内债务，不阻塞发布）                                                                          |
| FE-07  | 能力已具备且被复用：大表虚拟化 `src/shared/components/virtual-table-body.tsx`、路由懒加载 `src/app/deferred-pages.tsx`、服务端状态 TanStack Query；未发现重复建设                                                                                                                                            | 现有      | 需避免重复建设                   | P2     | 3–6  | 补测并按实测收益优化                                | Passed（已核对，非缺陷）                                                                                      |
| FE-08  | `pnpm test` = 12 个纯逻辑 `src/**/*.test.ts`（node:test，68 用例 / 37 套件，Node 环境）；`pnpm test:ui:coverage` = 113 个组件 `src/**/*.test.tsx`（Vitest + jsdom）。不迁移理由：纯逻辑用例无需 jsdom，迁移不产生新的行为证据（`AGENTS.md` TEST-4 允许两种环境分离），双运行器维护成本已由分层规则与门禁约束 | 现有      | 维护两套断言风格                 | P2     | 1    | 迁移后逐项核对用例与断言                            | Passed（决策关闭：保留双运行器）                                                                              |
| FE-09  | 构建输出 `__dirname` 不受 Vite 原生配置加载器支持的警告                                                                                                                                                                                                                                                      | 现有      | 每次构建噪声，CI 非 TTY 同样出现 | P3     | 1    | 改用 `fileURLToPath(import.meta.url)`，实测警告消失 | **Passed**                                                                                                    |
| FE-10  | 首屏闭包仅余 7.93 KiB（3.05%）预算余量                                                                                                                                                                                                                                                                       | 现有      | 入口新增代码空间极小             | P1     | 3    | 拆分 i18n/入口依赖并复测预算                        | **Passed**（§15：i18n 12 个非首屏领域移出首屏闭包，首屏 249.99 → **193.31 KiB**，余量 10.01 → **66.69 KiB**） |
| DOC-01 | `frontend/README.md` 验证章节仅 `pnpm lint`/`pnpm build`                                                                                                                                                                                                                                                     | 现有      | 文档与门禁不一致                 | P2     | 1    | 已同步真实脚本与门禁表                              | **Passed**                                                                                                    |

## 6. 后续阶段与回滚

- 阶段顺序与文件范围见 `.pi/plan/前后端全量审计与分阶段模块化升级计划-20261009-1947.md`。
- 阶段 1 之后各阶段的执行与登记情况：阶段 2–7 均已执行并在 §7–§13 记录；各阶段遗留的存量项以 §5 问题清单为准（`FE-04`/`FE-06`/`FE-07`/`FE-08`、`BE-01`/`BE-02`/`BE-04`/`BE-05` 等仍为 `Pending`）。本行原「阶段 2–7 仍待完成」的表述已过期，2026-10-10 更正。
- 回滚：按阶段提交回滚源码、配置、文档与锁文件；门禁基线与豁免清单随对应阶段提交一起回滚。本文件在每阶段结束时更新状态与证据，不覆盖历史结论。

## 7. CI 真实验证（阶段 2）

草稿 PR #1（`maint/modular-quality-audit`）触发真实 GitHub Actions，GHCR Image run #4（sha `6f762fb7`）**conclusion=success**：

| 步骤                                                                                          | 结果    |
| --------------------------------------------------------------------------------------------- | ------- |
| Verify frontend（`pnpm verify`：格式/类型/Oxlint/ESLint/架构/结构/门禁自测/覆盖率/构建/预算） | success |
| Install Playwright browser（`playwright install --with-deps chromium`）                       | success |
| Run full-stack E2E（`pnpm test:e2e`）                                                         | success |
| Build image (amd64 / arm64)                                                                   | success |

首轮 run #3（sha `5541238b`）失败于后端 `Test backend`，原因是 CI 首次真实运行 PostgreSQL 集成用例并暴露 1 个用例缺陷（详见 `backend/AUDIT.md` §8）；修复后 run #4 全绿。该失败与前端门禁无关。

`main` 分支镜像推送**已验证**：run `38055278879`（`main`，sha `2d386540`）的 `Publish image (amd64/arm64)` 与 `Merge image` 全部 success，注册表 9 个标签、`v0.1.1` 匿名拉取 HTTP 200；原 CI-01（pnpm 供应链策略）已解决，详见 §14 与 `backend/AUDIT.md` §11。

## 8. 阶段 3 成果（前端）

- `shared/i18n/index.ts`：**4150 → 40 行**；按「语言 × 领域」拆为 33 个资源模块（最大 401 行）；16 处 `Object.assign` 全部收敛，37 个被覆盖 key 一律取最终生效值；拆分前后 key 与文案 SHA-256 逐字节一致
- 超限文件 18 → **17**（i18n 已整改）；超限函数 80（持平）
- 自定义 hooks 全部达 100%：`use-debounced-value`、`use-settings`、`use-version-update`、`use-chart`（原在 `chart.tsx` 内）；`use-auth` 保持 100%
- `useVersionInfo` / `useCheckForUpdates` / `useChart` 从展示组件拆出，避免文件级 100% 阈值波及无关渲染分支
- 新增 `shared/api/client.test.tsx`（26 用例）：401 刷新重试、并发去重、浏览器锁、SSE 分块与边界、下载错误路径；`client.ts` 覆盖 **89.24 / 82.69 / 82.75 / 92.46**，已纳入 `coverage.include`
- 覆盖率 include 扩至 9 个文件，全局 **95.54 / 87.07 / 95.14 / 96.96**
- 体积：首屏闭包 252.07 → **249.91 KiB**（余量 10.09 KiB，此前 7.93）；全部 JS 593.25 → **591.16 KiB**；最大 chunk 458.31 KiB 不变
- 门禁全绿：Vitest 10 文件 / 104 用例、依赖 0 违规（163 模块 / 695 依赖）、结构门禁通过、门禁自测 9 例、`pnpm verify:full` exit 0（含 6 个 E2E）

### 阶段 3 遗留（已登记，非隐藏）

- `src/components/ui/use-chart.tsx` 位于 `components/ui`，该目录按既有约定被 eslint/oxlint 排除，因此这个**我们自己的新 hook 不参与 lint**（拆分前的 `chart.tsx` 同样不参与）。修复路径：移到 `src/shared/hooks/use-chart.ts` 并同步 `chart.tsx` 与 `vitest.config.ts`；登记为阶段 4 处理项。
- `shared/api/client.ts` 的 `decodeNever` 实际不可达（`parseResponse` 在 `!response.ok` 分支已抛错），属存量死代码；本轮未改动，登记为 P3。
- i18n 资源模块为纯数据对象，未纳入 `coverage.include`（无分支，风险低）。

## 9. 阶段 4 成果（账号 / 客户端密钥 / 模型）

源码文件 102 → **185**（拆分为小文件，非新增业务逻辑）；超限文件 18 → **14**、超限函数 80 → **74**；结构基线已收紧至 14 / 74。

| 模块                                        |   前 |       后 |       新增测试 |
| ------------------------------------------- | ---: | -------: | -------------: |
| `features/accounts/accounts-page.tsx`       | 3864 | **2382** | 13（账号集成） |
| `features/accounts/accounts-api.ts`         | 1076 |  **157** |              — |
| `features/client-keys/client-keys-page.tsx` | 1370 |  **241** |             27 |
| `features/models/models-page.tsx`           | 1043 |   **69** |             38 |

- accounts 按 DTO / 任务流 / 批量 / 导出与各弹窗拆分；client-keys 拆出表格、表单、范围、模型选择、删除与密钥弹窗等 15 个模块；models 拆出 6 个 hook + 5 个组件
- **阶段 3 遗留已修复**：`useChart` 从被 lint 排除的 `components/ui/` 迁至 `shared/hooks/use-chart.ts`。迁移前 `eslint` 报「File ignored because of a matching ignore pattern」、`oxlint` 报「No files found to lint」，迁移后两者均实际检查该文件且 0 问题——有前后对比证据，不是仅凭位置推断
- 覆盖率 include 扩至 **24 个文件**；Vitest **17 文件 / 182 用例**通过；全局 **96.41 / 88.91 / 97.18 / 97.43**
- 体积：首屏闭包 249.93 KiB（阈值 260）；全部 JS 596.59 KiB（阈值 650，相对上一基线 +0.92%，在 5% 容差内）；12 条路由增量最大 127.98 KiB（阈值 180）
- 门禁全绿：`pnpm verify` exit 0、`pnpm test:e2e` 6/6、依赖 0 违规（211 模块 / 964 依赖）、门禁自测 9 例

### 阶段 4 未达标项（如实登记，未静默排除）

**accounts 拆分出的多数新模块覆盖率仅 0–45%，因此未纳入 `coverage.include`，TEST-1 的 76% 要求对 accounts 模块尚未满足。**

实测（CLI 临时 include）：`account-batch-api.ts` 0、`account-export-api.ts` 0、`account-batch-dialogs.tsx` 17.85、`account-cleanup-dialog.tsx` 6.06、`account-conversion-dialogs.tsx` 14.81、`account-device-dialog.tsx` 18.18、`account-import-dialog.tsx` 20、`accounts-page.tsx` 41.63；已达标的仅 `account-quota.tsx` 99.06、`accounts-dto.ts` / `account-edit-form.ts` / `accounts-summary-panel.tsx` / `account-edit-dialog.tsx` 100。

13 个账号集成测试覆盖的是**页面级流程**，不能替代各拆分模块的文件级 76%。该项登记为阶段 4 未完成，需在后续阶段补测后纳入 include；`vitest.config.ts` 的注释已同步说明，避免后人误以为 accounts 已达标。

其它遗留：

- `client-keys` 有 2 个用例显式放宽超时到 20s（真实 300ms 防抖 + Radix 交互在覆盖率插桩下超 5s），未弱化断言，但属测试成本问题。
- 受限模型查询现在随弹窗卸载释放缓存（原实现以 `enabled:false` 保留），UI 可见结果一致，重开弹窗会重新请求。
- `src/features/*/…test-support.ts(x)` 测试脚手架位于 `src` 内，会被 `tsc -b` 检查；未纳入 coverage include。

## 10. 阶段 5 成果（设置 / 出口 / Quality Guard）

维护分支 d5cc4597，**CI run #12 = success**（后端隔离服务 + race + Swagger + 前端门禁 + 全栈 E2E + amd64/arm64 镜像构建）。

- 后端：`infra/egress/manager.go` 2342、`application/egress/service.go` 1443、`transport/http/egress/handler.go` 1579 按职责拆开；`application/settings/service.go` → config_apply / editable_config
- 前端：设置核心（settings-page 1604 拆分）、出口节点（egress-nodes 1560、egress-operations 1004）、Quality Guard（quality-guard-page 1579）三方向拆分并补齐集成测试
- **超限文件 18 → 7**、**超限函数 80 → 63**，基线已收紧
- `pnpm verify` exit 0；Vitest **24 文件 / 245 用例全过**；覆盖率 96.41 / 88.91 / 97.18 / 97.43；依赖 0 违规（275 模块 / 1234 依赖）；E2E 6/6；首屏闭包 249.92 KiB

### 阶段 5 中修复的真实缺陷

1. **blocked-delete 未生效**：Radix `DropdownMenuItem` 的 `disabled` 只拦截其 `onSelect`，不阻止原生 `onClick` → 「已绑定节点禁止删除」只是文案，点击仍会弹出删除确认。改为显式判空后才真正封锁（`egress-proxy-profiles.tsx`，修复后该文件 9/9）
2. **测试并行度饱和**：默认 24 worker 下 18 个失败、4 worker 下 5 个、1 worker 全过 → 属 CPU 饱和而非逻辑缺陷；在 `vitest.config.ts` 固定 `maxWorkers: 4`（确定性修复，未放宽断言、未删除用例）
3. 子代理留下的语法错误拼接、未使用参数、引用不存在的辅助函数（均已修正）

### 阶段 5 遗留

- accounts 新模块覆盖率仍 0–45%，未纳入 include（TEST-1 对 accounts 尚未满足）
- `infra/persistence/relational/account_links.go` 776 行、若干测试文件 >600 行属存量债务
- 阶段 6（创作台/媒体/Gateway）与阶段 7（性能对比与总验收）未开始

## 11. 阶段 6 成果（创作台 / 文档 / 媒体 / 仪表盘 / 审计 / 账号 / app shell）

基线 `236175e4` → 阶段 6 工作树。本阶段把前端**仍然超限的全部模块**拆完，并把覆盖率口径从「手工维护达标文件清单」改为「已重构模块整目录纳入 + 例外逐项登记」。

### 11.1 拆分成果

| 文件                                                                                     |                      前 |                后 | 新增按职责文件                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------- | ----------------------: | ----------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `features/creative-console/creative-console-page.tsx`                                    |                    3018 |            **73** | 36 个：API 层（`creative-api-core`/`creative-responses-protocol`/`creative-*-api`）、聊天（`chat-session-model`/`chat-session-store`/`chat-conversation-actions`/`chat-markdown*`/`chat-message-*`/`chat-composer`/`chat-toolbar`/`chat-truncate-dialog`/`chat-panel`）、hooks（`use-creative-*` 7 个）、面板与共享件（`image-panel`/`video-request`/`video-attachment`/`video-composer`/`video-result`/`video-panel`/`voice-panel`/`creative-widgets`/`creative-model-scope`） |
| `features/creative-console/creative-console-api.ts`                                      |                     777 |            **24** | 改为公共出口 barrel，导出符号与类型不变                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `features/docs/api-docs-page.tsx`                                                        |                     803 |            **63** | 6 个（`endpoint-definitions` 476、`api-docs-example-panel` 133、`api-docs-blocks` 106 等）                                                                                                                                                                                                                                                                                                                                                                                      |
| `features/media/video-gallery-page.tsx`                                                  |                     647 |            **80** | media 共 20 个（最大 `video-gallery-table` 380）                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `features/media/gallery-page.tsx`                                                        |                     389 |            **62** | 同上                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `features/audits/request-audits-page.tsx`                                                |                    1259 |           **138** | 21 个（`use-audit-list` 370、`audit-attempt-detail` 188、`audit-filter-definitions` 151 等）                                                                                                                                                                                                                                                                                                                                                                                    |
| `features/audits/request-audit-detail-dialog.tsx`                                        |                     670 |           **137** | 同上                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `features/accounts/accounts-page.tsx`                                                    |                    2382 |            **35** | 22 个（`use-accounts-transfer-flows` 356、`accounts-table` 347、`use-accounts-task-flows` 289、`use-account-delete-flow` 287、`accounts-toolbar` 318、`accounts-flow-dialogs` 260、`use-accounts-page-model` 254 等）                                                                                                                                                                                                                                                           |
| `app/app-shell.tsx`                                                                      |                     437 |            **61** | 7 个（`shell-navigation` 160、`shell-account-control` 125、`change-password-dialog` 121 等）                                                                                                                                                                                                                                                                                                                                                                                    |
| `features/dashboard/{trend,provider-distribution,overview,top-models,activity,page}.tsx` | 315/184/249/137/123/122 | 51/53/34/71/52/93 | 18 个（最大 `dashboard-trend-chart` 210）                                                                                                                                                                                                                                                                                                                                                                                                                                       |

**结构门禁（`structure-baseline.json` 已收紧）**：

- **超限文件（>600 行）：7 → 0**（历史基线 18；本阶段清零，`files` 为空对象）
- **超限函数（>50 行）：63 → 29**，全部为存量（无新增豁免）
- 扫描源码文件：249 → 380

### 11.2 覆盖率口径变更（本阶段重要纠正）

阶段 3–5 使用「手工维护达标文件清单」，导致 `accounts`、`settings` 页面、`quality-guard` 页面**长期不在门槛内且不可见**。本阶段改为：

- `include`：按已重构模块**整目录纳入**（app / accounts / audits / client-keys / creative-console / dashboard / docs / media / models / quality-guard / settings / system / shared-api / shared-auth / shared-hooks / virtual-table-body）
- `exclude`：**逐项写明理由**——测试与测试支撑、纯逻辑模块（其测试位于 node:test 层，v8 in jsdom 不统计）、纯 re-export barrel
- 首次暴露出的真实缺口：settings/egress/quality-guard 分支覆盖低至 0–10%（此前从未纳入），全局 branches 一度为 74.02%

### 11.3 本轮发现并修复的真实缺陷

1. **审计路由详情 tooltip 永不打开**（`features/audits/audit-route-cell.tsx#ModelRouteTrigger`）：`TooltipTrigger asChild` 克隆的 `onPointerMove`/`onFocus`/`data-state`/`ref` 被该函数组件丢弃、未展开到内部真实 `<button>`，触发器事件从不落到 DOM，路由详情（请求 ID / 客户端 IP / 实际模型 / 所属账号 / 所属密钥 / 检索来源）在真实 UI 中**永不显示**。修复为转发 `...triggerProps`；该文件分支覆盖由 33.33% 升到四项 100%
2. **测试并行度/超时口径与用例规模脱节**：24 文件/245 用例时 4 worker 可用；63 文件/682 用例时 4 worker 出现 5s 超时；155 文件/800+ 用例时 2 worker 仍出现 2 例超时（同文件单跑 21/21 全过，证明是 CPU 饱和而非逻辑挂起）。按证据把 `maxWorkers` 定为 2、`testTimeout` 定为 10s，并记录反证（真实挂起仍会失败）
3. **JSX 写进 `.ts` 文件**：`settings/egress-test-support.ts` 被追加 JSX 后 TypeScript 无法解析（19 个语法错误）→ 重命名为 `.tsx`
4. **测试工程类型门禁漏检**：`tsc -b`（`typecheck`）**不含** `*.test.ts(x)`（`tsconfig.app.json` 显式排除），测试文件只由 `tsconfig.test.json` 检查。子代理只跑 `tsc -b` 导致 **29 个测试类型错误**流入；已全部修复。**教训已记录：改测试必须跑 `npx tsc -p tsconfig.test.json`**
5. **11 个新用例契约漂移**（引用不存在的 testid/角色/文案）：`egress-node-actions.test.tsx` 9 个（`egress-import-list`→`egress-import-content`、不存在的 `egress-scope`/`egress-proxy-profile-manual`、分页选项 `50` 不存在实为 `100`、`/^筛选/` 命中多个等）、`guard-policy-and-events.test.tsx` 2 个（`min_healthy_nodes` 真实值为 1；zod 错误文案需先 submit 才渲染）。已按真实契约修复，未改任何组件行为、未弱化断言（反新增 2 条断言）

### 11.4 验证（阶段 6 工作树，本轮复测证据）

下列数字均为本轮实际执行的命令输出，不是计划值：

- `npx tsc -b --force` exit 0；`npx tsc -p tsconfig.test.json` exit 0（**0 错误**）
- `pnpm format:check`、`pnpm oxlint`（0 warnings / 0 errors，476 文件）、`pnpm lint`（eslint exit 0）全部通过
- Vitest 覆盖率门禁 `vitest run --coverage`：**89 文件 / 1122 用例全通过，0 失败**；全局 **statements 94.59% / branches 90.07% / functions 93.37% / lines 95.69%**，四项均高于 TEST-1 的 76% 门槛
- `pnpm check:architecture`（dependency-cruiser）**0 违规**：406 模块 / 1823 依赖（阶段 5 为 275/1234），跨 feature 冻结债务未扩张
- `pnpm check:structure` 通过：**超限文件 0、超限函数 29**（与冻结基线一致）
- 后端：`go build ./...`、`go vet ./...` exit 0；三包 `go test -count=1` 全通过（inference 138、provider-web 229、gateway 311 + 192 子测试，0 FAIL / 0 SKIP）

### 11.5 本轮新增的缺陷修复（在 11.3 之外）

1. **设置表单类型门禁整体失效（75 个 TS 错误）**：`settings-schema.ts` 为让字段级错误文案可渲染，把 `value` 从 `z.number().positive()` 改为 `z.unknown()` + 对象级 `superRefine`，导致 `SettingsForm` 中全部时长/字节字段退化为 `unknown`，`settings-model.ts`/各 pane 共 **75 处** TS2322/TS2345。根因不是断言过严，而是 schema 输出类型与 `DurationValue`/`ByteSizeValue` 契约脱节。修复：改用 `z.custom<number>()`（只声明类型、不做运行时断言），数值规则留在对象级 issue 上 —— 既保留「错误文案渲染到字段」的行为，又保持对外类型契约。修复后 `tsc -b` 0 错误，且 `src/features/settings` 160 个用例全通过
2. **`use-accounts-remaining-branches.test.tsx` 4 个失败用例**：`ApiError` 未导入（`TS2304`/运行时 `ApiError is not defined`）；`mocks` 缺少 `convertWebAccountsToBuild`/`listAccounts`/`getAccountSummary`（`Cannot read properties of undefined`）；`result.current.list.isError` 引用了不存在的属性（真实契约是 `list.query.isError`，且页面模型不为列表失败弹 toast —— 错误由表格 `ErrorState` 渲染）。修复后 23/23 通过。**该文件是阶段 6 新增测试文件，此前「全部通过」的记录不成立**
3. **`oxlint` 2 个错误 + 6 个文件格式不合规**：`use-accounts-remaining-branches.test.tsx` 重复 `import` 同一模块、`mocks` 重复键 `refreshAllWebAccountQuotas`、未使用的 `AccountProvider` 导入；另有 6 个文件（含 `AUDIT.md`）未过 Prettier。全部修正后 format/oxlint/lint 恢复 green

### 11.6 阶段 6 仍未达标项（如实登记，未静默排除）

- **逐文件口径**：阶段 6 收尾登记的「约 32 个文件 <76%」在阶段 7 收敛为 **8 个文件**（全部落在分支或函数指标，语句与行均 ≥76%，最低语句 77.77）；逐项见 §13.2。原登记中 `quality-guard/**` 的 `degrade-events-list`、`use-degrade-accounts`、`probe-profile-dialog` 与 `src/app/**` 6 个 0% 入口均已达标。
- **自定义 hook（TEST-2）**：阶段 7 把逐文件 100% 阈值从 10 个扩到 **20 个**；原登记未达 100% 的 `use-degrade-accounts`、`use-guard-nodes`、`use-probe-profiles`、`use-guard-node-actions`、`use-creative-video` 及 accounts/creative 各 hook 均已达 100/100/100/100，仅 `use-account-cleanup-flow.ts`（分支 97.06）未纳入，理由见 §13.3。
- jsdom 无法驱动的分支已逐条登记（例如 Radix「每页条数」选择、模态遮挡下的预览删除路径、recharts tooltip/tick 回调、`web-account-scripts.tsx` 的 Radix Checkbox 提交路径）
- 后端函数级 REV-2 仍有 **7** 个函数 >50 行（gateway 7 / inference 0 / provider-web 0；HEAD 基线 88 → 阶段 6 本轮 18 → 收尾 7），逐项登记于 `backend/AUDIT.md` §12.2；其中 `createResponseAt` 908 行已登记为不强行拆，**不记为「已通过」**

## 12. 阶段 6 收尾（E2E 扩展 / 入口与包裹层覆盖率补强）

### 12.1 E2E 由 1 spec / 6 用例扩为 4 spec / 16 用例

新增 3 个 spec（`client-keys`、`request-audits`、`settings`），沿用既有隔离机制（生产 `frontend/dist` + 真实 Go 二进制 + 每 worker 独立端口/临时目录/合成凭据 + 未知外呼指向未监听端口），未放宽任何生产语义：

| 观测项    | 结果                                                                                            |
| --------- | ----------------------------------------------------------------------------------------------- |
| 执行命令  | `npx playwright test`                                                                           |
| 结果      | **16 passed / 0 failed**                                                                        |
| 耗时/并发 | 37.4s、4 workers、`retries: 0`（`frontend/playwright.config.ts:15` 仍为 0，未用重试掩盖缺陷）   |
| spec 计数 | 4（`auth` 6 / `client-keys` 4 / `request-audits` 3 / `settings` 3，用例数由 `^\s*test\(` 实测） |

覆盖明细见 §2「真实全栈 E2E」。空账号池下管理 API 与服务端真实返回的交叉验证（`items=[]`）只断言**真实空池语义**，未新增测试后门或放宽鉴权。

### 12.2 `src/app/**` 入口与包裹层覆盖率由 0% 提升到 100%

此前 §11.6 登记的 6 个「未被任何组件测试导入、实测 0%」文件已补齐组件测试：

| 文件                                             | 补测结果     | 覆盖内容                               |
| ------------------------------------------------ | ------------ | -------------------------------------- |
| `src/app/auth-boundary.tsx`                      | 0 → **100%** | 已登录/未登录分支、加载态、重定向      |
| `src/app/deferred-pages.tsx`                     | 0 → **100%** | 懒加载 fallback 与 Suspense 边界       |
| `src/app/providers.tsx`                          | 0 → **100%** | Query/主题/鉴权 Provider 组装与卸载    |
| `src/app/router.tsx`                             | 0 → **100%** | 路由表装配与 SPA 回退                  |
| `src/shared/auth/auth-context.tsx`               | 0 → **100%** | context 消费与缺失 Provider 的显式报错 |
| `src/features/settings/egress-error-tooltip.tsx` | 0 → **100%** | 有/无错误时的渲染与可访问名称          |

新增测试文件（`src/app/{auth-boundary,deferred-pages,providers,router}.test.tsx`、`src/shared/auth/auth-context.test.tsx`、`src/features/settings/egress-error-tooltip.test.tsx`）共 **45 个用例**（总数以实际运行报告为准，未逐一比对行内 `it(` 计数）。`src/app/**` 目录汇总：statements **53.95 → 99.28**；剩余未达 100% 的为存量 `app-shell.tsx` 92.85 statements 与 `shell-navigation.tsx` 分支 95。

### 12.3 仍未达标项（本阶段未解决，如实登记）

- **逐文件口径**：阶段 6 收尾登记的「约 32 个文件 <76%」已归零——阶段 7 先补 `src/app/**` 6 个 0% 入口与 9 个 hook 的 100%（§13.1），再补齐最后 8 个文件的分支/函数缺口（§13.2）。当前逐文件四项全部 ≥76%。
- **hook 100%（TEST-2）**：阶段 7 已把逐文件 100% 阈值从 10 个扩到 **20 个** hook；唯一未纳入的是 `use-account-cleanup-flow.ts`（分支 97.06，1 个不可驱动分支），见 §13.3。
- **全局覆盖率**：阶段 7 最终实测 statements 97.65 / branches 93.76 / functions 97.94 / lines 98.36（113 文件 / 1394 用例，门槛 76），取代此前「补强后未重新实测」的说明。
- **后端函数级 REV-2 仍剩 7 个** >50 行（gateway 7 / inference 0 / provider-web 0，详见 `backend/AUDIT.md` §12.2 与 §13.6），未记为「已通过」。

## 13. 阶段 7（逐文件覆盖率 ratchet / 文档与配置一致性 / 复验）

阶段 7 在阶段 6 收尾的工作树上继续；未改变对外 API、DTO、模型路由 ID、鉴权、计费与审计语义。

### 13.1 hook 覆盖率收敛（只改测试，未改生产代码）

| 目标                                       | 收敛前（stmts/br/fn/lines）   | 收敛后              | 驱动用例                                                                  |
| ------------------------------------------ | ----------------------------- | ------------------- | ------------------------------------------------------------------------- |
| `quality-guard/use-degrade-accounts.ts`    | 71.23 / 60 / 55.88 / 74.57    | **100/100/100/100** | `use-guard-hooks.test.tsx`（新增）                                        |
| `quality-guard/use-guard-nodes.ts`         | 84.61 / 83.87 / 85.71 / 83.87 | **100/100/100/100** | 同上                                                                      |
| `quality-guard/use-probe-profiles.ts`      | 90 / 44.44 / 82.6 / 91.48     | **100/100/100/100** | 同上                                                                      |
| `quality-guard/use-guard-node-actions.ts`  | 96.87 / 64.28 / 93.33 / 96.72 | **100/100/100/100** | 同上                                                                      |
| `creative-console/use-creative-console.ts` | 98.57 / 97.05 / 100 / 100     | **100/100/100/100** | `use-creative-console.test.tsx`（+1，`render(<StrictMode>…)` 真实重挂载） |
| `creative-console/use-creative-video.ts`   | 98.82 / 94.44 / 96.29 / 98.73 | **100/100/100/100** | `use-creative-video.test.tsx`（+2，面板重试与 hook 级 `retryStatus`）     |
| `creative-console/use-creative-voice.ts`   | 98.33 / 92.1 / 100 / 100      | **100/100/100/100** | `use-creative-voice.test.tsx`（新增 3 例，陈旧提交闭包驱动回退）          |
| `accounts/use-accounts-transfer-flows.ts`  | 100 / 96.15 / 100 / 100       | **100/100/100/100** | `use-accounts-flow-error-branches.test.tsx`（新增 4 例）                  |
| `accounts/use-accounts-page-model.ts`      | 100 / 95.65 / 100 / 100       | **100/100/100/100** | 同上                                                                      |

本轮共新增 **23 个前端测试文件**（20 个 Vitest 组件/集成测试 + 3 个 Playwright E2E spec），并对既有测试做扩展；**未修改任何生产代码**。

`vitest.config.ts` 的 TEST-2 逐文件 100% 阈值由 10 个 hook 扩到 **20 个**，把上述已达标 hook 锁定，防止回退。

### 13.2 逐文件覆盖率实测（阶段 7，最终）

`pnpm verify` 内 `test:ui:coverage`：**113 文件 / 1394 用例全过**（413.8s，`maxWorkers: 2`），全局 **97.65 / 93.76 / 97.94 / 98.36**（门槛 76）。本节数字已被 §15 的 `thresholds.perFile` 复测取代（1394 用例）。逐文件（287 个纳入文件）**四项全部 ≥76%**——阶段 6 登记的「约 32 个文件 <76%」已归零。

收口过程：先由 `src/app/**` 6 个 0% 入口补测（§12.2）与 9 个 hook 收敛到 100%（§13.1）把缺口从 32 降到 8，再补 31 个用例把最后 8 个文件的分支/函数指标补过门槛：

| 文件                                               | 收敛前（stmts/br/fn/lines）   | 收敛后（stmts/br/fn/lines） |
| -------------------------------------------------- | ----------------------------- | --------------------------- |
| `features/settings/egress-source-dialog.tsx`       | 77.77 / 87.50 / 70.58 / 80.76 | 100 / 95.83 / 100 / 100     |
| `features/settings/egress-node-dialogs.tsx`        | 82.81 / 77.02 / 75.00 / 85.00 | 100 / 95.95 / 100 / 100     |
| `features/settings/settings-page.tsx`              | 90.00 / 100 / 66.66 / 100     | 100 / 100 / 100 / 100       |
| `features/settings/settings-page-tabs.tsx`         | 100 / 50.00 / 100 / 100       | 100 / 100 / 100 / 100       |
| `features/settings/settings-form-layout.tsx`       | 87.50 / 69.23 / 100 / 100     | 100 / 100 / 100 / 100       |
| `features/settings/egress-automation-settings.tsx` | 93.54 / 66.66 / 90.47 / 93.10 | 100 / 83.33 / 100 / 100     |
| `features/accounts/web-account-settings.tsx`       | 87.50 / 91.66 / 71.42 / 85.71 | 100 / 95.83 / 100 / 100     |
| `features/media/video-gallery-page.tsx`            | 100 / 72.72 / 100 / 100       | 100 / 90.90 / 100 / 100     |

新增测试文件 3 个（`settings/egress-dialog-fields.test.tsx`、`settings/settings-form-controls.test.tsx`、`accounts/web-account-settings-menu.test.tsx`），扩展 4 个既有测试文件（`settings/egress-operations-extra.test.tsx`、`settings/settings-page.test.tsx`、`accounts/web-account-settings-dialogs.test.tsx`、`media/video-gallery-page.test.tsx`）；**未修改任何生产代码**。

另有 5 个**不含可执行语句**的类型/DTO 模块在文本报表中显示 0/0/0/0（`shared/auth/auth-state.ts`、`features/settings/settings-dto.ts`、`features/settings/egress-dto.ts`、`features/media/types.ts`、`features/accounts/accounts-flow-context.ts`），属 v8 统计假象，不是覆盖缺口。

### 13.3 仍登记未达标项

- **逐文件 TEST-1：已无 <76% 的文件**。原 8 个文件的分支/函数缺口已补齐（§13.2）；仍保持未覆盖的是下列**死分支或工具语义不可达**分支（未伪造覆盖率、未改生产代码）：`egress-automation-settings.tsx:301` 的 `error` 死 prop 与 `:356` 逻辑上不可能成立的 `??` 右侧；`egress-source-dialog.tsx:46`、`egress-node-dialogs.tsx:53`/`:354` 的 `onOpenChange` 合成 else 分支（父级完全受控、内部无 `DialogTrigger`，jsdom 不可驱动）；`egress-node-dialogs.tsx:461` 的 `description` 死 prop；`media/video-gallery-page.tsx:39` 的 `result?.items.length ?? 0` 回退（左侧 `Boolean(result)` 已保证非空）；`accounts/web-account-settings.tsx:114` 的 `confirmationTarget` else 分支（目标为 null 时按钮 `disabled`，真实浏览器不派发 click）。这些分支不影响四项指标达标。
- **hook 100%（TEST-2）仍有 1 个未纳入阈值**：`accounts/use-account-cleanup-flow.ts` 分支 97.06，剩 `:169` 的 `preview?.data ?? null` 兜底分支。不可驱动证据：`previewFresh` 为真时 `preview` 必非 null，且 `preview.data` 来自 `account-batch-api.ts` 的解码器校验，null/undefined 响应会直接 reject。要让该分支执行只能让 mock 违反解码器契约（伪造覆盖率）或改生产代码，两者均未采用。
- **后端函数级 REV-2 仍剩 7 个** >50 行（gateway 7 / inference 0 / provider-web 0，详见 `backend/AUDIT.md` §12.2 与 §13.6），未记为「已通过」。
- **既有 StrictMode 用例是空转（本轮发现，未修改原用例）**：`creative-console/use-creative-console.test.tsx` 的 `strictWrapper` 把 `<StrictMode>` 放在自定义 wrapper 组件**内部**，实测不会触发 React 的 effect 双重执行，因此该用例「StrictMode 下不重复读取密钥」并未真正走到重挂载路径。本轮新增了真实双重执行的用例覆盖同一行为。

### 13.4 文档与配置一致性修正（阶段 7 只读审计发现）

| 发现                                                                               | 修正                                                                                                                                  |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| §1 验收矩阵 FE-A3/A5/A6/A7/A8/A9/A11/A13 停留在阶段 0–2 数值                       | 改为阶段 7 实测值（见 §1 与 §2）                                                                                                      |
| §2「`coverage.include` 当前 3 个文件」与 `vitest.config.ts` 的 16 条不一致         | 改为实际口径（16 条 include + 14 条 exclude + 20 个 hook 阈值）                                                                       |
| §2 覆盖率表仍是阶段 2 的 3 行                                                      | 改为阶段 7 全局实测                                                                                                                   |
| §2/§4.1 的 `252.07 KiB`、`128 模块 / 659 依赖` 过时                                | 改为 249.99 KiB、406 模块 / 1823 依赖                                                                                                 |
| §11.6「约 32 个文件 <76%」与「hook 未全部达标」与实测不符                          | 更新为 8 个文件（分支/函数指标）与 1 个 hook；见 §13.2 / §13.3                                                                        |
| `frontend/README.md` 把 `pnpm test:e2e` 列进「`pnpm verify` 依次执行」             | 改为明确「`pnpm verify` 不含 E2E」，并修正表内 `typecheck:e2e` 的位置                                                                 |
| `vitest.config.ts` 中 `endpoint-definitions.ts` 的排除理由写作「同名 `*.test.ts`」 | 该文件无同名 node:test 文件，实际由 `api-docs-examples.test.ts` 覆盖；注释改为准确表述                                                |
| 根 `AGENTS.md` REV-1 / REV-3 / TEST-6 的判定与门禁实际能力不符                     | REV-1 注明门禁扫描范围排除测试文件；REV-3 注明无自动门禁；TEST-6 注明 `go build` 为本地必需检查、CI 的 `go test`/`-race` 已编译全部包 |

### 13.5 阶段 7 复验（`pnpm verify`，exit 0）

| 步骤           | 命令                      | 结果                                                                                            |
| -------------- | ------------------------- | ----------------------------------------------------------------------------------------------- |
| 格式           | `pnpm format:check`       | Passed（All matched files use Prettier code style）                                             |
| Oxlint         | `pnpm oxlint`             | Passed（0 warnings / 0 errors，500 文件 / 96 规则）                                             |
| ESLint         | `pnpm lint`               | Passed（0 problem）                                                                             |
| 类型           | `pnpm typecheck`          | Passed（无输出）                                                                                |
| E2E 类型       | `pnpm typecheck:e2e`      | Passed（无输出）                                                                                |
| 纯逻辑单测     | `pnpm test`               | Passed（68 tests / 37 suites / 0 fail / 0 skip）                                                |
| 组件单测覆盖率 | `pnpm test:ui:coverage`   | Passed（113 文件 / 1388 tests；97.65 / 93.76 / 97.94 / 98.36）                                  |
| 依赖边界       | `pnpm check:architecture` | Passed（406 模块 / 1823 依赖 / 0 违规）                                                         |
| 结构约束       | `pnpm check:structure`    | Passed（380 源码文件；0 超限文件 / 29 超限函数 = 冻结基线）                                     |
| 门禁自测       | `pnpm test:gates`         | Passed（9 用例，含 4 个必须失败）                                                               |
| 生产构建       | `pnpm build`              | Passed（1.32s）                                                                                 |
| 体积预算       | `pnpm check:budget`       | Passed（首屏 249.99 / 260；全部 JS 620.66 / 650；CSS 16.65 / 20；最大 chunk 458.55 / 500 原始） |
| 真实全栈 E2E   | `pnpm test:e2e`           | Passed（16 passed / 0 failed / 36.8s / 4 workers / `retries: 0`）                               |

### 13.6 CI 首次运行暴露并修复的 E2E 隔离缺陷（P1）

PR #1 上的 CI run `38043685073`（sha `8534d1a6`）Verify job：后端 Test / Assert required integration tests ran / **Race** / Vet / Swagger diff 与前端 `pnpm verify` 全部 **success**，「Run full-stack E2E」**failure（1 failed / 15 passed）**。

| 观测项   | 事实                                                                                                                                                                                                                                                                                                                                              |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 失败用例 | `e2e/client-keys.e2e.ts`「删除密钥：确认后行与真实服务端记录同时消失」                                                                                                                                                                                                                                                                            |
| 失败断言 | `expect(page.getByTestId("client-keys-empty")).toContainText(/^(暂无数据\|No data)$/)`（第 171 行），`element(s) not found`，15s 超时                                                                                                                                                                                                             |
| 根因     | 该断言要求**整个列表**为空，而 Playwright 每个 worker 共享同一临时后端与 SQLite。本地 4 worker 下「编辑密钥」与「删除密钥」被分到不同 worker 恰好通过；CI 2 worker 下两者同 worker，「编辑密钥」留下的密钥使列表非空 → 空态元素不存在。同文件另有 2 处同类隐式依赖（创建用例的空态断言与按整库为空的 API 断言、编辑用例切回「可用」筛选后的空态） |
| 修复     | 新增 `searchKeys` 助手，用唯一搜索词把列表收敛到确定集合后再断言空态；按整库为空的 API 断言改为按唯一名称查询。断言仍针对用户可见结果与真实服务端事实，未放宽、未删除断言                                                                                                                                                                         |
| 验证     | `npx playwright test --workers=2`（复现 CI 条件）**16 passed / 0 failed / 58.7s**；`pnpm typecheck:e2e` exit 0                                                                                                                                                                                                                                    |
| 结论     | 这是**测试隔离缺陷**，不是产品缺陷；此前「本地 4 worker 16/16 通过」不构成 CI 通过的证据，worker 调度顺序曾使断言偶然成立                                                                                                                                                                                                                         |

### 13.7 CI 第二次运行暴露并修复的 E2E 登录限流缺陷（P1）

CI run `38047249123`（sha `5bd6b34d`）Verify job 其余步骤全 success，「Run full-stack E2E」再次 **failure（1 failed / 15 passed）**，但失败用例与 §13.6 不同。

| 观测项   | 事实                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 失败用例 | `e2e/settings.e2e.ts`「设置页分页可切换：Grok Build 与 Grok Web 面板按标签显隐」                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 失败断言 | `signIn()`（`e2e/fixtures.ts:87`）的 `expect(page).toHaveURL(/\/dashboard$/)`：点击登录后 15s 内 URL 仍为 `/login`                                                                                                                                                                                                                                                                                                                                                                                         |
| 根因     | 后端管理面登录接口按用户名限流 **12 次/分钟**（`backend/internal/application/adminauth/service.go:219`，键 `admin-login:user:<hash>`；`RateLimiter` 窗口 60s，`count >= limit` 即拒绝 → HTTP 429 `loginRateLimited`）。E2E 每个 worker 运行 16 个用例，其中 11 次 UI 登录 + 多次 `apiLogin` 会超过 12 次，第 13 次起登录失败、页面停在 `/login`。**本地复现**：`npx playwright test --workers=1` 时 `request-audits` 用例直接抛出 `管理员 API 登录失败：HTTP 429 loginRateLimited`（1 failed / 15 passed） |
| 修复     | `e2e/fixtures.ts`：按 worker 复用一次会话（`storageState` 的 cookie，登录态经 refresh cookie 恢复）与一次 API 令牌；仅在会话尚未建立或已被注销时才真正调用登录接口（`restoreCachedSession` 会先探测缓存会话是否仍有效）。登录流程本身仍由 `auth.e2e` 的两处 `signIn(page, server, { fresh: true })`（正确凭据登录 + 注销）与错误密码用例真实覆盖；未放宽任何断言、未新增生产后门、未修改后端限流                                                                                                           |
| 验证     | `npx playwright test` 在 **1 / 2 / 4 worker** 下均 **16 passed / 0 failed**（42.4s / 26.3s / 24.1s）；`pnpm typecheck:e2e` 与 `pnpm lint` exit 0                                                                                                                                                                                                                                                                                                                                                           |
| 结论     | 这是**测试与生产限流策略的冲突**，不是产品缺陷：限流按设计生效，E2E 需要复用会话而不是每次重新登录。§13.6 的隔离缺陷与本次限流缺陷是两次独立的 CI 失败，均已修复                                                                                                                                                                                                                                                                                                                                           |

## 14. 发布登记：v0.1.1（2026-10-10）

维护线首次发布，按 `AGENTS.md` §8 流程执行并登记证据。**前端门禁、CI Verify、容器镜像发布与工作流缺陷修复（P1/P3）均经实测 `Passed`。**

| 项目             | 事实                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 发布版本         | 根 `VERSION` = `v0.1.1`；`frontend/package.json` = `0.1.1`（此前为 `v3.1.6` / `0.1.0`，两套载体长期不一致，本次对齐；`Dockerfile:66` 把 `VERSION` 复制进镜像 `/app/VERSION`）                                                                                                                                                                                                                                                                                                                                                                                                     |
| 发布提交         | `b2123a7d0e250948f9f23b941f5a9acd2640ba35`（`main`，由 `maint/modular-quality-audit` fast-forward 合并，含 45 个既有提交 + 本次 2 个发布准备提交）                                                                                                                                                                                                                                                                                                                                                                                                                                |
| tag              | annotated `v0.1.1`，tag 对象 `db20ef9638fc27cee5bc915dc7afa84724a34610`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| GitHub Release   | https://github.com/JasmineTony/grok2api/releases/tag/v0.1.1 （非草稿、非预发布；本仓库首个 Release）                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 分支收敛         | `main` 与 `maint/modular-quality-audit` 完全一致（ahead/behind = 0/0）；`wip/stage5-settings-egress-guard` 已完全包含在 `main`（main 领先 31，wip 领先 0），无需单独合并。PR #1 由 GitHub 判定为 merged 并自动关闭                                                                                                                                                                                                                                                                                                                                                                |
| 本地门禁         | `pnpm verify` **exit 0**（733s）：113 文件 / 1388 用例全过；全局 statements 97.66 / branches 93.76 / functions 97.98 / lines 98.36；结构 0 超限文件 / 29 超限函数（= 冻结基线）；首屏 249.99 KiB、全部 JS 620.66 KiB、CSS 16.65 KiB，均在阈值内（**发布时快照**；FE-10 修复后的复测数字见 §15）                                                                                                                                                                                                                                                                                   |
| 远端 CI（tag）   | `GHCR Image` run `38054220100`（ref `v0.1.1`）：**Verify job 18 步全部 success**——后端 Test、Assert required integration tests ran（0 跳过）、Race、Vet、Swagger 精确 diff、前端 `pnpm verify`、全栈 E2E（16 passed）                                                                                                                                                                                                                                                                                                                                                             |
| 远端 CI（main）  | `GHCR Image` run `38054197912`（ref `main`）：Verify 同样全部 success                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 镜像发布         | **Passed**：删除未链接的孤立包后，run `38054220100`（tag `v0.1.1`）attempt 2 的 `Publish image (amd64)`/`(arm64)` 成功；run `38055278879`（`main`，sha `2d386540`）attempt 2 的 `Publish` 与 `Merge image` 全部 success。注册表实测 9 个 tag：`v0.1.1`、`v0.1.1-amd64`、`v0.1.1-arm64`、`main`、`main-amd64`、`main-arm64`、`latest`、`latest-amd64`、`latest-arm64`；`v0.1.1` / `main` / `latest` 均为 `application/vnd.oci.image.index.v1+json` 且实际平台为 linux/amd64 + linux/arm64，匿名拉取 HTTP 200                                                                       |
| 已解除的阻塞     | `ghcr.io/jasminetony/grok2api` 容器包由本仓库 2026-10-09T10:34:12Z 重建前的旧实例创建，`repository` 字段为 `NULL`（162 个版本全部来自旧实例），`GITHUB_TOKEN` 即使已获 `Packages: write` 仍被包级授权拒绝。**处置**：经维护线负责人授权，用带 `包读取作用域` + `包删除作用域` 的 交互式授权流程 凭据删除该孤立包（HTTP 204 → 再查 404），再由 CI 重建——新包 2026-10-10T13:57:17Z 创建、`visibility=public`、`repository=JasmineTony/grok2api`。详见 `backend/AUDIT.md` §11                                                                                                 |
| 已修复缺陷（P1） | **tag 推送时 `Merge image` 必然失败**：`docker/metadata-action@v5` 未设 `flavor`，默认 `latest=auto` 会对 `type=ref,event=tag` **无条件**标记 latest（不限于 semver），而自动 latest 只继承 `flavor.prefix/suffix`、不继承条目级 `suffix=` → per-arch 步骤在 tag 推送时另推一个单架构裸 `latest`，merge 步骤则去找不存在的 `latest-amd64`/`latest-arm64`，报 `ERROR: ...:latest-arm64: not found`（run `38054220100` attempt 2，job `114229640946`；`v0.1.1` 索引在失败前已产出 `sha256:daa912bf…`）。**修复**：`b4068303` 给两个 `Docker metadata` 步骤加 `flavor: latest=false` |
| 已修复缺陷（P3） | `merge` 的 `Create manifest list` 循环缺 `set -euo pipefail`，管道退出码只反映 `while` 循环最后一次迭代，前面的 `imagetools create` 失败会被后面的成功掩盖，留下陈旧标签却报绿。**修复**：`a4f58384` 在 `run:` 首行加 `set -euo pipefail`（由只读代码审查发现）                                                                                                                                                                                                                                                                                                                   |
| 缺陷验证证据     | **tag 推送路径（P1 靶心）**：推临时 tag `v0.1.1-verify.1`（指向含修复的 `a4f58384`）→ run `38060494037` **全部 job success**；`Merge image` 日志 `Processing flavor input → latest=false`、`DOCKER_METADATA_OUTPUT_TAGS = ghcr.io/jasminetony/grok2api:v0.1.1-verify.1`（只剩版本标签）、`imagetools inspect` 成功；`Publish image (amd64)` 只推 `…-amd64`，不再产生裸 `latest`。**main 推送路径**：run `38060467337` 全部 job success（无回归）。验证后已删除临时 tag 与其 3 个镜像版本（另清 4 个孤儿 attestation），注册表回到 9 个正式标签                                    |
| 未达成项         | ① 历史 tag 运行 `38054220100` 的 `Merge image` 仍显示 `Failed`——GitHub 的 re-run 使用该 run 原始提交 `b2123a7d`（不含修复）的工作流定义，无法就地转绿；修复自 `a4f58384` 起生效，下次 tag 推送即全绿。② tag `v0.1.1` 仍指向 `b2123a7d`，其 AUDIT 内容为发布当时的登记，修订位于 `main`；如需 tag 自身包含修复与登记，需重新打 tag（不可逆，未执行）                                                                                                                                                                                                                               |

## 15. FE-10 修复：i18n 非首屏领域移出首屏闭包（2026-10-10）

`FE-10` 登记的「首屏闭包余量过小」按该条登记的验证方法（「拆分 i18n/入口依赖并复测预算」）修复。

### 根因（实测）

首屏闭包 2 个文件共 249.99 KiB gzip，其中共享 chunk 并非旧描述的「图标运行时」（实测其中**没有任何 lucide 图标模块**），而是 **i18n 两语言全量领域文案 ≈62 KiB gzip + react/i18next/react-i18next/react-query/radix/lucide 运行时 ≈47.5 KiB gzip**。入口 chunk 静态 import 了该共享 chunk，而门禁按整文件计费，于是 15 个领域文案全部进入首屏闭包——但首屏实际只用 3 个。

### 判定依据（源码静态闭包）

从 `src/main.tsx` 出发、不跟随 `deferred-pages.tsx` 的 12 个 `lazy()` 目标，首屏模块集 55 个文件；其中出现翻译调用的只有 4 个文件，涉及 3 个领域：

| 领域         | 首屏使用点                                                                                                         | 是否可异步                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| `common`     | `features/auth/login-page.tsx:54,65,34`、`components/ui/spinner.tsx:13`（`PageLoadingFallback` 与所有 `Suspense`） | 否（首帧即渲染）                               |
| `auth`       | `login-page.tsx:20,21,66,67,74,75,79,90,101`、`app/auth-boundary.tsx:50,51,53`（会话不可用时立即渲染）             | 否                                             |
| `api-errors` | `shared/api/client.ts:43-44` 以 `` `apiErrors.${code}` `` **同步**调用 `i18n.exists`/`i18n.t`                      | 否（异步补入会产生「错误文案回落英文」的竞态） |

其余 12 个领域（`web-accounts`、`accounts`、`account-credentials`、`dashboard`、`creative-console`、`quality-guard`、`models`、`client-keys`、`audits`、`settings`、`egress`、`docs`）**无任何首屏模块引用**。

### 改动

| 文件                                            | 变更                                                                                                                                           |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/shared/i18n/resources/initial.ts`（新增）  | 只静态包含 3 个领域 × 2 语言，导出形状与拆分前一致                                                                                             |
| `src/shared/i18n/resources/deferred.ts`（新增） | 其余 12 个领域 × 2 语言，独立成一个懒加载 chunk                                                                                                |
| `src/shared/i18n/resources/index.ts`            | 改为 `export { default as resources } from "./initial"`                                                                                        |
| `src/shared/i18n/resources/{en,zh-CN}/index.ts` | **删除**（全量静态展开的根源；领域文件一个未删）                                                                                               |
| `src/shared/i18n/index.ts`                      | 新增 `loadDeferredResources(): Promise<void>`：单例 Promise，`import("./resources/deferred")` 后对两种语言 `addResourceBundle`；失败不静默吞掉 |
| `src/app/deferred-pages.tsx`                    | `lazyNamed` 改为「先 `await loadDeferredResources()` 再解析页面导出」，顺序不可颠倒                                                            |
| `src/test/setup.ts`                             | 组件测试直接渲染页面、绕过懒加载包装，故在 `beforeAll` 复现同一前置条件（否则 `t("accounts.x")` 原样回显 key，断言会退化为恒等比较）           |

测试为**新增断言**：`resources.test.tsx` 7 → 10 用例（原 7 个用例的 key 总数/集合/占位符断言数值与文本一字未改，仍在合并后全量资源上执行；新增「initial 同步可用且 4 个 deferred key 不可见」「懒加载后 12 个领域可解析」「重复调用复用同一 Promise」），`language-memory.test.tsx` 在 `vi.resetModules()` 后补前置加载。

### 实测结果

| 指标             | 改前                 | 改后                                                                                                             |
| ---------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 首屏关键 JS 闭包 | 249.99 KiB / 2 文件  | **193.31 KiB / 2 文件（−56.68 KiB，−22.7%）**                                                                    |
| 首屏余量         | 10.01 KiB（3.85%）   | **66.69 KiB（25.65%）**                                                                                          |
| 全部生产 JS      | 620.66 KiB / 76 文件 | 621.23 KiB / 77 文件（净影响 +0.08 KiB：新增 `deferred-*.js` 58.84 KiB 与首屏减少 58.76 KiB 相抵）               |
| 路由入口         | 12                   | 13（多出的是 `deferred-*.js`：`import()` 字面量位于首屏 chunk 内，被门禁按懒加载入口归类；增量 57.25 KiB < 180） |
| 最大路由增量     | 129.08 KiB           | 129.12 KiB（`dashboard-page`）                                                                                   |
| 相对冻结基线     | —                    | 首屏 −22.8%（下降，通过）；全部 JS +4.72%（容差 5%，**余量仅 1.68 KiB**）                                        |

验证：`pnpm verify` **exit 0**（565s，12 步全绿；113 文件 / 1394 用例，全局 97.65 / 93.76 / 97.94 / 98.36 未变；结构 0 超限文件 / 29 超限函数 = 冻结基线；依赖 406 模块 / 1825 依赖 / 0 违规）；`pnpm test:e2e` **exit 0**（16/16，4 workers，`retries: 0`）——其中 `e2e/auth.e2e.ts` 的登录首屏标题/副标题/按钮/错误提示断言全部通过，且 `auth.e2e.ts:36-43` 断言在 `/dashboard` 上 `page.reload()` 后仍显示已翻译标题，直接证明「直接/刷新进入懒加载路由」时前置加载生效。

### 15.6 体积漂移归因与基线重定（2026-10-11）

`bundle-budget.json` 的冻结基线由 2026-10-09T12:11:10Z 生成（`allJs` gzip 607485 B / 74 文件）。FE-10 修复后实测 `allJs` **636140 B / 77 文件**，相对该基线 **+28655 B（+27.98 KiB，+4.72%）**，REV-5 容差（5%）余量仅 1.68 KiB。经维护线负责人批准的处置：**先归因、再重定基线**；硬阈值与容差百分比不变。

| 指标             | 冻结基线（2026-10-09） |               当前 | Δ                      |
| ---------------- | ---------------------: | -----------------: | ---------------------- |
| 全部生产 JS      |     607485 B / 74 文件 | 636140 B / 77 文件 | +28655 B（+4.72%）     |
| 首屏关键 JS 闭包 |      258122 B / 2 文件 |  197947 B / 2 文件 | −60175 B（−58.76 KiB） |
| 全部生产 CSS     |       17054 B / 1 文件 |   17054 B / 1 文件 | 0                      |
| 最大单 chunk     |          469314 B 原始 |      468141 B 原始 | −1173 B                |

路由级增量（KiB，12 条共同路由；路由闭包互相包含共享 chunk，**不可相加当总量**）：accounts +6.44、creative-console +6.71、settings +5.11、quality-guard +3.04、video-gallery +2.67、gallery +2.17、client-keys +1.97、request-audits +1.55、models +1.26、dashboard +1.24、app-shell +0.55、api-docs +0.29，合计 +32.99；新增第 13 条入口 `deferred-*.js`（57.25 KiB）是 i18n 非首屏文案 chunk，其 `import()` 字面量位于首屏 chunk 内而被门禁按懒加载入口归类，dist 内无任何路由静态引用它（`from"./deferred-*.js"` 零命中）。

提交级来源（`git log --since=2026-10-09T12:00:00Z -- frontend/src`，19 个提交；剔除纯测试/文档提交后，改动会进入生产 JS 的非测试模块的提交）：`30953dc2`（i18n 拆分）、`3842d3d2`（accounts/client-keys/models 拆分）、`6ad1451f`（quality-guard/settings 拆分）、`d5f8e898` 与 `6a05ebd2`（出口 blocked-delete 修复引入的生产逻辑）、`d4e41653`/`d840748a`/`21c97bf7`/`6c25dced`/`d136d9d2`/`231e0fe1`/`a968ad51`（阶段 6 各模块拆分）、`6525b54a`（15 个创作台组件补 `data-testid`）、`2d5530f6`（FE-10，已知净 +0.08 KiB）。

重定结果：`node scripts/check-bundle-budget.mjs --update`（exit 0）后新基线 `generatedAt = 2026-10-11T02:27:32.159Z`，`allJs` 636140 B / 77 文件、`initialClosure` 197947 B / 2 文件、`allCss` 17054 B、`maxChunk` 468141 B、`routes` 13 条；随后 `node scripts/check-bundle-budget.mjs` exit 0。`thresholds`（260/180/650/20/500 KiB）与 `growthTolerancePercent: 5` **一字未改**（`git diff` 中命中阈值字段的变更行数为 0）——本次只把已解释的漂移冻结进基线，不是放宽阈值。副作用与边界：`allJs` 容差余量由 1.68 KiB 恢复为 5%（≈31 KiB），同时首屏闭包与最大 chunk 的基线分别被收紧 58.76 KiB 与 1173 B。

### 未处理项与风险（如实登记）

1. **`全部生产 JS` 相对冻结基线的漂移已归因并重定基线（2026-10-11，§15.6）**：原登记「容差余量仅 1.68 KiB、待决策」**已解除**——漂移 +4.72%（+28655 B / 27.98 KiB）在 REV-5 的 5% 容差内；归因粒度见 §15.6（`baseline` 只保存总量与路由闭包，**未做也无法做逐文件字节级归因**，本文件不给出未经验证的逐文件数字）；`thresholds` 与 `growthTolerancePercent` 未改，`pnpm check:budget` exit 0。残留风险：重定基线把一次 5% 容差吸收进基线，后续增长仍须逐次解释，不得再次静默吸收。
2. **`src/shared/i18n/**` 已纳入覆盖率口径（本轮修复）**：`vitest.config.ts` 的 `coverage.include` 新增该目录，并**同时**开启 `thresholds.perFile: true`——Vitest 5 的全局阈值默认只做聚合检查（`perFile` 默认 `false`，只有 glob 键条目逐文件校验），因此此前「逐文件四项 ≥76%」并非门禁强制项，只是人工核对口径。补齐所需测试已加入 `language-memory.test.tsx`（3 个用例：`localStorage.getItem`/`setItem` 抛异常、`vi.stubGlobal` 把 `window`/`document` 置为 `undefined` 的 SSR 守卫），使 `shared/i18n/index.ts` 从 branches 60%（6/10）提升到**四项全 100%**（23/23、10/10、5/5、19/19）。实测：`pnpm verify` exit 0（113 文件 / 1394 用例；321 个纳入文件逐文件四项全部 ≥76%，最低 branch 76.36）、`pnpm test:e2e` 16/16 全绿。
3. 未评估：首屏减少 58.76 KiB 后，登录成功后首个懒加载页面需多一次 chunk 请求（与 shell chunk 并行）；未做真实浏览器资源瀑布与首屏指标（LCP/FCP）测量，故**不声称**「首屏更快」——本次只声称「首屏关键 JS 闭包减少 56.68 KiB」，与 REV-5 的度量口径一致。
4. 回滚：删除 `initial.ts`/`deferred.ts` 与 `loadDeferredResources` 调用，恢复两个被删 `index.ts` 与 `resources/index.ts` 原内容、还原 `deferred-pages.tsx` 与测试改动即可；无数据、配置或接口契约变更。
5. **0/0/0/0 的统计假象与 `perFile` 语义（本轮登记）**：`src/shared/i18n/resources/**` 的 34 个纯数据模块（`initial.ts`/`deferred.ts`/`index.ts` + 两语言各 15 个领域文件）在覆盖率报告中显示 0/0/0/0。根因**不是未覆盖**：V8 转换管线对「纯 `export default <字面量>`」模块只产出 `__vite_ssr_export_default__` 与无 source map 位置的 `__vite_ssr_exportName__(...)` 脚手架，前者被 `@vitest/coverage-v8` 的 `ignoreNode` 忽略、后者在 `ast-v8-to-istanbul` 中因无原始位置被丢弃，故 statementMap 为空；istanbul 对 `total === 0` 记 100%，不影响门槛。其**内容**由 `resources.test.tsx` 的 10 个断言真实验证（key 总数、keySet 与资源 SHA-256 摘要、抽样 key、占位符对齐、懒加载顺序）。此类假象与 `AGENTS.md` §5 已登记的 5 个类型/DTO 模块同类。另需注意：开启 `perFile: true` 后 Vitest 5 **不再单独校验全局聚合组**，只做逐文件校验（逐文件 ≥76% 数学上蕴含聚合 ≥76%，约束强度未降低）。

## 16. 发布登记：v0.1.2（2026-10-11）

按 `AGENTS.md` §8 执行。本节按发布流程分两次写入：**16.1 远端仓库重建**（重建动作完成即登记）、**16.2 发布与镜像证据**（tag 与镜像产出后登记）。

### 16.1 远端仓库重建（按维护线负责人 2026-10-11 授权）

动机：规避历史遗留问题（历史 Actions run 中 tag `v0.1.1` 的 `Merge image` 因该 run 沿用修复前的工作流定义而永久显示 `Failed`；GHCR 包与仓库实例的归属历史）。

| 项目           | 事实                                                                                                                                                                                                                                                                              |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 旧仓库         | `JasmineTony/grok2api`（repo id `1411672647`，2026-10-09T10:34:12Z 创建；public、非 fork、默认分支 `main`、`has_wiki=false`、Actions 默认 workflow 权限 `read`）经 `DELETE /repos/JasmineTony/grok2api` 删除（HTTP 204，随后 GET 404）                                            |
| 新仓库         | 同名新建（repo id `1413858145`，2026-10-11T02:37:22Z；public、非 fork、默认分支 `main`、`has_issues=true`、`has_wiki=false`、`has_projects=false`）；Actions 默认 workflow 权限显式设为 `read`（与旧仓库一致，工作流内按需声明 `packages: write`）                                |
| GHCR 包        | 旧包 `ghcr.io/jasminetony/grok2api`（public，56 个版本，含 `v0.1.1`/`main`/`latest` 及各自 `-amd64`/`-arm64`）在仓库删除后成为孤立包，随即删除（HTTP 204，GET 404）；新包由本次 CI 首次发布时创建并链接到新仓库                                                                   |
| 有意丢弃的历史 | PR #1、Release `v0.1.1`、全部 Actions run 历史、tag `v0.1.1` 及其镜像（`sha256:daa912bf…`）。**代价已确认**：`v0.1.1` 镜像不再可拉取；其发布结论仍作为历史事实保留在本文件 §14 与 `backend/AUDIT.md` §14                                                                          |
| 未推送的 refs  | 远端只保留 `main` 与 `maint/modular-quality-audit`（推送时均为 `d070144b`）。上游历史 tag（`v1.x`–`v3.1.6` 等 50 个）与 `v0.1.1` tag **未推送**：它们匹配工作流的 `v*.*.*` 触发器，会对旧提交触发镜像工作流并再次留下失败历史（`v0.1.1` 提交 `b2123a7d` 早于 P1 修复 `b4068303`） |
| 本地安全备份   | 删除前执行 `git clone --mirror` 到会话 scratch 的 `grok2api-mirror.git`（69 个 ref、16.2 MB），并留档旧仓库远端 ref 清单（78 条）、旧仓库设置与旧 GHCR 版本清单；需要时可从该镜像恢复历史 ref                                                                                     |
| 推送凭据       | HTTPS OAuth 凭据缺工作流作用域（无法创建/更新 `.github/workflows/**`，推送被拒），改用已注册到该账号的 SSH 密钥推送；`origin` 仍为 `https://github.com/JasmineTony/grok2api.git`（`AGENTS.md` §1 未变），`upstream` 未推送                                                   |
| 首次 push 触发 | 首次 push 未产生 Actions run（`actions/runs` 持续 `total=0`，原因未查明），改用 `workflow_dispatch` 触发 run `38106888325` 验证 Actions 可用；后续 push 的触发情况在 16.2 登记                                                                                                    |

### 16.2 发布与镜像证据

| 项目            | 事实                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 版本载体        | 根 `VERSION` = `v0.1.2`、`frontend/package.json` = `0.1.2`（提交 `9b71efc0`）；CI 新增 `Verify version carriers are aligned` 步骤，三条 run 均 success                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 发布提交        | `34476cd3784cf4f0e89934d6dfca6257e849c54f`（`main` = `maint/modular-quality-audit`，含本轮 7 个提交）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| tag / Release   | annotated `v0.1.2`（tag 对象 `c2c94e1bb719eab5bea4998bb7b9235fac3f17de`，指向 `34476cd3`）；Release https://github.com/JasmineTony/grok2api/releases/tag/v0.1.2 （非草稿、非预发布，target `main`）                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 本机门禁        | `pnpm verify` **exit 0**（555s）：`format:check` / `oxlint`（0 warnings 0 errors，503 文件）/ `lint` / `typecheck` / `typecheck:e2e` / `test`（12 文件 / 68 用例 / 0 失败）/ `test:ui:coverage`（113 文件 / **1394** 用例，全局 97.66 / 93.77 / 97.95 / 98.36，**0 个文件低于 76%**）/ `check:architecture`（406 模块 / 1825 依赖 / 0 违规）/ `check:structure`（380 文件，0 超限文件 / 29 超限函数 = 冻结基线）/ `test:gates`（9 用例）/ `build`（4003 模块）/ `check:budget`（首屏 193.31、全部 JS 621.23、CSS 16.65、最大 chunk 457.17 KiB 原始、13 条路由）；`pnpm test:e2e` **exit 0**（16 passed / 4 workers / `retries: 0`） |
| 远端 CI（main） | run `38107489273`（`push`，ref `main`，sha `34476cd3`）：`Verify`（含 `Verify frontend`、`Run full-stack E2E`）**success**、`Publish image (amd64)`/`(arm64)` **success**、`Merge image` **success**、`Build image` skipped（PR 路径）                                                                                                                                                                                                                                                                                                                                                                                              |
| 远端 CI（tag）  | run `38108809200`（`push`，ref `v0.1.2`）：`Verify` + `Publish image (amd64/arm64)` + `Merge image` 全部 **success**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 镜像            | `ghcr.io/jasminetony/grok2api:v0.1.2` 为 `application/vnd.oci.image.index.v1+json`（`linux/amd64` + `linux/arm64` + 2 个 attestation manifest），digest `sha256:2e5e3ba69ba5c5b463e31c9e65654402bbb6b98af0bfdb84f386d6534f0657c9`；经 ghcr 匿名 token 流程拉取 **HTTP 200** 实测；注册表 9 个标签：`v0.1.2` / `v0.1.2-amd64` / `v0.1.2-arm64` / `main` / `main-amd64` / `main-arm64` / `latest` / `latest-amd64` / `latest-arm64`                                                                                                                                                                                                   |
| 过程缺陷        | 工作流文件被 PowerShell 文本往返改写导致编码损坏（BOM + 中文注释乱码 + 换行丢失），GitHub 无法解析并产生 4 个失败 run；已在 `34476cd3` 修复。完整根因、修复与「首次 push 未触发 run」的异常登记见 `backend/AUDIT.md` §15.2                                                                                                                                                                                                                                                                                                                                                                                                          |
| 未达成项        | 无                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

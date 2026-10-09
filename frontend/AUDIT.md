# 前端审计与验收报告

本文件记录前端验收矩阵、质量门禁现状、架构审计结论、性能基线与问题清单。
规则唯一事实来源是根目录 [`AGENTS.md`](../AGENTS.md)；本文件只记录**实际证据**与状态，不重复规范条文。

- 基线提交：`7c0493a2`（`refactor(auth): 认证全局状态由 React Context 迁移到 Zustand store`）
- 维护分支：`maint/modular-quality-audit`
- 环境：Windows 11 Pro (10.0.26300)，Node `24.0.1`，pnpm `12.3.4`，TypeScript `6.0.3`，Vite `8.3.4`，Vitest `5.0.3`
- 锁文件：`frontend/pnpm-lock.yaml` SHA256 `E0819D57485E3353C99C160B7EF7FFED39BC33D25057E4EC156543178AB64CAF`
- 基线采集时间：2026-10-09（`pnpm verify` 为热缓存运行，非冷缓存）

## 1. 验收矩阵

状态取值：`Passed` / `Failed` / `Skipped`（缺环境跳过）/ `Blocked`（环境不支持）/ `Pending`（本轮尚未执行）。
不允许用 `Skipped`、`Blocked` 或"配置已写好"代替 `Passed`。

| 编号   | 验收项                  | 判定命令/证据                    | 基线状态                               |
| ------ | ----------------------- | -------------------------------- | -------------------------------------- |
| FE-A1  | 格式一致                | `pnpm format:check`              | Passed（随 `pnpm verify`）             |
| FE-A2  | 类型契约                | `pnpm exec tsc -b --force`       | Passed（随 `pnpm verify` 的 `tsc -b`） |
| FE-A3  | Oxlint correctness      | `pnpm oxlint`                    | Passed（0 warnings / 0 errors）        |
| FE-A4  | ESLint 语义             | `pnpm lint`                      | Passed                                 |
| FE-A5  | 纯逻辑单测（node:test） | `pnpm test`                      | Passed（16 tests）                     |
| FE-A6  | 组件单测 + 覆盖率门槛   | `pnpm test:ui:coverage`          | Passed（2 文件 / 39 tests）            |
| FE-A7  | 生产构建                | `pnpm build`                     | Passed（1.31s）                        |
| FE-A8  | 依赖边界与循环          | `pnpm check:architecture`        | **Pending**（门禁未落地）              |
| FE-A9  | 产物体积预算            | `pnpm check:budget`              | **Pending**（门禁未落地）              |
| FE-A10 | 真实全栈 E2E            | `pnpm test:e2e`                  | **Pending**（未落地）                  |
| FE-A11 | 聚合全量门禁            | `pnpm verify:full`               | **Pending**（未落地）                  |
| FE-A12 | 构建可复现性            | 同工具链两次干净构建产物哈希一致 | **Pending**（本轮测量中）              |

## 2. 质量门禁现状与检查范围

`pnpm verify` = `format:check && oxlint && lint && test && test:ui:coverage && build`。

- **格式**：Prettier 3.9.9，配置 `frontend/.prettierrc`（`printWidth 120`、`trailingComma all`、`endOfLine auto`）。仓库存储换行由根 `.gitattributes` 统一为 LF。
- **类型**：`tsconfig.app.json`（`src`，排除测试）、`tsconfig.node.json`（`vite.config.ts`、`vitest.config.ts`）、`tsconfig.test.json`（测试与 `src/types/*.d.ts`）三套工程。基线缺口：E2E 尚无独立 tsconfig。
- **Lint**：ESLint 10.6.0 + `typescript-eslint` 8.63.0（`@typescript-eslint/no-explicit-any: error`）；Oxlint 1.87.0 仅 `correctness` 类。两者排除范围一致：`dist`、`coverage`、`src/components/ui`。
- **测试**：`*.test.ts` 由 `node --experimental-strip-types --test` 运行；`*.test.tsx` 由 Vitest（jsdom）运行。双运行器并存属待收敛项（TEST-4）。
- **覆盖率**：`@vitest/coverage-v8`，`coverage.include` 目前仅 3 个文件（`account-quota.tsx`、`auth-store.ts`、`use-auth.ts`），全局阈值 75，`use-auth.ts` 单独 100。
- **门禁缺口**：无架构/循环检查、无体积预算、无 E2E、无门禁自测。

### 基线覆盖率实测

| 文件                                      | Stmts | Branch | Funcs | Lines |
| ----------------------------------------- | ----: | -----: | ----: | ----: |
| All files（纳入 ratchet 范围）            | 99.35 |  84.84 |   100 |   100 |
| `src/shared/auth/auth-store.ts`           |   100 |    100 |   100 |   100 |
| `src/shared/auth/use-auth.ts`             |   100 |    100 |   100 |   100 |
| `src/features/accounts/account-quota.tsx` | 99.06 |  83.60 |   100 |   100 |

注：`account-quota.tsx` 数值取自前一轮报告；`vitest` 汇总行的 84.84% 分支由该文件主导。规范门槛为 **76%**，`account-quota.tsx` 分支覆盖是当前唯一低于 90% 的纳入文件，属需继续提升项。

## 3. 生产产物基线

`pnpm verify` 末尾构建（Vite 输出单位按 1000 B 计，下表原样引用）：

| 产物                                         |      原始 |      gzip |
| -------------------------------------------- | --------: | --------: |
| `assets/index-*.js`（入口）                  | 469.31 kB | 144.95 kB |
| `assets/createLucideIcon-*.js`（图标运行时） | 347.19 kB | 115.41 kB |
| `assets/dashboard-page-*.js`（仪表盘路由）   | 458.05 kB | 118.25 kB |
| `assets/creative-console-page-*.js`          | 133.46 kB |  37.94 kB |
| `assets/settings-page-*.js`                  | 117.06 kB |  23.23 kB |
| `assets/client-keys-page-*.js`               | 108.85 kB |  30.04 kB |
| `assets/accounts-page-*.js`                  |  98.95 kB |  23.01 kB |
| `assets/index-*.css`                         |         — |         — |

- 首屏关键 JS 依赖闭包（入口 + `createLucideIcon` 预加载）基线约 **252 KiB gzip**（1024 B 换算，取自既有产物只读统计），规范阈值 260 KiB，**余量很小**。
- 单个 JS chunk 阈值 500 KiB 原始体积：`index-*.js`(469.31 kB) 与 `dashboard-page-*.js`(458.05 kB) 均接近上限，`createLucideIcon`(347.19 kB) 亦偏大。
- 结论：预算不是"宽松通过"，需要真实门禁而非事后解释。

## 4. 架构审计

### 4.1 分层与依赖方向

- 现有目录：`app`（路由/壳层/Provider）、`features`（业务能力）、`entities`（领域 DTO 与只读查询）、`shared`（API/鉴权/配置/组件/工具）、`components/ui`（shadcn 原语）。
- 静态扫描（TypeScript AST，102 个非测试源码文件）结果：**未发现** `shared` / `entities` / `components/ui` 反向引用 `app` / `features`。分层方向当前成立。
- 已发现 **9 处跨 feature 引用**，需逐项判定是"公共领域契约放错位置"还是合理的领域组合：

| 来源                                                  | 目标                                      | 判定                                           |
| ----------------------------------------------------- | ----------------------------------------- | ---------------------------------------------- |
| `features/accounts/accounts-page.tsx`                 | `features/settings/settings-api.ts`       | 账号页消费出口节点/订阅源 DTO，应下沉到 entity |
| `features/audits/request-audits-page.tsx`             | `features/client-keys/client-keys-api.ts` | 审计筛选需要密钥选项，应下沉到 entity          |
| `features/audits/request-audits-page.tsx`             | `features/accounts/accounts-api.ts`       | 审计筛选需要账号选项，应下沉到 entity          |
| `features/creative-console/creative-console-page.tsx` | `features/client-keys/client-keys-api.ts` | 创作台选择密钥，同上                           |
| `features/creative-console/creative-console-page.tsx` | `features/media/media-api.ts`             | 创作台上传/媒体，同上                          |
| `features/dashboard/dashboard-page.tsx`               | `features/system/version-update.tsx`      | 复用版本更新组件，应下沉到 `shared`/entity     |
| `features/quality-guard/degrade-accounts-panel.tsx`   | `features/accounts/accounts-api.ts`       | 守护面板列出账号，同上                         |
| `features/quality-guard/quality-guard-page.tsx`       | `features/settings/settings-api.ts`       | 守护页需要出口节点，同上                       |
| `features/settings/settings-page.tsx`                 | `features/system/version-update.tsx`      | 同上                                           |

处理原则：多个 feature 共同消费的只读 DTO/查询入口下沉到对应 `entities/*`；命令与交互留在原 feature；不做无差别搬迁。

### 4.2 结构与体量基线

- 源码文件：102 个（不含测试与 `.d.ts`）。
- **超过 600 行**：18 个文件（规范此前记录的"11 个"已失效）：

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

- **超过 50 行**的函数/组件：101 个。最严重的集中在 `AccountsPage`(3391 行)、`SettingsPage`(1411)、`EgressNodes`(1086)、`ClientKeysPage`(1060)、`ModelsPage`(776)、`ChatPanel`(758)、`VideoPanel`(651)。
- 这是**存量债务**，按 `AGENTS.md` §5 分阶段消减；未完成阶段只允许持平或下降。

### 4.3 已具备且不应重复建设的能力

- 路由级懒加载（`app/deferred-pages.tsx`）、`Suspense` 回退。
- 大表虚拟化（`shared/components/virtual-table-body.tsx`，>20 行启用，含 `ResizeObserver` 与滚动监听清理）。
- 服务端状态统一走 TanStack Query；会话状态走 Zustand store。
- 统一 API 客户端（`shared/api/client.ts`：401 刷新重试、`navigator.locks` 并发刷新、SSE 解析、`ApiError` 语义）与解码器（`shared/api/decoder.ts`）。
- 结论：性能优化必须以实测收益为准，不得以"新增虚拟化/懒加载/缓存"冒充改进。

## 5. 问题清单

| 编号   | 证据                                                                                                  | 现有/新增 | 影响                                 | 优先级 | 阶段 | 验证方法                      | 状态    |
| ------ | ----------------------------------------------------------------------------------------------------- | --------- | ------------------------------------ | ------ | ---- | ----------------------------- | ------- |
| FE-01  | `pnpm verify` 无 E2E/预算/架构检查                                                                    | 现有      | 关键路径与体积无自动门禁             | P1     | 1、2 | 新增门禁并在 CI 实跑          | Pending |
| FE-02  | `vitest.config.ts` 仅纳入 3 文件；规范 `>75%` 与阈值 `75` 边界不一致                                  | 现有      | 覆盖率口径歧义、覆盖面过窄           | P1     | 1    | 阈值改 76，逐阶段扩大 include | Pending |
| FE-03  | `AGENTS.md` 债务清单为 11 个/过时行数                                                                 | 现有      | 基线不可信                           | P2     | 0    | 已按 18 个文件更正            | Passed  |
| FE-04  | 18 个超限文件、101 个超长函数                                                                         | 现有      | 可维护性与审查成本                   | P2     | 3–6  | 逐模块拆分并移出豁免          | Pending |
| FE-05  | `vite.config.ts` 无条件 `define` 注入 `VITE_DEV_API_TARGET`，`runtime-config.ts` 将其作为公开地址回退 | 现有      | 设置该变量时开发地址可能进入生产回退 | P1     | 1    | 环境隔离改造 + 配置回归测试   | Pending |
| FE-06  | 9 处跨 feature 引用（见 §4.1）                                                                        | 现有      | 领域契约位置不清晰                   | P2     | 3    | 下沉到 entity 后架构检查通过  | Pending |
| FE-07  | 已有虚拟化/懒加载/Query 能力                                                                          | 现有      | 需避免重复建设                       | P2     | 3–6  | 补测并按实测收益优化          | Pending |
| DOC-01 | `frontend/README.md` 验证章节仅 `pnpm lint`/`pnpm build`                                              | 现有      | 文档与门禁不一致                     | P2     | 1、7 | 同步 README 与真实脚本        | Pending |
| FE-08  | 双测试运行器（node:test + Vitest）并存                                                                | 现有      | 维护两套断言风格                     | P2     | 1    | 迁移后逐项核对用例与断言      | Pending |
| FE-09  | `VITE_CONFIG_NATIVE_IGNORE_WARNING` 警告出现在构建输出                                                | 现有      | 噪声，需确认 CI 行为                 | P3     | 1    | 定位来源并确认是否需要处理    | Pending |

## 6. 后续阶段与回滚

- 阶段顺序与文件范围见 `.pi/plan/前后端全量审计与分阶段模块化升级计划-20261009-1947.md`。
- 回滚：按阶段提交回滚源码、配置、文档与锁文件；本文件在每阶段结束时更新状态与证据，不覆盖历史结论。

# Grok2API Frontend

Grok2API 的管理端 SPA，用于管理账号池、模型路由、客户端密钥、请求审计和运行设置。

## 技术栈

- React 19 + TypeScript 6
- Vite 8 + Tailwind CSS 4
- shadcn/ui + Radix UI
- TanStack Query（服务端状态）、Zustand（客户端会话状态）
- React Hook Form + Zod

## 本地开发

- Node.js ≥ 22（CI 固定 Node 22；仓库通过 `frontend/package.json` 的 `engines` 声明）；包管理器使用 `packageManager` 声明的 pnpm 12.10.1。

先启动根目录中的 Go 后端，再运行：

```bash
cd frontend
pnpm install --frozen-lockfile
pnpm dev
```

开发服务器默认地址为 `http://127.0.0.1:5173`，并将 `/api`、`/v1`、`/healthz` 和 `/readyz` 代理到 `http://127.0.0.1:8000`。

需要使用其他后端地址时：

```bash
VITE_DEV_API_TARGET=http://127.0.0.1:9000 pnpm dev
```

`VITE_DEV_API_TARGET` **只在开发服务器生效**，构建期固定为空，不会进入生产产物的公开地址回退。

## 生产构建

```bash
pnpm build
```

构建结果输出到 `dist/`（其中 `.build-manifest.json` 是构建内部产物，后端按根级点文件拒绝外部访问）。后端通过根配置中的 `frontend.staticPath` 同源托管该目录，并为非 API 路径提供 SPA 回退。前端不读取原始 YAML，公开运行信息由后端受控接口提供。

## 代码结构

```text
src/app/             路由与应用壳层
src/features/        按业务能力组织的页面与交互
src/entities/        领域 DTO 与只读查询
src/shared/          API、鉴权、配置、组件和通用工具
src/components/ui/   shadcn/ui 基础组件
scripts/             门禁脚本（结构 / 体积 / 报告执行 / 门禁自测）、构建输入指纹、构建清单插件
```

`scripts/` 被 `vite.config.ts` 与 E2E `globalSetup` 直接 import，镜像构建需要整目录 `COPY`。

业务请求统一通过 `shared/api`，服务端状态由 TanStack Query 管理；页面只组合业务能力，不直接维护重复的请求、鉴权或格式化逻辑。依赖方向为 `app` → `features` → `entities`/`shared`，`components/ui` 为基础原语，下层不得反向依赖上层。

## 验证

```bash
pnpm verify        # 完整质量门禁
```

`pnpm verify` 依次执行：

| 步骤             | 命令                      | 说明                                                                                                                                                                                                                                                                                             |
| ---------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 格式             | `pnpm format:check`       | Prettier 是格式唯一来源                                                                                                                                                                                                                                                                          |
| Oxlint           | `pnpm oxlint`             | correctness 类快速检查                                                                                                                                                                                                                                                                           |
| ESLint           | `pnpm lint`               | TS / React / Hooks 语义                                                                                                                                                                                                                                                                          |
| 类型             | `pnpm typecheck`          | `tsc -b --force`                                                                                                                                                                                                                                                                                 |
| E2E 类型         | `pnpm typecheck:e2e`      | `tsc -p tsconfig.e2e.json`                                                                                                                                                                                                                                                                       |
| 纯逻辑单测       | `pnpm test`               | `node:test`（含 `tsc -p tsconfig.test.json` 与 `scripts/**` 的构建输入指纹与构建清单插件用例，2 个文件）                                                                                                                                                                                         |
| node:test 报告   | `pnpm test:results:node`  | 解析 node:test 原生 JSON（`.artifacts/node-test/results.json`）：必需文件与用例确实执行、通过数达标、无未登记跳过，且磁盘 `src/**/*.test.ts` + `scripts/**/*.test.ts` 集合与清单**完全相等**；清单外失败、整文件零用例与未知状态一律 fail-closed；`NODE_TEST_REPORT_ROOT` 只允许指向系统临时目录 |
| 组件单测与覆盖率 | `pnpm test:ui:coverage`   | Vitest + jsdom；逐文件门槛 76%，口径与例外见 `vitest.config.ts`                                                                                                                                                                                                                                  |
| 必需场景执行     | `pnpm test:results`       | 解析 Vitest 原生 JSON：必需文件存在、必需用例标题为 `passed`、通过数与文件数不低于棘轮、无未登记跳过与 flaky；文件级收集失败 / 整文件跳过 / 未知或缺失状态一律 fail-closed，且报告不得早于清单文件 mtime（防止沿用过期报告）                                                                     |
| 依赖边界         | `pnpm check:architecture` | dependency-cruiser：循环、分层方向、跨 feature                                                                                                                                                                                                                                                   |
| 结构约束         | `pnpm check:structure`    | 单文件 ≤600 行、具名函数 ≤50 行，存量债务冻结                                                                                                                                                                                                                                                    |
| 门禁自测         | `pnpm test:gates`         | 验证门禁在违规输入下确实失败                                                                                                                                                                                                                                                                     |
| 生产构建         | `pnpm build`              | `tsc -b && vite build`                                                                                                                                                                                                                                                                           |
| 体积预算         | `pnpm check:budget`       | 首屏闭包 / 路由新增闭包 / 总量 / 最大 chunk                                                                                                                                                                                                                                                      |

`pnpm verify` **不含** E2E。真实全栈 E2E 单独执行：`pnpm test:e2e`（Playwright + 生产 dist + 真实 Go 服务，临时 SQLite/Memory）。

`pnpm verify:full` = `pnpm verify` + `pnpm test:e2e` + `pnpm test:results:e2e`（对 Playwright 报告做同一套断言：必需用例标题、文件总数下限、`expectedStatus`/未知状态 fail-closed、无未登记跳过与 flaky，收集期失败与整文件跳过同样失败），用于交付前完整验收。

单项命令可用于开发反馈，例如 `pnpm test:ui`、`pnpm check:budget`、`pnpm test:e2e`。

### 全栈 E2E 的隔离与前置

- 需要本机可用的 Go 与 Playwright 浏览器（首次执行 `pnpm exec playwright install chromium`）。
- 每个 worker 独占一个后端进程：动态端口 + 独立临时目录（`config.yaml`、SQLite、媒体目录）+ 一次性合成管理员凭据。
- 不读取仓库 `config.yaml`；启动前剔除 `GROK2API_*`、`TEST_POSTGRES_*`、`TEST_REDIS_*`，并把 `HTTP(S)_PROXY` 指向未监听端口，使未知外呼快速失败而不是挂起。
- `globalSetup` 用内容指纹（`scripts/build-inputs.ts` 的 `inputHash`/`outputHash`）判定 `dist` 是否与当前构建输入一致，缺失或不一致即重建前端，并每次重建后端二进制，避免测到过期产物。
- 产物与报告输出到 `frontend/.artifacts/`（已忽略，不参与格式与 lint 门禁）：Playwright 的 HTML/JSON 在 `.artifacts/playwright`，`pnpm test:results` 读取的 Vitest JSON 为 `.artifacts/vitest/results.json`，`pnpm test:results:node` 读取的 node:test JSON 为 `.artifacts/node-test/results.json`。
- project 矩阵：`chromium`（Desktop Chrome，运行除 `e2e/mobile-device.e2e.ts` 外的全部用例，由 project `testIgnore` 排除该文件）与 `mobile-chromium`（Pixel 5 真实设备描述符：`isMobile`/`hasTouch`/`deviceScaleFactor`/`userAgent`）。仅在桌面布局成立的用例标 `@desktop` 并由移动 project `grepInvert` 排除（当前只有 `e2e/navigation.e2e.ts` 的 1 个 describe 标签，覆盖 1 个用例）；`e2e/mobile-device.e2e.ts` 只在移动 project 运行。

规则与阈值定义在根目录 [`AGENTS.md`](../AGENTS.md)，实际证据与问题状态见 [`AUDIT.md`](./AUDIT.md)。

### 门禁维护

- 结构基线：`pnpm exec node scripts/check-structure.mjs --update`（仅在完成整改后收缩基线）。
- 体积基线：`pnpm exec node scripts/check-bundle-budget.mjs --update`（需先 `pnpm build`）。
- 依赖边界例外：`.dependency-cruiser.cjs` 中的 `frozenCrossFeatureDebt` 只允许删除条目。

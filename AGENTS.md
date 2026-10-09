# AGENTS.md — grok2api 维护线开发规范

本文件对本仓库的 AI Agent 与人类贡献者同时生效。每条规范都有编号与**可验证的判定方式**；无法通过命令或明确检查项验证的要求不得写入本文件。

## 1. 仓库定位与上游关系

- 本仓库是 [`chenyme/grok2api`](https://github.com/chenyme/grok2api) 的**衍生 / 维护线**（maintenance fork），用于承载本地维护与增量开发。
- 上游地址：https://github.com/chenyme/grok2api
- 上游优先：与上游冲突时，以上游 `main` 的对外行为契约为准；本地偏离必须在 PR 描述中写明理由、影响面与回滚方式。
- 可回馈上游的通用修复、协议对齐、能力增强，应尽量实现为可回馈上游的形态（避免只在本地 fork 成立的私有改动）。
- 判定方式：`git remote -v` 确认远端归属。本维护线 `origin` 指向 `https://github.com/JasmineTony/grok2api.git`，`upstream` 指向 `https://github.com/chenyme/grok2api.git`；推送前必须显式确认目标远端，禁止向上游仓库推送。
- 技术栈现状：后端 Go（`backend/`，`go test ./...`、`go vet ./...`）；前端 React 19 + TypeScript + Vite + pnpm（`frontend/`）；CI 定义见 `.github/workflows/ghcr-image.yml`。

## 2. 开发规范（DEV）

### DEV-1 所有新组件必须有 `data-testid`

- 规则：`frontend/src/**` 下**新增**（或重构中重写）的 React 组件与可视元素（`*.tsx`）必须带稳定的 `data-testid`。
- 命名：kebab-case，体现语义与所属领域，以前缀标识组件/功能，例如 `account-quota-model-block-marker`、`account-status-model-quota-block-badge`。
- 唯一性：同一页面渲染范围内 `data-testid` 必须唯一。列表项必须可区分，二选一并**在同一文件内保持一致**：
  - 方案 A（本项目采用）：把业务标识拼进 testid，例如 `` data-testid={`account-quota-model-block-item-${block.model}`} ``；
  - 方案 B：静态 `data-testid` + `data-model` 等业务属性组合。
- 稳定性：`data-testid` 是测试契约，不得随文案、样式、i18n key 变动；重命名必须同步更新测试。
- 判定方式：`rg -n "data-testid" frontend/src` 覆盖本轮新增组件；测试通过 `@testing-library/react` 的 `getByTestId` 命中。纯展示且无断言价值的包装层可豁免，但必须在 PR 描述中说明。

### DEV-2 所有新函数必须有 TypeScript 类型

- 规则：新增的导出函数、组件、hook 必须有显式类型：props 使用具名或内联对象类型，函数与 hook 必须标注返回类型；不得以类型推断充当对外契约。
- 禁止 `any` 与 `@ts-ignore`。`@typescript-eslint/no-explicit-any` 已在 `frontend/eslint.config.js` 中配置为 `error`。
- 例外：确需绕过类型系统时必须在 PR 描述中给出理由、影响面与移除计划；只允许 `@ts-expect-error` + 说明（仅限外部类型缺陷），禁止 `@ts-ignore`。
- 判定方式：`frontend/` 下 `pnpm lint` exit 0；`rg -n ":\s*any\b|@ts-ignore" frontend/src` 无命中；`frontend/` 下 `npx tsc -b --force` exit 0。

### DEV-3 遵循本文件与仓库既有约定

- 规则：沿用既有分层与目录职责（`frontend/src/features/<feature>/`、`frontend/src/shared/`、`frontend/src/components/ui/`）；新增前先检索同文件、同目录、同领域实现，能复用就不复制第二套业务逻辑；保持最小改动，不夹带无关重构、批量格式化、命名调整与依赖升级。
- 判定方式：PR diff 仅包含当前需求相关文件；`frontend/` 下 `pnpm lint`、`pnpm build` 均 exit 0；新增第三方依赖必须在 PR 描述中证明既有能力无法满足，并给出体积/许可证/回滚评估。

### DEV-4 每个 PR 必须通过 `pnpm verify`

- 规则：在 `frontend/` 下执行 `pnpm verify`，必须 exit 0。
- CI 门禁：`.github/workflows/ghcr-image.yml` 的 `verify` job 以前端 `pnpm verify` 作为合并门禁，与 `go test ./...`、`go vet ./...`、swagger 文档校验并列。
- 过渡说明：若 `frontend/package.json` 尚未定义 `verify` 脚本，等价门禁为 `frontend/` 下依次执行 `pnpm lint`、`pnpm test`、`pnpm build` 且全部 exit 0；`verify` 脚本补齐后以 `pnpm verify` 为准。
- 判定方式：本地实际执行上述命令并确认 exit 0；CI 上确认 `verify` job 通过。禁止以“未运行”代替“通过”。

## 3. 测试要求（TEST）

### TEST-1 UI 组件测试覆盖率 > 75%

- 规则：`frontend/src/**/*.tsx` 中被测试覆盖的语句与分支覆盖率必须 **> 75%**；`frontend/src/components/ui/`（shadcn 原语，已在 `frontend/eslint.config.js` 中 ignore）不计入。
- 度量方式与门槛位置：使用 vitest coverage（provider 采用 `@vitest/coverage-v8`），门槛写入 `frontend/vitest.config.ts` 的 `test.coverage.thresholds`，通过 `coverage.include` 限定到纳入 ratchet 的文件（`src/**/*.ts(x)`；当前为 `src/features/accounts/account-quota.tsx`、`src/shared/auth/auth-store.ts`、`src/shared/auth/use-auth.ts`）。
 - 判定方式：`frontend/` 下 `pnpm test:ui:coverage`（`vitest run --coverage`）产出报表并强制门槛；未达标时 vitest 以非零退出码失败。该命令已由 `pnpm verify` 串联。
 - 现状（ratchet 已落地）：`frontend/vitest.config.ts` 已配置 v8 coverage 与全局 75 门槛，`coverage.include` 见上一条。实测：`account-quota.tsx` statements 99.06% / branches 83.6% / functions 100% / lines 100%；`auth-store.ts`（zustand 认证 store）statements 100% / branches 100% / functions 100% / lines 100%。`accounts-page.tsx` 等存量文件尚未纳入门槛（该文件格式化后 3752 行，属 §5 存量债务），需按 feature 逐块补齐后再扩大 `coverage.include`。

### TEST-2 Hooks 测试覆盖率 100%

- 规则：自定义 hook（`frontend/src/**/use*.ts(x)` 以及组件文件内定义/导出的 `use*` 函数）必须达到 **100%** 语句与分支覆盖，并覆盖副作用清理（定时器、订阅、请求取消）与边界入参。
 - 判定方式：coverage 报表中 hook 文件为 100%；hook 达标后应在 `frontend/vitest.config.ts` 中对其单独设置 `thresholds` 为 100%。
 - 现状（部分落地）：hook 共 6 个（3 个独立文件 `frontend/src/shared/hooks/use-debounced-value.ts`、`frontend/src/shared/auth/use-auth.ts`、`frontend/src/features/settings/use-settings.ts`；3 个组件内 hook 见 `frontend/src/features/system/version-update.tsx`、`frontend/src/components/ui/chart.tsx`）。`use-auth.ts` 已随认证全局状态迁移到 zustand store 达标（100% 语句/分支/函数/行），并在 `frontend/vitest.config.ts` 中对其单独设置 100 门槛；其余 5 个 hook 覆盖率仍为 0，作为独立迭代推进。

### TEST-3 关键路径必须有集成测试

- 规则：登录/鉴权、账号导入与凭据刷新、额度与模型封锁展示、请求审计筛选、客户端密钥增删、系统版本更新等关键路径，必须存在覆盖「UI 交互 → API 调用 → 状态与错误分支」的集成测试（mock 网络层，不 mock 被测业务组件）。
- 判定方式：每条关键路径至少 1 个集成测试文件（例如 `frontend/src/features/accounts/accounts-page.test.tsx`），断言用户可见结果（`data-testid` 命中、错误提示、权限不足路径、空态），而非仅断言 mock 调用次数。

### TEST-4 禁止弱化测试

- 规则：新增或修改业务逻辑必须同步新增/更新测试；不得删除测试、弱化断言、只验证 mock 调用，或用过度 mock 掩盖事务/权限/状态/一致性问题。
- 判定方式：PR diff 中测试文件只增不减（减少必须有明确理由并说明替代覆盖）；断言需覆盖正常路径、异常路径、边界值、权限不足、重复请求、外部失败。

## 4. 代码审查（REV）

### REV-1 单文件不超过 600 行

- 判定方式：`frontend/src` 下不存在行数 > 600 的 `*.ts` / `*.tsx`；新增文件必须 ≤ 600 行。

### REV-2 函数不超过 50 行

- 规则：单个函数/组件/回调不超过 50 行（不含类型声明与 import）。
- 判定方式：人工审查；建议后续在 `frontend/eslint.config.js` 启用 `max-lines-per-function`（当前未启用，属工具链后续任务）。

### REV-3 避免深层嵌套（最多 3 层）

- 规则：控制流嵌套（`if` / `for` / `try` / 三元链）最多 3 层；超出时用提前返回、提取函数或查表替代。
- 判定方式：人工审查；建议后续在 `frontend/eslint.config.js` 启用 `max-depth: ["error", 3]`（当前未启用，属工具链后续任务）。

### REV-4 使用有意义的命名

- 规则：命名表达业务语义；禁止 `xxx2`、`newXxx`、`finalXxx`、`tempXxx`、`oldXxx` 等无语义命名与无意义缩写。
- 判定方式：`rg -n "\b(new|final|temp|old)[A-Z]" frontend/src` 与 `rg -n "\w+2\b\s*=" frontend/src` 的命中必须能逐条给出业务语义解释。

## 5. 存量债务与生效边界（重要）

- 仓库现存部分文件已超过 REV 阈值，属**存量债务**，不代表本规范失效。当前 `frontend/src` 下共 **11** 个 `*.ts`/`*.tsx` 文件超过 600 行，例如：
  - `frontend/src/features/accounts/accounts-page.tsx`（2452 行）
  - `frontend/src/shared/i18n/index.ts`（2412 行）
  - `frontend/src/features/creative-console/creative-console-page.tsx`（2017 行）
  - 其余：`request-audits-page.tsx`(784)、`client-keys-page.tsx`(740)、`accounts-api.ts`(718)、`egress-nodes.tsx`(696)、`creative-console-api.ts`(692)、`settings-page.tsx`(678)、`quality-guard-page.tsx`(656)、`request-audit-detail-dialog.tsx`(606)
- 生效边界：DEV / TEST / REV 规范对**新增代码**与**后续重构**生效；不得要求在一次 PR 内整改全部存量超限文件。
- 硬性要求：**新增代码不得引入新的超限文件或超限函数** —— 不得新建 > 600 行的文件、不得新增 > 50 行的函数、不得把未超限文件推过阈值。
- 修改存量超限文件时：允许行数持平或下降，不得继续增大其体积（除非 PR 同时给出拆分计划与后续任务链接）；优先把被修改的逻辑抽到新文件/新函数中。
- 判定方式：`git diff --numstat` 对比改动前后行数，超限文件不得净增；新增文件行数 ≤ 600。

## 6. 文档维护规则

- 本文件是规范的唯一事实来源（SSOT）。
- 任何规范变更（新增/修改/删除条目、调整门槛数值、变更判定命令或门禁位置）必须**在同一次改动中**同步更新本文件。
- 条目编号稳定：删除条目时保留编号并标记「已废弃」，不得复用编号。
- 判定方式：规范类 PR 必须包含 `AGENTS.md` 的 diff；仅修改代码而规范已变化的 PR 视为不合规。

## 7. 提交前快速自检

```powershell
# 前端（在 E:\grok2api\frontend 下执行）
pnpm lint                 # DEV-2 / DEV-3
pnpm test                 # TEST 现有纯 TS 用例
pnpm build                # DEV-3（含 tsc -b）
npx tsc -b --force        # DEV-2 显式类型
pnpm verify               # DEV-4 门禁（脚本未落地时用 lint + test + build 替代）

# 后端（在 E:\grok2api\backend 下执行）
go test ./...
go vet ./...

# 规范自检
rg -n ":\s*any\b|@ts-ignore" frontend/src                    # DEV-2 应为空
rg -n "data-testid" frontend/src                             # DEV-1 覆盖新增组件
git diff --numstat                                           # REV-1 超限文件不得净增
```

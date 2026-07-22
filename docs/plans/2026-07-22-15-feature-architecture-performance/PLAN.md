# 第 15 轮迭代计划：Feature 架构拆分、按需加载与性能收敛

- 日期：2026-07-22
- 序号：15
- 负责人：JasmineTony
- 状态：实施中
- 基线：`777a4c72a39174b681127ae3f6d94aac278d70b6`
- 工作分支：`codex/feature-architecture-performance`

## 目标

在不改变公开 API、后端配置、数据库、Go module 与发布策略的前提下，清零第 14 轮冻结的超长页面和可维护性基线，全面落实 page/container/presentation/shared-ui 分层，完成账户、创作控制台、客户端密钥、模型、审计、设置、文档、视频库和应用 Shell 的组件化重构，并通过路由预取、稳定订阅、延迟图表、Tabs 与虚拟表格优化收敛首屏和交互性能。

## 背景

第 14 轮已建立 Provider 作用域 ApiClient、安全存储、共享表格基础、ESLint/Prettier、架构审计、跨浏览器与容器 CI 门禁，并以 PR #32 合并为 `777a4c7`。当前架构审计仍冻结 9 个超过 500 行的 view，代码审计冻结 5 个超长模块；第 15 轮必须删除冻结基线并达到零违规。

## 范围

- 账户域：拆分 query/mutation hooks、core/bulk/device/egress API、页面容器、工具栏、表格、行操作、移动卡片和 Dialog；保留筛选、批量操作、导入导出、授权、配额、Egress 与状态事件语义。
- 创作控制台：按 chat/image/video 拆分 session reducer、API、展示面板、媒体参数、历史与错误视图；共享模型选择、可重试错误和 SafeMarkdown。
- 客户端密钥、模型、请求审计、设置、API 文档、视频库与 AppShell：拆出 schema、Dialog、表格、批量操作、展示组件和导航/账户控制；页面仅负责组合容器。
- 所有 route page、workspace 与 container 文件不超过 500 行；`accounts-api.ts` 等代码审计模块降到门禁内。
- 所有表格页使用共享查询状态、批量选择、虚拟表格和统一移动端摘要，不改变 URL 查询参数或请求语义。
- 增加路由 hover/focus/空闲预取、固定尺寸 Suspense skeleton、Dashboard 可见/空闲图表加载、稳定 props/context、Tabs rAF 测量与 VirtualTableBody 集中监听。
- 增加容器/展示边界、错误处理、取消请求、空/加载/失败、safeStorage、runtime apiBaseUrl、非根路径 public API、批量选择与 Dialog 销毁回归。
- Chromium 三视口亮暗主题全量；Firefox/WebKit 关键路由、认证恢复、深色模式和 a11y smoke；Chrome DevTools MCP 复核登录、Dashboard 与模型 Dialog。

## 非范围

- 不迁移 React，不引入 Vue，不切换状态管理库，不启用 React Compiler，不进行全站视觉重做。
- 不合并 Dependabot #26–#29；依赖升级继续使用独立审计与计划。
- 不创建版本标签、GitHub Release 或 GHCR 镜像，不修改上游同步或 Release 工作流。
- 不改变 `/v1/*`、`/api/admin/v1/*`、后端配置键、数据库结构或 Go module 路径。

## 组件与依赖约束

- `shared/ui`：无业务基础组件，不依赖业务 API。
- `shared/components`：可复用组合组件，只依赖 shared/entity 公共能力。
- `features/<domain>/components`：展示组件，不直接发起请求或持有跨页面副作用。
- `features/<domain>/containers` 与 hooks：数据获取、状态编排、mutation、取消和错误边界入口。
- 页面只组合容器，不内嵌复杂 mutation、schema、表格行或 Dialog 业务。
- 依赖方向保持 `app → features/entities/shared`；feature 只能通过公开入口协作，shared 禁止依赖 feature/entity 的运行态实现。

## 固定代码约束

- 禁止模块级可变业务状态、直接 `fetch`、直接 `localStorage`、`eval`、`Function` 与子进程执行。
- 页面、workspace 和 container 不得超过 500 行；不得硬编码业务配置值，不得省略 Promise/异常处理。
- 不使用过时 API 或语法；React Hooks 依赖必须完整，避免机械 memo 和无收益缓存。
- 重复查询、选择、错误、格式化和任务编排逻辑必须抽成 hook/util；不得复制业务逻辑。
- 不提交密码、Cookie、Token、私钥、Trace、堆快照、临时数据库或未脱敏性能产物。

## 实施步骤

1. 补记第 14 轮远程验收，创建本迭代 PLAN/RESULT 并更新计划索引。
2. 拆分账户域与账户 API，同时以测试固定 URL、SSE、AbortSignal、批量任务和设备授权语义。
3. 拆分创作控制台 chat/image/video 状态、API、历史、错误和展示边界。
4. 拆分客户端密钥、模型、审计、设置、文档、视频库与 AppShell，复用表格、筛选、批量选择、Dialog 和 schema 工具。
5. 落地路由预取、Dashboard 延迟加载、Auth 状态/命令订阅拆分、Tabs 与 VirtualTableBody 性能优化。
6. 增加单测、E2E、a11y、跨浏览器与 Chrome DevTools MCP 性能复核。
7. 删除 `architecture-baseline.json`、`code-audit-baseline.json` 中冻结项及 ESLint 临时豁免，要求零违规。
8. 完成前端、后端、Swagger、安全、容器、Markdown/UTF-8 与性能验收；更新 RESULT 后才首次推送和创建 PR。

## 验证

- 前端：`pnpm install --frozen-lockfile`、`pnpm audit --audit-level high`、`pnpm verify`、`pnpm test:e2e`、Firefox/WebKit smoke、axe。
- 质量：format、typecheck、lint、coverage、unused/code/architecture/duplicate、bundle/chunk/icon 全部通过；零冻结违规。
- 后端：`go test -p 1 ./...`、`go vet ./...`、govulncheck、Swagger 无漂移。
- 安全/运维：actionlint、Gitleaks、Hadolint、Compose config/health smoke、Markdown 链接、UTF-8、敏感信息与冲突标记。
- 性能：登录、Dashboard、模型 Dialog 采样 LCP、CLS、长任务、forced reflow、console 与 heap 汇总；原始产物仅存 `.cache`。

## 风险与回滚

- 大文件拆分可能遗漏查询失效、Dialog 生命周期、SSE 取消和表格选择语义；通过行为测试、API URL 快照和逐域 checkpoint 控制。
- 路由预取或 memo 可能增加无效网络或产生陈旧状态；仅预取热点路由，并以 chunk/网络记录验证不增加首屏请求。
- Tabs/虚拟表格测量改造可能影响键盘、滚动和动态行高；保留固定高度回退并覆盖三视口和 a11y。
- 回滚以本轮最终 Squash 提交为单位；无数据库、配置或后端接口回滚需求。

## 交付与推送门禁

- 本 PLAN.md 是唯一交付单元；本地 checkpoint commit 允许存在，但范围、测试、验收、假设与 RESULT 未完成前不推送。
- 第 15 轮全部本地验收后同步最新 main、复跑完整门禁，只首次推送一次并创建最终 PR。
- CI 失败只允许在同一分支进行必要修复，不绕过检查、不强制合并。

## 假设与默认值

- 第 14 轮共享 API、safeStorage、表格与审计基础继续作为本轮稳定底座。
- Chromium 执行三视口亮暗完整回归；Firefox/WebKit 只执行关键 smoke。
- Windows Firefox 软件合成器限制不视为应用缺陷；Ubuntu CI 是最终 Firefox 验收。
- 本机无 Docker 时，以 GitHub amd64/arm64、Compose health 与 container config job 为最终容器验收。

## 验收标准

- [ ] 9 个超长 view 与 5 个代码审计冻结项全部清零，页面/workspace/container 均不超过 500 行。
- [ ] 零直接 fetch/localStorage、危险执行、模块级可变业务状态与未授权跨层依赖。
- [ ] 账户、创作控制台、客户端密钥、模型、审计、设置、文档、视频库和 AppShell 完成容器/展示/UI 分层。
- [ ] 关键错误、取消、空态、失败态、批量选择、Dialog 生命周期与存储异常有回归测试。
- [ ] bundle/chunk 无回退，Dashboard LCP/CLS、长任务和强制回流无明显退化。
- [ ] 前端、后端、Swagger、安全、容器、E2E/a11y/跨浏览器检查全部通过。
- [ ] RESULT.md、计划索引、性能和代码审查结论完整。
- [ ] 首次推送发生在最终本地验收之后，且不创建版本标签、Release 或 GHCR 镜像。

# 第 12 轮计划：前端架构、现代化 UI、构建治理与 v3.1.0 发布

- 日期：2026-07-21
- 分支：`codex/frontend-architecture-ui-build-v3.1.0`
- 交付方式：单计划、单 PR；本地允许分阶段提交，全部实现与验收完成后统一推送
- 目标版本：`v3.1.0`
- 基线：`main@1afee0aabf30e408ad9a5371f78502ec1ae89ac7`

## 需求拆解

### 明确要求

1. 以资深前端架构师视角审查并优化当前 React 项目。
2. 以资深运维工程师视角优化 CI、Docker、缓存与发布流程。
3. 以现代运维控制台为视觉方向，优化布局、排版、响应式、交互和可访问性。
4. 重构超大模块、移除冗余代码、修复确定性 Bug，提高可读性与可维护性。
5. 强化 TypeScript 类型、必要注释和 ESLint 规则，遵循 React Hooks 与 React 19 最佳实践。
6. 建立设计令牌和可复用样式规范，降低样式冲突、CSS 体积和浏览器差异。
7. 增加完整代码审计任务，覆盖功能、质量、性能、安全与健壮性。
8. 提供需求拆解、三种方案、选型、完整实现、测试和后续优化说明。
9. 计划完成后统一推送、通过 PR 检查并发布新版本。

### 隐含约束

- 项目使用 React，不引入 Vue 或并存框架。
- 保持 `/v1/*`、`/api/admin/v1/*`、配置键、数据库既有语义和 Go module 路径兼容。
- 不进行无证据的后端业务重写；全栈审计只直接修复可复现、有测试且保持兼容的问题。
- 不把凭据、Cookie、Token、私钥、数据库、原始 Trace 或堆快照提交到 Git。
- 继续使用当前 pnpm、Node 24、React Router、TanStack Query、Tailwind 4、Radix/shadcn 体系。
- 所有高风险功能和发布动作必须通过现有 CI、CodeQL、双架构 Docker 与 release environment。

### 边界条件

- 375×812、768×1024、1440×900 三种视口；亮色与暗色主题。
- 空数据、加载、错误、无权限、长文本、宽表格、大列表和 Dialog 溢出场景。
- 键盘导航、焦点可见性、表单 Label、Reduced Motion 和主流浏览器滚动条差异。
- CI 中 PostgreSQL、SQLite、Windows Playwright、Linux race、amd64/arm64 构建。
- 旧配置、旧数据库升级、重复迁移和 Release 版本/tag/commit 一致性。

## 三种实现方案

### 方案 A：只做局部修补

- 内容：修复明显布局、类型和 CI 问题，不拆分超大页面。
- 优点：改动小、交付快。
- 缺点：技术债和测试缺口继续存在；无法满足架构重构与长期维护目标。

### 方案 B：一次性全面重写

- 内容：重建前端目录、状态管理、设计系统和全部页面。
- 优点：短期结构统一，视觉变化最大。
- 缺点：回归面过大，容易破坏协议与管理流程；审查和回滚困难。

### 方案 C：受控系统化改造（选定）

- 内容：保留路由、API 与业务语义，先强化规则和测试，再抽取设计系统与页面模式，最后按高风险模块逐步拆分和优化构建。
- 性能：利用现有懒加载与包体门禁，避免重写带来的 bundle 回退。
- 可维护性：通过 Feature 内部分层、类型化 API、共享页面组件和模块边界规则持续降低复杂度。
- 安全性：保留现有认证与发布模型，并把 XSS、依赖、凭据、工作流权限和容器检查纳入自动审计。
- 结论：在兼容性、性能、安全和可回滚性之间最优。

## 实施步骤

### 1. 工程规则与测试基础

- 启用 typescript-eslint 类型感知规则、React Hooks、JSX 可访问性、复杂度和模块边界检查。
- 强化 TypeScript：`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`noImplicitOverride` 等按错误清单逐项落地。
- 新增 `audit:code`，检查超大文件、禁用类型、危险 HTML、敏感字面量、循环依赖、冲突标记和必要测试。
- 增加 Vitest 覆盖率、共享组件/纯函数测试，以及登录、Dashboard、账号、模型、密钥、审计、设置和创作控制台的 Playwright mock 场景。

### 2. 设计系统与应用骨架

- 将全局颜色、排版、间距、阴影、动效、容器和密度定义为明确设计令牌。
- 建立 `PageScaffold`、`PageToolbar`、`MetricCard`、`FormSection`、`ResponsiveDataView`、统一空/错/加载状态。
- 重构应用 Shell：桌面侧栏、移动导航、顶部操作、文档导航、主题/语言/账号操作分离。
- 重做登录页的视觉层级、品牌说明、状态反馈和移动端首屏利用率，同时保持轻量加载。

### 3. 页面与代码结构

- 拆分 `accounts-page.tsx` 为查询/批量操作 hooks、表格、移动卡片、筛选器和 Dialog 模块。
- 拆分 `creative-console-page.tsx` 为会话、编辑器、消息渲染、媒体预览和安全 Markdown 模块。
- 将 i18n 按语言与 Feature 拆分，并增加中英文键集合类型/测试。
- 统一账号、密钥、模型、审计、设置、媒体和 Dashboard 的页面容器、筛选器、表格、移动卡片、Dialog 与反馈模式。
- 修复审计发现的确定性 XSS、竞态、Hook 依赖、错误丢失、边界和可访问性问题。

### 4. 构建与运维

- 将单体 Verify 拆为并行后端测试、race、前端质量、代码审计、视觉和 Docker jobs。
- 为 Docker Buildx 补充 `cache-to`，优化跨架构缓存；保持 PR/main 不发布镜像。
- 增加 Go/前端覆盖率、actionlint、依赖漏洞、Dockerfile/Compose 和敏感信息审计。
- 为 Docker 依赖启用 Dependabot；记录基础镜像版本策略和可复现构建参数。
- 保持 Release published 才发布 GHCR，发布 v3.1.0 后执行镜像 smoke test。

### 5. 发布

- 更新 `VERSION`、README 和相关版本说明为 v3.1.0。
- 完整本地验收后统一推送并创建 PR。
- PR 全部检查成功后 Squash 合并，等待最终 main CI 成功。
- 创建并发布 `v3.1.0` GitHub Release，验证 GHCR 多架构镜像、SBOM/provenance 和 `/healthz`。

## 测试与验收

- 前端：frozen install、audit、typecheck、typed lint、Vitest/coverage、build、bundle、chunk DAG、Playwright 多页面多视口亮暗主题。
- 后端：`go test -p 1 ./...`、`go vet ./...`、Linux race、govulncheck、SQLite/PostgreSQL 迁移和 Swagger 无漂移。
- 安全：XSS、CSRF/认证 cookie、权限绕过、URL scheme、敏感日志、SQL 参数化、工作流权限、容器非 root 与 Secret 扫描。
- 性能：Chrome DevTools MCP 复核 LCP/CLS/强制回流/DOM/网络/Console/堆；包体不得超过当前预算。
- 可访问性：键盘、焦点、Label、Dialog、导航、颜色对比、Reduced Motion 和主流浏览器。
- 最终：本地 `HEAD == origin/main`、工作区干净、无临时分支，Release 与 VERSION/tag/commit 一致，GHCR amd64/arm64 smoke 成功。

## 假设与默认值

- 采用受控系统化改版，不改变公开接口和核心业务流程。
- 单计划、单 PR，全部完成后才首次推送。
- 全栈审计发现的确定性兼容问题直接修复；破坏性问题只记录。
- 新版本采用兼容性 minor 版本 `v3.1.0`。
- 视觉方向为专业、克制、低饱和的现代运维控制台，保留亮暗主题。

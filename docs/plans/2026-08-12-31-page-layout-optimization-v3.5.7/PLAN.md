# 页面布局优化与交互视觉改进计划

- Date: 2026-08-12
- Sequence: 31
- Status: In progress
- Base commit: $(git rev-parse HEAD)
- Working branch: layout/optimization-v3.5.7-20260812

## Objective

全面审计并优化 grok2api 前端页面布局，重点改善全局壳层、导航、内容容器、响应式行为、状态反馈、视觉层级和交互一致性，同时保持现有业务边界、无障碍、主题、性能和 API 兼容性。

## Scope

- 全局 AppShell/AdminShell：桌面侧栏、移动端导航、顶栏、内容宽度、页面进入动效和滚动行为。
- 设置路由：导航分组、移动端横向导航、当前项可见性、表单操作条和跨页面状态。
- 核心页面：Dashboard、Accounts、Models、Request Audits、Creative Console 的标题区、工具栏、数据区域和空/加载/错误状态。
- 交互：键盘焦点、响应式收缩、sticky 行为、异步操作反馈、页面级 loading/empty/error 稳定性。
- 视觉：间距令牌、卡片层级、边框/阴影、标题与辅助文本对比、亮暗主题一致性。
- 技术：复用 shared UI，避免跨 feature 依赖；新增组件保持可测试、可懒加载，并通过现有质量门禁。

## Constraints

- 不修改后端 API 和业务语义；不删除现有页面能力。
- 遵守 pp → features → entities → shared 依赖方向。
- 页面级/容器组件不超过 500 行；展示组件通过 typed props 接收状态。
- 使用 Tailwind 设计令牌和 cn，保留 keyboard/focus-visible/reduced-motion/主题支持。
- 不提交本地缓存、凭据、截图、Trace 或未经脱敏的运行日志。

## Acceptance criteria

- [ ] 全局布局在 375/768/1440 视口下无横向溢出，导航和操作可达。
- [ ] 页面标题、辅助说明、主要操作和状态反馈层级清晰且一致。
- [ ] 设置导航在移动端可滚动、当前项可见，桌面端分组边界明确。
- [ ] loading/empty/error 状态不造成明显布局跳动。
- [ ] 交互具备可见 focus、键盘可达、Reduced Motion 兼容。
- [ ] Prettier、TypeScript、ESLint、Vitest、Vite build、bundle/chunk/code/architecture audits 通过。
- [ ] 重点布局 E2E/组件测试通过。

## Verification

- rontend: format/type/lint/unit/build/quality audits。
- Playwright Chromium desktop/tablet/mobile，必要时 Firefox/WebKit smoke。
- git diff --check、冲突标记扫描、工作区缓存隔离。

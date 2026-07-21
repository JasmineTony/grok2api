# 第 11 轮迭代计划：Chrome DevTools MCP 深度性能剖析与优化

- 日期：2026-07-21
- 分支：`perf/chrome-devtools-mcp`
- 推送规则：性能采集、优化、回归测试和最终 v3.0.6 main 同步全部完成后才首次推送

## 目标

- 为本地 Codex 环境配置固定版本的 Chrome DevTools MCP，并验证能够通过 MCP 直接操控 Chrome DevTools。
- 建立 Grok2API 管理端可重复的性能测试场景，采集 Core Web Vitals、网络请求、页面加载时间线、JavaScript 执行火焰图、长任务、布局偏移和堆内存证据。
- 根据实测数据定位瓶颈，在不改变公开 API、配置、数据库、路由结构和设计系统的前提下实施可回滚优化。
- 输出包含基线、证据、根因、改动、优化前后对比和后续建议的结构化报告。

## 集成范围

- 固定使用官方 `chrome-devtools-mcp@1.6.0`，不使用浮动 `latest`。
- Codex MCP 配置默认采用隔离、无痕、无 CrUX、无使用统计、网络头脱敏的本地 headless Chrome。
- 仓库新增可复用的性能测试说明、场景脚本、预算和报告模板；原始 trace、堆快照、截图及敏感网络数据仅保存在 `.cache/`，不得提交。
- MCP 配置不保存凭据、Cookie、客户端密钥、上游 Token 或代理密码。

## 实施步骤

1. 核验 Chrome、Node.js、pnpm、前后端启动方式和现有 Playwright/Vite 性能基线。
2. 安装并验证 Chrome DevTools MCP，枚举工具并实际调用页面、性能、网络和内存相关能力。
3. 启动本地服务，准备匿名登录页和可控的管理端模拟数据场景。
4. 分别采集冷启动与热启动：导航、LCP、INP/交互延迟代理、CLS、主线程长任务、脚本执行、自定义资源 timing、网络瀑布和堆快照。
5. 分析关键渲染路径、资源优先级、React 渲染、路由块、图表、i18n、表格/Dialog、缓存与内存保留路径。
6. 只实施有证据且可由自动测试覆盖的优化；不进行全站重做或破坏性架构迁移。
7. 重复同一场景采集优化后数据，计算差异并检查回归。
8. 更新 RESULT、性能报告和使用文档；在 v3.0.6 正式 main 完成后同步最终基线并运行完整验收。

## 测试与验收

- Chrome DevTools MCP：初始化、工具列表、页面导航、性能追踪、网络查询、脚本执行和内存采集均成功。
- 前端：frozen install、audit、Vitest、typecheck、lint、build、icon、bundle、Playwright。
- 后端：`go test -p 1 ./...`、`go vet ./...`，必要时验证本地启动和管理 API。
- 性能：至少覆盖 375×812、768×1024、1440×900；冷/热导航；亮/暗主题；登录页、Dashboard、账号、模型、密钥和审计详情关键路径。
- 报告：记录 LCP、CLS、交互延迟、DOMContentLoaded/load、长任务、脚本成本、资源体积、请求数、内存前后差异及明确证据。
- 安全：报告与仓库中不得出现 Cookie、Authorization、客户端密钥、账号凭据、代理密码或请求正文敏感信息。

## 兼容性与默认值

- 仅根据测量结果优化，不以猜测替代证据。
- 保持现有 React Router、Feature 目录、TanStack Query、Tailwind、shadcn/Radix 和后端分层。
- Core Web Vitals 中无法在纯本地单次实验稳定获得的 INP，使用可重复交互 Event Timing 与主线程阻塞数据作为实验室代理，并在报告中明确区分。
- 堆快照和 trace 不提交 Git；只提交脱敏后的聚合指标与诊断。
- 当前工作树基于已验证的 v3.0.6 预合并结果，最终推送前必须重放到正式 `origin/main`。
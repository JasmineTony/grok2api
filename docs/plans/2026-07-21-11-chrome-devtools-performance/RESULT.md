# 第 11 轮迭代结果：Chrome DevTools MCP 深度性能剖析与优化

- 日期：2026-07-21
- 状态：本地实现与验收完成；等待正式 `origin/main` 完成 v3.0.6 同步后重放、最终推送和 PR
- 分支：`perf/chrome-devtools-mcp`
- 当前本地基线：`66d9f47ccde9cc2ea8b93bcf62b105e5d4f9795a`

## MCP 集成

- 在 ChatGPT Desktop / Codex 用户配置中注册官方 `chrome-devtools-mcp@1.6.0`。
- 配置采用 headless、isolated、无 CrUX、无使用统计、网络头脱敏和本地日志。
- 通过标准 MCP JSON-RPC 成功初始化 `chrome_devtools 1.6.0`，枚举 39 个工具。
- 已实际调用页面导航、Performance Trace、Insight、网络、Console、JavaScript、截图、堆快照和快照比较工具。
- 新增 `pnpm profile:devtools` 匿名页面冒烟脚本和[使用指南](../../reference/chrome-devtools-performance.md)。
- MCP 配置与采样脚本不保存凭据；认证场景的临时凭据和所有原始证据均位于 `.cache/`。

## 性能基线与证据

- 原始生产分块存在循环，Dashboard 登录后出现 `TypeError: i is not a function`；开发构建不复现。
- 优化前代表性 Dashboard Trace：LCP 3111 ms、CLS 0.1674、强制回流 749 ms、大型样式重算 628 ms。
- 网络关键链明显短于 render delay，且 RenderBlocking 估算 FCP/LCP 节省为 0 ms。
- 最终代表性 Trace：LCP 959 ms、CLS 0.0809、强制回流 154 ms、大型样式重算 96 ms。
- 三种视口强制无缓存 Dashboard LCP 为 1335–1354 ms；Desktop CLS 0.08，Tablet/Mobile CLS 0.18/0.22。
- 完整证据、样本表格和限制见 [PERFORMANCE-REPORT.md](./PERFORMANCE-REPORT.md)。

## 已实施优化

- 登录页只初始化 Theme、Auth 和 Toaster；QueryClient/Tooltip 移入懒加载管理端 Shell。
- 修正 Radix 依赖拆分，避免共享块初始化循环。
- 图表仅固定拆分 D3/运行时依赖，保留无循环的自动 Recharts 分块。
- 新增生产分块有向图检查 `check:chunks`，并加入 CI Verify。
- Dashboard Trend 加载阶段不再挂载空 Recharts，关闭非必要首屏动画。
- 账号可用率改为轻量 CSS conic-gradient，移除该同步路径的 Recharts/ResizeObserver。
- 添加 Meta description、MCP 冒烟脚本、使用指南和结构化性能报告。

## 优化前后对比

| 指标 | 优化前 | 优化后 |
| --- | ---: | ---: |
| Dashboard LCP | 3111 ms | 959 ms |
| Dashboard CLS | 0.1674 | 0.0809 |
| 强制回流 | 749 ms | 154 ms |
| 大型样式重算 | 628 ms | 96 ms |
| DOM 元素 / 深度 | 735 / 22 | 709 / 16 |
| 生产 Console | Dashboard TypeError | 无错误 |
| 生产 chunk cycle | 存在 | 0 |

交互实验室代理：Dashboard 刷新 272 ms、Dashboard→模型 39 ms、模型 Dialog 328 ms。

## 测试、兼容性与安全验收

已通过：

- Chrome DevTools MCP 初始化、工具枚举、导航、Trace、Insight、网络、Console、脚本、截图、堆快照和比较；
- `pnpm install --frozen-lockfile`；
- `pnpm audit --audit-level high`：无已知漏洞；
- `pnpm test`：2/2；
- `pnpm typecheck`；
- `pnpm lint`；
- `pnpm check:icons`；
- `pnpm build`；
- `pnpm check:bundle`；
- `pnpm check:chunks`：68 个 JavaScript 块，无循环；
- `pnpm test:e2e`：三视口亮暗主题 6/6；
- `go test -p 1 ./...`；
- `go vet ./...`；
- `govulncheck`：0 个可达漏洞；导入包 0 个，依赖模块存在 1 个不可达记录；
- Swagger 重新生成且 tracked 输出无差异；
- 最终生产认证流程、Dashboard、模型路由和添加模型 Dialog 无 Console error。

兼容性：未修改公开 API、配置键、数据库结构、Go module 路径、路由 URL 或发布规则。

安全：报告和 tracked 文件不包含 Cookie、Authorization、管理员密码、客户端密钥、代理密码、请求正文、原始 Trace 或堆快照。

## 未解决事项与回滚

- Tablet/Mobile Dashboard 强制无缓存 CLS 仍为 0.18/0.22，应在后续独立迭代定位 layout-shift source 并稳定数据面板高度。
- Dashboard 刷新与模型 Dialog 的实验室 INP 代理分别为 272/328 ms，应继续缩小同步 React 更新边界。
- 预热后第二组路由循环仍增长约 1.53 MB，主要来自 Chrome Accessibility 与编译/调试上下文；未确认应用泄漏，但需要无 DevTools Accessibility 的长时间 soak test。
- 用户级 MCP 配置不随仓库提交；仓库只提交固定版本的安全说明和可复用脚本。
- 正式 `origin/main` 尚未完成第 09/10 轮编排；最终推送前必须重放到正式 main 并重跑关键验收。

回滚无需数据库迁移，可分别撤销 Provider 延迟加载、Vite 分块、Dashboard 图表优化、CI 分块检查和文档改动。

## 提交与 PR

- 计划提交：`3e045b7b708d98ce686fc84e8e3357ce2fdc51f3`
- 本地实现提交：`4dea4c3`（最终同步时可能因 rebase 变化）
- PR：待整轮验收和正式 main 同步完成后统一创建

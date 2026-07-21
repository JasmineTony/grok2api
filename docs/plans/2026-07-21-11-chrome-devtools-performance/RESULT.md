# 第 11 轮迭代结果：Chrome DevTools MCP 性能分析与优化

- 日期：2026-07-21
- 状态：本地实现与最终验收完成；仅在 GitHub 全部检查成功后 Squash 合并
- 最终基线：`origin/main@a472f6c950a2a0d86c6de9c2a25106692cbbeb0b`（已包含上游 v3.0.6）
- 最终本地实现提交：`753ededb78ae4e21c17c07f0c465641e3ffc5638`

## Chrome DevTools MCP 集成

- 使用固定版本 `chrome-devtools-mcp@1.6.0`，配置为 headless、isolated、关闭 CrUX/使用统计、网络头脱敏和内存调试。
- 通过标准 MCP JSON-RPC 调用页面导航、Performance Trace、Insight、网络、Console、脚本执行、截图、堆快照与快照分析工具。
- `pnpm profile:devtools` 现在自动生成页面加载 Trace、网络/Console/Runtime 汇总和堆快照统计；所有原始产物仅保存到 `.cache/chrome-devtools-profile/`。
- 最终冒烟采样生成约 228 KiB Trace 与 9.6 MiB 堆快照，汇总文件不包含凭据。
- 认证场景使用本地一次性认证桥，凭据不输出到聊天、日志或 tracked 文件；认证后立即关闭桥接服务并清除内存值。

## 已实施优化

- 登录页仅初始化 Theme、Auth 和 Toaster；QueryClient/Tooltip 延迟到管理端 Shell。
- 修正 Vite/Radix 手工分块引起的生产初始化循环，并新增 `check:chunks` 生产 chunk DAG 门禁和 CI 检查。
- Dashboard 加载阶段不再挂载空 Recharts；关闭非必要首屏动画；账号可用率环图改为 CSS `conic-gradient`。
- 添加固定尺寸加载态、Meta description、可复用 MCP 自动采样脚本与结构化性能报告。
- 管理端 Query、图表和路由块保持延迟加载；不改变现有路由、API、配置或数据库结构。
- 根据最终 DevTools Issues 修复模型页搜索、Provider/能力选择、账号绑定和启用开关的 `id`/`name`/Label 关联；模型 Dialog 最终无 Console warning、error 或 issue。

## 优化前后代表性结果

| 指标 | 优化前 | 优化后代表样本 |
| --- | ---: | ---: |
| Dashboard LCP | 3111 ms | 959 ms |
| Dashboard CLS | 0.1674 | 0.0809 |
| 强制回流 | 749 ms | 154 ms |
| 大型样式重算 | 628 ms | 96 ms |
| DOM 元素 / 深度 | 735 / 22 | 709 / 16 |
| 生产 Console | Dashboard `TypeError` | 无错误 |
| 生产 chunk cycle | 存在 | 0 |

最终 v3.0.6 rebase 后的独立复核：

| 视口/主题 | LCP | CLS |
| --- | ---: | ---: |
| 1440×900 / Light | 1007 ms | 0.0809 |
| 768×1024 / Light | 908 ms | 0.18 |
| 375×812 / Dark | 864 ms | 0.00 |

桌面最终 Trace 的 TTFB 为 3 ms，LCP 的 99.7% 为客户端 render delay；709 个 DOM 元素、深度 16，最大子节点数 40。最大样式重算约 97 ms，布局更新约 81 ms，强制回流约 177 ms，主要关联 Radix Tabs/React 布局读取。RenderBlocking 的估算 FCP/LCP 节省均为 0 ms，说明当前主要瓶颈已从网络转为客户端数据恢复、布局与渲染。

## 测试与验收

全部通过：

- `pnpm install --frozen-lockfile`；
- `pnpm audit --audit-level high`：无已知漏洞；
- `pnpm test`：2/2；
- `pnpm typecheck`；
- `pnpm lint`；
- `pnpm check:icons`；
- `pnpm build`：3714 个模块；CSS 89.67 kB raw；
- `pnpm check:bundle`；
- `pnpm check:chunks`：68 个 JavaScript chunks，无循环；
- `pnpm test:e2e`：三视口亮/暗主题 6/6；
- `pnpm profile:devtools`：Trace、网络、Console、Runtime 与堆快照自动采样成功；
- `go test -p 1 ./...`；
- `go vet ./...`；
- `govulncheck`：0 个可达漏洞；导入包 0 个，依赖模块有 1 个不可达记录；
- Swagger 重新生成：tracked 输出无漂移；
- UTF-8、Markdown 相对链接、敏感信息、冲突标记和 `git diff --check`；
- Dashboard、模型路由和添加模型 Dialog 最终无 Console error、warning 或 issue；
- GitHub 的 Linux race、CodeQL 与 amd64/arm64 Docker 由最终 PR 验收。

兼容性：未修改公开 API、配置键、数据库结构、Go module 路径、路由 URL 或发布规则。

安全：tracked 文件不包含 Cookie、Authorization、管理员密码、客户端密钥、代理密码、请求正文、原始 Trace、截图或堆快照。

## 未解决事项与回滚

- Tablet Dashboard 强制无缓存 CLS 仍为 0.18，应在后续独立迭代定位 layout-shift source，并稳定数据面板高度。
- 桌面最终强制回流约 177 ms，主要落在 Radix Tabs；后续可评估首屏仅渲染当前 Tab、延迟测量或降低布局读取范围。
- Dashboard 刷新与模型 Dialog 的既有实验室 INP 代理分别为 272/328 ms，后续应继续缩小同步 React 更新边界。
- 预热后第二组路由循环的历史堆样本仍增长约 1.53 MB，主要来自 Chrome Accessibility 和编译/调试上下文；未确认应用泄漏，但仍建议进行无 DevTools Accessibility 的长时间 soak test。
- 回滚无需数据库迁移，可分别 revert Provider 延迟加载、Vite 分块、Dashboard 图表优化、MCP 自动采样、表单元数据和文档提交。

## 提交与 PR

- 计划提交：`21d543ed77e33c59b781e7b0040a6bee4178b58f`
- 核心实现提交：`cf5c6fe0effb8f70d032f24a0493eb5913f006ba`
- 本地验收文档提交：`fbee8d55520559557b8ca5ce269de2e6f9d9558f`
- 最终 MCP/表单修复提交：`753ededb78ae4e21c17c07f0c465641e3ffc5638`
- PR：本轮全部验收后统一创建；只有 Verify、Visual、CodeQL 与双架构 Docker 全绿后才 Squash 合并。

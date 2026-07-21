# Grok2API Chrome DevTools MCP 性能优化报告

- 日期：2026-07-21
- 分支：`perf/chrome-devtools-mcp`
- 应用基线：上游 `v3.0.6` 预合并结果 `66d9f47ccde9cc2ea8b93bcf62b105e5d4f9795a`
- 浏览器：Chrome `150.0.7871.128`
- 工具：官方 `chrome-devtools-mcp@1.6.0`
- 前端：Node.js 24、pnpm 11.15.1、Vite 8.1.5、React 19.2.7、Recharts 3.9.2

## 1. 结论摘要

本轮确认并修复了一个生产构建正确性缺陷和两个首屏性能根因：

1. 手工 Vite 分块形成循环依赖，生产 Dashboard 登录后出现 `TypeError: i is not a function`，开发构建不复现。
2. 登录页无条件初始化 TanStack Query 和管理端 Tooltip Provider，增加匿名入口启动成本。
3. Dashboard 在空数据加载阶段挂载完整 Recharts，并用 Recharts 绘制简单账号可用率环图，造成大规模样式计算、强制回流和延迟 LCP。

最终生产分块图无循环，登录后 Dashboard、模型页和 Dialog 不再出现生产运行时错误。代表性 Desktop 深度 Trace 中：

- LCP：`3111 ms → 959 ms`，下降约 `69%`；
- 强制回流：`749 ms → 154 ms`，下降约 `79%`；
- 大型样式重算：`628 ms → 96 ms`，下降约 `85%`；
- DOM 元素：`735 → 709`，DOM 深度 `22 → 16`；
- CLS：`0.1674 → 0.0809`，进入良好区间。

强制无缓存样本中，登录页 LCP 为 `282–389 ms`；Dashboard LCP 为 `1335–1354 ms`。Dashboard 的 Tablet/Mobile CLS 仍为 `0.18/0.22`，是明确的后续优化项。

## 2. 环境与方法

### 2.1 MCP 安全配置

MCP 以以下约束运行：

- 固定 `chrome-devtools-mcp@1.6.0`；
- headless、isolated；
- 禁用 CrUX 和使用统计；
- 网络头脱敏；
- 原始 Trace、堆快照、截图和临时凭据只保存在 `.cache/`。

标准 MCP JSON-RPC 初始化成功，枚举到 39 个工具，并实际调用性能、网络、Console、脚本执行、截图和堆快照工具。

### 2.2 测试场景

- URL：本地生产构建 `http://127.0.0.1:8000`；
- 数据：本地 SQLite、临时管理员、无上游生产凭据；
- 视口：`1440×900`、`768×1024`、`375×812`；
- CPU：1x，无网络节流；
- 页面：登录页、Dashboard、账号、模型、客户端密钥、请求审计；
- 交互：Dashboard 刷新、Dashboard→模型路由切换、添加模型 Dialog；
- 内存：预热路由后两组各 8 轮路由循环、三份堆快照。

本地实验室结果不等于真实用户指标。特别是 INP 仅为可重复交互的实验室代理。

## 3. 基线问题与证据

### 3.1 生产分块循环导致 Dashboard 崩溃

原始生产构建中存在以下循环：

```text
index → client → vendor-radix → client
```

登录后 Console 出现：

```text
TypeError: i is not a function
React Router caught the following error during render
```

开发构建没有复现，因此这是生产分块初始化顺序缺陷，而不是业务 API 错误。

### 3.2 首屏主要瓶颈是渲染而非网络

优化前代表性 Trace：

- 登录页 LCP 约 750 ms，其中 render delay 约 743 ms；
- Dashboard LCP 3111 ms，其中 render delay 3098 ms；
- Dashboard 网络关键链约 323 ms；
- RenderBlocking 对 FCP/LCP 的估算节省均为 0 ms；
- Dashboard 强制回流 749 ms，主要落在图表布局与 Tabs/React commit 路径；
- 大型样式重算 628 ms，影响 623 个元素。

结论：继续优化 preload 或内联 CSS不是优先事项；应减少首屏同步 Provider、避免无数据阶段挂载重型图表，并消除循环分块。

## 4. 已实施优化

### 4.1 管理端 Provider 延迟加载

根 Provider 只保留 Theme、Auth 和 Toaster。TanStack Query 与 Tooltip Provider 移入懒加载的 `AdminShell`，匿名登录页不再初始化管理端数据层。

### 4.2 消除生产分块循环

- Radix 分组递归包含其依赖，避免拆入共享 `client` 块；
- 图表仅单独拆分 D3/运行时依赖，不强制拆分 Recharts 主包；
- 新增 `check:chunks`，构建后解析静态导入图并阻止循环分块；
- `check:chunks` 已加入 GitHub Actions Verify。

### 4.3 减少 Dashboard 图表启动成本

- Trend 加载阶段只显示固定高度 Spinner，不再挂载空 Recharts；
- Trend 的 Bar、Area、Line 关闭首屏动画；
- 账号可用率环图改为 CSS `conic-gradient`，移除该同步路径的 Recharts、ResponsiveContainer 与 ResizeObserver；
- 保留既有视觉结构、数据语义、交互和 API。

### 4.4 元数据和回归门禁

- 添加中文 Meta description；
- 包体预算兼容自动生成的 `chart-*` 块；
- 新增可复用的 `pnpm profile:devtools` 匿名页面 MCP 采样脚本；
- 增加 Chrome DevTools MCP 使用与安全文档。

## 5. 最终性能结果

### 5.1 强制无缓存硬刷新

| 页面 | 视口 | LCP | CLS | FCP | Navigation | 请求数 | 资源传输量 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Login | 1440×900 | 282 ms | 0.00 | 216 ms | 157 ms | 13 | 845,682 B |
| Login | 768×1024 | 322 ms | 0.00 | 256 ms | 206 ms | 13 | 845,682 B |
| Login | 375×812 | 389 ms | 0.00 | 308 ms | 248 ms | 13 | 845,682 B |
| Dashboard | 1440×900 | 1354 ms | 0.08 | 472 ms | 414 ms | 45 | 867,802 B |
| Dashboard | 768×1024 | 1354 ms | 0.18 | 556 ms | 481 ms | 45 | 867,802 B |
| Dashboard | 375×812 | 1335 ms | 0.22 | 536 ms | 492 ms | 45 | 867,802 B |

本地服务使用 HTTP/1.1 且未压缩静态资源。生产部署应在反向代理/CDN 启用 Brotli 或 gzip，并保持哈希静态资源的 immutable 缓存策略。

### 5.2 热缓存重复导航中位数

每个视口执行 5 次，以下为全部样本中位数：

| 页面 | 视口 | LCP | CLS | FCP | Navigation |
| --- | --- | ---: | ---: | ---: | ---: |
| Login | 1440×900 | 236 ms | 0.00 | 124 ms | 82 ms |
| Login | 768×1024 | 194 ms | 0.00 | 188 ms | 82 ms |
| Login | 375×812 | 202 ms | 0.00 | 124 ms | 76 ms |
| Dashboard | 1440×900 | 831 ms | 0.08 | 124 ms | 78 ms |
| Dashboard | 768×1024 | 749 ms | 0.18 | 116 ms | 76 ms |
| Dashboard | 375×812 | 2121 ms | 0.00 | 760 ms | 599 ms |

Mobile 热样本存在明显调度噪声，因此最终判断同时参考硬刷新、深度 Trace 和多样本中位数，不用单一结果下结论。

### 5.3 深度 Trace 对比

| 指标 | 优化前 | 优化后 | 变化 |
| --- | ---: | ---: | ---: |
| Dashboard LCP | 3111 ms | 959 ms | -69% |
| Dashboard CLS | 0.1674 | 0.0809 | 改善至良好 |
| 强制回流 | 749 ms | 154 ms | -79% |
| 大型样式重算 | 628 ms | 96 ms | -85% |
| DOM 元素 | 735 | 709 | -3.5% |
| DOM 深度 | 22 | 16 | -27% |
| 网络关键链 | 323 ms | 176 ms | -46%（本地噪声影响） |

最终 LCP 仍有 945 ms render delay。下一步应聚焦数据返回后的 React commit 和可见区域布局稳定性，而不是继续优化已被判定为 0 ms 节省的 render-blocking 资源。

## 6. 交互与 INP 实验室代理

| 交互 | 总延迟 | Input delay | Processing | Presentation | 评价 |
| --- | ---: | ---: | ---: | ---: | --- |
| Dashboard 刷新 | 272 ms | 14 ms | 232 ms | 26 ms | 需要优化 |
| Dashboard → 模型 | 39 ms | 3 ms | 9 ms | 27 ms | 良好 |
| 打开“添加模型” Dialog | 328 ms | 4 ms | 278 ms | 46 ms | 需要优化 |

路由切换表现良好。刷新和 Dialog 的主要成本在 React/组件处理阶段，不是输入排队；后续可通过更小的更新边界、延迟非关键校验和按需加载 Dialog 内容优化。

## 7. 内存分析

### 7.1 首次路由加载

首次从 Dashboard 访问账号、模型、密钥和审计页后，总快照会增长，因为路由块、编译代码、查询缓存和组件定义首次进入内存。该差异不能直接判定泄漏。

### 7.2 预热后稳定性检查

预热 2 轮后，再执行两组各 8 轮路由循环：

| 快照 | 总大小 | V8 Heap | Native | 节点数 |
| --- | ---: | ---: | ---: | ---: |
| Base | 19.76 MB | 11.66 MB | 8.10 MB | 373,589 |
| Mid | 22.21 MB | 13.08 MB | 9.13 MB | 394,692 |
| Final | 23.74 MB | 13.55 MB | 10.19 MB | 415,749 |

第二组仍增加约 1.53 MB，但最大增长来自 Chrome Accessibility 缓存（AX dirty/object 约 884 KB）和编译/调试上下文；React hook/fiber 形状的净增长较小，没有发现单一业务 DTO、请求正文、凭据或监听器持续占据主导。

结论：**未确认高置信度应用内存泄漏，但堆尚未完全稳定**。建议后续在不启用 DevTools Accessibility Snapshot 的普通 Chrome 中执行 30–60 分钟 soak test，并持续观察 Detached DOM、事件监听器和 Query Cache。

## 8. 包体与分块

最终主要产物：

| Chunk | Raw | Gzip |
| --- | ---: | ---: |
| Entry | 228.48 kB | 72.48 kB |
| Dashboard route | 12.87 kB | 4.22 kB |
| Dashboard charts | 339.06 kB | 91.51 kB |
| Chart runtime | 75.46 kB | 25.66 kB |
| Radix | 124.03 kB | 38.02 kB |
| CSS | 89.67 kB | 15.65 kB |

所有既有预算通过，生产静态导入图包含 68 个 JavaScript 块且无循环。

## 9. 安全与正确性

- 最终生产 Dashboard、模型页和 Dialog 无 Console error；
- 匿名登录页的 refresh `401` 是会话恢复探测的预期网络噪声，不包含凭据；
- 报告未包含 Cookie、Authorization、管理员密码、客户端密钥、代理密码或请求正文；
- 原始 Trace、Heap Snapshot、截图和临时数据库未提交；
- 公开 API、配置结构、数据库、Go module 路径和发布策略未改变。

## 10. 后续优先级

### P1

1. 将 Dashboard Tablet/Mobile CLS 从 `0.18/0.22` 降至 `<0.1`：采集 layout-shift source，稳定 Top Models、Usage Governance 和数据返回前后的可见高度。
2. 优化 Dashboard 刷新 processing 232 ms：缩小同步更新范围，避免刷新时重建不相关面板。
3. 优化模型 Dialog processing 278 ms：延迟加载非首屏表单区和大列表，保持键盘焦点行为不变。

### P2

1. 在生产反向代理启用 Brotli/gzip，验证首次传输量下降。
2. 对管理端进行非 DevTools Accessibility 的长时间内存 soak test。
3. 接入隐私安全的 Web Vitals RUM，使用真实用户 p75 代替本地单机推断。
4. 在有真实大数据集时复测表格虚拟化、Dashboard 聚合和图表点数上限。

## 11. 回滚

若发现回归，可分别回滚：

- `AdminShell/AdminProviders` 延迟加载改动；
- Vite 分块策略和 `check:chunks`；
- Dashboard 空数据加载策略、CSS 可用率环图和禁用动画；
- Meta description 和本地 MCP 说明。

回滚不需要数据库迁移，也不影响公开 API 或配置。
## 最终 v3.0.6 基线复核

性能分支 rebase 到 `origin/main@a472f6c950a2a0d86c6de9c2a25106692cbbeb0b` 后重新构建并用 Chrome DevTools MCP 实测：

| 视口/主题 | LCP | CLS |
| --- | ---: | ---: |
| 1440×900 / Light | 1007 ms | 0.0809 |
| 768×1024 / Light | 908 ms | 0.18 |
| 375×812 / Dark | 864 ms | 0.00 |

桌面样本中 TTFB 仅 3 ms，LCP 的 99.7% 为客户端 render delay；DOM 为 709 个元素、深度 16，最大样式重算约 97 ms、布局更新约 81 ms、强制回流约 177 ms。45 个导航请求均成功，Dashboard 与模型 Dialog 无 Console error/warning/issue。模型页表单元数据问题已在最终采样中修复。

`pnpm profile:devtools` 已扩展为自动采集 Trace、网络、Console、Runtime 与堆快照汇总；默认匿名登录页样本生成约 228 KiB Trace 和 9.6 MiB 堆快照，原始数据继续只保存在 `.cache/`。

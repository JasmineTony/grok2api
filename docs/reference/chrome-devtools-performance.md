# Chrome DevTools MCP 性能分析指南

本文说明如何在本地使用官方 `chrome-devtools-mcp@1.6.0` 对 Grok2API 前端执行可重复、脱敏的性能采样。它用于实验室诊断，不替代真实用户监控（RUM）或线上 CrUX 数据。

## 安全模型

- MCP 使用隔离的 headless Chrome，默认不复用个人浏览器会话。
- 禁用 CrUX 查询和使用统计，并对网络请求头脱敏。
- 原始 Trace、堆快照、截图、Cookie 和网络明细只能写入仓库忽略的 `.cache/`。
- 不要把管理员密码、Cookie、Authorization、客户端密钥、代理密码或请求正文写入脚本、报告或 Git。
- 需要认证的场景应从环境变量或本地忽略文件读取临时凭据；采样后删除测试数据。

## ChatGPT Desktop / Codex MCP 配置

在桌面终端中注册固定版本：

```powershell
codex mcp add chrome-devtools -- cmd /d /s /c `
  npx -y chrome-devtools-mcp@1.6.0 `
  --headless=true `
  --isolated=true `
  --viewport=1440x900 `
  --memory-debugging=true `
  --no-performance-crux `
  --no-usage-statistics `
  --redact-network-headers=true `
  --log-file=E:\codex\grok2api\.cache\chrome-devtools-mcp.log
```

核验配置：

```powershell
codex mcp get chrome-devtools
```

配置是用户级开发工具设置，不属于应用运行时，也不应包含凭据。团队成员可以按自己的工作区路径调整 `--log-file`。

## 匿名页面冒烟采样

先启动本地 Grok2API，再运行：

```powershell
cd frontend
pnpm profile:devtools
```

默认目标是 `http://127.0.0.1:8000/login`。可通过环境变量切换到其他无敏感参数的 URL：

```powershell
$env:GROK2API_PERF_URL = "http://127.0.0.1:8000/login"
pnpm profile:devtools
```

脚本会通过标准 MCP JSON-RPC 调用：

- `new_page`
- `performance_start_trace`
- `evaluate_script`
- `list_network_requests`
- `list_console_messages`
- `take_heapsnapshot`
- `get_heapsnapshot_summary`
- `close_heapsnapshot`

输出保存在 `.cache/chrome-devtools-profile/`，包括页面加载 Trace、堆快照和脱敏汇总，不会进入 Git。堆快照可能保留页面文本与运行时对象，只能在本地受控环境使用，分析完成后应按需要删除。

## 深度分析场景

### 页面加载

分别覆盖登录页和 Dashboard：

1. 常规导航，观察真实路由加载顺序。
2. 强制无缓存 reload，观察首次资源下载。
3. 热缓存 reload，至少运行 5 次并取中位数。
4. 覆盖 `375×812`、`768×1024`、`1440×900`。
5. 同时记录 LCP、CLS、FCP、DOMContentLoaded、load、请求数、传输量和 JS Heap。

不要把单次样本直接当作结论。Windows 文件缓存、杀毒软件、CPU 调度和本地 SQLite 查询都可能造成明显波动。

### 交互延迟

对 Dashboard 刷新、管理路由切换和 Dialog 打开执行无导航 Trace，使用 `INPBreakdown` 分解：

- Input delay
- Processing duration
- Presentation delay

本地单次交互只是实验室 INP 代理，不是网站的现场 INP。

### 内存稳定性

1. 先访问所有待测路由，使懒加载模块完成初始化。
2. 获取预热后的基线堆快照。
3. 循环 Dashboard、账号、模型、密钥和审计页。
4. 分别在两组循环后获取快照并调用 `compare_heapsnapshots`。
5. 优先检查持续增长的业务对象、React 状态、事件监听器和 DOM；区分 V8 编译代码、DevTools Accessibility 缓存和网络资源缓存。

仅凭“总堆大小增加”不能判定泄漏。若第二阶段仍持续增长，应在不启用 DevTools Accessibility Snapshot 的浏览器中进行更长时间 soak test。

## 生产分块门禁

生产构建后运行：

```powershell
pnpm check:bundle
pnpm check:chunks
```

`check:chunks` 会解析生产 JavaScript 静态导入图并拒绝循环分块。此门禁用于防止手工 Vite 分块再次形成初始化顺序错误。

## 结果解释

- LCP 延迟主要来自 render delay 时，优先检查同步 JavaScript、React commit、图表测量和数据加载后的大块 DOM 更新，而不是盲目添加 preload。
- RenderBlocking 估算节省为 0 时，不应为了分数内联大段 CSS 或运行时配置。
- 强制回流栈落在图表/布局库时，应先避免空数据阶段挂载重型图表、关闭非必要首屏动画，并为加载状态保留稳定尺寸。
- CLS 达到 `0.1–0.25` 表示仍需优化；应通过布局偏移 source、加载骨架和数据区固定最小尺寸定位，不应只隐藏内容。

本轮实测结果见[第 11 轮性能报告](../plans/2026-07-21-11-chrome-devtools-performance/PERFORMANCE-REPORT.md)。

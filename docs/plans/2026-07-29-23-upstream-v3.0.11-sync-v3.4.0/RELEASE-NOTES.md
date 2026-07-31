# v3.4.0

同步上游 `v3.0.11`，修复大号池、推理统计和 Console 思考参数三个缺陷，并把 Grok Build、
Grok Web、Grok Console 拆分为独立设置页面。公开 API、配置语义、数据库兼容性和 Go module
路径保持不变，升级无需迁移。

## 缺陷修复

- **大号池请求失败（上游 #824）**：账号数超过 SQLite 约 32766 个绑定参数上限时，未分批的
  `IN (...)` 查询会在请求到达上游前直接失败并被包装成 `upstream_unavailable`。相关查询现已
  统一分批。
- **Anthropic Messages 推理长度为 0（上游 #825）**：Anthropic 把思考计入 `output_tokens`
  且不返回单独的推理字段，而解析器只读取 OpenAI 形态的 `reasoning_tokens`。现在会依据
  thinking 内容块与流式 `thinking_delta` 推导推理长度；若上游明确返回计数则优先采用。
- **Console 拒绝思考参数（上游 #814）**：以往任意受支持的等级都会被转发给任意支持推理的模型，
  导致 `grok-4.20-0309-reasoning` 等模型返回
  `does not support parameter reasoningEffort` 并使整个请求失败。现在会按模型实际支持的等级
  就近收敛。
- **账号导出上限**：未分页导出接口会拒绝超过 10000 个账号的号池，导致大号池完全无法导出。
  管理端现改为按游标分页导出并合并为单个文件。
- 同时修正了仪表盘 `tokenCacheHitRate`、`requestCacheHitRate` 从未被计算，以及四个
  成本/缓存字段从未被填充的问题。

## 设置页面调整

Grok Build、Grok Web、Grok Console 由「网络代理」下的标签页改为独立设置页面；「网络代理」
只保留出口代理节点与运维。「关于」「更新说明」「媒体」保持不变。三个页面仍共享同一份设置
表单，跨页面编辑不会丢失，保存时依旧提交完整 DTO。

## 升级

镜像 `ghcr.io/jasminetony/grok2api:v3.4.0`。无数据库迁移，可直接从 v3.3.0 升级；如需回滚，
回到 v3.3.0 亦无需数据库操作。

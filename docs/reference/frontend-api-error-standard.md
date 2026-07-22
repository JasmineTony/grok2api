# 前端 API 交互与错误处理标准

## 客户端边界

- `ApiClientProvider` 为每个 React 根创建独立 `ApiClient`；access token、refresh 去重和失效订阅均属于实例，禁止模块级可变会话。
- 管理 API 使用 `runtimeConfig.apiBaseUrl`；公开兼容 API 使用 `runtimeConfig.publicApiBaseUrl`。
- feature API 显式接收 `ApiClient`，并使用 decoder 将 `unknown` 转换为 DTO；组件不得解析原始 Response。
- 请求必须支持 `AbortSignal`；SSE 验证 content type、缓冲区上限、超时和错误事件。

## 错误标准

- `ApiError` 至少包含 HTTP status、稳定 code、脱敏 message、requestId 和 retryable。
- 401 仅在认证请求中触发一次 refresh 重试；refresh 网络不可用返回明确 503 错误，不伪装为凭据失效。
- JSON/DTO 解码失败统一为 `invalidResponse`；不得把响应正文、Token 或 Cookie写入 UI/日志。
- mutation 必须定义用户可见错误；后台刷新失败不得清空已显示数据。

## Query 标准

- query key 使用 typed factory；筛选、排序、页码和时区必须参与 key。
- queryFn 通过闭包显式传入 client，禁止把 API 函数直接作为 React Query 回调而造成参数错位。
- Dialog 查询仅在打开且 ID 有效时启用；关闭时取消长轮询或流。
- 下载和批量流必须清理 reader、timer、AbortController 与 loading toast。

## 存储标准

- localStorage 只能由 `safe-storage` 访问；读取必须 schema/decode，写入必须处理配额和隐私模式错误。
- 不保存管理员 Token、客户端密钥、代理密码、请求正文或其他凭据。

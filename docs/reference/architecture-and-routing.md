# Grok2API 架构与路由参考

本文保存从首页 README 迁出的架构、Provider、模型、路由与媒体细节。面向需要理解内部能力边界、排查路由或进行二次开发的维护者。

## 总体架构

```mermaid
flowchart TB
    Client["OpenAI / Anthropic 客户端"] --> Compat["兼容 API"]
    Admin["React 管理端"] --> AdminAPI["管理 API"]
    Compat --> App["应用服务"]
    AdminAPI --> App
    App --> Router["模型路由"]
    Router --> Selector["账号选择器"]
    Selector --> Registry["Provider Registry"]
    Registry --> Build["Grok Build Adapter"]
    Registry --> Web["Grok Web Adapter"]
    Registry --> Console["Grok Console Adapter"]
    App --> DB["SQLite / PostgreSQL"]
    App --> Runtime["Memory / Redis"]
    Build --> Egress["出口管理"]
    Web --> Egress
    Console --> Egress
```

- Go 服务负责兼容 API、管理 API、路由、账号调度、审计、媒体和运行设置。
- React 管理端由 Go 服务同源托管。
- 关系型数据库保存账号、加密凭据、模型、额度、客户端密钥、审计和媒体元数据。
- Memory/Redis 保存限流、并发租约、粘滞会话、锁、额度恢复和多实例通知等运行态。

## Provider 能力边界

| Provider | 账号来源 | 模型目录 | 多轮/存储特性 |
| --- | --- | --- | --- |
| Build | OAuth | 按账号真实能力动态发现 | 依模型与上游能力决定 |
| Web | SSO | 网关维护兼容目录并结合账号等级 | 支持 Web 对应的会话和媒体能力 |
| Console | SSO | 静态目录与兼容别名 | 保持无状态语义，不支持 stored response 查询/删除或 compact |

Provider 之间只共享统一管理和路由入口，不共享凭据、额度、健康、冷却、并发或多轮状态。带 `Build/`、`Web/`、`Console/` 前缀的模型名可用于显式指定来源。

## 模型发现与路由

- Build 模型按账号能力动态同步，不维护容易过期的固定公开列表。
- Web 与 Console 维护兼容模型目录；实际可用性仍受账号等级、健康、额度和冷却影响。
- 普通公开模型名可以映射到多个来源；路由先选择满足权限和能力的 Provider，再只在该 Provider 的账号池内切换账号。
- `GET /v1/models` 返回当前可服务模型，应作为调用方的最终依据。
- 客户端密钥可以限制允许访问的模型。

账号选择器综合以下条件：

1. 显式来源和模型能力；
2. 客户端密钥权限；
3. 账号启用与健康状态；
4. 额度、冷却和并发租约；
5. 会话粘滞与最近选择时间；
6. 有界等待与故障切换。

## 账号关联与出口身份

Web 账号可以与对应 Build、Console 账号建立一对一弱关联。关联只用于管理端来源展示和匿名出口身份复用，不共享凭据、额度、可用性、冷却、并发、模型能力或计费。

Resin 代理用户名支持 `{account}` 占位符：

```text
socks5h://Default.{account}:RESIN_PROXY_TOKEN@resin:2260
```

运行时会替换为稳定、匿名的账号身份。出口层只对明确发生在请求提交前的连接错误进行有限重试，不会自动重放已经提交的生成请求、认证失败、额度耗尽或上游限流。

## API 与媒体边界

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/v1/models` | 当前可服务模型 |
| `POST` | `/v1/responses` | Responses JSON / SSE |
| `POST` | `/v1/responses/compact` | Responses compact |
| `GET` | `/v1/responses/{id}` | 查询 stored response |
| `DELETE` | `/v1/responses/{id}` | 删除 stored response |
| `POST` | `/v1/chat/completions` | Chat Completions JSON / SSE |
| `POST` | `/v1/messages` | Anthropic Messages JSON / SSE |
| `POST` | `/v1/images/generations` | 图片生成 |
| `POST` | `/v1/images/edits` | 图片编辑，支持 JSON 与 multipart |
| `POST` | `/v1/videos/generations` | 创建异步视频任务 |
| `GET` | `/v1/videos/{request_id}` | 查询视频任务 |
| `GET` | `/v1/videos/{request_id}/content` | 获取视频任务内容 |
| `GET` | `/v1/media/images/{asset_id}` | 读取归档图片 |
| `GET` | `/v1/media/videos/{asset_id}` | 读取归档视频 |
| `PUT` | `/v1/media/uploads/{token}` | 使用一次性票据接收视频上传 |

stored response、compact 和服务端 reasoning replay 的可用性取决于最终 Provider 及配置。健康检查、不可猜测 ID 的媒体读取和一次性上传票据具有独立授权边界。

## 代码入口

- 后端结构与命令见 [`backend/README.md`](../../backend/README.md)。
- 前端结构与命令见 [`frontend/README.md`](../../frontend/README.md)。
- 部署和运行配置见 [`deployment-and-configuration.md`](./deployment-and-configuration.md)。

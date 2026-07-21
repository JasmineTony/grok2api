<p align="center">
  <img alt="Grok2API" src="./frontend/public/grok2api.png" width="720" />
</p>

<p align="center">
  <strong>面向 Grok Build、Grok Web 与 Grok Console 的多账号 API 网关</strong>
</p>

<p align="center">
  <a href="./backend/go.mod"><img alt="Go" src="https://img.shields.io/badge/Go-1.26-00ADD8?logo=go&logoColor=white" /></a>
  <a href="./frontend/package.json"><img alt="React" src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=111827" /></a>
  <a href="./LICENSE"><img alt="License" src="https://img.shields.io/badge/License-MIT-22c55e" /></a>
  <a href="https://github.com/JasmineTony/grok2api/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/JasmineTony/grok2api/actions/workflows/ci.yml/badge.svg" /></a>
</p>

Grok2API 以 Go 服务端和 React 管理端组成统一网关，把 Grok Build OAuth、Grok Web SSO 与 Grok Console SSO 管理为彼此隔离的账号池，并向客户端提供 OpenAI 与 Anthropic 风格接口。项目支持多账号调度、模型路由、客户端密钥、媒体任务、请求审计以及代理出口管理。

> [!IMPORTANT]
> 本项目仅用于技术研究与学习交流。使用者应遵守上游服务条款及所在地法律法规，并自行承担账号、数据与部署风险。

## English summary

Grok2API is a Go-based, multi-account API gateway with a React administration console. It connects Grok Build, Grok Web, and Grok Console through isolated provider pools and exposes OpenAI- and Anthropic-compatible endpoints. This repository is independently maintained by JasmineTony while preserving the upstream MIT license and attribution. See the sections below for deployment, API usage, security, and contribution links.

## 维护关系

本仓库由 [JasmineTony](https://github.com/JasmineTony) 独立维护，基于 MIT 许可证下的 [chenyme/grok2api](https://github.com/chenyme/grok2api)。上游版权、提交历史和许可证声明继续保留。

```text
origin   git@github.com:JasmineTony/grok2api.git
upstream https://github.com/chenyme/grok2api.git
```

上游同步必须使用 `sync/upstream-YYYYMMDD` 分支和 Pull Request，不直接强制覆盖 `main`，也不自动镜像上游标签。具体流程见 [UPSTREAM.md](./UPSTREAM.md)。

## 核心能力

- **三类 Provider**：Build、Web、Console 分别维护凭据、额度、健康、冷却、并发与模型能力。
- **兼容接口**：Responses、Chat Completions、Anthropic Messages、Images 与异步 Videos。
- **多账号调度**：支持优先级、能力过滤、额度门控、会话粘滞、并发租约与有界故障切换。
- **模型路由**：支持动态能力发现、静态目录、来源限定与客户端权限控制。
- **管理后台**：管理账号、模型、客户端密钥、图库、视频任务、请求审计、代理和运行设置。
- **部署选择**：单实例可使用 SQLite + Memory；多实例可使用 PostgreSQL + Redis。
- **出口管理**：支持 HTTP、SOCKS5 与 Resin 粘性代理。
- **安全边界**：上游凭据加密保存，发布镜像与普通 CI 完全分离。

架构和路由细节见 [架构与路由参考](./docs/reference/architecture-and-routing.md)。

## API 概览

客户端推理接口使用管理端创建的 `g2a_` API Key：

```http
Authorization: Bearer g2a_xxx_xxx
```

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/healthz` | 存活检查 |
| `GET` | `/readyz` | 分层就绪状态 |
| `GET` | `/v1/models` | 当前可服务模型 |
| `POST` | `/v1/responses` | Responses JSON / SSE |
| `POST` | `/v1/chat/completions` | Chat Completions JSON / SSE |
| `POST` | `/v1/messages` | Anthropic Messages JSON / SSE |
| `POST` | `/v1/images/generations` | 图片生成 |
| `POST` | `/v1/images/edits` | 图片编辑 |
| `POST` | `/v1/videos/generations` | 创建异步视频任务 |

Build 模型按账号真实能力动态发现，请以管理端模型页或 `GET /v1/models` 为准。完整接口、Provider 边界和媒体流程见 [架构与路由参考](./docs/reference/architecture-and-routing.md)。

## 快速开始

### Docker Compose（推荐）

1. 创建本地配置：

```bash
cp config.example.yaml config.yaml
```

2. 至少修改以下安全项：

```yaml
secrets:
  jwtSecret: "至少 32 个字符的随机值"
  credentialEncryptionKey: "Base64 编码的 32 字节密钥"

bootstrapAdmin:
  username: "admin"
  password: "强密码"
```

可使用以下命令生成示例随机值：

```bash
openssl rand -hex 32
openssl rand -base64 32
```

`credentialEncryptionKey` 在写入账号后必须长期保留；更换后已有凭据将无法解密。

3. 从当前源码构建并启动：

```bash
docker compose up -d --build
```

4. 打开：

```text
http://127.0.0.1:8000
```

默认 Compose 会构建当前仓库源码，而不是依赖尚未发布的 GHCR 镜像。端口、时区和配置路径可通过 `GROK2API_PORT`、`TZ`、`GROK2API_CONFIG` 调整。

更多部署、数据库、Redis、代理和源码运行说明见 [部署与配置参考](./docs/reference/deployment-and-configuration.md)。

## 首次使用

1. 使用 `bootstrapAdmin` 创建的管理员登录。
2. 在“上游账号”中接入 Build、Web 或 Console 账号。
3. 等待额度和模型能力完成首次同步。
4. 在“模型路由”中确认公开模型名、来源和启用状态。
5. 在“客户端密钥”中创建 `g2a_` API Key。
6. 使用该密钥调用 `/v1/*`。
7. 管理员创建成功后修改密码，并从配置中删除 `bootstrapAdmin`。

最小调用示例：

```bash
curl http://127.0.0.1:8000/v1/responses \
  -H "Authorization: Bearer g2a_xxx_xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "grok-chat-auto",
    "input": "用三句话解释量子隧穿",
    "stream": true
  }'
```

## 常见问题

### 为什么找不到 GHCR 镜像？

首个正式 GitHub Release 发布前，`ghcr.io/jasminetony/grok2api` 可能不存在。此时使用 `docker compose up -d --build` 从当前源码构建即可。

普通分支、`main` 推送或单独推送标签都不会发布镜像。只有发布符合版本要求的 GitHub Release，并通过受保护的 `release` environment 审批后，才会写入 GHCR。

### 调用返回 `401` 或 `403` 怎么处理？

- 确认使用的是“客户端密钥”页面创建的 `g2a_` Key，而不是管理员密码或上游账号凭据。
- 请求头必须是 `Authorization: Bearer <key>`。
- 检查密钥是否启用、是否限制了目标模型，以及模型是否存在可用 Provider 账号。
- 不要在 Issue、日志或截图中公开完整密钥、Cookie、OAuth/SSO 凭据或代理密码。

### 模型存在但无法调用怎么办？

- 先检查管理端账号的健康状态、额度、冷却和最近一次能力同步结果。
- Build 模型来自动态能力目录，账号失效或能力变化时，公开模型集合也会变化。
- 显式指定 `Build/`、`Web/`、`Console/` 来源时，路由不会跨 Provider 转移状态或额度。

### 什么时候需要 PostgreSQL 和 Redis？

单实例默认使用 SQLite + Memory。多实例部署应使用 PostgreSQL 保存共享业务数据，并使用 Redis 提供分布式限流、租约、粘滞会话、锁和设置通知；媒体目录还需要共享卷或实例亲和。

### 代理问题如何排查？

先确认代理地址、认证信息和出口网络可用，再检查账号是否绑定了预期代理。已提交的生成请求、认证失败、额度耗尽或上游限流不会由出口层无限重放。

## 安全与发布

- 使用 HTTPS，并在 HTTPS 管理地址下启用 `auth.secureCookies`。
- 使用强随机 `jwtSecret` 和 `credentialEncryptionKey`。
- 生产环境保持 `server.swaggerEnabled: false`。
- 不要将真实配置、数据库、Token、Cookie、账号导出或代理凭据提交到 Git。
- 安全问题必须按 [SECURITY.md](./SECURITY.md) 使用私密渠道报告。
- CI 只验证，不发布镜像；容器发布必须来自经过审批的 GitHub Release。

## 开发与验证

```bash
# 后端
cd backend
go test ./...
go vet ./...

# 前端
cd frontend
pnpm install --frozen-lockfile
pnpm lint
pnpm build
```

修改公开 API 注释后，在仓库根目录运行 `make swagger` 并确认生成文件没有意外漂移。

## 文档与贡献

- [部署与配置参考](./docs/reference/deployment-and-configuration.md)
- [架构与路由参考](./docs/reference/architecture-and-routing.md)
- [后端开发说明](./backend/README.md)
- [前端开发说明](./frontend/README.md)
- [Chrome DevTools MCP 性能分析](./docs/reference/chrome-devtools-performance.md)
- [上游同步流程](./UPSTREAM.md)
- [安全策略](./SECURITY.md)
- [安全审计记录](./SECURITY-AUDIT.md)
- [项目计划与迭代归档](./docs/plans/README.md)
- [Issues](https://github.com/JasmineTony/grok2api/issues)
- [Pull Requests](https://github.com/JasmineTony/grok2api/pulls)

本项目采用 [MIT License](./LICENSE)。

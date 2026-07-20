# Grok2API 部署与配置参考

本文保存从首页 README 迁出的部署、配置、存储、多实例与故障排查细节。

## Docker Compose

根目录 `docker-compose.yml` 默认从当前源码构建：

```bash
cp config.example.yaml config.yaml
docker compose up -d --build
```

默认访问地址：

```text
http://127.0.0.1:8000
```

常用环境变量：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `GROK2API_PORT` | `8000` | 主机映射端口 |
| `GROK2API_CONFIG` | `./config.yaml` | 本地配置文件路径 |
| `GROK2API_IMAGE` | `grok2api:local` | 本地镜像名称 |
| `TZ` | `Asia/Shanghai` | 容器时区 |

首个正式 GitHub Release 发布前可能没有 GHCR 包；默认 Compose 不依赖远程镜像。只有正式发布 GitHub Release 并通过 `release` environment 审批，Release 工作流才会写入 GHCR。

## 必需安全配置

首次启动前至少修改：

- `secrets.jwtSecret`：至少 32 个字符的随机值；
- `secrets.credentialEncryptionKey`：Base64 编码的 32 字节密钥；
- `bootstrapAdmin.password`：强管理员密码。

`credentialEncryptionKey` 用于解密已保存的上游凭据，写入账号后必须稳定备份。管理员创建成功后应修改密码，并从配置中删除 `bootstrapAdmin`。

## 配置分组

| 分组 | 说明 |
| --- | --- |
| `server` | 监听地址、请求体限制、超时和 Swagger |
| `auth` | 管理端 Token、刷新周期和安全 Cookie |
| `secrets` | JWT 与上游凭据加密密钥 |
| `frontend` | 同源静态资源目录 |
| `database` | SQLite 或 PostgreSQL |
| `runtimeStore` | Memory 或 Redis |
| `media` | 媒体存储驱动和路径 |
| `routing` | 服务端 reasoning replay 缓存 |

Provider 容量、批量任务并发、模型路由、媒体、审计和出口代理等运行设置由管理端维护。未标记“重启生效”的设置会热加载。

## 单实例与多实例

| 场景 | 数据库 | 运行态 | 媒体 |
| --- | --- | --- | --- |
| 单实例 | SQLite | Memory | 本地目录 |
| 多实例 | PostgreSQL | Redis | 共享卷或实例亲和 |

Redis 不替代关系型数据库。它负责分布式限流、并发租约、会话粘滞、锁、额度恢复和设置通知；账号、加密凭据、模型、客户端密钥、审计和媒体元数据仍保存在数据库中。

## 源码运行

后端：

```bash
cd backend
go run ./cmd/grok2api -config ../config.yaml
```

前端开发服务器：

```bash
cd frontend
pnpm install --frozen-lockfile
pnpm dev
```

前端默认运行于 `http://127.0.0.1:5173`，并将 `/api`、`/v1`、`/healthz` 和 `/readyz` 代理到 `http://127.0.0.1:8000`。

生产构建：

```bash
cd frontend
pnpm build

cd ../backend
go build ./cmd/grok2api
```

## 生产建议

- 使用 HTTPS 和反向代理，并在 HTTPS 管理地址下设置 `auth.secureCookies: true`。
- 生产环境保持 `server.swaggerEnabled: false`。
- 备份 `config.yaml`、数据库和媒体目录。
- 多实例为媒体配置共享卷或实例亲和。
- 不要提交真实 Token、Cookie、OAuth/SSO 凭据、数据库、代理密码或账号导出。
- 公网环境应增加访问控制、速率限制和基础网络防护。

## 常见故障

### 服务拒绝启动

- 检查 `jwtSecret` 是否达到最小长度。
- 检查 `credentialEncryptionKey` 是否为有效的 Base64 32 字节密钥。
- 检查配置挂载路径和 YAML 缩进。
- SQLite 使用相对路径时，以配置文件所在目录为基准。

### 管理端无法登录

- `bootstrapAdmin` 只在数据库中没有管理员时创建账号。
- 已存在管理员时，修改配置中的 `bootstrapAdmin` 不会覆盖数据库密码。
- HTTPS 部署应检查 `secureCookies` 与反向代理协议头。

### 账号或模型不可用

- 检查账号启用、健康、额度、冷却和能力同步时间。
- 检查客户端密钥是否限制模型。
- 检查代理是否可访问对应上游。
- 使用 `GET /readyz` 和管理端请求审计定位运行问题。

### 多实例状态不一致

- 确认所有实例使用同一 PostgreSQL 和 Redis。
- 确认 Redis `keyPrefix` 在同一实例组中一致。
- 确认媒体使用共享卷或请求具有实例亲和。

## 相关文档

- [主 README](../../README.md)
- [架构与路由参考](./architecture-and-routing.md)
- [配置示例](../../config.example.yaml)
- [安全策略](../../SECURITY.md)

# 第 07 次迭代迁移说明

## 数据库

- `provider_accounts.state` 为新增非空字段，默认值 `ready`，并限制为 `ready`、`degraded`、`cooldown`、`quota_exhausted`、`reauth_required`、`disabled`。
- `account_state_events` 为新增状态事件表，当前只建立结构和索引，业务写入将在状态服务接入 PR 中完成。
- GORM AutoMigrate 对 SQLite/PostgreSQL 增量添加字段和表，重复启动幂等；旧账号通过映射层兼容为 `ready`/`disabled`/`reauth_required`。

## 配置

新增 `observability.prometheus.enabled/listen`，默认关闭并监听 `127.0.0.1:9090`。未配置时运行行为不变。

## 依赖

- Node.js 工具链锁定 24.13.0（本地运行时需切换至对应版本）。
- pnpm 11.15.1、Vite 8.1.5、Tailwind 4.3.3、ESLint 10.7.0、TypeScript 6.0.2。
- Go `x/net` 0.57.0、`protobuf` 1.36.11。

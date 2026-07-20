# 可观测性与可靠性基础

本轮迭代保留既有 API、配置键和运行分层，仅增加可选的可靠性基础能力。

## Prometheus

指标默认关闭：

```yaml
observability:
  prometheus:
    enabled: false
    listen: 127.0.0.1:9090
```

启用后仅监听配置地址，默认地址为 `127.0.0.1:9090`。指标标签只使用低基数的结果、错误分类、账号状态、出口健康状态、Token 类型和成本类型，不包含账号 ID、请求 ID、Cookie、Token、密钥或完整请求正文。

## 账号状态

账号新增运行状态列，旧 `enabled`、`auth_status`、失败计数和冷却字段继续保留。初始状态按以下兼容规则推导：禁用账号为 `disabled`，需要重新认证的旧账号为 `reauth_required`，其余账号为 `ready`。状态转换只能由显式事件驱动；网络、超时、代理、5xx 和未知 403 不会直接触发重认证。

## 协议黄金文件

`backend/testdata/protocol/` 中的夹具仅用于离线兼容性测试。比较前会规范化 request ID、时间戳和 JSON 对象键顺序。默认不更新快照；更新必须显式设置 `UPDATE_GOLDEN=1`，且测试不联网。

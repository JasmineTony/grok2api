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

容器内启用可选 Prometheus/Grafana 栈时，将应用监听地址改为
`0.0.0.0:9090`。该端口只通过 Compose 内部网络暴露，不映射到宿主机：

```yaml
observability:
  prometheus:
    enabled: true
    listen: 0.0.0.0:9090
```

先为 Grafana 设置独立管理员密码，再启动可选 profile：

```powershell
$env:GROK2API_GRAFANA_ADMIN_PASSWORD = "replace-with-a-strong-password"
docker compose -f docker-compose.yml -f docker-compose.observability.yml --profile observability up -d
```

默认宿主机入口为 `127.0.0.1:9091`（Prometheus）和
`127.0.0.1:3000`（Grafana）。面板自动加载以下低基数信号：

- 账号 `reauth_required`/`disabled` 状态；
- Token refresh 失败；
- Provider 429；
- Voice WebSocket 活跃数；
- Billing reservation 最长存活时间；
- Audit queue 深度/容量；
- 逻辑上游请求与真实物理调用。

`deploy/observability/alerts.yml` 的阈值是保守起点。上线后应以业务
SLO、Provider 限流策略、正常 WebSocket 峰值和审计写入吞吐重新标定。

## 账号状态

账号新增运行状态列，旧 `enabled`、`auth_status`、失败计数和冷却字段继续保留。初始状态按以下兼容规则推导：禁用账号为 `disabled`，需要重新认证的旧账号为 `reauth_required`，其余账号为 `ready`。状态转换只能由显式事件驱动；网络、超时、代理、5xx 和未知 403 不会直接触发重认证。

## 协议黄金文件

`backend/testdata/protocol/` 中的夹具仅用于离线兼容性测试。比较前会规范化 request ID、时间戳和 JSON 对象键顺序。默认不更新快照；更新必须显式设置 `UPDATE_GOLDEN=1`，且测试不联网。

# 第 08 次迭代结果：可靠性治理与平台能力完整演进

- 完成日期：待完成
- 状态：实施中
- 基线提交：`c4a29a183e5065823c2356406f9002b310b62819`
- 本地工作分支：`codex/reliability-platform-roadmap`
- Pull Request：完整计划验收前不创建

## 当前进度

- 已切换为“完整计划完成后统一推送”的交付方式。
- 后续局部实现和本地检查点不得触发远程分支或中间 PR。
- 已将账号健康写入切换到显式状态事件事务：成功、冷却、限流、额度耗尽和确认凭据拒绝均生成统一状态。
- 未知 403 保持账号凭据有效并进入 cooldown；新增持久化事件与兼容 AuthStatus 回归测试。
- 已将低基数 HTTP 请求量、错误分类和耗时指标接入统一中间件，并复用 Prometheus registry。
- 当前后端串行全量测试与 go vet 通过。
- 管理 API 已新增兼容字段 `state`，前端账号列表按 disabled/reauth_required/degraded/quota_exhausted/cooldown/ready 显示，并保留旧 authStatus 兼容判断。
- 账号 upsert 已保留现有运行状态，避免凭据刷新或重新导入将状态误重置为 ready；后端 DTO 测试、前端 typecheck/lint 通过。
- 新增 `stateChangedAt`、`GET /api/admin/v1/accounts/:id/state-events` 与管理端状态记录对话框，可查看状态、原因、变化时间和最近事件；接口与数据库测试通过。
- Prometheus 已接入网关重试、输入/缓存/输出/reasoning Token、实际/估算成本，并每 30 秒刷新账号状态与 Egress 健康低基数 gauge；相关单元测试通过。
- 协议黄金测试扩展至 Responses、Chat Completions、Anthropic Messages、SSE、工具调用、usage/cache、图片、视频、401/403/429 和畸形响应；默认离线且仅 `UPDATE_GOLDEN=1` 可更新。

## 交付内容

待完整路线图完成后补充。

## 验证结果

待完整测试与验收完成后补充。

## 假设与默认值核对

待完成后逐项记录。

## 偏差、未解决事项与回滚

待完成后补充。

## 本轮本地推进（未推送）

- 继续遵守“完整路线图、测试与验收、假设与默认值全部完成后才首次推送”的规则；本轮只保留本地修改和检查点，不创建 PR、不推送远程。
- 将账号运行态相关写入进一步收敛到显式状态事件：账号启用/禁用、凭据重新认证、凭据刷新恢复均通过 TransitionHealth；移除未使用的旧 UpdateHealth 写入口。
- 增加结构化上游失败到状态事件的映射：未知 403/策略拒绝不会进入 reauth_required，只有带凭据拒绝证据的分类才会触发重新认证；状态原因只保存稳定错误码、分类、阶段和脱敏详情。
- 扩展回归测试，覆盖 MarkReauthRequired、启用/禁用事件、结构化未知 403、凭据拒绝和刷新恢复；后端全量测试与 go vet ./... 通过。
- 将 Recharts 升级到 3.9.2，TypeScript 类型检查、前端测试、lint 和生产构建通过；使用 Vite 8 AdvancedChunks 拆分 React、路由、查询、国际化、Radix 和图表依赖。
- 前端包体预算已收紧为主入口 350 kB raw / 115 kB gzip、Dashboard 及图表块 350 kB raw / 100 kB gzip、Lucide 100 kB raw、CSS 90 kB raw；当前 pnpm check:bundle 通过。
- Swagger 重新生成尚未完成：本地缓存缺少生成器的间接模块，联网补依赖尝试失败；该项仍是最终验收阻塞项，不能据此标记计划完成。
- go test -race 尚未完成：当前环境要求启用 cgo，需后续在具备 cgo 的 Windows 工具链中复验。
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
## 本轮第二阶段本地推进（未推送）

- 增加账号级 Egress 策略：inherit 继承 Provider 节点池、node 固定出口节点、direct 强制直连；固定节点可显式允许不可用时直连回退。
- 新增 account_egress_policies 增量表、SQLite/PostgreSQL 兼容的 GORM 模型、索引、重复初始化测试和作用域校验；不改变已有账号字段或现有 Egress 节点表。
- Egress Manager 在 AcquireCredential 时读取账号策略，保持旧账号和旧测试替身的 Provider 池行为不变；绑定节点按账号身份选择，Web 账号只允许绑定主 Web 节点，避免只配置资源节点导致聊天请求失效。
- 新增管理端 GET/PUT /api/admin/v1/accounts/:id/egress-policy，并在账号页增加出口策略对话框；敏感代理地址仍不会回显。
- 新增 Egress Manager、仓储和 HTTP API 回归测试；Go 全量测试、go vet、前端 typecheck、lint、Vitest、构建与 raw/gzip 包体预算均通过。
- 仍未实现主动出口健康探测、历史记录、Provider 级节点优先级和批量账号策略；这些继续作为路线图 B 的后续本地工作。
## 出口主动健康检查本地推进（未推送）

- 新增 POST /api/admin/v1/egress-nodes/:id/check 与 GET /api/admin/v1/egress-nodes/:id/health-checks；检查结果只保存健康状态、耗时、稳定错误码和时间，不保存代理凭据。
- 主动检查对代理主机执行有超时的 TCP 连通性探测；成功恢复健康度并清除冷却，失败按连续次数降低健康度并进入指数冷却。
- 新增 egress_health_checks 增量表、节点/时间索引、仓储查询和重复迁移兼容；管理端设置页可立即检查并查看最近历史。
- 新增应用服务与 HTTP API 回归测试；前端 typecheck、lint、生产构建和包体预算通过。
- 当前健康检查验证代理端点连通性，不伪装为完整上游协议探测；Provider 级业务探测、后台定时调度和跨实例熔断协调仍待后续实现。
## Token 与缓存语义本地推进（未推送）

- 网关在写入审计和成本估算前统一规范 usage：input/output/reasoning 不得为负，cached_input_tokens 被限制为 input_tokens 的子集；上游未提供 total_tokens 时按规范化字段补齐。
- 新增回归测试覆盖缓存 Token 超出输入、负数输出和上游 total_tokens 保留行为。
- 实际成本与估算成本仍使用独立字段和独立 Prometheus 指标；小时/日汇总表、请求级缓存命中率和多维成本视图仍待后续实现。
## 用量聚合、缓存与成本治理本地推进（未推送）

- 新增可丢弃的 `usage_rollups` 小时/日汇总表和 `usage_rollup_checkpoints` 覆盖检查点；首次运行回填历史完整小时，之后每 5 分钟幂等重算最近 48 小时，兼容迟到审计记录。
- Dashboard 对 UTC 整小时边界优先读取小时汇总，当前未结束小时、未覆盖区间和非整小时偏移时区自动回退 `request_audits`，审计明细表继续作为唯一权威数据源。
- 增加 Token 缓存命中率与请求缓存命中率的独立语义；请求缓存分母只统计显式标记为可缓存的请求。当前网关尚未启用完整响应缓存，因此默认显示“请求缓存未启用”，不会把内部选择器或查询缓存误报为请求缓存命中。
- 实际成本、估算成本和计费成本分别持久化与聚合；计费成本继续按“存在实际成本则使用实际成本，否则使用估算成本”计算，避免静默混用。
- Dashboard 与审计汇总 API 已增加实际/估算/计费成本、两类缓存计数和命中率；管理页同步展示成本组成以及请求缓存是否启用。
- Dashboard 新增账号与客户端密钥 Top 用量治理面板；Provider、模型、账号、客户端密钥均可查看请求量、Token、缓存和成本聚合，其中汇总表只保存数值维度 ID，不复制账号名、密钥名或凭据。
- SQLite 迁移、重复初始化、小时/日汇总、迟到记录重算、raw/rollup 快照等价、账号/密钥维度以及缓存约束回归测试已通过。
- 本地 Windows/amd64 基准（60,000 条审计、90 天桶、每项 3 次）结果：原始审计聚合约 `255.16 ms/op`，小时汇总约 `7.26 ms/op`，查询耗时下降约 97%，超过“至少下降 50%”验收目标。该结果用于本机基线，最终仍以 CI 和目标部署数据库复验为准。
- 本轮已通过 `go test -p 1 ./...`、前端 `pnpm lint`、`pnpm typecheck` 和 `pnpm build`；当前分支仍保持仅本地，未执行远程推送。

## 阶段 C：版本、备份与通知中心本地推进（未推送）

- 版本检查的维护仓库已切换到 JasmineTony/grok2api；chenyme/grok2api 作为独立的上游同步提示，手动检查和每日后台任务分别刷新两者。
- 新增应用级 SQLite 一致性备份：使用 VACUUM INTO 生成快照，复制本地媒体，写入版本、数据库驱动、文件大小、SHA-256、加密状态和恢复停服要求的 manifest；PostgreSQL 明确标记为需要外部备份，不伪装成完整数据库备份。
- 新增备份清单校验、篡改检测和显式停服恢复；恢复前保留 .pre-restore-*，不在服务运行时偷偷替换打开中的数据库。
- 新增站内通知表、去重/冷却、已读/确认、过期清理和管理员 API；Webhook 仅使用环境变量 GROK2API_NOTIFICATION_WEBHOOK_SECRET 提供签名密钥，正文不包含凭据、请求正文或客户端密钥。
- 前端导航加入通知中心，展示严重级别、正文、时间、未读数并支持标记已读/确认；版本页显示维护仓库和上游版本来源。
- 本地回归已覆盖 SQLite 备份清单、恢复、通知去重、Webhook HMAC 签名与敏感内容排除；后端相关测试、前端类型检查和 lint 已通过。
- 阶段 C 仍未全部完成：升级前磁盘/驱动/迁移兼容性检查、PostgreSQL/Redis 外部备份钩子、账号/代理/额度/持续高错误率事件的统一通知触发，继续留在本地路线图中。

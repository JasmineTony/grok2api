# AGENTS.md — grok2api 维护线开发规范

本文件是开发与验收规范的唯一事实来源（SSOT）。规则必须能通过命令或明确检查项验证；代码、工具配置与规范变化必须在同次改动中同步。

## 1. 仓库定位与上游关系

- 本仓库是 [`chenyme/grok2api`](https://github.com/chenyme/grok2api) 的衍生维护线，不是无关的独立重写。
- 上游 `main` 的对外行为契约优先；偏离须在 PR 中说明理由、影响与回滚方式。通用修复优先采用可回馈上游的实现。
- `origin` 必须指向 `https://github.com/JasmineTony/grok2api.git`，`upstream` 指向 `https://github.com/chenyme/grok2api.git`。推送前执行 `git remote -v`，禁止推送 upstream。
- 当前技术路线：Go/Gin/GORM 模块化单体；React 19、TypeScript 6、Vite 8、pnpm，服务端状态用 TanStack Query，客户端会话状态用 Zustand。
- 架构重构不默认授权改变 API、模型路由 ID、凭据/数据库格式、鉴权、计费、账号范围、审计或取消语义；不可逆迁移和生产发布单独确认。
- 在维护分支分阶段提交。草稿 PR/CI 验证不等于允许合并 `main`、发布或部署。

## 2. 开发规范（DEV）

### DEV-1 新增或重构 UI 必须可稳定定位

- 新增或重写的业务 React 组件及可视交互元素使用稳定的 `data-testid`，命名为领域前缀的 kebab-case。
- 同一页面内 testid 唯一。列表采用业务 ID 后缀，例如 ``account-row-${account.id}``，不以数组位置、文案或 i18n key 作为标识。
- 组件测试通过 testid 断言可见结果，同时检查 role、可访问名称、键盘操作及错误提示；不能用 testid 代替可访问性。
- 纯展示包装层可豁免，但须在 PR 说明。重命名测试契约必须同步测试。
- 判定：检查新增 JSX、运行组件集成测试与 Playwright；查询 `data-testid` 的扫描只作辅助，不等于行为验证。

### DEV-2 显式 TypeScript 契约

- 新增导出函数、组件、hook 声明返回类型；props 使用具名或内联对象类型。不以推断代替对外契约。
- 禁止新增 `any` 与 `@ts-ignore`。仅外部类型缺陷可用带具体说明的 `@ts-expect-error`，并在 PR 写明移除条件。
- 生产源码、Node 工具配置、测试与 E2E 均有明确的类型检查范围。不得把失败代码移出 include 来绕过检查。
- 判定：`pnpm typecheck`、`pnpm lint` 退出 0；辅助检索 `rg -n ":\s*any\b|@ts-ignore" frontend/src`，逐项区分代码与文本。

### DEV-3 沿用分层与既有能力

- 前端依赖方向：`app` 组合 `features`；feature 消费 `entities` 的公共领域契约与 `shared`；`components/ui` 是基础原语。下层不能反向引用 app/features。
- 多个 feature 共同使用的 DTO/只读查询归属相应 entity；命令、交互、表单及可取消任务归属 feature。禁止复制一套鉴权、API 客户端、校验、查询 key 或服务端状态。
- 后端：Transport → Application → Domain；Repository/Ports 定义契约，Infra 实现；`internal/app` 是装配入口。存量依赖例外必须显式登记，不得扩大。
- 先检索同目录/领域实现，复用现有解码器、表格、分页、额度展示、任务池、事务、锁与取消能力。拆分必须体现职责，不把巨型组件改名为巨型 hook。
- 默认不增加生产依赖或框架。新增依赖须说明现有能力不足、版本兼容性、许可证、生产体积与回滚方式。
- 判定：架构检查退出 0；diff 只含阶段范围；无未使用代码、永久兼容转发层或第二套业务规则。

### DEV-4 前端质量门禁

- `frontend/` 下 `pnpm verify` 必须退出 0，覆盖格式、类型、Oxlint、ESLint、架构、单元/组件覆盖率、生产构建和预算。
- `pnpm verify:full` 在质量门禁之后运行真实全栈 E2E；CI 必须同时运行前端质量、E2E、后端与镜像检查，不能以快速命令代替全部验收。
- 聚合命令不重复运行同一套测试。独立 `pnpm test` 用于开发反馈，`pnpm test:ui:coverage` 保留覆盖率入口。
- 不以 `Skipped`、`Blocked`、未运行、只写好配置或重试后偶然通过代替 `Passed`。
- 门禁与实际证据位置见 `frontend/AUDIT.md`、`backend/AUDIT.md`；规则变更须同步本文件。

### DEV-5 格式、环境和构建一致性

- Prettier 是前端格式唯一来源。仓库存储换行由 `.gitattributes` 统一为 LF；工作区检出换行由 git `core.autocrlf` 与 Prettier `endOfLine` 决定，两者不得互相矛盾。格式调整与行为变化分开审查，不夹带无关批量格式化。
- ESLint 检查 TS/React/Hooks 语义，Oxlint 检查 correctness；生成物与基础原语的排除范围须一致且有依据。禁止宽泛 disable 掩盖问题。
- `pnpm-lock.yaml` 冻结安装；使用 `packageManager` 声明的 pnpm。记录 Node/pnpm/Go/OS/提交与锁文件 hash。
- 开发代理目标只用于开发，不得污染生产公开地址回退；不将后端秘密注入 `VITE_*`。生产保持后端受控运行配置、同源管理 API、哈希资源与 SPA 回退。
- 同工具链/平台/输入下两次干净构建产物 hash 一致；冷/热构建耗时分开记录，不声称跨 Node/OS 字节级一致。
- 判定：format/type/lint/config 回归、冻结安装、生产产物检查与两次构建比较。

## 3. 测试要求（TEST）

### TEST-1 业务 UI 覆盖率门槛 76%

- 原要求“>75%”统一为可执行的 **76%**，本轮新增/完成重构的业务 UI 按文件约束语句、分支、函数和行覆盖率。
- 使用 Vitest `@vitest/coverage-v8`；include 和 thresholds 位于 `frontend/vitest.config.ts`，报告必须区分已纳入范围与存量未覆盖范围。
- shadcn 基础原语不纳入业务 UI 门槛；原语内部自定义 hook 仍遵守 TEST-2。
- 扩大覆盖采用逐阶段 ratchet，不降低已达标文件门槛，不删除断言，不通过排除新增/重构文件制造达标。
- 判定：`pnpm test:ui:coverage` 退出 0，报告中目标文件达到门槛；既有高覆盖保持，未覆盖风险显式记录。

### TEST-2 自定义 hooks 覆盖率 100%

- 自定义 hook（独立 `use*.ts(x)` 或组件内的 `use*` 函数）语句、分支、函数、行均为 **100%**。
- 覆盖订阅、定时器、请求/流取消、重复操作、StrictMode 和边界入参；按生命周期实际断言清理。
- 可将 hook 与展示职责分离以单独设置 100% 门槛，不能为了覆盖率改变行为或隐藏未测试分支。
- 判定：相关 hook coverage 报表与 `vitest.config.ts` 单独阈值一致。

### TEST-3 关键路径组件集成测试

- 登录/鉴权、导入与凭据刷新、额度/模型封锁、审计筛选、客户端密钥增删、设置冲突、版本更新等均需覆盖 UI → API → 状态/错误。
- 网络边界可替换，被测业务组件、hook、decoder 与状态流保持真实；不能只检查 mock 调用次数。
- 判定：领域集成测试断言正常/失败/空态与相关权限、重复操作、取消等路径的用户可见结果。

### TEST-4 禁止弱化测试

- 业务逻辑变化同步新增/更新测试。移除测试须说明等效替代覆盖，不能删除失败断言、扩大超时或无条件重试来掩盖缺陷。
- 既有 `node:test` 迁移到 Vitest 必须逐项保留用例和断言，并确保纯逻辑 Node 环境与组件 jsdom 环境分离。
- 判定：测试 diff、用例计数与关键不变量对比；缺陷修复先提供复现/根因证据。

### TEST-5 真实全栈 E2E 与隔离

- Playwright 使用生产前端产物和真实 Go HTTP/Auth/Application/SQLite/Memory。mock 管理 API 的浏览器测试必须单列，不作为全栈通过证明。
- 每 worker 独立端口、临时数据库/媒体目录、合成凭据；只监听 loopback，不读取真实 `config.yaml`，不继承指向真实服务的环境配置。
- 外部 Provider/OAuth/更新查询使用明确的测试 client 或本地替身；未知外部调用失败，不放宽 TLS、鉴权或生产 readiness，不新增生产后门。
- 空账号池 `/readyz` 未就绪与管理面可用分别断言。清理只针对测试自有 PID/目录，日志与 trace 不包含真实秘密。
- 判定：`pnpm test:e2e`、`pnpm verify:full`；登录/会话/密码、密钥 CRUD、账号、审计、设置/模型/出口、创作/媒体、语言主题与路由刷新按阶段纳入。

### TEST-6 后端与存储验证

- 后端执行 `go test ./... -count=1`、`go vet ./...`、`go build ./...`；Linux CI 执行 `go test -race ./...`。
- PostgreSQL/Redis 集成测试使用隔离 CI 服务；启动前确认环境可达，不能用缺环境跳过冒充通过。复用临时 PostgreSQL 数据库和隔离 Redis 命名空间。
- 公开接口注释变化需生成 Swagger 并做精确 diff 校验；架构重构保持公开协议与前轮回归。
- 判定：命令退出码、测试 JSON 中失败/跳过明细及 CI 真实结果。环境不足准确标记阻塞。

## 4. 代码审查（REV）

### REV-1 单文件不超过 600 行

- 前端新增或完成重构的 `.ts`/`.tsx` 文件 ≤600 行；存量豁免必须在阶段基线中明确，不得把未超限文件推过阈值。
- 判定：架构/结构门禁和 `git diff --numstat`；行数仅是边界，不是只搬文件即可通过的理由。

### REV-2 函数不超过 50 行

- 新增或完成重构的函数、组件、回调 ≤50 行，不含 import 与类型声明；拆分应命名实际职责，不能生成无语义 helper。
- 判定：结构门禁与人工 diff 检查；未完成阶段的旧函数不得继续扩大。

### REV-3 控制流嵌套最多 3 层

- `if`/`for`/`try`/三元链最多 3 层，优先提前返回、明确条件与职责拆分。
- 判定：结构门禁与 diff 检查，不用复杂表达式或一行代码隐藏嵌套。

### REV-4 使用业务命名

- 禁止无意义 `xxx2`、`newXxx`、`finalXxx`、`tempXxx`、`oldXxx`；`newPassword` 等确属业务含义的名称可保留。
- 判定：检索命中逐项说明，不对文本误报机械改名。

### REV-5 产物与性能预算

| 指标 | 硬阈值 |
| --- | ---: |
| 登录首屏关键 JS 依赖闭包（含必需语言资源） | 260 KiB gzip |
| 业务路由相对基础资源的新增 JS 依赖闭包 | 180 KiB gzip |
| 全部生产 JS（去重） | 650 KiB gzip |
| 全部生产 CSS | 20 KiB gzip |
| 单个 JS chunk | 500 KiB 原始体积 |

- KiB=1024 B，gzip 使用固定参数。共享依赖去重；结合浏览器资源记录检查，不能只拆 chunk 绕预算。
- 关键体积比冻结基线增长 >5% 必须解释处理，不自动提高阈值。压缩体积不等于服务器已开启传输压缩。
- 性能比较同环境重复测量，记录前端资源/请求/DOM与后端 `ns/op`、`B/op`、`allocs/op`、查询次数。稳定回退 >10% 必须查明；不为提速牺牲事务、安全、审计或一致性。
- 判定：`pnpm check:budget`、构建产物与 benchmark 前后报告；无实测收益则不声称优化成功。

## 5. 存量债务与阶段边界

- `7c0493a2` 基线：前端 18 个源码文件 >600 行，含 accounts 3864、creative-console 3018、i18n 4150、settings 1604、quality-guard 1579、egress-nodes 1560 等。旧“11个”记录已失效。
- 完整文件/函数基线、已整改范围与问题状态由机器可读结构基线及 `frontend/AUDIT.md` 记录；不能将新违规写成历史豁免。
- 重构按公共契约 → 账号/密钥/审计/模型 → 设置/出口/守护 → 创作/媒体/Gateway推进。完成模块移出豁免；阶段内未完成旧文件只允许持平或减小。
- 全量审计不意味着一次性同时重写全部目录；但已批准的后续阶段不得悄悄取消或冒称全部完成。

## 6. 文档与验收状态

- 本文件编号稳定；条目废弃保留编号，不复用。规则变化同步配置、命令、README与审计报告。
- 问题记录包含编号、`file:line`/日志证据、现有/新增、影响、优先级、阶段、验证方法、结果与回滚点。
- P0：安全、数据损坏、范围/计费/审计不变量失效，立即阻塞。
- P1：必需检查失败/未运行、预算或新架构违规、生产环境隔离失败，阶段验收阻塞。
- P2：已登记且未扩张的计划内存量债务；P3：无缺陷证据的建议，不无限扩大任务。
- `Passed`、`Failed`、`Skipped`、`Blocked` 分别记录。CI未实际完成、测试只定义未执行、Quality Guard只写配置均不能记为通过。
- 自审只列相关风险：修改与保留文件、复用点/新增抽象理由、边界与重复逻辑、权限/并发/事务/性能/失败处理、测试、未覆盖风险及按阶段提交回滚。

## 7. 验证入口

```powershell
# frontend/
pnpm install --frozen-lockfile
pnpm verify
pnpm verify:full

# backend/
go test ./... -count=1
go vet ./...
go build ./...
# 支持 race 的 Linux/CI 工具链
go test -race ./...

# 仓库根：检查改动边界与目标远端
git diff --check
git diff --numstat
git remote -v
```

独立命令、覆盖范围、环境限制、性能基线与实际运行结果参见 [前端审计](frontend/AUDIT.md)、[后端审计](backend/AUDIT.md)。

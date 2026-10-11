# AGENTS.md — 工程规范与验收契约（grok2api 维护线）

本文件是**规则**的唯一事实来源（SSOT）。它只回答三件事：**做什么、怎么判定、违反的后果**。
历史演进、债务计数与一次性证据**不写在这里**（见 §5、§12）。任何数字都必须能由命令复现（META-2）。

## 0. 适用范围、判定方式与失败后果（META）

| 项         | 定义                                                                                                      |
| ---------- | --------------------------------------------------------------------------------------------------------- |
| 适用主体   | 人类贡献者、自动化代理（含子代理）、维护线负责人；三者同受约束                                            |
| 触发时机   | 写入前（§9/§2）、提交前（§11）、PR/合并前（§3/§4/§7）、发布前（§8）                                       |
| 判定方式   | **机器门禁** = 有命令与退出码（表见 BIND-4）；**评审准则** = 无门禁、人工判断，违反须在 PR/汇报中说明理由 |
| 失败后果   | 见 META-4；P0/P1 阻塞合并与发布，P2/P3 只登记                                                             |
| 规则元信息 | 每条规则标注适用主体、判定方式；未标注判定的条目一律视为评审准则                                          |

### META-1 规则必须可判定

每条规则要么给出可执行判定命令，要么显式标注「评审准则」。禁止写入无法判定的措辞（如「使用有意义的命名」而不给检索式）。

### META-2 数字必须可复现

文档、PR、AUDIT 中任何数字（行数、覆盖率、用例数、条数、体积、run id）必须同时给出产生它的命令与日期；无法复现的必须标注「未复现」。

### META-3 规范与状态分离

本文件只放规则与**稳定的**绑定事实（路径、命令、阈值）。历史演进、债务计数、逐轮实测与一次性证据写入 `frontend/AUDIT.md` / `backend/AUDIT.md`（§12）。

### META-4 优先级与阻塞语义

- 阻塞语义：P0/P1 阻塞合并与发布；P2 不阻塞，按棘轮只许持平或下降；P3 只登记，不扩大任务。P0–P3 的完整定义见 §6。
- 规则与 P 级绑定：违反 §2/§3/§4/§7 的机器门禁 = P1；违反 §8 的发布前置与版本载体一致性门禁 = P1；违反 §13 的 SEC-1/SEC-3/SEC-4 = P0、SEC-2 = P1；违反 §10 的虚假通过 = P1；其余见各节。

### META-5 编号稳定

条目废弃保留编号、不复用；规则变更必须与配置、命令、审计文档在同一次改动内同步。

## 1. 仓库定位与上游关系

- 本仓库是 [`chenyme/grok2api`](https://github.com/chenyme/grok2api) 的衍生维护线，不是无关的独立重写。
- 上游对外行为契约优先，其**载体**是 `backend/api-baseline.txt`、`make swagger` 的精确 diff、`backend/api-baseline.txt` 覆盖不到的公开协议由 E2E 用例固定。偏离须在 PR 说明理由、影响与回滚方式；通用修复优先采用可回馈上游的实现。
- `origin` 必须指向 `https://github.com/JasmineTony/grok2api.git`，`upstream` 指向 `https://github.com/chenyme/grok2api.git`。推送前执行 `git remote -v`（评审准则，无自动化校验），**禁止推送 upstream**。
- 技术栈与版本不在本文件复制，以 `backend/go.mod`、`frontend/package.json` 为准（BIND-2）。
- 架构重构不默认授权改变 API、模型路由 ID、凭据/数据库格式、鉴权、计费、账号范围、审计或取消语义；不可逆迁移与生产发布单独确认（§8）。
- 在维护分支分阶段提交；草稿 PR/CI 验证不等于允许合并 `main`、发布或部署。合并 `main`、创建 tag/Release、推送生产镜像属不可逆操作，逐次单独授权并登记证据（§8）。

**授权登记**

- 2026-10-10 维护线负责人授权：把 `maint/modular-quality-audit` 合并到 `main` 并发布 `v0.1.1`。
- 2026-10-11 维护线负责人授权：合并 `maint/modular-quality-audit` 到 `main`、发布 `v0.1.2`（annotated tag + GitHub Release + GHCR 镜像），并在同一授权内重建远端 `origin`（删除并新建同名仓库，同时删除历史遗留的 GHCR 容器包）。发布证据按 §8 登记。
- 授权记录不可改写；新增授权在末尾追加（META-5）。

## 2. 开发规范（DEV）

### DEV-1 新增或重构 UI 必须可稳定定位（评审准则）

- 新增/重写的业务 React 组件及可视交互元素使用稳定的 `data-testid`，命名为领域前缀 kebab-case。
- 同一页面内 testid 唯一。列表采用业务 ID 后缀，例如 `account-row-${account.id}`，不以数组位置、文案或 i18n key 作为标识。
- 组件测试通过 testid 断言可见结果，同时检查 role、可访问名称、键盘操作及错误提示；不能用 testid 代替可访问性。
- 纯展示包装层可豁免，但须在 PR 说明。重命名测试契约必须同步测试。
- **无机器门禁**。辅助检索 `rg -n "data-testid" frontend/src` 只作定位，不等于行为验证。

### DEV-2 显式 TypeScript 契约（机器门禁）

- 新增导出函数、组件、hook 声明返回类型；props 使用具名或内联对象类型。不以推断代替对外契约。
- 禁止新增 `any` 与 `@ts-ignore`。仅外部类型缺陷可用带具体说明的 `@ts-expect-error`，并在 PR 写明移除条件。
- 生产源码、Node 工具配置、测试与 E2E 均有明确的类型检查范围。不得把失败代码移出 include 来绕过检查。
- 判定：`pnpm typecheck`、`pnpm lint` 退出 0。`any`/`@ts-ignore` 由 `frontend/eslint.config.js` 的 `no-explicit-any` 与 `ban-ts-comment` 强制，**不得**用 `rg` 检索代替 lint。

### DEV-3 沿用分层与既有能力

**机器门禁部分**

- 前端依赖方向：`app` 组合 `features`；feature 消费 `entities` 的公共领域契约与 `shared`；`components/ui` 是基础原语。下层不能反向引用 app/features。
- 判定：`pnpm check:architecture` 退出 0（`frontend/.dependency-cruiser.cjs`：`no-circular`、`not-to-unresolvable`、`lower-layers-must-not-import-upper`、按 feature 生成的 `no-cross-feature-*`）；`frozenCrossFeatureDebt` 只允许收缩，新增跨 feature 直接依赖即违规。

**评审准则部分**

- 后端：Transport → Application → Domain；Repository/Ports 定义契约，Infra 实现；`internal/app` 是唯一装配入口。存量依赖例外必须显式登记，不得扩大。
- 先检索同目录/同领域实现，复用现有解码器、表格、分页、额度展示、任务池、事务、锁与取消能力。拆分必须体现职责，不把巨型组件改名为巨型 hook。
- 默认不增加生产依赖或框架。新增依赖须说明现有能力不足、版本兼容性、许可证、生产体积与回滚方式。
- diff 只含阶段范围；无未使用代码、永久兼容转发层或第二套业务规则。

### DEV-4 前端质量门禁（机器门禁）

- `frontend/` 下 `pnpm verify` 必须退出 0，覆盖 12 步：`format:check → oxlint → lint → typecheck → typecheck:e2e → test → test:ui:coverage → check:architecture → check:structure → test:gates → build → check:budget`。
- `pnpm verify:full` 在质量门禁之后运行真实全栈 E2E；CI 必须同时运行前端质量、E2E、后端与镜像检查，不能以快速命令代替全部验收。
- 聚合命令不重复运行同一套测试。独立 `pnpm test` 用于开发反馈，`pnpm test:ui:coverage` 保留覆盖率入口。
- 不以 `Skipped`、`Blocked`、未运行、只写好配置或重试后偶然通过代替 `Passed`（§10）。
- 门禁与实际证据位置见 `frontend/AUDIT.md`、`backend/AUDIT.md`；规则变更须同步本文件。
- **改动落地即验**：每次修改代码后必须在同一次改动内运行受影响的门禁（至少 `pnpm check:structure` / `go run ./tools/structurecheck` / 相关包的测试），禁止把门禁失败留到阶段收尾批量返工（取证：一个会话内 `结构门禁失败` 出现 32 次、累计 97 个新增超限文件/函数）。

### DEV-5 格式、环境和编码一致性

- Prettier 是前端格式唯一来源（`frontend/.prettierrc`）。仓库存储换行由 `.gitattributes` 统一为 LF；工作区检出换行由 git `core.autocrlf` 决定，两者不得互相矛盾。格式调整与行为变化分开审查，不夹带无关批量格式化。
- ESLint 检查 TS/React/Hooks 语义，Oxlint 检查 correctness；生成物与基础原语的排除范围须一致且有依据。禁止宽泛 disable 掩盖问题。
- `pnpm-lock.yaml` 冻结安装；使用 `packageManager` 声明的 pnpm（版本一致性本身尚无门禁，登记为 P3）。
- 开发代理目标只用于开发，不得污染生产公开地址回退；不将后端秘密注入 `VITE_*`。
- **编码与文本比对（评审准则，必须遵守）**：禁止用 shell 文本工具做编码/行数敏感的判定。`Get-Content` 在无 BOM 的 UTF-8 文件上会少算行数、默认 ANSI 解码会产生假差异；行数与编码判定一律使用字节级读取（`ReadAllBytes`/显式 UTF-8）或解析器（`go/ast`、TS AST），比较前先归一化 CRLF 与编码。
- 判定：`pnpm format:check`、`pnpm install --frozen-lockfile` 退出 0；批量改写文件时按 §11 的 CHG-10 校验改动文件集与编码。

## 3. 测试要求（TEST）

### TEST-1 业务 UI 覆盖率门槛 76%（机器门禁）

- 按文件约束语句、分支、函数和行覆盖率 ≥76%。唯一口径是 `frontend/vitest.config.ts` 的 `coverage.include` 与 `thresholds`（`perFile: true` 才是逐文件强制；Vitest 5 的全局阈值默认只做聚合检查）。
- shadcn 基础原语不纳入业务 UI 门槛；原语内部自定义 hook 仍遵守 TEST-2。
- 扩大覆盖采用逐阶段 ratchet，不降低已达标文件门槛，不删除断言，不通过排除新增/重构文件制造达标。
- 判定：`pnpm test:ui:coverage` 退出 0，报告必须区分已纳入范围与存量未覆盖范围。
- **CLI 临时 `--coverage.include` 得到的数字不是门禁口径，不得计入 `Passed`。**

### TEST-2 自定义 hook 覆盖率 100%（机器门禁）

- 纳入 `vitest.config.ts` 逐文件 100% 阈值的 hook，语句、分支、函数、行四项均须 100%。
- 覆盖订阅、定时器、请求/流取消、重复操作、StrictMode 和边界入参；按生命周期实际断言清理。
- 可将 hook 与展示职责分离以单独设置 100% 门槛，不能为了覆盖率改变行为或隐藏未测试分支。
- 新增 hook 必须在同一次改动内加入阈值，或登记未纳入的原因（不得静默留在门槛外）。
- 判定：`frontend/vitest.config.ts` 的 `thresholds` 条目与覆盖率报告一致；纳入条目数以该文件的 `thresholds` 为准，不在本文件复制数字（META-2）。

### TEST-3 关键路径组件集成测试（评审准则 + CI 硬门禁）

- 登录/鉴权、导入与凭据刷新、额度/模型封锁、审计筛选、客户端密钥增删、设置冲突、版本更新等均需覆盖 UI → API → 状态/错误。
- 网络边界可替换，被测业务组件、hook、decoder 与状态流保持真实；不能只检查 mock 调用次数。
- 判定：评审准则；CI 步骤 `Assert required integration tests ran`（`.github/workflows/ghcr-image.yml`）的「集成用例 0 跳过」断言是唯一硬门禁（§8）。

### TEST-4 禁止弱化测试（评审准则）

- 业务逻辑变化同步新增/更新测试。移除测试须说明等效替代覆盖，不能删除失败断言、扩大超时或无条件重试来掩盖缺陷。
- 调整超时/并发/容差参数必须附实测判别力证据（说明为何不是掩盖缺陷）。
- 既有 `node:test` 迁移到 Vitest 必须逐项保留用例和断言，并确保纯逻辑 Node 环境与组件 jsdom 环境分离。
- 判定：测试 diff、用例计数与关键不变量对比；缺陷修复先提供复现/根因证据。

### TEST-5 真实全栈 E2E 与隔离（机器门禁）

- Playwright 使用生产前端产物和真实 Go HTTP/Auth/Application/SQLite/Memory。mock 管理 API 的浏览器测试必须单列，不作为全栈通过证明。
- 每 worker 独立端口、临时数据库/媒体目录、合成凭据；只监听 loopback，不读取真实 `config.yaml`，不继承指向真实服务的环境配置。
- 外部 Provider/OAuth/更新查询使用明确的测试 client 或本地替身；未知外部调用失败，不放宽 TLS、鉴权或生产 readiness，不新增生产后门。
- 已实现的隔离手段（证据在 `frontend/e2e/backend-process.ts`、`frontend/e2e/global-setup.ts`）：子进程设 `HTTP_PROXY`/`HTTPS_PROXY` 指向未监听端口使未知外呼快速失败；剔除 `GROK2API_*`、`TEST_POSTGRES_*`、`TEST_REDIS_*`；globalSetup 在 dist 缺失或早于构建输入时重建，避免测到过期产物。
- 空账号池 `/readyz` 未就绪与管理面可用分别断言。清理只针对测试自有 PID/目录，日志与 trace 不包含真实秘密。
- 判定：`pnpm test:e2e`、`pnpm verify:full`；登录/会话/密码、密钥 CRUD、账号、审计、设置/模型/出口、创作/媒体、语言主题与路由刷新按阶段纳入。

### TEST-6 后端与存储验证（机器门禁）

- **必须在 `backend/` 目录执行**（`backend/scripts/verify.sh` 会校验 cwd，否则退出 2）。单一入口：`bash scripts/verify.sh`，依次执行 `go build ./...` → `go vet ./...` → `go run ./tools/structurecheck` → `go run ./tools/apicheck` → `go test ./... -count=1`，失败即停并透传退出码。
- Linux CI 追加 `go test -race ./...`；CI 的 `go test` 与 `-race` 本身会编译全部包，因此 CI 未再单列 `go build`。
- PostgreSQL/Redis 集成测试使用隔离 CI 服务；启动前确认环境可达，不能用缺环境跳过冒充通过。复用临时 PostgreSQL 数据库和隔离 Redis 命名空间。
- 公开接口注释变化需 `make swagger` 并做精确 diff 校验（`git diff --exit-code -- backend/docs/{docs.go,swagger.json,swagger.yaml}`）；架构重构保持公开协议与前轮回归。
- 判定：命令退出码、测试 JSON 中失败/跳过明细及 CI 真实结果。环境不足准确标记 `Blocked`，不得记为 `Passed`。

### TEST-7 测试必须对缺陷有判别力（评审准则，优先自动化）

- 任何用例/断言必须对目标缺陷有判别力：对「疑似错误变体」（`||` 合并、`>0` 改 `==0`、字段顺序调换、守卫反转）注入后，至少一个用例必须失败。属性断言、空转用例、被 lint/typecheck 排除的文件不算覆盖。
- 判定：overlay 变体或等价反例证据（记录于 AUDIT）。

## 4. 代码审查（REV）

### REV-1 单文件不超过 600 行（前后端双侧机器门禁）

- 新增或完成重构的 `.ts`/`.tsx` 与生产 Go 文件 ≤600 行；存量豁免必须在阶段基线中明确，不得把未超限文件推过阈值。
- 判定：前端 `pnpm check:structure`（扫描 `src/**/*.ts(x)`，排除 `*.test.*`/`*.spec.*`/`*.d.ts`）与后端 `go run ./tools/structurecheck`（排除 `*_test.go`、`docs/`、`testdata/`）。
- 行数仅是边界，不是只搬文件即可通过的理由。测试文件不在该门禁范围内（存量 >600 行测试文件登记在 `frontend/AUDIT.md` 的未达标/未覆盖章节）。

### REV-2 函数不超过 50 行（前后端双侧机器门禁）

- 新增或完成重构的函数、组件、回调 ≤50 行；拆分应命名实际职责，不能生成无语义 helper（后者为评审准则）。
- 判定：同 REV-1 的两个工具；未完成阶段的旧函数不得继续扩大。
- 已知口径边界（登记为 P2，不得据此声称已全覆盖）：前端 `check-structure.mjs` 只对**具名**函数/方法/具名回调按函数体行数判定，匿名内联回调的行数不单独判定（其嵌套计入 REV-3 的口径差异）；后端 `structurecheck` 按函数体行数计算（含签名）。

### REV-3 控制流嵌套最多 3 层（前后端双侧机器门禁）

- `if`/`for`/`try`/三元链最多 3 层，优先提前返回、明确条件与职责拆分。
- 统一口径：计入 `if`（含 `else` 分支，但 **`else if` 与 `if` 同层**）/ `for` / `range` / `switch` / type switch / `select`；`case` / `comm` 子句体不额外加层；`else { if ... }` 比 `else if` 多一层，属有意保留的不对称口径。两侧对**具名**作用域与 `case` / `comm` / `else if` 的口径完全一致；函数字面量两侧都参与判定，但**深度基线不同**：后端 `structurecheck` 把函数字面量当独立作用域、从 0 起算深度并上报为 `<closure>`（键含定位）；前端 `check-structure.mjs` 不为其新建键，而是把匿名回调体内的嵌套累加到最近外层具名作用域的当前深度上。**这是已登记的口径差异（P2，不是漏报）**：同一段代码，当匿名回调出现在已有 1 层嵌套的位置时，前端报 5 层、后端报 4 层，两侧都会判失败。
- 判定：同 REV-1 的两个工具，> 3 层即失败，存量由两侧 `structure-baseline.json` 棘轮冻结。
- **「0 越限」必须附带参与判定的作用域总数**，以证明不是漏报通道造成的假通过（§10 的 EVID-3）。两个工具均已输出该行：`参与判定的作用域（REV-3）：N 个`；当次实测值以工具输出为准，历次实测与口径见 `frontend/AUDIT.md` / `backend/AUDIT.md`（META-3：逐轮实测不写在本文件）。

### REV-4 使用业务命名（评审准则）

- 禁止无意义 `xxx2`、`newXxx`、`finalXxx`、`tempXxx`、`oldXxx`；`newPassword` 等确属业务含义的名称可保留。
- 判定：辅助检索 `rg -n "\b(new|final|temp|old)[A-Z]"`，命中逐项说明，不对文本误报机械改名。

### REV-5 产物与性能预算

| 指标                                       |           硬阈值 |
| ------------------------------------------ | ---------------: |
| 登录首屏关键 JS 依赖闭包（含必需语言资源） |     260 KiB gzip |
| 业务路由相对基础资源的新增 JS 依赖闭包     |     180 KiB gzip |
| 全部生产 JS（去重）                        |     650 KiB gzip |
| 全部生产 CSS                               |      20 KiB gzip |
| 单个 JS chunk                              | 500 KiB 原始体积 |

- 前端（机器门禁）：KiB=1024 B，gzip 使用固定参数。共享依赖去重；结合浏览器资源记录检查，不能只拆 chunk 绕预算。关键体积比冻结基线增长 >5% 必须解释处理，不自动提高阈值。压缩体积不等于服务器已开启传输压缩。
- 判定：`pnpm check:budget`（基线 `frontend/bundle-budget.json`；`--update` 须满足 CHG-5）。
- 后端性能（`ns/op`、`B/op`、`allocs/op`、查询次数）：**评审准则，无门禁**。性能比较同环境重复测量；稳定回退 >10% 必须查明；不为提速牺牲事务、安全、审计或一致性；无实测收益则不声称优化成功。

## 5. 债务与基线（棘轮）

- 本文件只登记**当前基线**与指针；历史演进、逐轮实测与更正记录见 `frontend/AUDIT.md`、`backend/AUDIT.md`（§12）。
- 结构基线（REV-1/REV-2/REV-3）：`frontend/structure-baseline.json` 与 `backend/structure-baseline.json` 的 `files`/`functions`/`nesting` **当前均为空**（复现：`pnpm check:structure`（`frontend/`）、`cd backend && go run ./tools/structurecheck`）→ 存量 0 项，只允许持平或下降；新增越限即违规。
- 契约基线：`backend/api-baseline.txt`（由 `go run ./tools/apicheck --update` 生成）；当前条数以 `go run ./tools/apicheck` 的输出为准（数字不在此复制，META-2）。
- 前端跨 feature 依赖：`frontend/.dependency-cruiser.cjs` 的 `frozenCrossFeatureDebt` 为空对象 → 任何新增跨 feature 直接依赖即违规。
- 覆盖率与用例数、体积实测值、hook 阈值条目数：以 `pnpm test:ui:coverage`、`pnpm check:budget` 的当次输出为准，历史值见两个 AUDIT。
- 测试分层现状（已决策接受）：`pnpm test` 运行纯逻辑 `src/**/*.test.ts`（node:test，Node 环境），`pnpm test:ui:coverage` 运行组件/集成 `src/**/*.test.tsx`（Vitest + jsdom）。双运行器不迁移（理由见 `frontend/AUDIT.md` 的 FE-08）。
- 已登记的 P2/P3 未收口项（含前端 >600 行测试文件、未纳入 100% 阈值的 hook、匿名回调行数不参与 REV-2 判定、REV-3 两侧深度基线差异等）见两个 AUDIT 的「未达标/未覆盖」章节；按 META-4 不阻塞，但不得扩张。
- 棘轮更新必须满足 CHG-5：只在工作区静止时执行，并记录 `git rev-parse HEAD` 与在跑任务数。

## 6. 文档与验收状态

- 编号稳定性（条目废弃保留编号、不复用）与规则变更的同步要求见 META-5。
- 问题记录包含编号、`file:line`/日志证据、现有/新增、影响、优先级、阶段、验证方法、结果与回滚点。
- P0：安全、数据损坏、范围/计费/审计不变量失效，立即阻塞。
- P1：必需检查失败/未运行、预算或新架构违规、生产环境隔离失败，阶段验收阻塞。
- P2：已登记且未扩张的计划内存量债务；P3：无缺陷证据的建议，不无限扩大任务。
- `Passed`、`Failed`、`Skipped`、`Blocked` 分别记录，语义见 §10 的 EVID-1/EVID-2。CI 未实际完成、测试只定义未执行、Quality Guard 只写配置均不能记为通过。
- 自审只列相关风险：修改与保留文件、复用点/新增抽象理由、边界与重复逻辑、权限/并发/事务/性能/失败处理、测试、未覆盖风险及按阶段提交回滚。

## 7. 验证入口

```powershell
# frontend/（pnpm verify 已串联全部前端门禁）
pnpm install --frozen-lockfile
pnpm verify
# 单项复查
pnpm typecheck
pnpm check:architecture
pnpm check:structure
pnpm test:gates
pnpm check:budget
# 阶段 2 起：pnpm verify:full（质量门禁 + 真实全栈 E2E）

# backend/（必须在 backend/ 目录执行；verify.sh 会校验 cwd，否则退出 2）
bash scripts/verify.sh
# 单项复查
go build ./...
go vet ./...
go run ./tools/structurecheck   # REV-1/REV-2/REV-3 结构门禁（基线棘轮，--list 输出工作清单）
go run ./tools/apicheck         # 导出 API 面契约门禁（基线 backend/api-baseline.txt）
go test ./... -count=1
# 支持 race 的 Linux/CI 工具链
go test -race ./...

# 仓库根：检查改动边界与目标远端
git diff --check
git diff --numstat
git remote -v
```

独立命令、覆盖范围、环境限制、性能基线与实际运行结果参见 [前端审计](frontend/AUDIT.md)、[后端审计](backend/AUDIT.md)。

## 8. 发布流程（REL）

- 版本载体：仓库根 `VERSION` 是唯一权威版本源（`Dockerfile:66` 把它复制到镜像 `/app/VERSION`，`backend/internal/buildinfo/version.go` 的 `CurrentVersion()` 读取它）；`frontend/package.json` 的 `version` 必须与 `VERSION` 处于同一条版本线，二者不一致按文档缺陷处理。该一致性由 CI 步骤「Verify version carriers are aligned」强制。
- 发布前置（缺一不可，未实际完成不得记为 `Passed`）：目标提交上前端 `pnpm verify`、后端 `go test ./... -count=1` / `go vet ./...` / `go build ./...` 退出 0；`ghcr-image.yml` 的 Verify job 在远端真实跑完（含 race、PostgreSQL/Redis 集成用例 0 跳过、Swagger 精确 diff、全栈 E2E）。
- 发布步骤：① 把维护分支 fast-forward 合并到 `main` 并推送 `origin`；② 打 annotated tag `vX.Y.Z` 并推送；③ 创建同名 GitHub Release，说明引用 `frontend/AUDIT.md` / `backend/AUDIT.md` 的验收结论；④ 等待 `ghcr-image.yml` 的 `build_ghcr_image` 与 `merge` 产出 `ghcr.io/<owner>/grok2api:vX.Y.Z` 的 amd64/arm64 与 manifest list。
- 发布后登记（必须附 run id + step + conclusion，见 EVID-2）：在两个 `AUDIT.md` 中记录 tag、commit sha、CI run id 与镜像 digest；任何未达成的环节按 §6 记为 `Blocked`/`Failed` 并写明精确补救步骤，不得以「配置已写好」代替。
- 固有局限（必须一并登记）：tag 指向发布提交，其 `AUDIT.md` 不含 tag run 之后的登记；如需 tag 自带登记只能重打 tag（不可逆，默认不做）。
- 授权与边界：合并 `main`、创建 tag/Release、推送镜像、删除/重建远端仓库或容器包属不可逆操作，逐次单独授权；`upstream` 永不推送。执行前必须逐项列出并确认外部依赖（CI 包权限、Secrets、Release、Webhook、镜像 tag、下游消费者），无法确认则阻塞（§11 的 CHG-9）。
- 绑定事实：`ghcr.io` 容器包必须与 `origin` 仓库建立链接，否则 `GITHUB_TOKEN` 即使声明 `packages: write` 也会以 `permission_denied: write_package` 失败（证据与根因见 `backend/AUDIT.md` §11）。

## 9. 执行与委派纪律（EXEC）

> 适用主体：自动化代理（含子代理）。来源：本项目多轮会话中最高频的重复错误是「以等待代替推进」与「子任务无时长预算」。

### EXEC-1 不阻塞等待（评审准则）

外部系统（CI、子代理、远端）未返回时，必须在同一时间窗内推进至少一项与之不冲突的工作；禁止把等待本身当作进展。

### EXEC-2 单次阻塞有界（评审准则）

单次工具调用的阻塞上限 120s。禁止在参数中出现 `AddMinutes(>3)`、`Start-Sleep -Seconds >180`、`TaskWait timeoutSeconds >180`。长等待必须拆成短查询后返回，并在返回后推进其它工作。

### EXEC-3 子任务 ≤20 分钟且必须可交付（评审准则）

派发子代理时必须同时给出三项：**≤20 分钟可交付的最小产出**、**文件/目录级所有权边界**、**自检命令与期望输出**。单任务墙钟超过 1200s 即违规。

### EXEC-4 并发有界，容量错误立即改批次（评审准则）

并发上限 10。收到「已达并发上限」类错误后必须改变批次大小或先收敛，禁止原样重试；同一容量错误连续出现 ≥2 次即违规。

### EXEC-5 并行写者互斥（评审准则）

同一文件/同一包同一时刻只允许一个写者；子代理只对自己拥有的包做结论；全量 build/test 只在全部写者收敛后跑一次。

### EXEC-6 断点可续跑（评审准则）

长任务必须把进度落盘（计划/清单文件），使 turn 中断（超时、空响应、被中止、上下文压缩）后可从文件恢复。同一阻塞项连续汇报 ≥2 次后，必须改为「列出需用户操作的最小清单 + 转做其他可推进工作」（取证：一次会话内出现 9 个连续空响应与 3 次 `EMPTY_MODEL_RESPONSE`，用户随后连续 25 次「继续执行」；本批取证未观察到压缩记录，但该要求对压缩同样适用）。

### EXEC-7 默认值推进（评审准则）

待决策项按各节推荐默认值执行并登记假设，不因等待确认而停顿；只有不可逆、越权或安全类决策才停下。

### EXEC-8 不递归委派（评审准则）

子代理不得再派发子代理；一个任务只有一个负责人。

## 10. 证据与验收（EVID）

> 适用主体：自动化代理、人类贡献者。来源：重复错误「把发起/配置/静态读取当成已验证」。

### EVID-1 未运行不得称通过（评审准则，可检索）

`Passed` 只能来自**实际执行**的命令。配置已写好、脚本已存在、静态读取到步骤 → 只能记 `Pending` 或「部分实施」。其余状态：`Failed` = 命令实际执行且退出码非 0 或断言失败；`Skipped` = 命令主动跳过且必须记录跳过原因；`Blocked` = 因环境/外部依赖不足未执行，必须写明精确原因与可复现命令；四者不得互相替代。

### EVID-2 Passed 三要素（评审准则，可检索）

每个 `Passed` 必须附：**命令原文 + 退出码 + 关键输出片段**；CI/发布类还必须附 **run id + step 名 + conclusion**。

### EVID-3 门禁工具必须自证（机器门禁）

新增或修改任何门禁工具时，必须同时提供：口径边界清单（哪些构造计入/排除）+ 正样本（应通过）+ 负样本（应失败）夹具，并证明「0 越限」不是漏报（附参与判定的作用域/文件总数）。无夹具的新门禁不得合并。
判定：`pnpm test:gates`（`frontend/scripts/self-test-gates.mjs`）与工具自测用例。

### EVID-4 度量必须交叉对账（评审准则）

用于决策或派发的度量，必须同时给出「夹具证明会失败」与「与独立实现（另一工具/另一口径）在同一输入上一致」；自写临时脚本的结论只能标为「待验证」，不得作为基线或派活依据。

### EVID-5 判定用命令自身退出码（评审准则）

不得用执行框架的 `exitCode` 字段代替命令退出码（命令向 stderr 写内容会被误判为失败）。判定必须读取命令自身的退出码（`$LASTEXITCODE` 或显式回显）。

### EVID-6 结论自洽（评审准则）

同一次汇报内不得同时出现互相否证的结论（例如「CI 全绿」与「该 job 必然失败」）。

### EVID-7 子代理产物必须复核（评审准则）

主代理登记任何状态前，必须逐项核对子代理报告中的「未验证/未执行」段；未验证项不得进入 `Passed`，也不得夹带进文档。

### EVID-8 失真立即更正并留痕（评审准则，可检索）

发现已登记数字/状态与实际不符时，必须在同一次改动内更正，并写明「原值 → 新值 → 根因 → 复现命令」；历史快照章节保留原值，只加指针。

### EVID-9 CI 通过 ≠ 已交付（评审准则）

CI 变绿只证明检查通过，不证明已交付。CI 通过后必须在同一轮内完成合并/推送，或明确登记「未合并原因 + 阻塞解除条件」；不得把「CI 已绿」当作完成状态（取证：用户投诉「CI 已经完成，且正确，没有合并，当前 main 分支 CI 有报错」，而当时该 run 的 `conclusion=success`）。

## 11. 变更与提交纪律（CHG）

### CHG-1 单一目的提交（评审准则）

一次提交只做一件事，可独立回滚；禁止把格式调整、重命名、依赖升级与行为变更混在同一提交。提交信息使用 Conventional Commits（`feat|fix|refactor|perf|test|docs|chore|ci`）。

### CHG-2 搬运与重写分离（评审准则）

被改函数必须标注 `搬运`（逐字等价）或 `重写`（语义可能变化）；`重写` 必须单独提交、单独审查、逐条列出差异。禁止在以「纯搬运/行为不变」声明的改动中夹带重写。

### CHG-3 行为等价必须有判别力证据（评审准则）

拆分/搬运必须提供：编译期签名一致 + 契约基线（`backend/api-baseline.txt`）不变 + 相关测试计数不变 + 对「疑似错误变体」至少一个用例失败（§3 的 TEST-7）。

### CHG-4 禁止为过门禁而放宽（评审准则，可检索）

禁止为让门禁变绿而：放宽阈值/超时/worker 数、删除或弱化断言、扩大排除范围、把失败文件移出 include、在基线中加入新增越限。此类改动必须给出独立理由与前后实测值。

### CHG-5 棘轮基线只许在静止状态更新（评审准则）

`--update` 类基线收缩只能在**工作区静止**时执行（无在跑子代理、`git status` 稳定），并记录 `git rev-parse HEAD` 与在跑任务数。

### CHG-6 同类缺陷必须全量扫描（评审准则）

修复一个缺陷后必须检索同类（同一模式、同一调用面）并一次性处理或登记；禁止只修被点名的那一处。修复提交说明「同类扫描范围 + 命中数 + 未处理项」。

### CHG-7 根因追到可验证层（评审准则）

诊断必须给出**最小复现**与**证据链**；禁止以第一层归因结案（例：把「镜像推送被拒」归因为「供应链策略」，实为「容器包与仓库未建立链接」）。

### CHG-8 生成物与派生文件不手改（评审准则）

`backend/docs/**`、`frontend/pnpm-lock.yaml`、两侧 `structure-baseline.json`、`backend/api-baseline.txt`、`frontend/bundle-budget.json` 只能由其生成命令改写，并在同一次改动内跑对应校验。

### CHG-9 不可逆操作（评审准则）

见 §8 与 §13 的 SEC-4：删除/重建远端仓库、tag、Release、容器包、合并 `main`、生产部署，必须逐次授权并逐项确认外部依赖。

### CHG-10 文本改写安全（评审准则）

批量改写文件（尤其含中文/多字节的 YAML/Markdown）必须：先记录 `git status --porcelain` 基线 → 用编辑工具或显式 UTF-8（无 BOM）写入 → 改写后校验改动文件集等于预期集合、编码与换行未被改变 → 跑该文件类型的解析/校验门禁。
判定：`git diff --numstat` 与预期集合一致；无 BOM/乱码。
- `-w` 类批量改写器（`gofmt -w`、`prettier --write`、`oxlint --fix`）同受本条约束：在 CRLF 检出上执行前先记录基线，执行后必须核对改动文件集等于预期集合（取证：`gofmt -w` 曾因 `core.autocrlf` 重写整包文件，需 `git checkout --` 回滚）。

### CHG-11 临时文件不入库（评审准则，可检索）

调试用临时脚本/测试只能放在会话 scratch 目录；提交前 `git status --porcelain` 不得出现 `zz-*`、`__probe*`、`tmp-*` 等调试产物。

## 12. 文档分层（DOC）

| 层         | 载体                                    | 放什么                                 | 不放什么                       |
| ---------- | --------------------------------------- | -------------------------------------- | ------------------------------ |
| 规范       | `AGENTS.md`                             | 规则、判定命令、稳定的绑定事实         | 历史演进、债务计数、一次性证据 |
| 证据与状态 | `frontend/AUDIT.md`、`backend/AUDIT.md` | 逐轮实测、债务清单、更正记录、发布登记 | 新规则                         |
| 计划       | `.pi/plan/*.md`（本机，**不入库**）     | 阶段性计划与决策点                     | 规范                           |
| 变更历史   | git 提交信息 + GitHub Release           | 每次发布的变更摘要                     | 规范                           |

### DOC-1 单一事实来源（评审准则）

同一事实只在一处定义（阈值、命令、版本、条数）；其他位置只能引用，不得复制数字。

### DOC-2 历史快照不可改写（评审准则）

已登记的轮次结论与历史 tag 记录保留原值；被取代时只追加指针（「由 X 承接」）。

### DOC-3 计划的可追溯性（评审准则）

被引用的计划若不在仓库内（`.pi/` 被 `.gitignore` 忽略），必须在引用处说明其不可追溯；实施与计划漂移必须在同次改动内更正计划或登记偏离。

## 13. 安全与供应链（SEC）

### SEC-1 秘密（P0，评审准则 + 可检索）

禁止把秘密写入仓库、日志、测试夹具或 `VITE_*`（会进产物）；开发代理目标不得污染生产回退。辅助检索 `rg -n "VITE_.*(KEY|SECRET|TOKEN)"`。

### SEC-2 供应链（P1，评审准则）

CI 的 `uses:` 已全部固定到 commit SHA（`.github/workflows/` 下每条均形如 `owner/repo@<40 位 sha> # vX.Y.Z`；核验命令 `rg -n "uses:" .github/workflows`）；**新增或更新 action 时必须继续固定到 SHA，不得退回 tag**。新增依赖须说明现有能力不足、版本兼容性、许可证、体积与回滚方式；`frontend/pnpm-workspace.yaml` 的 `minimumReleaseAge` 策略不得为个别包随意放宽。

### SEC-3 外部调用与网络（P0，评审准则）

未知外呼必须快速失败；禁止放宽 TLS、鉴权、生产 readiness，禁止新增生产后门。判定依据：`frontend/e2e/backend-process.ts` 的隔离配置。

### SEC-4 不可逆副作用（P0，评审准则）

删除或重建远端仓库/容器包/命名空间前，必须逐项列出并确认外部依赖（CI 包权限、Secrets、Release、Webhook、镜像 tag、下游消费者），无法确认则阻塞等待。

## 14. 本项目绑定事实（BIND）

### BIND-1 仓库与远端

`origin` = `https://github.com/JasmineTony/grok2api.git`；`upstream` = `https://github.com/chenyme/grok2api.git`；默认分支 `main`。维护线标签 `v0.1.1`、`v0.1.2`。

### BIND-2 技术栈（版本以文件为准，不在本文件复制）

- 后端：Go 模块 `github.com/chenyme/grok2api/backend`（`backend/go.mod`），Gin + GORM（PostgreSQL / 纯 Go SQLite）+ go-redis；入口 `backend/cmd/grok2api/main.go`；装配入口 `backend/internal/app`。
- 后端分层：`internal/transport/http/**` → `internal/application/**` → `internal/domain/**`；`internal/repository`、`internal/ports` 定义契约，`internal/infra/**` 实现。
- 前端：`frontend/package.json` 声明 `packageManager` 与 Node 要求；React + TypeScript + Vite，服务端状态 TanStack Query，客户端会话状态 Zustand，i18next，react-hook-form + zod。
- 前端分层：`src/app`、`src/features/*`、`src/entities/*`、`src/shared/*`、`src/components/ui`。

### BIND-3 生成物与派生文件（不得手改，见 CHG-8）

| 文件                                                                     | 生成命令                                      | 校验命令                       |
| ------------------------------------------------------------------------ | --------------------------------------------- | ------------------------------ |
| `backend/docs/{docs.go,swagger.json,swagger.yaml}`                       | `make swagger`                                | CI 精确 diff                   |
| `frontend/pnpm-lock.yaml`                                                | pnpm                                          | `pnpm install --frozen-lockfile` |
| `frontend/structure-baseline.json`                                       | `node scripts/check-structure.mjs --update`   | `pnpm check:structure`         |
| `backend/structure-baseline.json`                                        | `go run ./tools/structurecheck --update`      | `go run ./tools/structurecheck` |
| `backend/api-baseline.txt`                                               | `go run ./tools/apicheck --update`            | `go run ./tools/apicheck`      |
| `frontend/bundle-budget.json`                                            | `node scripts/check-bundle-budget.mjs --update` | `pnpm check:budget`          |

### BIND-4 机器门禁表

| 规则         | 判定命令（工作目录）                                                                  | 基线 / 配置                                                                                | CI 步骤 | 违反后果 |
| ------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------- | -------- |
| DEV-2        | `pnpm typecheck`、`pnpm lint`（`frontend/`）                                          | `frontend/eslint.config.js`                                                                | Verify  | P1       |
| DEV-3        | `pnpm check:architecture`（`frontend/`）                                              | `frontend/.dependency-cruiser.cjs`                                                         | Verify  | P1       |
| DEV-4        | `pnpm verify`（`frontend/`）                                                          | `frontend/package.json` 的 `verify` 脚本                                                   | Verify  | P1       |
| DEV-5        | `pnpm format:check`、`pnpm install --frozen-lockfile`（`frontend/`）                  | `frontend/.prettierrc`、`.gitattributes`（仓库根）                                         | Verify  | P1       |
| TEST-1/2     | `pnpm test:ui:coverage`（`frontend/`）                                                | `frontend/vitest.config.ts`                                                                | Verify  | P1       |
| TEST-3       | CI 步骤 `Assert required integration tests ran`（`.github/workflows/ghcr-image.yml`） | `.github/workflows/ghcr-image.yml`                                                         | Verify  | P1       |
| TEST-5       | `pnpm test:e2e`（`frontend/`）                                                        | `frontend/playwright.config.ts`                                                            | Verify  | P1       |
| TEST-6       | `bash scripts/verify.sh`（`backend/`）                                                | `backend/scripts/verify.sh`、`backend/structure-baseline.json`、`backend/api-baseline.txt` | Verify  | P1       |
| REV-1/2/3    | `pnpm check:structure`（`frontend/`）、`go run ./tools/structurecheck`（`backend/`）  | `frontend/structure-baseline.json`、`backend/structure-baseline.json`                      | Verify  | P1       |
| REV-5        | `pnpm check:budget`（`frontend/`）                                                    | `frontend/bundle-budget.json`                                                              | Verify  | P1       |
| REL 版本载体 | CI 步骤「Verify version carriers are aligned」                                        | `VERSION`、`frontend/package.json`                                                         | Verify  | P1       |
| EVID-3       | `pnpm test:gates`（`frontend/`）                                                      | `frontend/scripts/self-test-gates.mjs`                                                     | Verify  | P1       |

### BIND-5 只有评审准则、没有机器门禁的规则

DEV-1、DEV-3 的复用/职责部分、DEV-5 的编码与文本比对、TEST-4、TEST-7、REV-2 的匿名回调行数边界、REV-4、REV-5 的后端性能、SEC-1…SEC-4、§9 全部、§10 除 EVID-3、§11 全部、§12 全部。
未在上文列出的条目（§0 的 META-1…META-5、§1、§6、§8 除版本载体，以及上述章节中未列入 BIND-4 的部分）同样按评审准则执行。
违反这些条目必须说明理由，**不得声称「已由门禁保证」**。

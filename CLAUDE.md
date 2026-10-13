# CLAUDE.md — 仓库入口索引与操作习惯

| 项       | 内容                                                                                                     |
| -------- | -------------------------------------------------------------------------------------------------------- |
| 目标读者 | 进入本仓库的自动化代理（Claude Code 等）与人类贡献者；首次接触本仓库、需要「先读什么、怎么跑命令」的人   |
| 覆盖范围 | 权威层级与读取顺序、仓库事实、工程实践→载体的映射、全仓文档地图、可执行命令、变更与证据纪律、反模式清单  |
| 不放什么 | 规则本体、任何阈值/条数/版本号/用例数/实测值；需要当前值时读定义它的文件或跑命令（DOC-1 / META-2）        |
| 文档状态 | 入口索引；规则 SSOT 是 [`AGENTS.md`](AGENTS.md)，当前状态是两份 `AUDIT.md` 的 A–E 区                     |

本文件不复制规则。规则（做什么、怎么判定、违反后果）的唯一事实来源是 [`AGENTS.md`](AGENTS.md)；两者冲突时一律以 `AGENTS.md` 为准，并在同一次改动内修正本文件。

## 0. 权威层级与读取顺序

| 优先级 | 载体                                              | 放什么                                                                       |
| ------ | ------------------------------------------------- | ---------------------------------------------------------------------------- |
| 1      | `AGENTS.md`                                       | 规则、判定命令、稳定的绑定事实                                               |
| 2      | `frontend/AUDIT.md`、`backend/AUDIT.md` 的 A–E 区 | **当前状态快照**、未达标登记、发布登记、授权登记、主题索引                    |
| 3      | 同上两文件的「历史档案」区（原编号，append-only） | 逐轮实测与更正记录（只在追溯根因时读）                                       |
| 4      | `docs/`（PRD / TD / implementation-plan）         | 产品需求、技术设计、实施细节（**派生文档**，非规则 SSOT）                     |
| 5      | 本文件                                            | 入口索引与操作习惯（冲突时以 `AGENTS.md` 为准）                              |
| —      | `.pi/plan/*.md`                                   | 阶段计划，**不入库**（被 `.gitignore` 忽略）；引用时须说明其不可追溯（DOC-3） |

**稳定锚点**：`AGENTS.md` 的 §0–§14 章节编号与规则编号（`META-n`/`DEV-n`/`TEST-n`/`REV-n`/`REL-n`/`EXEC-n`/`EVID-n`/`CHG-n`/`DOC-n`/`SEC-n`/`BIND-n`）是全仓引用目标（引用计数与复现命令见 `AGENTS.md` §7），**不要重排、不要复用**。两个 `AUDIT.md` 的历史档案编号（如 `frontend/AUDIT.md` §24.2、`backend/AUDIT.md` §25.2）被脚本、测试断言与 `AGENTS.md` 引用，同样不得重排（META-5）。

**引用约定**（DOC-4）：`AGENTS.md` → AUDIT 用主题指针（「见 `frontend/AUDIT.md` D 区」）；AUDIT → 规则用规则编号；AUDIT 互引用用「文件 + 原编号」。

## 1. 仓库事实

- 定位：`chenyme/grok2api` 的衍生维护线。`origin` = `JasmineTony/grok2api`（HTTPS 取 / SSH 推），`upstream` = `chenyme/grok2api`（只读参考），默认分支 `main`；**禁止推送 `upstream`**（BIND-1）。
- 上游对外契约优先，其载体是 `backend/api-baseline.txt`、`make swagger` 的精确 diff、以及 E2E 用例固定的公开协议；偏离须说明理由、影响与回滚方式。
- 后端：Go，版本以 `backend/go.mod` 为准；入口 `backend/cmd/grok2api/main.go`；唯一装配入口 `backend/internal/app`。
  - 依赖方向：`internal/transport/http` → `internal/application` → `internal/domain`；`internal/repository`、`internal/ports` 定义契约，`internal/infra/**` 实现。
- 前端：React + TypeScript + Vite，版本与包管理器以 `frontend/package.json` 为准（`packageManager` 声明 pnpm）。
  - 依赖方向：`src/app` 组合 `src/features/*`；feature 消费 `src/entities/*` 的公共领域契约与 `src/shared/*`；`src/components/ui` 是基础原语。**下层不得反向引用上层**。
- 配置：`config.example.yaml` 是示例；生产配置不提交，秘密不进仓库、日志、测试夹具与 `VITE_*`（SEC-1）。

### 生成物（不得手改，只能由命令改写）

完整表（含生成命令与校验命令）见 `AGENTS.md` 的 BIND-3；棘轮基线只允许持平或下降，`--update` 只在**工作区静止**时执行，并记录 `git rev-parse HEAD` 与在跑任务数（CHG-5）。

## 2. 工程实践 → 本项目载体

六条主线与 `AGENTS.md` 的「导航：六条工程主线」表一一对应；本表只给载体与判定入口，规则本体不在此复制。

| 实践         | 载体 / 判定                                                                                                                                |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 单一事实来源 | 规则进 `AGENTS.md`，现状与证据进两个 `AUDIT.md` 的 A–E 区，历史留痕进档案区，授权登记进 `backend/AUDIT.md` D 区，计划不入库（DOC-1…4）      |
| 职责分层     | 后端 Transport → Application → Domain；前端 app → features → entities/shared；`pnpm check:architecture`（DEV-3、REV-1…4）                   |
| 边界校验     | 外部输入在 transport 层解码校验；类型契约显式、错误路径可见；未知外呼快速失败（DEV-2、DEV-3、DEV-5、SEC-3）                                |
| 最小权限     | 秘密不入库/日志/夹具/`VITE_*`；CI action 固定到 commit SHA；不可逆操作逐次授权（SEC-1…4、CHG-9）                                            |
| 行为验证     | `pnpm verify`、`pnpm verify:full`、`bash scripts/verify.sh`；测试必须对缺陷有判别力（DEV-4、TEST-1…7、REV-5、EVID-3）                      |
| 可追溯交付   | 每轮新分支、单一目的提交、生成物不手改、状态与证据一一对应（CHG-1…12、EVID-1…9、EXEC-1…8、REL-1）                                          |

机器门禁的完整命令表与违反后果见 `AGENTS.md` 的 BIND-4；只有评审准则、没有门禁的条目见 BIND-5。

## 3. 文档地图

| 文档                             | 角色             | 什么时候读                                             |
| -------------------------------- | ---------------- | ------------------------------------------------------ |
| `AGENTS.md`                      | 规则 SSOT        | 决定「能不能这么做、怎么判定、违反了怎么办」           |
| `CLAUDE.md`（本文件）            | 入口索引         | 第一次进入仓库、需要命令与纪律速查                     |
| `frontend/AUDIT.md` A–E 区       | 前端当前状态     | 需要当前覆盖率/体积/结构/未达标项/发布登记             |
| `backend/AUDIT.md` A–E 区        | 后端当前状态     | 需要当前结构/契约/测试/性能基线/未达标项/发布与授权登记 |
| 两个 `AUDIT.md` 的历史档案区     | 逐轮证据留痕     | 追溯根因、核对「当时为什么这么改」（append-only，勿回改） |
| `docs/PRD.md`                    | 产品需求         | 判断需求边界、非目标、优先级                           |
| `docs/TD.md`                     | 技术设计         | 判断架构、数据、接口契约、一致性与并发设计             |
| `docs/implementation-plan.md`    | 实施细节         | 判断工作项、验收标准、提交序列、风险与回滚             |
| `README.md` / `README.zh-CN.md`  | 面向用户的使用说明 | 部署、配置、对外能力                                |
| `backend/README.md` / `frontend/README.md` | 分侧开发说明 | 该侧的命令、测试分层、门禁维护方式                  |
| `.pi/plan/*.md`                  | 阶段计划         | 了解历史计划与决策点（**不入库**，引用须说明不可追溯） |

- `docs/` 三份是**派生文档**：不是规则 SSOT，也不承载实测值；与 `AGENTS.md`、两个 `AUDIT.md` 冲突时以后者为准，并在同一次改动内修正派生文档。
- 同一事实只在一处定义：阈值/条数/命令/版本以定义它的文件或命令输出为准（DOC-1、META-2）。

## 4. 命令

前端（工作目录 `frontend/`）：

```powershell
pnpm install --frozen-lockfile
pnpm verify        # 串联全部前端质量门禁（步骤清单见 AGENTS.md 的 DEV-4）
pnpm verify:full   # verify + 真实全栈 E2E + E2E 报告门禁
```

单项复查（脚本名以 `frontend/package.json` 为准）：`pnpm check:version`、`pnpm format:check`、`pnpm oxlint`、`pnpm lint`、`pnpm typecheck`、`pnpm typecheck:e2e`、`pnpm test`、`pnpm test:results:node`、`pnpm test:ui:coverage`、`pnpm test:results`、`pnpm check:architecture`、`pnpm check:structure`、`pnpm test:gates`、`pnpm build`、`pnpm check:budget`、`pnpm test:e2e`、`pnpm test:results:e2e`。

- 双测试运行器是既定现状：纯逻辑测试走 node:test，组件/集成测试走 Vitest + jsdom（见 `AGENTS.md` 的 TEST-1/TEST-2 与 §5），不要只跑其中一个就当作已覆盖。
- 首次运行 E2E 需安装浏览器：`pnpm exec playwright install`。
- 根目录 `AGENTS.md`、`CLAUDE.md`、`Makefile`、`Dockerfile`、`VERSION`、`docs/**`、`.github/**` 不在前端 Prettier/ESLint 的覆盖范围内（`format:check` 的 cwd 是 `frontend/`），改动这些文件后需自行核对格式与编码。

后端（**必须在 `backend/` 目录执行**，否则 `verify.sh` 退出 2）：

```bash
bash scripts/verify.sh
```

单项复查：`go build ./...`、`go vet ./...`、`go run ./tools/structurecheck`、`go run ./tools/apicheck`、`go run ./tools/dockerfilecheck`、`go test ./... -count=1`、`go test -race ./...`。

仓库根：`git diff --check`、`git diff --numstat`、`git remote -v`。

## 5. 常见任务入口

| 任务                           | 先做什么                                                                                                             | 完成前必须                                                                   |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 改前端业务组件 / 页面          | 先检索同 feature 的既有组件、query hook、decoder 与表格（DEV-3），复用而非新建                                        | 补/改测试（含 testid、role、可访问名称、键盘）；跑 `pnpm verify`             |
| 改后端用例 / 仓储 / Provider   | 先确认所属层与既有 use case、事务、锁、任务池、取消语义（DEV-3）                                                      | 跑 `bash scripts/verify.sh`；契约变化跑 `make swagger` + 精确 diff           |
| 新增或修改门禁工具             | 先定口径边界清单（计入/排除）                                                                                         | 正样本 + 负样本夹具，并证明「0 越限」不是漏报（EVID-3）；跑 `pnpm test:gates` |
| 收口未达标项 / 债务            | 先读两个 `AUDIT.md` 的 C 区，确认定级与棘轮约束                                                                        | 只允许持平或下降；基线更新须满足 CHG-5（工作区静止）                         |
| 发布新版本                     | 先读 `AGENTS.md` §8 的发布前置与 `backend/AUDIT.md` D 区（含授权登记）                                                 | 版本载体一致 + CI 真实 run 结果；未完成记 `Blocked`/`Failed`（EVID-2）       |
| 改文档                         | 先确认该事实的定义处（DOC-1）：规则→`AGENTS.md`，状态→`AUDIT.md` A–E 区，历史→档案区（只增不改）                        | 不复制数字；引用用规则编号/主题指针；不重排稳定锚点（META-5）                |
| 排障 / 定位根因                | 先给最小复现与证据链                                                                                                  | 追到可验证层，不用第一层归因结案（CHG-7）；同类缺陷全量扫描（CHG-6）         |

## 6. 变更与交付纪律

- 每轮（一个可独立交付的批次）从当前集成分支切**新分支** `maint/<主题>-<日期>[-<轮次>]`；不在上一轮已用分支上继续堆积新批次（CHG-12）。
- 提交信息用 Conventional Commits（`feat|fix|refactor|perf|test|docs|chore|ci`），一次提交只做一件事、可独立回滚；格式调整与行为变更分开（CHG-1）。
- 搬运与重写分离：被改函数标注 `搬运`（逐字等价）或 `重写`（语义可能变化），`重写` 单独提交、单独审查（CHG-2）。
- **不得为过门禁而放宽**：不提高阈值/超时、不删弱化断言、不扩大排除范围、不把失败文件移出 include、不在基线中加入新增越限（CHG-4）。
- 改动落地即验：每次改代码后在同一次改动内跑受影响门禁，不留到阶段收尾批量返工（DEV-4）。
- 修一个缺陷后检索同类模式与同调用面，一次性处理或登记；根因要追到可验证层并给最小复现（CHG-6 / CHG-7）。
- 临时/调试脚本只放会话 scratch 目录，提交前 `git status --porcelain` 不得出现调试产物（CHG-11）。
- 不可逆操作（合并 `main`、tag/Release、推送镜像、删除或重建远端仓库/容器包、生产部署）**逐次单独授权**，执行前逐项列出并确认外部依赖（CHG-9 / SEC-4；授权登记见 `backend/AUDIT.md` D 区）。

## 7. 证据契约

- `Passed` 只能来自**实际执行**的命令，必须附：命令原文 + 退出码 + 关键输出片段；CI/发布类另附 run id + step 名 + conclusion（EVID-1 / EVID-2）。
- 配置已写好、脚本已存在、静态读到步骤 → 只能记 `Pending` 或「部分实施」；`Failed` / `Skipped` / `Blocked` 分别记录，**不得互相替代**。
- 判定必须读命令自身的退出码（`$LASTEXITCODE` 或显式回显），不要用执行框架的 `exitCode` 字段（EVID-5）。
- 同一次汇报内不得出现互相否证的结论；发现已登记数字/状态失真，同次改动内更正并留痕（原值 → 新值 → 根因 → 复现命令，EVID-6 / EVID-8）。
- 子代理报告中的「未验证/未执行」项不得进入 `Passed`，也不得夹带进文档（EVID-7）。
- **CI 通过 ≠ 已交付**：CI 变绿后须在同一轮完成合并/推送，或明确登记「未合并原因 + 阻塞解除条件」（EVID-9）。

## 8. 编码与文本安全

- 禁止用 shell 文本工具做编码/行数敏感判定：`Get-Content` 在无 BOM 的 UTF-8 文件上会少算行数，默认 ANSI 解码会产生假差异。行数与编码判定一律用字节级读取（`ReadAllBytes` / `[System.IO.File]::ReadAllText($p, [System.Text.Encoding]::UTF8)`）或解析器（`go/ast`、TS AST），比较前先归一化 CRLF 与编码（DEV-5）。
- 本机可能没有 `rg`：检索优先用 `git grep -nE "<pattern>" -- <path>`（只扫已跟踪文件，避免 node_modules 噪声），必要时回退 `Select-String`。
- 仓库存储换行由 `.gitattributes` 统一为 LF；Prettier 是前端格式的唯一来源，不得夹带无关批量格式化。
- 批量改写（含 `gofmt -w`、`prettier --write`、`oxlint --fix`）：先记录 `git status --porcelain` 基线 → 用编辑工具或显式 UTF-8（无 BOM）写入 → 改写后核对改动文件集等于预期集合、编码与换行未变 → 跑该文件类型的解析/校验门禁（CHG-10）。
- 新增 CI action 必须固定到 40 位 commit SHA 并附 `# vX.Y.Z` 注释，禁止浮动 tag/branch 引用（SEC-2）。
- 默认不新增生产依赖、框架、全局/构建/部署配置或顶层目录；确需新增须证明现有能力不可满足（DEV-3）。

## 9. 反模式（看到就停）

- 用默认值、空数组、宽泛 `catch`、静默降级、无条件重试或伪成功状态掩盖未知问题。
- 未使用代码、死分支、占位 TODO、样板包装、第二套业务规则、`xxx2`/`newXxx`/`tempXxx`/`oldXxx` 式命名。
- 拆分巨型组件时只是把它改名为巨型 hook；为过 REV 门禁只搬文件不改职责。
- 把「已写配置 / 已发起 / 静态读到」当作已验证。
- 用 `Skipped`、`Blocked`、未运行或重试后偶然通过代替 `Passed`。
- 跨层绕过既有 use case、service、repository、权限、审计、事务与取消语义约定。
- 为消除外部检查告警而修改被检代码语义或删除日志。
- 重排或复用 `AGENTS.md` 的章节/规则编号，或重排两个 `AUDIT.md` 历史档案的章节编号（会打断仓库内既有引用与门禁断言）。
- 在 `AUDIT.md` 的 A–E 区回填会过期的旧值、或把新规则写进 `AUDIT.md`（违反 DOC-1 / DOC-2）。
- 把阈值、条数、版本号、用例数复制到本文件或 `docs/` 派生文档（应改为指针）。
- 推送 `upstream`；把秘密或推送凭据元数据写进仓库。

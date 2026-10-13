# CLAUDE.md — 仓库入口索引与操作习惯

| 项       | 内容                                                                                                     |
| -------- | -------------------------------------------------------------------------------------------------------- |
| 目标读者 | 进入本仓库的自动化代理（Claude Code 等）与人类贡献者；首次接触本仓库、需要「先读什么、怎么跑命令」的人   |
| 覆盖范围 | 权威层级与读取顺序、仓库事实、工程实践→载体的映射、全仓文档地图、可执行命令、变更与证据纪律、执行与委派纪律、反模式清单 |
| 不放什么 | 规则本体、任何阈值/条数/版本号/用例数/实测值；需要当前值时读定义它的文件或跑命令（DOC-1 / META-2）        |
| 文档状态 | 入口索引；规则 SSOT 是 [`AGENTS.md`](AGENTS.md)，当前状态是两份 `AUDIT.md` 的 A–E 区                     |

本文件不复制规则。规则（做什么、怎么判定、违反后果）的唯一事实来源是 [`AGENTS.md`](AGENTS.md)；两者冲突时一律以 `AGENTS.md` 为准，并在同一次改动内修正本文件。

## 0. 权威层级与读取顺序

下表只回答「先读什么」；每层「放什么 / 不放什么」的定义见 `AGENTS.md` 的「文档契约」表（`docs/` 派生文档的定位见其 §7），本文件不复制。

| 优先级 | 载体                                              | 读取口径                                            |
| ------ | ------------------------------------------------- | --------------------------------------------------- |
| 1      | `AGENTS.md`                                       | 规则 SSOT（放什么见其「文档契约」表）               |
| 2      | `frontend/AUDIT.md`、`backend/AUDIT.md` 的 A–E 区 | **当前状态**入口（各区放什么见 `AGENTS.md` 契约表） |
| 3      | 同上两文件的「历史档案」区（原编号，append-only） | 逐轮留痕，只在追溯根因时读                          |
| 4      | `docs/`（PRD / TD / implementation-plan）         | 派生文档，非规则 SSOT                               |
| 5      | 本文件                                            | 入口索引与操作习惯（冲突时以 `AGENTS.md` 为准）     |
| —      | `.pi/plan/*.md`                                   | 阶段计划，不入库；引用须说明其不可追溯              |

**稳定锚点**：`AGENTS.md` 的 §0–§14 章节编号与规则编号（`META-n`/`DEV-n`/`TEST-n`/`REV-n`/`REL-n`/`EXEC-n`/`EVID-n`/`CHG-n`/`DOC-n`/`SEC-n`/`BIND-n`）是全仓引用目标（引用计数与复现命令见 `AGENTS.md` §7）；两个 `AUDIT.md` 的历史档案编号（如 `frontend/AUDIT.md` §24.2、`backend/AUDIT.md` §25.2）被门禁脚本注释与测试注释、以及 `AGENTS.md` 引用。上述编号一律不得重排或复用（META-5）。

**引用约定**：跨文档引用一律用指针或编号，三种形态的定义见 DOC-4。

## 1. 仓库事实

- 定位：`chenyme/grok2api` 的衍生维护线。`origin` = `JasmineTony/grok2api`（HTTPS 取 / SSH 推），`upstream` = `chenyme/grok2api`（只读参考），默认分支 `main`；**禁止推送 `upstream`**（BIND-1）。
- 上游对外行为契约优先，其载体是 `backend/api-baseline.txt`、`make swagger` 的精确 diff、以及 E2E 用例固定的公开协议；偏离须说明理由、影响与回滚方式。
- 后端：Go，版本以 `backend/go.mod` 为准；入口 `backend/cmd/grok2api/main.go`；唯一装配入口 `backend/internal/app`（技术栈与分层见 BIND-2 / DEV-3）。
- 前端：React + TypeScript + Vite，版本与包管理器以 `frontend/package.json` 为准（`packageManager` 声明 pnpm）；分层与依赖方向见 DEV-3。
- 配置：`config.example.yaml` 是示例；生产配置不提交，秘密不进仓库、日志、测试夹具与 `VITE_*`（SEC-1）。

### 生成物（不得手改，只能由命令改写）

完整表（含生成命令与校验命令）见 `AGENTS.md` 的 BIND-3；手改禁令见 CHG-8。棘轮基线只允许持平或下降，基线现状见 `AGENTS.md` §5、实测值见两个 `AUDIT.md` B 区；`--update` 的执行纪律见 CHG-5。

## 2. 工程实践 → 本项目载体

六条主线与 `AGENTS.md` 的「导航：六条工程主线」表一一对应；本表只给载体与判定入口，规则本体不在此复制。

| 实践         | 载体 / 判定                                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| 单一事实来源 | 规则进 `AGENTS.md`，现状与证据进两个 `AUDIT.md` 的 A–E 区，历史留痕进档案区，授权登记进 `backend/AUDIT.md` D 区，计划不入库（DOC-1…4） |
| 职责分层     | 分层与依赖方向见 DEV-3；结构门禁见 REV-1…4；判定 `pnpm check:architecture`                                                      |
| 边界校验     | 边界层解码校验与错误路径见 DEV-2 / DEV-3 / DEV-5 / SEC-3                                                                          |
| 最小权限     | 秘密与供应链约束见 SEC-1…4；不可逆操作见 CHG-9                                                                                  |
| 行为验证     | `pnpm verify`、`pnpm verify:full`、`bash scripts/verify.sh`；判别力与预算见 TEST-1…7 / REV-5 / EVID-3                            |
| 可追溯交付   | 每轮新分支、单一目的提交、生成物不手改、状态与证据一一对应（CHG-1…12、EVID-1…9、EXEC-1…8、REL-1）                               |

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
pnpm verify        # 串联全部前端质量门禁（DEV-4）
pnpm verify:full   # verify + 真实全栈 E2E + E2E 报告门禁
```

- 单项复查脚本与步骤定义一律以 `frontend/package.json` 的 `scripts` 为准，不在本文件复制；完整单项清单见 `AGENTS.md` §7 与 BIND-4。
- 双测试运行器是既定现状：纯逻辑测试走 node:test，组件/集成测试走 Vitest + jsdom（见 `AGENTS.md` 的 TEST-1/TEST-2 与 §5），不要只跑其中一个就当作已覆盖。
- 首次运行 E2E 需安装浏览器：`pnpm exec playwright install`。
- 根目录 `AGENTS.md`、`CLAUDE.md`、`Makefile`、`Dockerfile`、`VERSION`、`docs/**`、`.github/**` 不在前端 Prettier/ESLint 的覆盖范围内（`format:check` 的 cwd 是 `frontend/`），改动这些文件后需自行核对格式与编码。

后端（**必须在 `backend/` 目录执行**，否则 `verify.sh` 退出 2）：

```bash
bash scripts/verify.sh
```

- 单项复查命令见 `AGENTS.md` §7 与 BIND-4，不在本文件复制。

仓库根：`git diff --check`、`git diff --numstat`、`git remote -v`。

## 5. 常见任务入口

| 任务                           | 先做什么                                                                                                                   | 完成前必须                                                                  |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 改前端业务组件 / 页面          | 先检索同 feature 的既有组件、query hook、decoder 与表格（DEV-3），复用而非新建                                              | 补/改测试（DEV-1、TEST-3）；跑 `pnpm verify`（DEV-4）                       |
| 改后端用例 / 仓储 / Provider   | 先确认所属层与既有 use case、事务、锁、任务池、取消语义（DEV-3）                                                            | 跑 `bash scripts/verify.sh`（TEST-6）；契约变化跑 `make swagger` + 精确 diff |
| 新增或修改门禁工具             | 先定口径边界清单（计入/排除）                                                                                               | 跑 `pnpm test:gates`；门禁自证要求见 EVID-3                                 |
| 收口未达标项 / 债务            | 先读两个 `AUDIT.md` 的 C 区，确认定级与棘轮约束                                                                              | 只允许持平或下降（§5）；基线更新见 CHG-5                                    |
| 发布新版本                     | 先读 `AGENTS.md` §8 的发布前置与 `backend/AUDIT.md` D 区（含授权登记）                                                       | 版本载体一致 + CI 真实 run 结果（REL-1）；状态语义见 EVID-1 / EVID-2        |
| 改文档                         | 先确认该事实的定义处（DOC-1）：规则→`AGENTS.md`，状态→`AUDIT.md` A–E 区，历史→档案区（只增不改）                              | 不复制数字（META-2）；引用用编号/指针（DOC-4）；稳定锚点见 META-5           |
| 排障 / 定位根因                | 先给最小复现与证据链                                                                                                        | 根因追到可验证层（CHG-7）；同类缺陷全量扫描（CHG-6）                        |

## 6. 变更与交付纪律

- 每轮（一个可独立交付的批次）从当前集成分支切**新分支** `maint/<主题>-<日期>[-<轮次>]`（CHG-12）。
- 提交信息用 Conventional Commits，一次提交只做一件事、可独立回滚；格式调整与行为变更分开（CHG-1）。
- 搬运与重写分离并标注（CHG-2）。
- **不得为过门禁而放宽**（CHG-4）。
- 改动落地即验：每次改代码后在同一次改动内跑受影响门禁，不留到阶段收尾批量返工（DEV-4）。
- 修缺陷后全量扫描同类模式与调用面，根因追到可验证层并给最小复现（CHG-6 / CHG-7）。
- 临时/调试脚本只放会话 scratch 目录，提交前 `git status --porcelain` 不得出现调试产物（CHG-11）。
- 不可逆操作**逐次单独授权**，范围与执行前要求见 CHG-9 / SEC-4；授权登记见 `backend/AUDIT.md` D 区。

### 执行与委派（EXEC）

以下只列主题名与指针，判定细节与参数见 `AGENTS.md` §9，本文件不复制：

- 不阻塞等待（EXEC-1）
- 单次阻塞有界（EXEC-2）
- 子任务时长与可交付（EXEC-3）
- 并发有界（EXEC-4）
- 并行写者互斥（EXEC-5）
- 断点可续跑（EXEC-6）
- 默认值推进（EXEC-7）
- 不递归委派（EXEC-8）

## 7. 证据契约

- `Passed` 只能来自**实际执行**的命令；证据要素见 EVID-1 / EVID-2。
- 状态语义（`Pending` / `Failed` / `Skipped` / `Blocked` / `Passed`）不得互相替代，定义见 `AGENTS.md` §6 与 EVID-1。
- 判定用命令自身的退出码，不用执行框架的字段（EVID-5）。
- 同一次汇报内结论必须自洽；已登记数字/状态失真须同次更正并留痕（EVID-6 / EVID-8）。
- 子代理报告须复核，「未验证/未执行」项不得进入 `Passed`（EVID-7）。
- **CI 通过 ≠ 已交付**（EVID-9）。

## 8. 编码与文本安全

- 行数/编码判定必须用字节级读取或解析器，禁用 `Get-Content` 判行数（DEV-5）。
- 本机可能没有 `rg`：检索优先用 `git grep -nE "<pattern>" -- <path>`（只扫已跟踪文件，避免 node_modules 噪声），必要时回退 `Select-String`。
- 仓库存储换行由 `.gitattributes` 统一为 LF；Prettier 是前端格式的唯一来源（DEV-5）。
- 批量改写（含 `gofmt -w`、`prettier --write`、`oxlint --fix`）的安全管线见 CHG-10。
- 新增 CI action 的供应链约束见 SEC-2。
- 默认不新增生产依赖、框架、全局/构建/部署配置或顶层目录（DEV-3）。

## 9. 反模式（看到就停）

- 重排或复用 `AGENTS.md` 的章节/规则编号，或重排两个 `AUDIT.md` 历史档案的章节编号（META-5；见 §12）。
- 把阈值、条数、版本号、用例数复制到本文件或 `docs/` 派生文档（DOC-1 / META-2；见 §12）。
- 在 `AUDIT.md` 的 A–E 区回填会过期的旧值，或把新规则写进 `AUDIT.md`（DOC-1 / DOC-2；见 §12）。
- 推送 `upstream`，或把秘密/推送凭据元数据写进仓库（BIND-1 / SEC-1；见 §13）。
- 把「已写配置 / 已发起 / 静态读到」当作已验证，或用 `Skipped`/`Blocked`/未运行代替 `Passed`（EVID-1；见 §10）。

其余通用反模式（默认值/空数组/宽泛 `catch`/静默降级掩盖未知问题、未使用代码与第二套业务规则、跨层绕过既有约定、为过门禁放宽、为消除外部告警改被检代码语义等）见 `AGENTS.md` §2（DEV）、§4（REV）、§9（EXEC）、§10（EVID）、§11（CHG）、§13（SEC）。

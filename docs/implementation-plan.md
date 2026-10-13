# grok2api 实施细节方案

## 0. 文档信息与定位

| 项 | 值 |
| --- | --- |
| 文档类型 | 派生实施文档：把 `docs/PRD.md` 的需求与 `docs/TD.md` 的设计缺口，落成**可判定、可回滚、带文件级改动点**的工作项 |
| 目标读者 | 实施人（人类或代理）、验收人、发布负责人 |
| 覆盖范围 | 现状基线、验收总则、工作项 W0–W7、文件级改动点、验证命令、提交序列、风险与回滚、外部依赖与授权清单、与 PRD/TD 的追踪 |
| 文档状态 | 派生文档（非规则 SSOT）；规则以 `AGENTS.md` 为准，实测值以两个 `AUDIT.md` 为准 |
| 基线提交 | `45838afe`（`main`，2026-10-12；工作区干净）；历史基线 `c6206d50` 因远端仓库重建/历史重写已不可解析，引用其行号时需按当前文件重新定位 |
| 版本载体 | 唯一权威版本源是仓库根 `VERSION`（规则见 `AGENTS.md` §8）；`frontend/package.json.version` 须与之同线。本文不复制版本号，数值以该文件与 `pnpm check:version` 当次输出为准 |
| 权威边界 | 规则 SSOT = `AGENTS.md`；证据 SSOT = `frontend/AUDIT.md`、`backend/AUDIT.md`；历史计划 = `.pi/plan/*`。本文与之冲突时以那三者为权威 |
| 与既有计划的关系 | 本文的 `W0`–`W7` 工作项（§3）、`S1`–`S13` 提交序列（§6）、`AC-1`–`AC-17` 验收标准（§2）与 `DEP-1`–`DEP-4` 依赖清单（§8）**由本文自身定义**；早期计划（`.pi/plan/*`，被 `.gitignore`（`/.pi/`）忽略、**不入库**）只作背景线索。注意 `.pi/plan/前后端验收审计与增量模块化优化计划-20261011-1936.md` 内**不含**任何 `W#-` / `S#` / `AC-` / `DEP-` 标识符（复现：对该文件跑 `Select-String -Pattern 'W[0-9]-|AC-[0-9]|DEP-[0-9]'` 命中 0），故上述编号不继承自该文件；引用 `.pi/plan/` 一律不可追溯（DOC-3） |

**编号约定**：本文工作项编号 `W0`–`W7`，与需求 `R-*`（PRD §7）、设计缺口 `GAP-*`（TD §16）互相对应。既有计划中已完成项**保留原编号并标注状态**，不重编号（META-5 精神）。

**入口说明**：本文是派生文档，不是规则 SSOT；规则见 `AGENTS.md`，当前状态见 `frontend/AUDIT.md` 与 `backend/AUDIT.md`。三份文档的阅读顺序：`docs/PRD.md` → `docs/TD.md` → `docs/implementation-plan.md`。

---

## 1. 现状基线（可复现）

### 1.1 仓库与版本

| 项 | 实测值 | 复现命令 |
| --- | --- | --- |
| 分支 / tip | `main` @ `45838afe`，工作区干净 | `git status --porcelain` |
| 版本载体 | 唯一权威源为仓库根 `VERSION`（规则见 `AGENTS.md` §8），`frontend/package.json.version` 须与之同线；本文不复制数值 | `pnpm check:version`（`pnpm verify` 第 1 步，清单见 `AGENTS.md` 的 BIND-4 / DEV-4） |
| remote | `origin`（fetch `https://github.com/JasmineTony/grok2api.git` / push `git@github.com:JasmineTony/grok2api.git`）+ `upstream`（只读参考，**禁止推送**）；事实 SSOT：`AGENTS.md` 的 BIND-1 | `git remote -v` |
| `main` 跟踪 | `origin/main`（事实 SSOT：`AGENTS.md` 的 BIND-1） | `git status -sb` |
| 本地 tag | 维护线版本线为 `v0.1.x`；完整列表（含上游历史 tag）以 `git tag` 当次输出为准，本文不复制 | `git tag` |

### 1.2 门禁与工具链

| 项 | 实测值 | 复现命令 |
| --- | --- | --- |
| 前端 `verify` | 串行门禁；步骤清单、顺序与条数的 SSOT 是 `AGENTS.md` 的 BIND-4 / DEV-4（本文不复制步骤序号与条数） | `[System.IO.File]::ReadAllText('frontend\package.json',[System.Text.Encoding]::UTF8)` |
| 后端 `verify.sh` | 串行门禁（步骤清单 SSOT：`AGENTS.md` 的 BIND-4 / TEST-6） | `backend/scripts/verify.sh` |
| 结构基线 | `frontend/` 与 `backend/` 的 `structure-baseline.json` 的 `files`/`functions`/`nesting` **均为空** | `[System.IO.File]::ReadAllText('<dir>\structure-baseline.json',[System.Text.Encoding]::UTF8)`（`<dir>` = `frontend` / `backend`） |
| 边界例外 | `applicationInfraExceptions` 冻结清单（文件数与 (文件, 包路径) 对数以 `go test ./internal/ports/provider/ -count=1` 当次输出为准；实测值 SSOT 见 `backend/AUDIT.md` C 区 BE-P2-2） | `cd backend && go test ./internal/ports/provider/ -count=1` |
| 体积预算 | 阈值未变（唯一来源 `frontend/bundle-budget.json`，规则见 `AGENTS.md` 的 REV-5）；基线 `generatedAt` = `2026-10-12T09:07:19.809Z` | `[System.IO.File]::ReadAllText('frontend\bundle-budget.json',[System.Text.Encoding]::UTF8)` |
| 体积基线实测值 | 以 `pnpm check:budget` 当次输出为准（实测值 SSOT 见 `frontend/AUDIT.md` B.3；本文不复制数值） | `cd frontend && pnpm check:budget` |

> 本表复现命令统一使用字节级读取（`[System.IO.File]::ReadAllText($p,[System.Text.Encoding]::UTF8)`）；行数/编码判定口径见 `AGENTS.md` DEV-5（本机 `core.autocrlf=true`，`Get-Content` 不作为判定口径）。

### 1.3 遗留项分级（当前口径）

| 级别 | 数量 | 内容 |
| --- | --- | --- |
| P0 | 0 | — |
| 发布阻塞 | 4 | 远端仓库未重建/未验证；推送凭据可用性未验证（DEP-1）；CI 断言 step 从未真实执行；版本口径待确认 |
| P2 | 见 `docs/PRD.md` §7 | 后端边界未收敛（BE-02）；体积口径（已四项结论，见 W3）；`ports/security` 迁移；阶段 5-2/5-6 无证据；AUDIT 登记滞后 |
| P3 | 见 `docs/PRD.md` §7 | 计数口径＝`docs/PRD.md` §7 表格中优先级为 P3 的条目数（R-10…R-15）；本方案侧的 P3 工作项为 W5、W7-6…W7-9，另有 TD 缺口 `GAP-9`/`GAP-10` 未安排工作项。原写「5」的 EVID-8 留痕见 §10 |

### 1.4 本机不可执行项（如实记 `Blocked`，不得记 `Passed`）

| 项 | 原因 | 覆盖方 |
| --- | --- | --- |
| `go test -race ./...` | 本机 `CGO_ENABLED=0` | CI `Race backend` step |
| 隔离 PostgreSQL / Redis 集成用例 | 本机无隔离服务（环境门控跳过条数随批次变化，以 `go test ./... -count=1 -v` 当次输出与 `backend/AUDIT.md` B 区 BE-B2 为准） | CI services + `Assert required integration tests ran` |
| Docker 镜像构建 | 本机无可用构建环境 | CI `check_ghcr_image` / `build_ghcr_image` |
| 真实外部 Provider 调用 | 无生产凭据/出口 | 仅本地替身与合成凭据 |
| 远端 CI run 与镜像 digest | 未推送 | 推送后回填 |

---

## 2. 验收总则（不可降级）

沿用 `AGENTS.md` §10 的 `EVID-1`/`EVID-2`：

1. 未实际执行的检查**不得**记为 `Passed`；只写配置不等于通过。
2. 不可逆步骤（合并 `main`、tag/Release、推镜像、删除重建远端）**逐次单独授权**并登记证据。
3. 禁止为让门禁变绿而：放宽阈值、删除断言、`--update` 吸收增长、把失败文件移出 include、扩大超时掩盖缺陷。
4. 每个工作项的验收必须给出**可判定命令 + 通过条件**，负样本必须进 `self-test-gates.mjs`（EVID-3）。
5. 工作区必须静止后再做基线类操作（CHG-5），并记录 `git rev-parse HEAD` 与在跑任务数。

---

## 3. 工作项

### W0 环境与登记前置（P1，阻塞发布）

#### W0-1 登记 `origin` remote 现状与推送凭据（**状态已更正：实测 `origin` 存在**）

- **现状（实测，本轮复核）**：`git remote -v` 显示 `origin`（fetch `https://github.com/JasmineTony/grok2api.git` / push `git@github.com:JasmineTony/grok2api.git`）与 `upstream`（只读参考，**禁止推送**）均已配置；`git config --get branch.main.remote` = `origin`，`main` 跟踪 `origin/main`（事实 SSOT 是 `AGENTS.md` 的 BIND-1）。原「仅 `upstream`、无 `origin`、`main` 跟踪 `upstream/main`、ahead 计数为旧值（该旧值不再复现，现状以 `git status -sb` / `git rev-list --count` 当次输出为准）」表述已过期，`frontend/AUDIT.md` §37.4/§38.2 要求的 `git remote -v` 显示 `origin` 已满足。
- **影响**：原「无法执行 S8/S9/S10」的阻塞点（缺 `origin`）已解除；剩余未验证项是推送凭据可用性（DEP-1）与「远端仓库重建 + `v0.1.1` 重发」的实测证据（`frontend/AUDIT.md` §38.4 的登记以该节当次内容为准）。
- **动作（剩余）**：
  1. 确认远端仓库重建与 `v0.1.1` 重发状态（REST 查询仓库 id 与 `created_at`），并回填 `frontend/AUDIT.md` §38.4。
  2. 在两份 AUDIT 以 EVID-8 格式登记「`origin` 已存在（fetch HTTPS / push SSH）、`main` 跟踪 `origin/main`」的现状与复现命令；原「本地无 `origin`」表述按 EVID-8 更正为「原值 → 新值 → 根因 → 复现命令」。
  3. 确认推送凭据可用（**不在文档登记任何凭据元数据**）。
- **改动点**：`frontend/AUDIT.md`、`backend/AUDIT.md`（文档）；`git remote -v` / `git config --get branch.main.remote` 取证（本地配置，非仓库文件）。
- **验收**：`git remote -v` 显示 `origin`（fetch HTTPS / push SSH）且 `upstream` 仍在；`git rev-parse --abbrev-ref main@{upstream}` = `origin/main`；两份 AUDIT 含该现状的 EVID-8 条目。
- **证据**：命令输出 + 提交 diff。
- **回滚**：`git remote remove origin`（本地配置，可逆）。
- **依赖**：维护线负责人确认远端仓库状态（不可逆操作已发生与否）。

#### W0-2 版本口径确认（DEC，P1）

- **现状**：仓库根 `VERSION` 的当前值以该文件为准（唯一权威版本源，规则见 `AGENTS.md` §8；本文不复制版本号）。**授权登记的唯一处是 `backend/AUDIT.md` D.5**（`AGENTS.md` §1 只保留指针，依据 DOC-1 / META-3）：该区已登记与本轮版本口径相关的授权条目，并已把「已授权发布 `v0.1.2`/`v0.1.3` 但远端只发布 `main` 与 `refs/tags/v0.1.1`」登记为待负责人一次性决策的开放项（条目、范围、日期与证据见 D.5，本文不复述；原逐条复述已按 DOC-1 收敛）。早期计划对版本号的落定记录位于 `.pi/plan/*`（不入库、不可追溯，DOC-3），本文不复述。
- **动作**：由维护线负责人一句话确认本轮发布版本号，并在 `backend/AUDIT.md` D.5 末尾追加一条授权登记（append-only，不改写既有记录；`AGENTS.md` §1 不再承载授权登记）。
- **验收**：`VERSION`、`frontend/package.json.version`、`backend/AUDIT.md` D.5 最新授权条目三者一致；`pnpm check:version` exit 0。
- **回滚**：还原 `VERSION` 与 `package.json`。
- **说明**：此项未定前，W6 的 S10/S11 不得执行。

---

### W1 登记一致性收口（P1，纯文档）

#### W1-1 回写未登记提交（登记一致性，**仍开放**；对应 `AGENTS.md` §6，无 TD 缺口编号）

- **现状（实测，本轮复核）**：历史重写前的 14 个 sha（**当前仓库不可解析**，`git cat-file -t <sha>` 14/14 报 `fatal: Not a valid object name`）中，以下 13 个在两份 AUDIT 中均无登记：
  `c6206d50`、`775eb11e`、`d0f8cc18`、`d315aba3`、`70f10b75`、`3fbda14b`、`822acafb`、`47e827ff`、`8b9a8c5f`、`9edad001`、`49c611d9`、`7b639d93`、`6a353e42`（含 merge）；`3e045dba` 仅前端有登记。
  以上 sha 属**历史重写前**的谱系，与当前 `git log` 无对应关系；未登记提交需按当前 `git log` 重新定位，不得沿用旧 sha。
  复现：不可解析性 `git cat-file -t <sha>`（14/14 报 `fatal: Not a valid object name`）；当前谱系 `git log --format='%h' -20`（与上列 sha 无交集）；命中数 `Select-String -Path frontend\AUDIT.md,backend\AUDIT.md -Pattern <sha>`（**纯子串检索，只统计命中数，不做行数/编码判定**，`AGENTS.md` DEV-5 口径）。
- **动作**：为上述提交补登记章节或条目（按单一目的归组，merge 提交只并入内容不单独登记）；把两份 AUDIT 中仍写「未修复/未闭环」的表述按 EVID-8 更正为「原值 → 新值 → 根因 → 复现命令」。
- **改动点**：`frontend/AUDIT.md`、`backend/AUDIT.md`（**单一写者**）。
- **验收**：① 历史重写前谱系只要求**列表 + 不可解析标注**（原「每个待登记 sha 在至少一份 AUDIT 中非零命中」不可满足：14/14 sha 的 `git cat-file -t` 均报 `fatal: Not a valid object name`，无法与任何 AUDIT 条目对应）；② 按当前 `git log` 重定位后的提交，每个 sha 在至少一份 AUDIT 中非零命中；③ `pnpm format:check` exit 0（AUDIT 表格受 Prettier 管辖）。
- **回滚**：`git revert`（纯文档）。

#### W1-2 计划编号映射（FT/FP 与 FE-08 决策变更）

- **动作**：在 `frontend/AUDIT.md` 新增一节，把计划 B 的 `FT-01`/`FT-02`/`FT-03`/`FP-01` 与对应章节/测试文件逐条映射；对 `FE-08`（双运行器）登记为**决策变更**并写明理由指针。
- **改动点**：`frontend/AUDIT.md`。
- **验收**：`Select-String -Path frontend\AUDIT.md -Pattern 'FT-01|FT-02|FT-03|FP-01'` 命中 ≥4（**纯子串检索，只统计命中数，不做行数/编码判定**，`AGENTS.md` DEV-5 口径）；`FE-08` 条目含「决策变更」字样。
- **回滚**：`git revert`。

#### W1-3 无结论条目落定

- **动作**：对「阶段 5-2」「阶段 5-6」「阶段 3-5（tree-shaking/浏览器目标）」「阶段 0-4（六列矩阵）」「阶段 1-4（三工具差异表）」「FT-01 纳入/排除矩阵」逐条二选一：**执行并登记** 或 **登记为不做 + 理由 + 复现命令**。
- **改动点**：两个 AUDIT。
- **验收**：两份 AUDIT 中不再存在无结论的「未找到证据」条目；每条有状态词与理由。
- **回滚**：`git revert`。

---

### W2 门禁接线与 CI 盲区（P1）

| 子项 | 状态（本轮复核） | 剩余动作 |
| --- | --- | --- |
| W2-1 本地版本载体一致性校验 | **已完成** | `frontend/scripts/check-version-carriers.mjs` 已存在并作为 `pnpm verify` 第 1 步；`AGENTS.md` §DEV-4/§8、`frontend/README.md` 已同步 |
| W2-2 预算 artifact 上传 | **文件已就位**，CI 证据待补 | `.github/workflows/ghcr-image.yml` 已有 `Capture bundle budget report` + 上传 step；完成判据是**目标提交上真实 run 的 artifact 存在** |
| W2-3 两个维护线新增 step 首次真实执行 | **未达成** | 依赖 W0-1（推送通道）；取得 run 后确认 `Verify backend structure and API contract` 与 `Assert required frontend tests ran` 均**存在且 success**（`skipped`/缺失均算未达成） |

- **W2-2/W2-3 验收**：run id + step 名 + `conclusion=success`；artifact 名称可检索。
- **回滚**：`git revert` 工作流改动（如涉及）。
- **禁止**：以「剥离工作流改动后再推送」规避（会使 CI 缺 step 并掩盖真实发布路径）。

---

### W3 体积预算口径（P1 → 已收口，保留结论）

| 子项 | 状态（本轮复核） | 证据 |
| --- | --- | --- |
| W3-1 `runtime-config.js` 漏算 | **已修复并并入** | `check-bundle-budget.mjs:342` 明确处理「`public/` 原样拷贝的非 `/assets/` 脚本」；基线 `initialClosure.files` 已含 `runtime-config.js` |
| W3-2 认证后首屏超 REV-5 阈值（数值以 `pnpm check:budget` 与 `frontend/AUDIT.md` 当次输出为准） | **登记为门禁外独立指标（登记不做）** | `frontend/AUDIT.md` 的 FE-19-5 及其 §37.2：不改阈值（CHG-4 禁止）；需先优化到预算阈值以内再补场景与负样本 |
| W3-3 嵌套 `import()` 静态不可见 | **现状登记，不扩张** | `frontend/AUDIT.md` §29.7 ③：理论上存在拆分通道；「含动态 import 的文件数」以该节当次输出为准（口径是构建产物 chunk，不是源码 `import(` 计数），当前未触发超限 |
| W3-4 冻结基线陈旧 | **已按 CHG-5 重定** | `frontend/AUDIT.md` §37.1：基线已重定（前后数值以该节当次内容为准），硬阈值与容差**一字未改** |

- **剩余动作**：无（如后续要把「认证后首屏」纳入门禁，必须先优化到预算阈值以内（阈值唯一来源 `frontend/bundle-budget.json`），再补场景判定与「超限必须失败」的负样本，并在同一次改动内更新 AUDIT 与 `AGENTS.md`）。
- **回滚**：`git checkout 90513aea1710a0881eb185c51c0174c757a837d4 -- frontend/bundle-budget.json`（旧基线；`90513aea` 是 `main` 上可解析提交，`git cat-file -t` → `commit`，其 `frontend/bundle-budget.json` 的 blob 正是 `5d6aace3423404feea58a022a6a3c8936ade6380`，故与按 blob 还原等价。原写法 `git checkout <blob> -- <path>` 因 `5d6aace…` 的 `git cat-file -t` 为 `blob` 而非 `commit`，不可执行）。

---

### W4 后端边界与性能登记（P2，只读结论）

#### W4-1 边界例外口径统一

- **现状**：例外表 `applicationInfraExceptions` 的文件数与对数以 `go test ./internal/ports/provider/ -count=1` 当次输出为准（实测值 SSOT 见 `backend/AUDIT.md` C 区 BE-P2-2）；AUDIT §4.1/§5/§20.2/§31.4 之间已有相互指针，但存在两套计量（import 行 vs (文件, 包路径) 对）。
- **动作**：确认三处口径统一为同一数字并建立指针；登记 `internal/app` 只有豁免、无自动规则。
- **验收**：`cd backend && go test ./internal/ports/provider/ -count=1` exit 0，输出含 declared = actual 与「参与判定的作用域」计数。
- **改动点**：`backend/AUDIT.md`（文档）。
- **回滚**：仅文档。

#### W4-2 阶段 5-2 只读检查（装配/生命周期/取消链）

- **动作**：核对装配顺序、关闭顺序、后台任务退出、请求取消与业务状态转移，产出结论表（检查点 → 证据 → 结论 → 是否需修复）。**默认不改生产代码**；发现真实缺陷另立修复项并单独提交。
- **改动点**：`backend/AUDIT.md` 新增章节。
- **验收**：结论表落盘；`cd backend && go test ./... -count=1` 与 `bash scripts/verify.sh` exit 0；`go run ./tools/apicheck` 无未授权差异。
- **回滚**：仅文档。

#### W4-3 阶段 5-6 / 阶段 3-5 登记为有理由的不做

- **动作**：引用既有结论（基准统计检验无判别力、未改被基准覆盖的生产路径）登记「不执行热点优化」与「无 tree-shaking/浏览器目标专项核对」。
- **验收**：两个 AUDIT 中这两条不再是无结论状态。
- **回滚**：仅文档。

---

### W5 E2E 与文档矩阵（P3）

#### W5-1 E2E 流程补强（按风险排序）

- **优先顺序**：账号导入校验 → 模型额度封锁 → 出口页面 → 设置版本冲突；创作台/媒体与文档页按剩余预算。
- **状态（2026-10-13）**：**部分完成**。「修改密码（含当前密码错误的失败路径）」与「模型封锁 + 批量封锁/解除」已闭环（`frontend/e2e/account-password.e2e.ts`、`frontend/e2e/models.e2e.ts`；`pnpm test:e2e` 58 passed / 0 failed / 0 skipped，`pnpm test:results:e2e` exit 0，必需用例清单与门禁自测棘轮已同步到 9 文件 / 58 实例）。其余流程（账号列表/搜索/分页、额度侧模型封锁、批任务失败与取消、模型页、出口页、Quality Guard 状态、创作台/媒体、路由直达刷新与键盘操作）已按本节「未补流程逐条登记」的要求登记为未覆盖：`frontend/AUDIT.md` C 区 **FE-P2-6**。
- **改动点**：`frontend/e2e/*.e2e.ts`（新增用例）、`frontend/scripts/check-test-results.mjs`（必需用例清单，**棘轮只增**）。
- **验收**：`pnpm test:e2e` 0 failed / 0 skipped（`retries: 0`）；`pnpm test:results:e2e` exit 0；用例数只增不减；未补流程逐条登记「未覆盖 + 原因」。
- **回滚**：按 spec 文件粒度回退，同步回退报告门禁清单。

#### W5-2 三份矩阵文档

- **动作**：产出 ① 「规则 → 配置 → 范围 → 命令 → 结果 → 阻塞级别」六列矩阵；② Prettier/ESLint/Oxlint 范围差异表；③ 覆盖率纳入/排除矩阵（FT-01）。可合并为一节，但必须逐项可检索。
- **改动点**：`frontend/AUDIT.md`（或独立文档 + 指针）。
- **验收**：矩阵存在且每行命令可复制执行；根级文件无三工具覆盖的事实显式登记（不做则写理由）。
- **回滚**：仅文档。

---

### W6 交付与发布（**不可逆，逐次授权**）

提交序列（本文定义，按当前状态修订）：

| 步 | 动作 | 状态 | 前置 |
| --- | --- | --- | --- |
| S1 | W1 全部提交（`docs(audit): …`，按单一目的拆分） | 待执行 | 工作区静止 |
| S2 | W2-1 本地版本一致性校验 | **已完成** | — |
| S3 | W3 预算口径三项 | **已完成/已登记**（W3-1 修复、W3-4 重定、W3-2 登记不做） | — |
| S4 | W4 后端只读结论与登记 | 待执行 | — |
| S5 | W5 E2E 与矩阵 | **部分**（W5-1 已闭环改密与模型封锁两项，其余流程登记为 FE-P2-6；W5-2 矩阵待产出） | — |
| S6 | 版本载体对齐（`VERSION` / `package.json` / `backend/AUDIT.md` D.5 授权登记） | 待执行 | **W0-2 版本口径确认** |
| S7 | 本机全量验收：`pnpm verify:full`、`bash scripts/verify.sh`、`make swagger` 精确 diff、`git diff --check` | 待执行 | S1–S6 收敛 |
| S8 | 推送交付分支 → 取目标提交 CI run | **Blocked** | W0-1（推送凭据可用性）+ 推送凭据 |
| S9 | **fast-forward 合并 `main` → 推送 `origin main`** | 未授权 | AUTH-1 + 外部依赖确认 |
| S10 | 打 annotated tag → 推送 | 未授权 | S9 |
| S11 | 创建 GitHub Release | 未授权 | S10 |
| S12 | 验证镜像（多架构索引、匿名拉取、digest） | 待执行 | S10 |
| S13 | 两份 AUDIT 的 D 区发布后登记（`AGENTS.md` §8 要求附 run id + step + conclusion） | 待执行 | S12 |

- **发布前置（缺一不可）**：AC-1 版本载体一致、AC-2 前端 `pnpm verify` exit 0、AC-3 `pnpm verify:full` exit 0、AC-4 后端 `verify.sh` exit 0、AC-5 Swagger diff 为 0、AC-6 CI `verify` job 全部必需 step `success`、AC-7 两条新增断言 step 存在且 `success`、AC-8 无新增架构/结构/预算违规、AC-9 无未授权契约/语义变化、AC-10 改动边界与编码干净。
- **发布动作验收**：AC-11 fast-forward、AC-12 annotated tag、AC-13 多架构 manifest list、AC-14 镜像可拉取、AC-15 Release 非草稿非预发布、AC-16 发布后登记完成、AC-17 固有局限（tag 指向发布提交，其 AUDIT 不含 tag run 之后的登记）已登记。
- **外部依赖确认（执行前逐项）**：DEP-1 推送凭据权限；DEP-2 推送 `main` 会覆盖 GHCR `latest`/`main` 标签（确认下游消费者与旧 `latest` 处置）；DEP-3 GHCR 容器包与仓库链接有效 + `packages: write` 生效；DEP-4 Linux CI 的 race 与隔离 PG/Redis。
- **回滚**：S1–S6 按单一目的提交 `git revert`；已发布后回滚（需再次授权）＝删除 Release、删除远端 tag、删除 GHCR 标签，并**注意 `latest` 已被覆盖**需重新指向。

---

### W7 架构演进（P2/P3，TD 设计缺口的落地细节）

> 下列各项**不阻塞发布**，按优先级择期执行。每项都必须在同一次改动内跑通受影响门禁（`AGENTS.md` §DEV-4「改动落地即验」）。

#### W7-1 多副本一致性 fail-closed（GAP-4 / R-6，P2）

- **问题**：`runtimeStore.driver = memory` + `deployment.replicas > 1` 时，限流/粘滞/锁**静默退化**为每实例独立。
- **改动点**：`backend/internal/app/topology.go`（`preflightDeployment` 增加组合校验）、对应 `_test.go`、`config.example.yaml` 注释。
- **动作**：该组合启动即失败并给出可操作原因（或按配置项显式允许并输出警告），不得静默通过。
- **验收**：新增单测覆盖「memory + replicas>1 → 启动失败/告警」与「redis + replicas>1 → 通过」；`bash scripts/verify.sh` exit 0；`go run ./tools/apicheck` 无差异。
- **回滚**：`git revert`（单提交）。
- **风险**：可能影响现有单副本默认路径 → 仅在组合校验处加判断，不改默认行为。

#### W7-2 数据迁移版本化（GAP-3 / R-9，P2）

- **问题**：`InitializeSchema` 为 AutoMigrate + 幂等 DDL + 手工迁移函数累积，无版本表、无 down、无迁移耗时/锁等待指标。
- **改动点**：`backend/internal/infra/persistence/relational/schema.go`（新增迁移版本记录与逐版本函数）、新 `migration_*.go`、`schema_*_test.go`、`backend/AUDIT.md`（设计决策登记）。
- **动作**：引入迁移版本记录（已应用版本 + 时间）；把现有手工迁移函数纳入版本化序列；输出迁移耗时与锁等待日志；明确回滚策略（或登记「不回滚，仅前滚 + 备份」并说明）。
- **验收**：新增用例覆盖「全新库 → 最新版本」「旧库 → 升级到最新」「重复启动幂等」；`go test ./internal/infra/persistence/... -count=1` 全绿；Postgres 与 SQLite 两 driver 均覆盖（Postgres 走 CI 隔离服务）。
- **回滚**：迁移为前滚语义，回滚 = 代码回退 + 备份恢复；必须在 AUDIT 写明。
- **风险**：**涉及不可逆数据变更** → 按 `AGENTS.md` 决策顺序，需单独确认后再实施。

#### W7-3 计费窗口与乐观并发登记（GAP-5，P2；PRD §7 无对应条目，相关 NFR-6）

- **问题**：预留无版本号列；崩溃遗留预留最长回收窗口 = 10 分钟周期。
- **改动点**：优先**登记**（`backend/AUDIT.md`：最长超收/漏收窗口的推导与复现命令）；如需改实现，则 `billing_reservations` + `client_keys` 仓储与同事务结算路径。
- **验收（登记路径）**：AUDIT 给出窗口推导与复现命令，并标注「未做实现变更」。
- **回滚**：仅文档。

#### W7-4 可观测性补全（GAP-8 / R-7，P2）

- **问题**：无 SLO、无指标导出端点、无请求级全链路 trace。
- **改动点（最小落地）**：新增只读管理面端点或 `/metrics` 类导出（`backend/internal/transport/http/system/`）、`pkg/perfmetrics` 暴露计数器、`config.example.yaml` 开关、`api-baseline.txt` 同步（新增导出会触发 `apicheck`，必须显式 `--update` 并评审）、`backend/AUDIT.md` 登记 SLO 定义。
- **验收**：端点有鉴权、有单测；`go run ./tools/apicheck` 经评审后 `--update` 并 diff 可解释；`make swagger` 同步。
- **回滚**：`git revert` + `apicheck --update` 回退基线。
- **风险**：新增公开面 → 必须走契约变更评审（AC-9 同口径）。

#### W7-5 失效广播一致性 SLO（GAP-6，P2）

- **改动点**：`backend/internal/application/invalidation/service.go` 与 `settings` 广播路径加可观测计数（发布数/投递数/丢弃数）；`backend/AUDIT.md` 定义 SLO。
- **验收**：计数可在日志或导出端点观测；单测覆盖「队列满 → 计数递增且本地已应用」。
- **回滚**：`git revert`。

#### W7-6 `application/gateway` 拆分（GAP-11 / R-10，P3）

- **问题**：单包文件数与单文件行数偏大（具体清单与行数以 `go run ./tools/structurecheck` 与字节级行数当次输出为准；实测值 SSOT 见 `backend/AUDIT.md`）。原列举的若干行号已过期，按 EVID-8 不再复制。
- **动作**：按「选号 / 转发 / 结算 / 媒体」边界给出拆分方案，**先出方案与文件清单**，再分阶段搬迁；每阶段跑 `structurecheck` + `apicheck` + 相关测试。
- **验收**：`go run ./tools/structurecheck` 与 `apicheck` 全绿；`structure-baseline.json` 保持空；`backend/AUDIT.md` 登记阶段计划。
- **回滚**：按阶段 `git revert`。
- **风险**：包内搬迁会大面积触碰 import → 必须逐阶段验证，不得一次成型。

#### W7-7 Provider 能力声明前移校验（GAP-7 / R-14，P3）

- **改动点**：`backend/internal/ports/provider/definition.go` + `infra/provider/provider.go` 的 `Validate()` 附近，新增编译期或测试期断言（例如对每个 Provider 生成接口断言测试）。
- **验收**：新增用例在「声明了能力但未实现接口」时失败（负样本）；`go test ./internal/ports/provider/ -count=1` 全绿。
- **回滚**：`git revert`。

#### W7-8 外部依赖熔断与灰度登记（GAP-12 / R-15，P3）

- **动作**：在 `backend/AUDIT.md`（或 `docs/`）登记 FlareSolverr、Statsig signer、ipinfo 探针、代理/隧道等外部依赖的超时、重试、降级与回滚流程；与 `infra/egress/FAILURE_RETRY.md` 建立指针，不复制第二套描述。
- **验收**：每个外部依赖一行且可检索；已有实现路径被引用而非重述。
- **回滚**：仅文档。

#### W7-9 就绪语义扩展（GAP-10，P3）

- **动作**：评估是否把 `/readyz` 的组件快照扩展为「部分能力可用」（例如某 Provider 不可用时声明并接入路由排除）。
- **验收**：先出设计结论；若实施，`apicheck`/`swagger` 同步 + 单测。
- **回滚**：`git revert`。
- **注意**：`/readyz` 是公开契约，语义扩展需按 AC-9 评审。

---

## 4. 文件级改动点汇总

| 工作项 | 主要文件 | 类型 |
| --- | --- | --- |
| W0-1 | `frontend/AUDIT.md`、`backend/AUDIT.md` | 文档（+ 本地 git config） |
| W0-2 | `VERSION`、`frontend/package.json`、`backend/AUDIT.md`（D.5 授权登记） | 配置/文档 |
| W1-1/2/3 | `frontend/AUDIT.md`、`backend/AUDIT.md` | 文档 |
| W2-2/3 | `.github/workflows/ghcr-image.yml`（如需调整） | CI 配置 |
| W3 | `frontend/scripts/check-bundle-budget.mjs`、`frontend/bundle-budget.json`、`frontend/AUDIT.md` | 脚本/基线/文档 |
| W4-1/2/3 | `backend/AUDIT.md` | 文档 |
| W5-1 | `frontend/e2e/*.e2e.ts`、`frontend/scripts/check-test-results.mjs` | 测试/门禁清单 |
| W5-2 | `frontend/AUDIT.md` | 文档 |
| W6 | `VERSION`、`frontend/package.json`、`backend/AUDIT.md`（D.5）、两个 AUDIT（D 区发布登记） | 配置/文档 |
| W7-1 | `backend/internal/app/topology.go`(+test) | 生产代码 |
| W7-2 | `backend/internal/infra/persistence/relational/schema*.go`(+test) | 生产代码 |
| W7-4 | `backend/internal/transport/http/system/*`、`backend/internal/pkg/perfmetrics/*`、`backend/api-baseline.txt`、`backend/docs/*` | 生产代码 + 契约产物 |
| W7-5 | `backend/internal/application/invalidation/service.go`(+test) | 生产代码 |
| W7-6 | `backend/internal/application/gateway/*`（搬迁） | 生产代码 |
| W7-7 | `backend/internal/ports/provider/*`、`backend/internal/infra/provider/*`(+test) | 生产代码 |
| W7-8/9 | `backend/AUDIT.md`（+ 视结论涉及 `internal/app/startup.go`） | 文档/生产代码 |

---

## 5. 验证命令清单

规范命令统一维护在 `docs/TD.md` §17.5（规范命令）与 `AGENTS.md` §7（门禁入口）；本文不复制命令副本。下列仅为**本文工作项特有的判定命令**：

- 边界例外 `declared = actual`：`cd backend && go test ./internal/ports/provider/ -count=1`
- Swagger 精确 diff：命令与判定 SSOT 是 `AGENTS.md` 的 TEST-6（本文不复述命令副本）
- 改动边界与远端：`git status --porcelain`、`git diff --check`、`git diff --numstat`、`git remote -v`、`git rev-parse HEAD`
- 门禁入口：SSOT 是 `AGENTS.md` §7（前端 `pnpm verify` / 后端 `bash scripts/verify.sh`，cwd 校验见 TEST-6），本文不复述

本机 `Blocked`（不得记为 `Passed`）：`go test -race ./...`（需 CGO 与 Linux 工具链）；隔离 PostgreSQL / Redis 集成用例（需隔离服务，由 CI 提供）；`docker build`（需可用构建环境）。

---

## 6. 提交序列（单目的提交，便于回滚）

| 序 | 提交信息（建议） | 内容 |
| --- | --- | --- |
| 1 | `docs(audit): 登记 origin 现状与推送凭据状态` | W0-1 |
| 2 | `chore(release): 确认本轮发布版本口径` | W0-2 |
| 3 | `docs(audit): 回写未登记提交并统一门禁步数口径` | W1-1 |
| 4 | `docs(audit): 补齐计划编号映射与决策变更登记` | W1-2 |
| 5 | `docs(audit): 落定无结论条目（执行或登记不做）` | W1-3 |
| 6 | `docs(backend): 边界口径统一与阶段 5-2 只读结论` | W4-1/2/3 |
| 7 | `test(frontend): 补账号/模型/出口/设置 E2E` | W5-1 |
| 8 | `docs(audit): 三份矩阵文档` | W5-2 |
| 9 | `chore(release): 版本载体对齐` | W6-S6 |
| 10 | `docs(audit): 登记发布证据` | W6-S13 |

版本载体与发布相关的第 9/10 步属**不可逆路径**，执行前需 AUTH-1 与 W0-2 决策。

---

## 7. 风险与回滚

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 并行写者继续推进 `main`（本会话期间 tip 已多次前进，当前 `main` = `45838afe`） | 基线/验收快照失效，`verify:full` 不可复现 | 执行前确认工作树静止；全量验收只在写者收敛后跑一次；每次动作前重记 tip |
| 推送 `main` 覆盖 GHCR `latest` | 下游可能拉到未确认版本 | DEP-2 逐项确认；必要时先发 tag 镜像再决定 `latest` 归属 |
| 远端仓库重建/`v0.1.1` 重发未验证（`frontend/AUDIT.md` §38.4 的登记以该节当次内容为准） | 无法声称发布完成 | W0-1 先做远端状态确认；未回填前一律记 `Blocked` |
| CI 新增断言 step 首次执行可能失败 | 发布阻塞（属预期风险） | 在交付分支先取 run；失败则修复后重跑，不跳过 |
| W7-2 迁移涉及不可逆数据变更 | 生产数据风险 | 单独确认；前滚 + 备份 + 回滚说明写进 AUDIT |
| W7-4 新增公开端点 | 契约面变化 | 走契约评审 + `apicheck`/`swagger` 同步 |
| 版本号跳号（`0.1.1`/`0.1.3` 并存）引发下游困惑 | 标签语义不清 | W0-2 显式决策并登记；Release 正文说明版本线背景 |

**本方案不做**：放宽任何阈值/超时/排除范围；把失败文件移出 include；在基线中加入新增越限；删除或弱化断言；推送 `upstream`；未授权执行合并 `main`/tag/Release/推镜像；在文档中登记推送凭据元数据。

---

## 8. 外部依赖与授权清单

| 编号 | 依赖 / 授权 | 类型 | 未满足时状态 | 解除条件 |
| --- | --- | --- | --- | --- |
| DEP-1 | 可推送的 Git 凭据（SSH 通道已实测可用） | 外部 | `Blocked` | 凭据由本地凭据助手提供 |
| DEP-2 | 推送 `main` 会覆盖 GHCR `latest`/`main` | 外部影响 | 需确认 | 确认下游消费者与旧 `latest` 处置 |
| DEP-3 | GHCR 容器包与仓库链接有效；`packages: write` 生效 | 外部 | `Blocked` | 发布前确认 |
| DEP-4 | Linux CI 的 race 与隔离 PostgreSQL/Redis | 外部（CI 侧已有） | 本机 `Blocked` | 由 CI 覆盖，本机不声称 |
| AUTH-1 | 合并 `main`、创建 tag/Release、推送镜像 | 授权（不可逆） | 不执行 | 维护线负责人逐次授权并登记 |
| DEC-1 | 本轮发布版本号（以仓库根 `VERSION` 为准；历史授权中的版本号见 `backend/AUDIT.md` D.5） | 决策 | 按当前仓库根 `VERSION` 准备（数值以该文件为准），不发布 | 负责人一句话即可定 |

---

## 9. 与 PRD / TD 的追踪

| 工作项 | 对应需求（PRD §7） | 对应设计缺口（TD §16） |
| --- | --- | --- |
| W0-1 | R-3 | GAP-1 |
| W0-2 | R-2 | — |
| W1-* | — | — （登记一致性，`AGENTS.md` §6 要求） |
| W2-2/3 | R-1、R-4 | GAP-1 |
| W3-* | R-5 | GAP-13 |
| W4-1 | R-8 | GAP-2 |
| W4-2/3 | — | GAP-8（性能不可声称） |
| W5-1 | R-12 | — |
| W5-2 | R-11 | — |
| W6 | R-1、R-2、R-3、R-4 | GAP-1 |
| W7-1 | R-6 | GAP-4 |
| W7-2 | R-9 | GAP-3 |
| W7-3 | —（PRD §7 无对应条目；相关非功能需求 NFR-6 计费一致性） | GAP-5 |
| W7-4 | R-7 | GAP-8 |
| W7-5 | R-7 | GAP-6 |
| W7-6 | R-10 | GAP-11 |
| W7-7 | R-14 | GAP-7 |
| W7-8 | R-15 | GAP-12 |
| W7-9 | — | GAP-10 |
| （未安排） | — | GAP-9（P3 选号公平性/饥饿；本轮 W7-1…W7-9 未安排对应工作项，登记为开放缺口） |

---

## 10. 变更记录

| 日期 | 说明 |
| --- | --- |
| 2026-10-12 | 初稿：以 `main` @ `45838afe` 为基线（历史基线 `c6206d50` 因远端仓库重建/历史重写已不可解析），继承既有 W1–W6 阶段与 AC-1~AC-17，新增 W0（`origin`/推送凭据现状与版本口径）与 W7（TD 设计缺口落地细节），并按当前 tip 更新各项状态 |
| 2026-10-13 | EVID-8 更正（原值 → 新值 → 根因 → 复现命令）：① §1.3 的 P3 计数 原值「5」→ 新值「6」；根因＝原计数按本表分类目测（内容列为 5 类），与 `docs/PRD.md` §7 表格中 P3 条目数（R-10…R-15）冲突，违反 DOC-1；复现：`git grep -nE "^\| R-1[0-5] \|" -- docs/PRD.md`（6 行 P3）与 `git grep -nE "P3" -- docs/PRD.md docs/implementation-plan.md`。② 授权登记引用 原值「`AGENTS.md` §1（三条相邻授权 / 最新授权条目 / 授权登记）」→ 新值「`backend/AUDIT.md` D.5（授权登记唯一处）」；根因＝授权登记已按 DOC-1 / META-3 迁入 D.5，`AGENTS.md` §1 只保留指针；复现：`git grep -n "授权登记" -- AGENTS.md backend/AUDIT.md`。③ 复制项改为指针：前端 `verify` 步骤序号/条数（→ `AGENTS.md` 的 DEV-4）、Swagger 精确 diff 与门禁入口命令（→ TEST-6 / §7）、版本号（→ 仓库根 `VERSION`，`AGENTS.md` §8）、会漂移的实测值（认证后首屏体积、环境门控跳过条数、旧 ahead 计数）改为「以命令 / `AUDIT.md` 当次输出为准」。 |
| 2026-10-13 | 缺口收口（EVID-8 更正）：① W1-1 现状口径 原值「最近 20 个提交中以下在两份 AUDIT 中均无登记」→ 新值「历史重写前的 14 个 sha（`git cat-file -t` 14/14 报 `Not a valid object name`）中 13 个无登记」；根因＝原表述把不可解析的旧谱系当作当前 `git log` 结果，且「最近 20 个提交」与旧 sha 无对应关系（当前 `git log --format='%h' -20` 与 14 个 sha 无交集）；复现：`git cat-file -t <sha>`、`git log --format='%h' -20`。② W1-1 验收条件 原值「每个待登记 sha 在至少一份 AUDIT 中非零命中」（实测 13/14 命中 0，条件不可满足）→ 新值「历史重写前谱系只要求列表 + 不可解析标注；按当前 `git log` 重定位后的提交才要求 AUDIT 非零命中」。③ DEV-5 口径：§1.2 的 `Get-Content` 复现命令改为字节级读取（`[System.IO.File]::ReadAllText($p,[System.Text.Encoding]::UTF8)`），§3 的 `Select-String` 用法标注为纯子串检索（不做行数/编码判定）。 |

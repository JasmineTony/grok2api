# 后端审计与验收报告

本文件是**后端证据与状态**的唯一登记处：**A–E 区**是当前状态入口，文末**历史档案区**（原编号 §1–§37）是 append-only 留痕。

- 规则唯一事实来源是根目录 [`AGENTS.md`](../AGENTS.md)：本文件引用**规则编号**（`TEST-6` / `REV-3` / `SEC-1`…），不复述规则原文（DOC-4）。
- 与 [`frontend/AUDIT.md`](../frontend/AUDIT.md) 同批、同结构；同一事实只在一侧登记，另一侧只放指针（DOC-1）。
- 任何数字都必须能由命令复现，并附命令与日期（META-2）。A–E 区只放**最近一次实测**；旧值与当时结论保留在历史档案，不回改（DOC-2）。

**读取顺序**：A（职责与编号约定）→ B（当前状态快照）→ C（未达标与未覆盖登记）→ D（发布与不可逆操作登记）→ E（主题索引）→ 需要追溯根因时才读历史档案。

## A. 本文件职责与编号约定

| 区       | 内容                                          | 更新时机               |
| -------- | --------------------------------------------- | ---------------------- |
| A        | 职责、结构与编号约定                          | 文档结构调整时         |
| B        | 当前状态快照（命令 + 日期 + 结果）            | 每次真实复跑后         |
| C        | 未达标与未覆盖登记（P2/P3、未闭环、Blocked）  | 状态变化时             |
| D        | 发布与不可逆操作登记（tag / CI run / digest） | 每次发布或远端重建后   |
| E        | 主题索引（按关注点查历史档案）                | 新增轮次时             |
| 历史档案 | 原 §1–§37，逐字保留                           | append-only（DOC-2）   |

- **编号约定**：历史档案沿用**原章节编号**（§1–§37）——这些编号被 `backend/internal/transport/http/frontend_exposure_test.go` 等代码注释引用（复现：`git grep -n "AUDIT.md §"`），不得重排、不得复用（META-5）。A–E 区使用字母，避免与档案编号冲突。
- **状态语义**：`Passed` / `Failed` / `Skipped` / `Blocked` / `Pending` 的定义见 `AGENTS.md` §6 与 EVID-1；未实际执行的检查只能记 `Pending` / `Blocked`。
- **本区不放**：新规则（进 `AGENTS.md`）、前端侧证据（进 `frontend/AUDIT.md`）、已闭环项的逐轮叙述（进历史档案）。

## B. 当前状态快照（可复现）

环境：Windows（本机），Go 工具链版本以 `go version` 为准，`CGO_ENABLED=0`；模块 `github.com/chenyme/grok2api/backend`。**所有命令均在 `backend/` 目录执行**（`scripts/verify.sh` 会校验 cwd，否则退出 2）。

### B.1 验收矩阵

| 编号   | 验收项             | 判定命令                                                     | 最近一次结果                                                                                                                                                |
| ------ | ------------------ | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BE-A1  | 编译               | `go build ./...`                                             | `Passed`（2026-10-13 复跑，exit 0）                                                                                                                         |
| BE-A2  | 静态检查           | `go vet ./...`                                               | `Passed`（2026-10-13 复跑，exit 0）                                                                                                                         |
| BE-A3  | 结构门禁 REV-1/2/3 | `go run ./tools/structurecheck`                              | `Passed`（2026-10-13 复跑：扫描生产 Go 文件 483 个；超限文件 / 超限函数 / 越限嵌套 当前 0、基线 0；`参与判定的作用域（REV-3）：5544 个`）                    |
| BE-A4  | 导出 API 契约门禁  | `go run ./tools/apicheck`                                    | `Passed`（2026-10-13 复跑：`基线条目 2062 条，当前 2062 条`，逐条一致）                                                                                      |
| BE-A5  | 容器构建输入守卫   | `go run ./tools/dockerfilecheck`                             | `Passed`（2026-10-13 复跑：必需文件 900 个；未被 COPY 覆盖 0、被忽略规则排除 0、COPY 源不可用 0）                                                            |
| BE-A6  | 单元与集成测试     | `go test ./... -count=1`                                     | `Passed`（2026-10-13 最终代码：由 `verify.sh` 第 6 步执行，77.356s，无 FAIL / panic；包级 `ok` 67、`[no test files]` 11；跳过明细见 BE-B2）                    |
| BE-A7  | 数据竞争           | `go test -race ./...`                                        | `Passed`（2026-10-13 最终代码：**exit 0**，517.9s；`ok` 67 包 / `FAIL` 0 / `DATA RACE` 0；本机 `CGO_ENABLED=1` 且 `gcc` 16.2.0 在 PATH，竞态检测器已用故意竞争探针验证生效） |
| BE-A8  | 集成用例 0 跳过    | CI 步骤 `Assert required integration tests ran`              | `Passed`（CI run `38359230140`，tag `v0.1.3`，conclusion=success；PR 轮 `38357136129` 同为 success） |
| BE-A9  | Swagger 精确 diff  | `make swagger` + `git diff --exit-code -- backend/docs/...`  | `Passed`（CI 步骤 `Verify Swagger document`，run `38359230140`） |
| BE-A10 | 全栈 E2E（后端侧） | CI 步骤 `Run full-stack E2E`                                 | `Passed`（run `38359230140`） |
| BE-A11 | 聚合入口           | `bash scripts/verify.sh`                                     | `Passed`（2026-10-13 最终代码：6/6 步通过，94.115s，打印 `全部通过`）。**口径**：本机默认 PATH 的 `bash` 是 WSL 启动器、其内无 Go 工具链，直接执行会 exit 127，须用 Git Bash `D:\softwares\Git\bin\bash.exe` |

### B.2 基线与口径（唯一来源）

- 结构基线：`backend/structure-baseline.json` 的 `files` / `functions` / `nesting` **均为空** → 存量 0 项，只允许持平或下降（REV-1 / REV-2 / REV-3）。
- 契约基线：`backend/api-baseline.txt`（生成命令 `go run ./tools/apicheck --update`，须满足 CHG-5 / CHG-8）；条数以 `apicheck` 输出为准，不在文档复制（META-2）。
- 口径边界（登记为 P2，不是漏报）：REV-2 按函数体行数（含签名）判定；REV-3 前后端深度基线不同，见 C 区 BE-P2-1。
- `verify.sh` 不含 `-race` 与隔离 PG/Redis 的「0 跳过」断言，二者由 CI 承担（TEST-6）。

### B.3 测试与性能基线

- 测试：最近一次全量 `go test ./... -count=1` 见 BE-A6。2026-10-13 实测（两包定向 `-v`）：**SKIP 19**（17 个 `TestPostgres*` + 2 个 Redis）/ PASS 197 / FAIL 0 —— 本机缺 `TEST_POSTGRES_DSN` / `TEST_REDIS_ADDRESS`，按 TEST-6 记 `Blocked`，由 CI 隔离服务覆盖（复现：`go test ./internal/infra/persistence/relational ./internal/infra/runtime/redis -count=1 -v | Select-String "--- SKIP"`）。
- 性能：`ns/op` / `B/op` / `allocs/op` 属**评审准则、无门禁**（REV-5）。已有基准与最近一次实测数值、`benchstat` 统计检验结论见历史档案 §13.2、§20.10、§28.1；其中 §28.1 的结论是**本机不具备 ns/op 判别力**（负面结论），稳定可比的是分配指纹。本区不复制数值（META-2）。

### B.4 架构与边界（最近一次实测）

- 分层与依赖方向由测试守卫：`internal/ports/provider/import_boundary_test.go`（`applicationInfraExceptions`）、`internal/infra/egress` 例外清单（`infraApplicationExceptions`）、`TestInternalDirectoryCoverageBoundary`（目录覆盖递归判定）。
- 目录覆盖守卫已抽为纯函数 `directoryCoverageViolations` 并带自证夹具（EVID-3）；`internal/pkg` 亦有分层规则。
- 静态托管契约的成立项与缺口见历史档案 §25.1 / §25.2，缺口登记在 C 区 BE-R1…BE-R3。

## C. 未达标与未覆盖登记（P2/P3）

> 只登记**未闭环**项；已闭环项的状态与证据在其历史档案章节。定级语义见 `AGENTS.md` §6；`Blocked` 必须写明恢复条件。

| 编号    | 项                                                                        | 定级            | 状态与恢复条件                                                                                   | 依据                              |
| ------- | ------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------ | --------------------------------- |
| BE-P2-1 | REV-3 前后端深度基线口径不同（同一输入两侧数值不同）                       | P2              | 已登记、不阻塞；两侧都会判失败，非漏报                                                           | §25.1 / §29.4                     |
| BE-P2-2 | `application → infra` 存量依赖（29 处 / 27 文件）与冻结例外清单            | P2              | 冻结例外 `applicationInfraExceptions`（27 文件 / 29 对），只允许收缩；决策：默认冻结，待负责人批准后执行（见下方「C 区决策记录」） | §5 BE-02 / §20.2                  |
| BE-P2-3 | `infra/egress` 8 个生产文件反向依赖 `application/egress`                   | P2              | 冻结例外 `infraApplicationExceptions`（8 文件），只允许收缩                                      | §31.1                             |
| BE-P2-4 | 测试文件 >600 行（38 个，最大 `gateway/service_test.go` 4928 行）          | P2              | 既有约定，不在 REV-1 扫描范围（`*_test.go` 排除）                                                | §16.4                             |
| BE-P3-1 | `backend/tools/structurecheck/main.go` 597 行，距 600 仅 3 行              | P3              | 门禁工具本体，不在 `structurecheck` 扫描范围；如需收紧可拆夹具 / 输出                             | §32.2                             |
| BE-P3-2 | `gofmt -l ./cmd ./internal ./tools` 存量未格式化文件 | P3 | **已闭环（2026-10-13 本轮）**：`HEAD` 口径实测 4 个确为 gofmt 违规 + 1 个 EOF 空行清理，已修复并随本分支 `chore(gofmt)` 提交落地；**测量口径二次更正**见下方同名 EVID-8 条目 | §32.2 / §31.4 |
| BE-G3   | `ports/security` 迁移（BA-02）                                             | P2              | 需单独批准；设计清单见 §20.6，执行时按 CHG-8 跑 `apicheck --update` 并留 §8 证据；决策：默认冻结，待负责人批准后执行（见下方「C 区决策记录」） | §20.9 / §26.4                     |
| BE-B1   | 本机无 `-race` 工具链                                                      | 已闭环          | **2026-10-13 实测推翻**：本机 `CGO_ENABLED=1`、`gcc` 16.2.0 在 PATH，`go test -race ./... -count=1` **exit 0**（489.7s）；详见 BE-A7 与下方 EVID-8 条目 | §20.9 / BE-A7                     |
| BE-B2   | 本机无隔离 PostgreSQL / Redis                                              | `Blocked`       | 恢复条件：`TEST_POSTGRES_DSN` / `TEST_REDIS_ADDRESS` 就绪后取「0 跳过」计数；CI 已覆盖            | §20.9 / §34.3                     |
| BE-R1 | 静态托管暴露面：`staticPath` 误配置指向父目录可读取 `config.yaml` / `*.db` | P2（该形态 P1） | **已闭环（2026-10-13 本轮）**：启动期 fail-fast 已实现并随本分支 `fix(backend)` 提交落地（口径更正见下方 EVID-8 条目） | §25.2 / §32.1 / §33.3 |
| BE-R2 | `index.html` 无 ETag / `must-revalidate`，保留 mtime 时返回 304 陈旧 HTML | P2 | **已闭环（2026-10-13 本轮）**：`ETag = sha256(内容)` + `Cache-Control: no-cache, must-revalidate` + 零 mtime（不发 `Last-Modified`），已实现并随本分支 `fix(backend)` 提交落地 | §25.2 |
| BE-R3   | Go 侧零传输压缩 ⇒ 预算口径（磁盘 gzip）≠ 线上传输量                        | P2              | 已写入 `AGENTS.md` REV-5 的口径说明；如需改变须独立任务 + 实测收益                                | §25.2 / REV-5                     |
| BE-R4   | 凭据元数据「彻底清除」不可保证（GitHub 缓存 / 索引、已克隆副本、CI 日志）  | —               | 残留风险，如实登记；**不得**声称已彻底清除                                                        | §36.4 / `frontend/AUDIT.md` §38.5 |
| BE-R5   | 历史重写剥离 `gpgsig`（本地上游已签名提交换 sha；tree / parent / message 未变） | —          | 副作用登记；上游 tag 从不推送，无远端影响                                                         | §37                               |
| BE-R6   | 历史档案 §31.4 / §31.5 登记的提交 `93954469` 不可解析（历史重写前谱系）   | —               | 事实登记：`git cat-file -t 93954469` → `fatal: Not a valid object name`（2026-10-13 本机实测）；该对象不在本仓库对象库，属历史重写前谱系；按 DOC-2 不改档案原文，仅在此登记 | §31.4 / §31.5                     |

**C 区口径更正（EVID-8，条目 BE-R1 / BE-R2；原值保留不回改，DOC-2）**：两条原登记为「未实施 / 登记」，工作区**已实现**（相对 `HEAD` = `45838afe` 的新增代码，**未提交**）。

- **BE-R1 原值 → 新值**：「未实施：启动期 fail-fast 或托管白名单」→「**已实现**：`registerFrontend` 在托管前调用 `staticRootExposureViolation`，命中即 `panic` 拒绝启动（fail-closed，不静默降级）」。判定覆盖四类：① 静态根**覆盖进程工作目录**（`workingDirCoverageViolation`，`staticPath` 为 `.` 或其上级）；② 敏感条目名（唯一判定入口 `isDeniedStaticRootName`：精确名单 `.env` / `.git` / `config.yaml` / `config.yml`，模式 `config.*.yaml|yml` 与 `.env*`，后缀 `.db` / `.sqlite` / `.sqlite3` / `.exe` 且比对前剥离 `-wal` / `-shm`）；③ **符号链接与 Windows 重解析点/junction**（`entry.Type()&fs.ModeSymlink` 或 `&fs.ModeIrregular`——`filepath.WalkDir` 不进入二者，不判即构成绕过）；④ 扫描条目数超过 `staticRootScanEntryBudget`（20000）。另有放行名单 `staticRootAllowedNames`（`thumbs.db` / `desktop.ini`）在最前短路：这两类是 Windows 系统垃圾文件、与秘密无关，误判会让服务无法启动（`frontend/dist` 含图片）。
- **BE-R2 原值 → 新值**：「登记；正确性依赖『部署会改变 mtime』这一外部假设」→「**已实现**：`serveIndexHTML` 以 `sha256(文件内容)` 作为 `ETag`、`Cache-Control: no-cache, must-revalidate`，并给 `http.ServeContent` 传零 `mtime`（不发 `Last-Modified`，条件判定只看 ETag）；ETag 与响应体来自同一次 `os.ReadFile`」。
- **根因**：C 区两条登记取自实现前的快照，未随本轮实现回填（登记滞后，EVID-8），不是实现缺口。
- **落点**：`backend/internal/transport/http/frontend.go`（`registerFrontend`、`serveIndexHTML`、`staticRootExposureViolation`、`isDeniedStaticRootName`、`workingDirCoverageViolation`、`hasDotDotPathElement`）；测试 `backend/internal/transport/http/frontend_exposure_test.go`。
- **验证（2026-10-13 本机实测，工作区含未提交改动）**：全量结果见 B 区（`bash scripts/verify.sh`、`go test -race ./...`）；定向 `cd backend && go test ./internal/transport/http/... -count=1 -v -run 'Frontend|Exposure|Static'` **exit 0**，包内 PASS 75 / FAIL 0 / SKIP 0。
- **判别力（TEST-7，2026-10-13）**：用 `go test -overlay=` 注入 5 个变异（分别删掉模式判定、链接判定、`-wal`/`-shm` 剥离、放行名单短路、HEAD 的 `Cache-Control`），每个变异都至少有一个用例失败；注入副本只写在会话 scratch，工作区未被修改。
- **复现**：`cd backend && go test ./internal/transport/http/... -count=1 -v -run 'Frontend|Exposure|Static'`。
- **回滚**：`git checkout -- backend/internal/transport/http/frontend.go backend/internal/transport/http/frontend_exposure_test.go backend/internal/transport/http/server_test.go`（仅这三个文件；**不得**对整树执行 `reset --hard` / `restore`）。

**C 区口径更正（EVID-8，条目 BE-B1；原值保留不回改，DOC-2）**：原登记「本机无 `-race` 工具链（`CGO_ENABLED=0`，Windows / 无 gcc）」**已被 2026-10-13 实测推翻**。

- **原值 → 新值**：「`Blocked`：本机 `CGO_ENABLED=0` 无 race 工具链」→「**本机可执行**：`CGO_ENABLED=1`、`go env CC=gcc`、`gcc.exe (MinGW-W64 x86_64-ucrt-posix-seh) 16.2.0` 在 PATH，`go test -race ./... -count=1` **exit 0**（489.7s，`ok` 67 包 / `FAIL` 0 / `DATA RACE` 0）。竞态检测器已用「故意双 goroutine 无锁自增」探针验证确实生效（探针报 `WARNING: DATA RACE` 且 exit 1），故该 exit 0 可采信。
- **残余事实（不得据此声称全覆盖）**：该运行对 17 个 `TestPostgres*` + 2 个 Redis 集成用例仍是 `SKIP`（`TEST_POSTGRES_DSN` / `TEST_POSTGRES_ADMIN_DSN` / `TEST_REDIS_ADDRESS` 为空），故本地 `-race` **不覆盖**这些用例；CI 步骤 `Race backend` 仍作为独立环境复核保留。
- **同步修正的文档**：`backend/scripts/README.md` 的「本机不能覆盖、必须由 CI 承担的项」表中 `go test -race ./...` 一行（原写「race 检测需要 cgo 与 C 工具链，本机（Windows / 无 gcc）不可用」）已按实测改为「本机可执行」并附命令、日期与上述残余事实（DOC-1：与配置/脚本的实际行为一致）。
- **复现**：`cd backend && go env CGO_ENABLED && gcc --version && go test -race ./... -count=1`。
- **历史档案不改**：历史档案区（§20.8 的「本机限制」段与 §31.3 的命令表）仍含「本机 `CGO_ENABLED=0` / `-race` 不可执行」的原结论，按 DOC-2 **逐字保留、不回改**；当前状态一律以本区（A–E）为准。

**C 区口径更正（EVID-8，条目 BE-P3-2；原值保留不回改，DOC-2）**：原登记的「`gofmt -l ./cmd ./internal ./tools` 存量 5 个未格式化文件」属 **LF 工作区口径**。本机 `git config core.autocrlf` = `true`，工作区 `.go` 多为 CRLF，直接运行该命令得到 **311** 个命中，差异全部来自行尾 —— 即该命令的原始输出**不得采信**（DEV-5）。正确判定链：字节级读取（`[System.IO.File]::ReadAllText($p, [System.Text.Encoding]::UTF8)` / `ReadAllBytes`，禁止用 `Get-Content` 判行数）→ CRLF 归一化为 LF 写入**工作区外**临时副本 → 对副本跑 `gofmt -l`。
- 留痕更正：**原值 5（LF 工作区口径，历史档案 §32.2）→ 新值 0**（2026-10-13 本轮实测：`./cmd ./internal ./tools` 全量归一化副本，`gofmt -l` 无输出）。原「5」在本机不可复现（当时检出环境未登记）；「5 → 0」的成因不在本轮取证范围，不臆断，仅登记实测值。**根因**：CRLF 检出使 `gofmt -l` 产生约 300 个行尾假阳性（本轮实测 311 个）。
- 复现（PowerShell，在 `backend/` 目录执行；只写 `$env:TEMP`，不触碰工作区）：
```powershell
$tmp = Join-Path $env:TEMP 'gofmt-lf-check'; Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
$root = (Get-Location).Path
Get-ChildItem -Path .\cmd,.\internal,.\tools -Recurse -File -Filter *.go | ForEach-Object {
  $dst = Join-Path $tmp $_.FullName.Substring($root.Length + 1)
  New-Item -ItemType Directory -Force -Path (Split-Path $dst) | Out-Null
  $lf = [System.IO.File]::ReadAllText($_.FullName, [System.Text.Encoding]::UTF8) -replace "`r`n", "`n"
  [System.IO.File]::WriteAllText($dst, $lf, (New-Object System.Text.UTF8Encoding($false)))
}
@(gofmt -l $tmp).Count                      # 归一化口径：本轮实测 0
@(gofmt -l .\cmd .\internal .\tools).Count  # CRLF 原始输出：本轮实测 311（假阳性，不可采信）
```

**C 区口径更正（EVID-8，条目 BE-P3-2 的二次更正；上一条更正文本保留不回改）**：上一条把「存量 5 → 0」记为「原值不可复现」，该结论建立在**错误的工作区口径**上，现更正。

- **根因**：上一条的复现脚本用 `Get-ChildItem -Recurse -File` 读取**工作区**文件，而当时工作区**已经含有未提交的 gofmt 修复**（即 C 区 BE-P3-2 行所述的修复），因此测得 0 是「工作区已修」的结果，不是「`HEAD` 无债务」的证据。
- **2026-10-13 本次实测（字节级归一化为 LF 后交给 `gofmt -l`，Go 1.26.1）**：`HEAD`（`45838afe`）上有 **4 个**文件确为 gofmt 违规——`backend/internal/application/gateway/selector_test.go`、`backend/internal/infra/provider/web/account_settings.go`、`backend/internal/infra/provider/web/sso_build_test.go`、`backend/internal/transport/http/swagger_annotations.go`；**工作区（含未提交修复）为 0 个**。第 5 个改动文件 `backend/internal/ports/provider/video_error.go` 只删除了文件末尾的多余空行，`gofmt -l` 不判定，属人工清理，不计入 gofmt 违规数。
- **结论**：原登记「存量 5 个」在 `HEAD` 上**可复现**（本次测得 4 个；第 5 个口径不同，见上），**不是**「不可复现」；「5 → 0」的成因是**工作区已修复**，而非检出环境差异或工具版本差异。
- **复现命令**（在 `backend/` 目录执行；只写 `$env:TEMP`，不触碰工作区）：
```powershell
$files = git ls-files -- '*.go'
$work = Join-Path $env:TEMP 'gofmt-work'; $head = Join-Path $env:TEMP 'gofmt-head'
Remove-Item $work,$head -Recurse -Force -ErrorAction SilentlyContinue
foreach ($rel in $files) {
  $text = [System.Text.Encoding]::UTF8.GetString([System.IO.File]::ReadAllBytes((Join-Path (Get-Location) $rel)))
  $dest = Join-Path $work ($rel -replace '/','\'); New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
  [System.IO.File]::WriteAllText($dest, ($text -replace "`r`n","`n"), (New-Object System.Text.UTF8Encoding($false)))
  $destHead = Join-Path $head ($rel -replace '/','\'); New-Item -ItemType Directory -Force -Path (Split-Path $destHead) | Out-Null
  [System.IO.File]::WriteAllText($destHead, ((git show "HEAD:$rel") -join "`n"), (New-Object System.Text.UTF8Encoding($false)))
}
"工作区口径（本轮实测 0）: " + @(gofmt -l $work).Count
"HEAD 口径（本轮实测 4）: " + @(gofmt -l $head).Count
```

**C 区决策记录（BE-P2-2 / BE-G3；默认值推进，非已获授权的执行）**：默认决策为 **本轮不执行 `ports/security` 迁移**（`BE-G3` / `BA-02`）；`application → infra` 存量依赖（`BE-P2-2`）继续按 `applicationInfraExceptions` 冻结为**只减不增**的例外清单，本轮不新增例外、不扩大清单。
- 依据（两条均为计划；计划位于 `.pi/plan/`，被 `.gitignore` 忽略 ⇒ **不入库、不可追溯**，按 DOC-3 在此说明文件名与定位）：
  - `前后端验收审计与增量模块化优化计划-20261011-1936.md` §六「完成标准、剩余边界与回滚」→「不自动扩大的边界」：`ports/security` 全面迁移需要**构造签名和 API 基线的单独批准**；本轮可先完成边界约束、回归和迁移设计。
  - `前后端全量审计与分阶段模块化升级计划-20261009-1947.md` §一「已对齐的需求与边界」→「保持不变」：数据迁移、公共协议变化若确有必要，须**单独说明证据并重新确认**，不夹带实施。
- 执行条件（同时满足，缺一不可）：① 负责人对 `ports/security` 迁移的**单独批准**（构造签名与 API 基线影响面明确）；② 迁移落地后由生成命令改写 `backend/api-baseline.txt`（`go run ./tools/apicheck --update`，CHG-8；且须满足 CHG-5 的静止状态）；③ 走 §8 发布/不可逆流程并留 §8 证据。
- 复现命令（确认现状未被改变）：`git ls-files backend/internal/ports/`（本轮实测只输出 `provider`，`ports/security` 未建立）；`git grep -n "infra/security" -- backend/internal/application ":(exclude)*_test.go"`（本轮实测 16 个生产文件，仅表示 `infra/security` 直接 import 面）；例外表全量计数（期望 27 文件 / 29 对）：
```powershell
$t = [System.IO.File]::ReadAllText('backend/internal/ports/provider/import_boundary_test.go', [System.Text.Encoding]::UTF8)
$b = [regex]::Match($t, '(?s)var applicationInfraExceptions = map\[string\]\[\]string\{(.*?)\n\}').Groups[1].Value
@([regex]::Matches($b, '(?m)^\s*"internal/application/[^"]+":')).Count      # 27 文件
([regex]::Matches($b, 'internalModulePrefix \+ "')).Count                    # 29 对
```
  `go run ./tools/apicheck` 的条数以 B 区 BE-A4 为准（不得由迁移静默改写）。
- 回滚方式：该决策的执行动作是「不执行」，故无代码、无数据、无基线副作用；回滚 = 不实施（无操作）。若日后按执行条件启动，回滚为 `git revert` 对应迁移提交，并由生成命令把 `api-baseline.txt` 恢复到上一版（不手改，CHG-8）。
- 性质：本条是 **EXEC-7 默认值推进**下的假设登记，**不是已获授权的执行**；授权的唯一登记处是 D 区「授权登记」，未点名的新一轮不可逆操作仍需单独授权（CHG-9）。

## D. 发布与不可逆操作登记

> 登记项必须附 run id + step + conclusion（EVID-2）。**授权登记见本区 D.5**（`AGENTS.md` §1 只保留指针，依据 DOC-1 / META-3）。

### D.1 当前发布状态

| 版本     | tag / 提交                                                | Release            | CI run（GHCR Image）                        | 镜像 digest（manifest list）                                                                                                                                                                        |
| -------- | --------------------------------------------------------- | ------------------ | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `v0.1.1` | annotated tag `v0.1.1`（tag 对象 `692ce6a5`）→ `00120cea` | 已创建（非 draft；`publishedAt` `2026-10-12T15:03:49Z`） | `38267217186`（`push`，ref `v0.1.1`）success | `sha256:e0a2f395423afdcb097e1c5646cf4756e90cb3ca2ce68c1d4dbecec62d7e0f06` |
| `v0.1.3` | annotated tag `v0.1.3`（tag 对象 `af8182cd`）→ `ca31f056`（tag 之后的 `main` 前进见下行） | 已创建（非 draft、非 prerelease；`createdAt` `2026-10-13T06:52:32Z`、`publishedAt` `06:53:03Z`） | `38359230140`（`push`，ref `v0.1.3`）success | `sha256:2d07cf9f49d14c443fa2b518aebb4000d62e64a7551566cac2b00aff85ebc8c6` |
| `main` | 当前 tip `48477f2d`（与 `origin/main` 同步；`ca31f056` 之上的发布后登记提交 `docs(audit): 登记 v0.1.3 发布证据（EVID-2）`） | — | `38359192192`（`push`，ref `main`，head `ca31f056`）success；`38361945663`（`push`，ref `main`，head `48477f2d`）success | `main` / `latest` manifest list `sha256:1ea4cb5d4a18ce8a41fd1ac098a614f6786cea7ba05d8f0578916502f0192f82`；平台标签 `main-amd64` `sha256:4f454572fad3874b154e6236f899c87d4feda64c9e2d00a9f15ee0987bd25758`、`main-arm64` `sha256:47b147e84a1ff1bfe090e919a1d6b359a672e36125cbc3eec5b4934c0e56ced1` |

- `v0.1.1` 的 `Verify` job 关键 step 全部 `success`：`Verify version carriers are aligned`、`Test backend`、`Assert required integration tests ran`、`Race backend`、`Vet backend`、`Verify backend structure and API contract`、`Verify Dockerfile covers required inputs`、`Verify Swagger document`、`Verify frontend`、`Run full-stack E2E`、`Assert required frontend tests ran`；`Publish image (amd64)` / `Publish image (arm64)` / `Merge image` 同为 `success`。
- `v0.1.1` 镜像明细（注册表实测，2026-10-13）：`ghcr.io/jasminetony/grok2api:v0.1.1`（`application/vnd.oci.image.index.v1+json`）linux/amd64 `sha256:7453a6efc7fdabb371dd4959bbc026103b535304266b58944f1bf3659426698a`、linux/arm64 `sha256:1d040f5998fe5ce14a3712cea385620e70f723a3cf492c10970d20e3cb9f858f`；平台标签 `v0.1.1-amd64` `sha256:5f953a5c0e4d9d9a8d09e4485eb4d50484115c431f89f5ccd902d71b9cc4e3b1`、`v0.1.1-arm64` `sha256:a8fc0b445dffe9ff4c4ef4ae958742517a4001de9ddb6264076a69276c5182ed`。复现命令：`gh api 'users/JasmineTony/packages/container/grok2api/versions?per_page=100'`。
- 按 `AGENTS.md` §8 固有局限：本条登记提交自身的 run 不在本文件覆盖范围内；完整逐 step 证据见 `frontend/AUDIT.md` §39 与本文件 §37。
- `v0.1.3` 的 `Verify` job 关键 step 全部 `success`（run `38359230140`，30 步）：`Verify version carriers are aligned`、`Test backend`、`Assert required integration tests ran`（PostgreSQL/Redis 集成用例 0 跳过）、`Race backend`、`Vet backend`、`Verify backend structure and API contract`、`Verify Dockerfile covers required inputs`、`Verify Swagger document`、`Verify frontend`、`Run full-stack E2E`、`Assert required frontend tests ran`；`Publish image (amd64)` / `Publish image (arm64)` / `Merge image` 同为 `success`。
- `v0.1.3` 镜像明细（注册表实测，2026-10-13）：`ghcr.io/jasminetony/grok2api:v0.1.3` = `sha256:2d07cf9f49d14c443fa2b518aebb4000d62e64a7551566cac2b00aff85ebc8c6`（manifest list）；`v0.1.3-amd64` = `sha256:331e3beff93353173cf962da966a11e1031266bda97791c980cb15d02e7494d4`、`v0.1.3-arm64` = `sha256:fc19f5fbe6164eb3a99a0e8800122f32e0fc3086a489c4f422c677b83e215e62`。复现命令：`gh api 'users/JasmineTony/packages/container/grok2api/versions?per_page=20'`。
- **先取 PR 轮 CI 证据再动 `main`**：`38357136129`（`pull_request`，head `ca31f056`）的 `Verify` job 30 步中 **29 success + 1 `skipped`**（`Upload Playwright artifacts`：产物上传步骤，非门禁步骤；run `38359230140` 与 `38361945663` 同口径），用于在合并前验证 CI 环境（含本机 `SKIP` 的 19 个 PostgreSQL/Redis 集成用例），而不是只依赖本机结果。`main` 推送轮 `38359192192` 与 CodeQL 推送轮 `38359192152` 同为 `success`；发布后登记轮 `38361945663`（`GHCR Image`，head `48477f2d`）与 `38361945703`（`CodeQL Advanced`）同为 `success`。复现命令：`gh run view <run id> -R JasmineTony/grok2api --json jobs`。
- **发布后登记（tag 之外的登记提交）**：tag `v0.1.3` 指向发布提交 `ca31f056`；其后的登记提交（`48477f2d` 与本轮登记提交）不在 tag 内，按 §8 固有局限，tag 内容不随登记更新（移动 tag 属不可逆操作，须单独授权，CHG-9）。复现：`git log --oneline v0.1.3..main`。

### D.2 远端重建与容器包（不可逆操作，2026-10-12 执行轮）

- 仓库：旧实例 id `1413858145` 已删除；新实例 id `1415744814`（public、非 fork、默认分支 `main`、Actions 默认权限 `read`）。
- 容器包：旧实例 id `15784723` 已删除；新实例 id `15829871`，`repository=JasmineTony/grok2api`（**已正确链接**；未链接时 `GITHUB_TOKEN` 即使声明 `packages: write` 也会以 `permission_denied: write_package` 失败，见 §26.3）。
- 只推送 `main` 与 `refs/tags/v0.1.1`（逐 ref 指定，未用 `--tags` / `--mirror`），故上游历史 tag 与本地 `v0.1.2` / `v0.1.3` 均未进入远端。

### D.3 凭据与推送通道

- 凭据一律由本地凭据助手提供，**不登记任何元数据**（SEC-1）；HTTPS 推送是否携带 `workflow` 权限必须逐次实测，不得据凭据名称或历史作用域推断。
- 含工作流定义的推送走 SSH（`ssh -T git@github.com` 回显 `Hi <owner>!`）；SSH 不携带 OAuth scope，故不受该限制，且只改变推送通道、不改变被验证的提交内容。

### D.4 未收口项与残留风险

- 清除范围外的残留面（GitHub 侧提交缓存 / 搜索索引、已克隆副本、CI 日志与缓存、GHCR 旧镜像层）见 C 区 BE-R4 与 `frontend/AUDIT.md` §38.5。
- 远端重建的代价：原 PR、Release 历史与旧 Actions run 丢失；`v0.1.1` 镜像需重新拉取（digest 与旧值不同）。

### D.5 授权登记（决策记录，append-only）

> 由 `AGENTS.md` §1 迁入（原表逐字保留）。依据 DOC-1 / META-3：**授权是决策记录而非规则**，唯一登记处在本区；`AGENTS.md` §1 只保留指针。本表只增不改，新增授权在末尾追加（META-5）；授权只覆盖被点名的动作与范围，未点名的新一轮不可逆操作仍需单独授权（CHG-9）。

| 日期       | 授权范围                                                                                                                                                              | 证据                            |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| 2026-10-10 | 把 `maint/modular-quality-audit` 合并到 `main` 并发布 `v0.1.1`                                                                                                         | `frontend/AUDIT.md` D 区        |
| 2026-10-11 | 合并到 `main` 并发布 `v0.1.2`（annotated tag + GitHub Release + GHCR 镜像）；同一授权内重建远端 `origin`、删除历史 GHCR 容器包                                          | `frontend/AUDIT.md` D 区        |
| 2026-10-12 | 把交付线 `maint/release-v0-1-3`（并入 `maint/acceptance-audit-20261012-final`）合并到 `main` 并发布 **`v0.1.3`**（版本号由负责人指定，原计划 `v0.1.15` 作废，属决策变更） | `frontend/AUDIT.md` D 区        |
| 2026-10-12 | **新规则，取代此前「不直接合并 `main`、不部署、不发布」的约束**：把本地**全部分支**并入 `main` 并发布；冲突时**以当前状态为准**（REL-1）                                | REL-1、`frontend/AUDIT.md` §20  |
| 2026-10-12 | 推送凭据元数据清除与重发：删除并重建远端 `origin`，清除文档中已公开的推送凭据元数据（含历史重写），重发 `v0.1.1`，推送通道收紧为 SSH-only                              | `frontend/AUDIT.md` §38         |
| 2026-10-12 | **收口轮（部分取代上一条的执行口径）**：**不撤销 OAuth 授权**；推送凭据只存放于本地凭据助手，不登记、不推送任何凭据元数据；重建后**仅重发 `v0.1.1`**                     | `frontend/AUDIT.md` §38.6       |
| 2026-10-12 | **执行轮**：按「本地修改 → worktrees 梳理 → 删除远端 `origin` 仓库与 GHCR 容器包 → 重建同名仓库 → 仅重发 `v0.1.1`」执行；`origin` 以 HTTPS 取、SSH 推；远端不得出现任何凭据或凭据元数据 | `frontend/AUDIT.md` §39         |
| 2026-10-13 | **v0.1.3 发布（本轮）**：在当前 `main` 线（`45838afe`）切维护分支 `maint/release-v0-1-3-20261013` 提交本轮工作区改动；**移动**本地 annotated tag `v0.1.3`（原 `fe209ccd` → `6b69e01e`，远端从未存在）到新的发布提交；fast-forward 合并 `main` 并推送 `origin`；创建非 draft GitHub Release；推送 tag 触发 `ghcr-image.yml` 产出 `ghcr.io/jasminetony/grok2api:v0.1.3` 的 amd64 + arm64 与 manifest list | 本条 + D.1 `v0.1.3` 行 |

> **证据列指针说明（append-only：不修改既有行，仅追加）**：上表 `2026-10-10`–`2026-10-12` 各行的「证据」列原指向 `frontend/AUDIT.md` D 区；该 D 区现为指针表（无授权表，见其 `D. 发布登记（前端侧）`），对应证据实际位于 `frontend/AUDIT.md` 历史档案区：`v0.1.1` 见 §14、`v0.1.2` 见 §16、`v0.1.3` 见 §38.3。复现：`git grep -n "^## 14\.\|^## 16\.\|^### 38\.3" -- frontend/AUDIT.md`。
**授权与版本载体的当前差异（开放项，待负责人一次性决策）**：授权表已记录「发布 `v0.1.2`」「发布 `v0.1.3`」，但**远端当前只发布 `main` 与 `refs/tags/v0.1.1`**，且 `main` tip 的版本载体已由 `cb974efb`（`chore(release): 版本载体对齐到 v0.1.1`）回退为 `v0.1.1`。因此「已授权发布」不等于「已发布」：发布 `v0.1.2` 需要先明确目标提交与目标版本号，并处理已存在的本地 annotated tag `v0.1.2`（移动同名 tag 属不可逆操作，须单独授权，CHG-9）。

- 复现命令：`git tag --list "v0.1.*"`、`git show v0.1.2:VERSION`、`git show v0.1.3:VERSION`、`git ls-remote --tags origin`、`git rev-parse HEAD`。
- 事实（2026-10-13 实测）：`v0.1.2`（tag 对象 `5bb19073`）→ `6458e1c8`（该提交 `VERSION=v0.1.2`）；`v0.1.3`（tag 对象 `fe209ccd`）→ `6b69e01e`（`VERSION=v0.1.3`）；两者均为 `main` 的祖先提交；`main` tip `45838afe` 的 `VERSION=v0.1.1`。


**2026-10-13 更新：上述「授权与版本载体差异」开放项已由负责人本轮指令关闭（原登记文本按 DOC-2 保留不回改）**

- 决策：采用计划 §5.3 的**路径 P2** —— 在**当前 `main` 线**上提版本到 `v0.1.3`，并**移动同名本地 annotated tag** 到新的发布提交。依据：`.pi/plan/计划完成度核对与-v0-1-2-发布收敛计划-20261013.md` §5.3（该文件被 `.gitignore` 忽略 ⇒ 不入库、不可追溯，按 DOC-3 在此说明文件名与定位）；负责人本轮指令为「任务完成后发布新的版本 v0.1.3」。
- 排除路径的理由：**P1**（直推既有 tag `v0.1.3` → `6b69e01e`）会发布不含 `v0.1.1` 重发之后全部修复与门禁的旧树；**P3**（改用未占用新号）与本轮指定的版本号不符。远端从未存在 `v0.1.2` / `v0.1.3`（`git ls-remote --tags origin` 只有 `refs/tags/v0.1.1`），故移动同名 tag **不涉及远端强推**。
- 被移动 tag 的原值（2026-10-13 实测，保留留痕）：`v0.1.3` = tag 对象 `fe209ccd` → 提交 `6b69e01e`（该提交 `VERSION=v0.1.3`，为 `main` 的祖先；tag 于 2026-10-12 历史重写后重打，taggerdate `2026-10-12 19:43:31 +0800`）。`v0.1.2`（tag 对象 `5bb19073` → `6458e1c8`）**本轮不动**，保留为历史遗留 tag。
- 版本载体：`VERSION` 与 `frontend/package.json:version` 在同一改动内对齐到 `v0.1.3`，由 `pnpm check:version`（`pnpm verify` 第 1 步）与 CI 步骤 `Verify version carriers are aligned` 双向强制（REL）。
- 复现命令：`git tag --list "v0.1.*"`；`git for-each-ref --format='%(refname) %(objectname) %(taggerdate:iso)' refs/tags/v0.1.*`；`git ls-remote --tags origin`；`git rev-parse HEAD`。

## E. 主题索引（按关注点查历史档案）

| 关注点                                                        | 历史档案章节                                           |
| ------------------------------------------------------------- | ------------------------------------------------------ |
| 阶段 0–7 验收矩阵与阶段遗留                                    | §1–§13                                                 |
| 发布登记（`v0.1.1` / `v0.1.2` / `v0.1.3` 授权与证据）          | §14、§15、§35–§37                                      |
| 结构债务清零（REV-1 / REV-2 / REV-3）                          | §16、§17、§18.2、§31                                   |
| 门禁工具与自证（structurecheck / apicheck / dockerfilecheck）  | §18.1、§29、§31.2、§34.5                               |
| 判别力取证（TEST-7 变异注入）                                  | §20.3、§20.4、§22.3                                    |
| 静态托管暴露面与表征测试                                       | §20.7、§25、§32.1、§33.3、§34.1、§34.2                 |
| CodeQL 告警 triage                                             | §24、§27                                               |
| 容器构建缺陷与镜像发布                                         | §15.2、§26.3、§37                                      |
| benchmark 与统计检验                                           | §13.2、§20.10、§28                                     |
| CI 证据与更正（EVID-8 / EVID-9）                               | §20.13、§21.2、§26.2、§35                              |
| flaky 用例与收口                                               | §16.2、§30.2、§34.4                                    |
| 凭据元数据清除与远端重建                                       | §35.3、§36、§37（并见 `frontend/AUDIT.md` §38、§39）   |
| 授权登记（决策记录，append-only）                             | D.5                                                    |

---

## 历史档案（原编号 §1–§37，append-only）

> **约定**：以下章节是历次轮次的原始登记，**编号与内容保持原样**（DOC-2）：编号被代码注释与门禁脚本引用（META-5），不得重排；被后续轮次取代的结论只在其所在章节追加指针，不回改。**当前状态一律以 A–E 区为准。**

### 原文件头部（阶段 0 基线元信息，逐字保留）

- 基线提交：`7c0493a2`
- 维护分支：`maint/modular-quality-audit`
- 环境：Windows 11 Pro (10.0.26300)，Go `1.26.1 windows/amd64`，`CGO_ENABLED=0`，`GOFLAGS=-mod=readonly`，`GOPROXY=off`（模块缓存已就绪）
- 模块：`github.com/chenyme/grok2api/backend`，`go 1.26`
- 基线采集时已清空 `TEST_POSTGRES_DSN`、`TEST_POSTGRES_ADMIN_DSN`、`TEST_REDIS_ADDRESS`，未连接任何真实服务

## 1. 验收矩阵

| 编号  | 验收项            | 判定命令                                | 基线状态                                                                   |
| ----- | ----------------- | --------------------------------------- | -------------------------------------------------------------------------- |
| BE-A1 | 单元/集成测试     | `go test ./... -count=1`                | Passed（63 包，2820 用例，0 失败，20 跳过）                                |
| BE-A2 | 静态检查          | `go vet ./...`                          | Passed                                                                     |
| BE-A3 | 编译              | `go build ./...`                        | Passed                                                                     |
| BE-A4 | 竞态检测          | `go test -race ./...`                   | Passed（CI，见 §8）；本机 **Blocked**（`-race requires cgo`，无 C 编译器） |
| BE-A5 | PostgreSQL 集成   | 隔离 CI 服务                            | Passed（CI，17 个用例真实执行）                                            |
| BE-A6 | Redis 集成        | 隔离 CI 服务                            | Passed（CI，3 个用例真实执行）                                             |
| BE-A7 | 性能基准          | `-bench . -benchmem -count=5`           | Passed（本机 5 次取中位数实测表，见 §3；CI 不跑 benchmark）                |
| BE-A8 | 账号分页聚合基准  | 新增 benchmark                          | Passed（阶段 4 已补 `BenchmarkServiceListPageAggregation`，见 §3/§10/QA-03） |
| BE-A9 | Swagger 精确 diff | `make swagger` + `git diff --exit-code` | Passed（CI `Verify Swagger document` step success，见 §8/§14）             |

`Blocked` 与 `Skipped` 均不记为通过。BE-A4/BE-A5/BE-A6 已由 CI 隔离服务补齐，证据见 §8；本机仍不具备 race 与外部存储条件。

## 2. 测试基线明细

- 包级：`pass=64`，`fail=0`，`skip=11`（2026-10-11 本机复测；阶段 0 基线为 `pass=63`）
- 用例级：`pass=2935`，`fail=0`，`skip=20`（2026-10-11 本机复测；阶段 0 基线为 2820）
- 耗时（2026-10-11 本机复测，与前端覆盖率门禁**并发**运行、CPU 竞争，仅作参考；阶段 0 基线为 `go test -json ./... -count=1` 118.6s / `go vet` 4.7s / `go build` 6.1s）：`go test ./... -count=1` 142.7s；`go vet ./...` 13.1s；`go build ./...` 10.6s
- 跳过的 20 个用例全部是外部存储集成测试，缺少环境变量即跳过：

| 包                                      | 用例数 | 依赖                                            |
| --------------------------------------- | -----: | ----------------------------------------------- |
| `internal/infra/persistence/relational` |     17 | `TEST_POSTGRES_DSN` / `TEST_POSTGRES_ADMIN_DSN` |
| `internal/infra/runtime/redis`          |      2 | `TEST_REDIS_ADDRESS`                            |
| `internal/application/account`          |      1 | `TEST_REDIS_ADDRESS`                            |

其中包含并发与一致性关键用例（如 `TestPostgresBillingReservationAndAuditSettlementConcurrency`、`TestPostgresAuditBatchUsesStableClientKeyLockOrder`、`TestPostgresAccountLinkMutationLockSerializesTransactions`、`TestRedisQuotaRefreshCrossInstanceTrailing`）。本机无证据；**阶段 2 已在 CI 隔离服务中真实执行**，见 §8。

已有可复用的隔离机制：`postgres_integration_test.go` 的 `TestMain` 支持用 `TEST_POSTGRES_ADMIN_DSN` 自动创建并回收临时数据库（`grok2api_phase0_<纳秒>`），CI 应直接复用而不是另建一套。

## 3. 性能基线

- 已存在的 benchmark（阶段 0 基线为 12 个；当前工作树 Grep `^func Benchmark` 实测 **19 个**，含阶段 4 新增的 `BenchmarkServiceListPageAggregation` 与 §13.2 新增的 6 个 `infra/provider/web` 基准）：

| 文件                                                                         | Benchmark                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `internal/infra/persistence/relational/routing_projection_benchmark_test.go` | `BenchmarkRoutingAccountBaseProjectionWithLargePayloads`（300 账号 + 大 JSON 负载）、`BenchmarkSelectedCredentialHydration`                                                                                                                      |
| `internal/application/gateway/selector_layered_benchmark_test.go`            | `BenchmarkSelectorMultiModelCandidateLoad`（300 账号 × 2/8 模型）                                                                                                                                                                                |
| `internal/application/gateway/selector_test.go`                              | `BenchmarkSelectorCandidatePlanning`                                                                                                                                                                                                             |
| `internal/application/gateway/selector_segmented_active_test.go`             | `BenchmarkSelectorSegmentedCandidatePlanning`                                                                                                                                                                                                    |
| `internal/application/audit/service_benchmark_test.go`                       | `BenchmarkAuditServiceSQLite`                                                                                                                                                                                                                    |
| `internal/infra/persistence/relational/dashboard_repository_test.go`         | `BenchmarkDashboardUsageAggregate`                                                                                                                                                                                                               |
| `internal/infra/egress/manager_test.go`                                      | `BenchmarkManagerAcquireCachedBuild`                                                                                                                                                                                                             |
| `internal/transport/http/inference/handler_test.go`                          | `BenchmarkFirstTokenInspection`                                                                                                                                                                                                                  |
| `internal/transport/http/middleware/request_test.go`                         | `BenchmarkRequestBodyObservation`                                                                                                                                                                                                                |
| `internal/infra/runtime/memory/store_test.go`                                | `BenchmarkConcurrencyLimiterCurrentMany`                                                                                                                                                                                                         |
| `internal/pkg/perfmetrics/registry_test.go`                                  | `BenchmarkRegistryParallel`                                                                                                                                                                                                                      |
| `internal/infra/provider/web/benchmark_test.go`                              | 阶段 6 收尾新增 6 个：`BenchmarkConsumeJSONObjects`、`BenchmarkParseUpstreamFrame`、`BenchmarkNormalizeOpenAIInput`、`BenchmarkBuildOpenAIChatResult`、`BenchmarkParseWeeklyCreditsResponse`、`BenchmarkInferWebTierFromQuota`（实测值见 §13.2） |

- **缺口**：`internal/application/account` 包不存在任何 benchmark（阶段 0 核实；**已由阶段 4 的 `list_page_benchmark_test.go::BenchmarkServiceListPageAggregation` 补齐**，见 §10）。而账号列表是全站最重的读路径——`Service.List` 每页要执行 6 次批量查询（账号分页、审计 token 汇总、billing、quota recovery、quota windows、model quota blocks）。阶段 4 已补分页聚合基准，见 §10 与 §13.2。
- 基准命令（后续阶段必须用同一命令对比）：

```bash
go test ./internal/application/gateway ./internal/application/audit ./internal/infra/persistence/relational -run "^$" -bench . -benchmem -count=5
go test ./internal/infra/egress ./internal/infra/runtime/memory ./internal/pkg/perfmetrics ./internal/transport/http/inference ./internal/transport/http/middleware -run "^$" -bench . -benchmem -count=5
```

- 实测中位数（5 次取第 3 位；Go 1.26.1 windows/amd64，GOMAXPROCS=8，CGO_ENABLED=0）：

| Benchmark                                                                    |       ns/op |      B/op | allocs/op |
| ---------------------------------------------------------------------------- | ----------: | --------: | --------: |
| `SelectorMultiModelCandidateLoad/models_2`                                   |  15,413,665 | 2,814,369 |    34,890 |
| `SelectorMultiModelCandidateLoad/models_8`                                   |  22,938,981 | 5,485,970 |    50,860 |
| `SelectorSegmentedCandidatePlanning/3000/full`                               |   2,202,993 |   483,879 |     5,924 |
| `SelectorSegmentedCandidatePlanning/3000/active_segmented_64`                |   1,348,750 |    77,638 |       157 |
| `SelectorSegmentedCandidatePlanning/3000/active_segmented_64_full_fallback`  |   4,209,020 |   709,670 |     6,000 |
| `SelectorSegmentedCandidatePlanning/10000/full`                              |   7,594,783 | 1,782,851 |    19,951 |
| `SelectorSegmentedCandidatePlanning/10000/active_segmented_64`               |   4,690,615 |   224,372 |       159 |
| `SelectorSegmentedCandidatePlanning/10000/active_segmented_64_full_fallback` |  11,245,722 | 2,512,185 |    20,078 |
| `SelectorCandidatePlanning`                                                  |     617,059 |   343,678 |     5,907 |
| `AuditServiceSQLite/attempts_0`                                              |     427,659 |    10,853 |        91 |
| `AuditServiceSQLite/attempts_2`                                              |     515,894 |    17,810 |       156 |
| `DashboardUsageAggregate/legacy`                                             |  78,285,147 |    13,556 |       113 |
| `DashboardUsageAggregate/performance`                                        | 103,834,920 |    22,242 |       130 |
| `RoutingAccountBaseProjectionWithLargePayloads`                              |  73,725,580 | 3,126,136 |    62,248 |
| `SelectedCredentialHydration`                                                |     279,813 |   143,174 |       155 |
| `ManagerAcquireCachedBuild`                                                  |       1,883 |     1,633 |        12 |
| `ConcurrencyLimiterCurrentMany`                                              |     266,380 |   219,412 |        32 |
| `RegistryParallel`                                                           |       319.8 |         0 |         0 |
| `FirstTokenInspection/responses`                                             |       1,319 |       320 |         7 |
| `FirstTokenInspection/responses_custom_tool`                                 |       1,748 |       336 |         7 |
| `FirstTokenInspection/chat`                                                  |       2,743 |       504 |        11 |
| `FirstTokenInspection/anthropic`                                             |       2,401 |       408 |        10 |
| `RequestBodyObservation/plain`                                               |       3,156 |     5,383 |        15 |
| `RequestBodyObservation/observed`                                            |       4,446 |     5,449 |        16 |

- **噪声警告**：`DashboardUsageAggregate`（performance 子用例 5 次区间 97.8M–118.7M ns/op）与 `RoutingAccountBaseProjectionWithLargePayloads` 波动较大；后续对比必须先评估噪声水平，不能把单次差异当作优化收益。
- 分段选号收益的现有证据：3000 候选下 `active_segmented_64` 相对 `full` 为 1.35M vs 2.20M ns/op、157 vs 5,924 allocs/op；10000 候选下为 4.69M vs 7.59M ns/op、159 vs 19,951 allocs/op。这是**已有实现**的基线，不是本轮优化成果。

## 4. 架构审计

### 4.1 分层与依赖方向

目标方向：Transport → Application → Domain；Repository/Ports 定义契约，Infra 实现；`internal/app` 为装配入口。

静态扫描（425 个非测试 Go 文件）结果：

- `internal/domain/**` → 无越界依赖。**方向正确。**
- `internal/repository/**` → 无越界依赖（仅依赖 domain）。**方向正确。**
- `internal/application/**` → **生产代码 29 处**（分布在 **27 个文件** / 3 个包：`security` 16、`egress` 10、`config` 3）对 infra 的依赖，需登记并逐步收敛（按 import 行计；文件级拆分后同一逻辑依赖可能分布在更多文件）。测试代码另有 110 处 infra import（`persistence/relational` 36、`provider` 23、`runtime/memory` 20 等），属集成测试装配、不计入分层违规（2026-10-11 `go/parser` 全量复核；原记录「20 个文件」漏计 `settings/` 3 个 config 文件与 `egress/quality_lease.go`）。
- **边界依赖口径说明（§4.1 ↔ §5 BE-02 ↔ §20.2 ↔ §22.1 ↔ §31.4 相互指针）**：本条按 **import 行**（每个 (文件, 完整包路径) 组合一条）计；§20.2 的冻结例外 `applicationInfraExceptions`（`internal/ports/provider/import_boundary_test.go:30-58`）按 **(文件, 完整包路径) 对**计（27 个生产文件 / 29 对：`security` 16、`egress` 10、`config` 3）。两套计量**在本 tip 数值一致**（29 处 / 27 文件 = 29 对 / 27 文件），可交叉对账，但仍由两个不同工具产出，各自以对应工具输出为准：边界口径 = `cd backend && go test ./internal/ports/provider/ -count=1`（输出 `存量依赖=…`；§22.2/§31.4 实测 application 29、总数 38 = 29 + 1 + 8），结构口径 = `cd backend && go run ./tools/structurecheck`（**不含**边界依赖计数）。**EVID-8 更正（2026-10-12，只读静态复核）**：本条原值「生产代码 26 处 / 24 个文件（`security` 13）」→ 新值「生产代码 29 处 / 27 个文件（`security` 16、`egress` 10、`config` 3）」；根因：原计数把 `gateway/*` 的 `security` 引用按 3 组（`quality_probe` / `service_*` / `video_*`）而非按实际 6 个文件 / 6 条 import 行计，文件数 24 亦低于实测 27；复现（本轮未执行，EVID-1）：`cd backend && go test ./internal/ports/provider/ -count=1`（§20.2 记 `declared 27/29 = actual 27/29`），静态复核命令见 §20.2 末段。

| 目标 infra 包    | 引用位置（示例）                                                                          | 判定                                                                                                                                                     |
| ---------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `infra/provider`（根） | **生产 0 处**（实测仅测试引用 23 处） | 阶段 3 已完成契约收敛：`internal/ports/provider`（35 个接口 + 值类型 + 错误类型 + `Registry`），`internal/infra/provider/provider.go` 由 1468 行降至 **465** 行；2026-10-11 更正：application **生产代码已不直接依赖**该包，原表把它列为生产依赖已过期 |
| `infra/security` | 16 处：account 2、adminauth 1、clientkey 4、egress 3、gateway 6（逐文件明细见 §20.2 的 `applicationInfraExceptions`） | `Cipher`/`TokenService` 为具体实现，application 直接依赖具体类型；可迁 `internal/ports/security`（新建，实测 `ports` 当前 0 处 import infra/application，无环） |
| `infra/egress` | 10 处：gateway/{egress_audit,image,quality_probe,quality_retry,service,video,voice,voice_ws} | `Trace`/`Selection` 值类型可迁 ports；`WithTrace`/`WithQualityProbe`/`WithPhysicalCallTrace` 的 context key 由 infra 侧读写，搬进 ports 等于暴露实现细节 → **该项无法归零**，只能减少类型依赖 |
| `infra/config` | 3 处：settings | 配置结构体被应用层直接消费；`domain/settings/settings.go:32` 已有并行 `Config`（14 类型）且 application/settings 现做双向映射，**不新建 `ports/config`**（否则产生第三套配置类型，违反「禁止第二套业务语义」），保持现状并登记 |

处理原则：**区分「契约放错层」与「真实实现耦合」**。优先把确属公共能力的契约迁到 `internal/ports/**`（`provider` 已完成，`security` 为下一项）；`egress` 只做可迁部分、context 注入保留在 infra；`config` 因会产生第三套配置类型而**不迁**；测试装配用的 `persistence/relational` / `runtime/memory` 与 GORM/Redis 具体类型耦合，接口化会削弱集成测试真实性，**不迁**。不做全库机械搬迁。

### 4.2 结构与体量基线

- 源码文件：425 个（不含 `_test.go`；阶段 3–6 为 334 个，2026-10-11 文件级拆分后增加）。
- 最大的文件：下列为 2026-10-11 文件级拆分后的现状（`[IO.File]::ReadAllLines()` 逐文件实测）。阶段 0 基线为 16 个 >1000 行文件、最大 4717 行（`application/account/service.go`，§10）；阶段 3–6 后为 10 个 >1000 行、最大 1931 行；2026-10-11 起 **>1000 行文件 0 个**，剩余 >600 行生产文件 12 个（后端不在 REV-1 前端 600 行门禁范围内，此处仅作登记）。

| 文件                                              | 行数 | 说明                                                       |
| ------------------------------------------------- | ---: | ---------------------------------------------------------- |
| `internal/infra/runtime/redis/store.go`           |  995 | 既有，未拆分                                               |
| `internal/application/gateway/service_request.go` |  966 | 新文件，含存量 `createResponseAt`（908 行，已登记不强行拆） |
| `internal/infra/provider/console/media.go`        |  950 | 既有，未拆分                                               |
| `internal/pkg/tunnelproxy/tunnelproxy.go`         |  876 | 既有，未拆分                                               |
| `internal/infra/provider/web/quota.go`            |  815 | 既有，未拆分                                               |
| `internal/infra/provider/web/gateway.go`          |  785 | 既有，未拆分（本轮仅注释归位）                             |
| `internal/application/model/service.go`           |  669 | 既有，未拆分                                               |
| `internal/application/media/service.go`           |  652 | 既有，未拆分                                               |
| `internal/application/clientkey/service.go`       |  627 | 既有，未拆分                                               |
| `internal/domain/audit/pricing.go`                |  627 | 既有，未拆分                                               |
| `internal/domain/account/account.go`              |  618 | 既有，未拆分                                               |
| `internal/infra/provider/web/sso_build.go`        |  618 | 既有，未拆分                                               |

- 装配入口 `internal/app/application.go`（**2026-10-11 拆分后 309 行**）：装配逻辑拆入同包 `assemble.go`(586) 与 `lifecycle.go`(234)，`New()` 由 354 行降至 **27 行**、`Run()` 由 182 行降至 **19 行**，helper 全部 ≤50 行；装配顺序、错误包装与关闭顺序逐条比对未变（见 §16.1）。
- `internal/app/startup.go` 的 `readinessSnapshot` 实测 138 行（`startup.go:119-256`），混合了就绪判定与组件状态拼装。

### 4.3 已具备且不应重复建设的能力

- Provider 能力接口 + `Registry` 注册校验（重复注册、别名指向、规范路由 ID 校验）。
- 选号分层与分段（`segmentedSelectorEnabled`，3000 候选阈值、窗口 64）、原子并发门禁、粘滞路由、额度优先级。
- 事务与并发控制：账号关联变更使用行锁（`clause.Locking{Strength:"UPDATE"}`）、审计批次稳定加锁顺序、分布式锁（memory/redis 双实现）。
- 批量能力：`pkg/batch` 共享池与子池（import/conversion/sync/refresh 并发度可热更新）。
- 审计账本：`observe`/`enforce` 模式、队列水位、不可恢复判定与就绪联动。
- 就绪模型：`/readyz` 返回分层组件状态，空池/无可用账号为 `not_ready`（生产语义，测试不得放宽）。
- 运行态双实现：memory 与 redis 共享同一 `repository` 契约。
- 结论：性能与稳定性优化必须复用上述能力，不新增平行调度器、第二套重试框架或重复锁。

## 5. 问题清单

状态列的 `Pending` 均属 `AGENTS.md` §6 定义的 P2/P3 计划内债务：已登记、未扩张、不阻塞阶段验收与发布；`Passed` 必须附可复核证据。

| 编号  | 证据                                                                                                                                                                      | 现有/新增                           | 影响                                        | 优先级 | 阶段   | 验证方法                                   | 状态                                                                                                                                                  |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------- | ------ | ------ | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| BE-01 | 阶段 0 基线 16 个 >1000 行文件（最大 4717 行）→ 阶段 3–6 后 10 个（最大 1931 行）→ **2026-10-11 文件级拆分后 >1000 行文件 0 个**；8 组目标目录内文件全部 ≤600 行（唯一例外 `gateway/service_request.go` 966 行，含存量 `createResponseAt`），另有 11 个 600–995 行的既有文件尚未拆分（§4.2） | 现有                                | 可维护性、审查成本                          | P2     | 4–6    | 按用例/读写/调度拆分                       | **Passed**（2026-10-11：8 组纯文件级搬运，见 §16.1；>1000 行类清零，剩余 600–995 行文件按 P3 登记）                                                  |
| BE-02 | 29 处 / 27 个文件 application → infra 依赖（§4.1；冻结例外口径 27 文件 / 29 对见 §20.2，存量依赖总数 38 见 §31.4；阶段 0 基线为 28 处，文件级拆分后同一逻辑依赖分布在更多文件；**EVID-8 更正：原值「26 处 / 20 个文件」→ 新值「29 处 / 27 个文件」，根因与复现命令见 §4.1**）                                                          | 现有                                | 分层模糊，契约与实现同包                    | P2     | 3      | 契约迁 ports + 边界测试                    | Pending（P2 计划内债务，不阻塞发布）                                                                                                                  |
| BE-03 | 账号列表已按页批量（6 次查询），非 N+1                                                                                                                                    | 现有                                | 不应虚构缺陷                                | P2     | 4      | 补查询次数断言与基准                       | **Passed**（阶段 4：`TestListPageAggregationQueryCountIsPageSizeIndependent` 断言 pageSize 1–300 恒为固定 6 次批量调用；§10）                         |
| QA-01 | 20 个 PostgreSQL/Redis 集成用例在本机跳过，含并发/锁/账本不变量                                                                                                           | 现有                                | 关键一致性无本地证据                        | P1     | 1、7   | CI 隔离 service 真实执行                   | **Passed**（CI 0 跳过 / 2842 通过，并暴露并修复 1 个用例缺陷）                                                                                        |
| QA-02 | `go test -race` 本机 Blocked（无 cgo）                                                                                                                                    | 现有                                | 竞态检测缺失                                | P1     | 7      | Linux CI 执行                              | **Passed**（CI `go test -race ./... -count=1` success）                                                                                               |
| QA-03 | `internal/application/account` 无 benchmark                                                                                                                               | 现有                                | 最重读路径无可比基线                        | P2     | 4      | 新增分页聚合基准                           | **Passed**（阶段 4 新增 `BenchmarkServiceListPageAggregation`：8.60 / 9.81 / 9.61 ms/op；§10）                                                        |
| BE-04 | `app.New()`/`Run()` 单函数过长，装配与生命周期混合（原 `New()` 354 行 / `Run()` 182 行 / `readinessSnapshot` 138 行）                                                     | 现有                                | 变更风险集中                                | P2     | 3      | 拆分后回归装配与关闭顺序                   | **Passed**（2026-10-11：`New()` 27 行 / `Run()` 19 行，拆为 `assemble.go`(586) + `lifecycle.go`(234)，helper 全部 ≤50 行；`go build`/`vet`/`go test ./...` exit 0，见 §16.1） |
| BE-05 | `infra/provider/provider.go` 由 1468 行降至 **465** 行；能力契约已迁 `internal/ports/provider`（35 个接口，阶段 3，§9）                                                   | 现有                                | 契约与实现同包                              | P2     | 3      | 迁至 ports 并同步调用方                    | **Passed**（契约已迁 ports 且 `provider.go` 465 行，2026-10-11 复核；剩余 application→infra 依赖归 BE-02）                                            |
| BE-06 | 媒体尝试循环跨轮携带 `err`，判定换号/重试后下一轮跳过 `Acquire`，健康账号仍在池中却返回 503 `ErrNoAvailableAccount`（`gateway/voice_execution.go`、`image_execution.go`） | 现有（基线即有，阶段 6 收尾前未修） | 单账号凭据失效/传输抖动被放大为下游可见 503 | P1     | 6 收尾 | 两账号夹具回归测试断言第二个账号被真正租用 | **Passed**（§13.1：改为每轮独立 `acquireErr`；`media_attempt_loop_test.go` 3 条断言；`go build`/`vet`/`go test ./... -count=1` exit 0，64 包 0 FAIL） |
| BE-07 | `.github/workflows/ghcr-image.yml` 两个 `Docker metadata` 步骤未设 `flavor`；run `38054220100` job `114229640946` 日志 `ERROR: ghcr.io/jasminetony/grok2api:latest-arm64: not found` | 新增（2026-10-10 发布时暴露） | tag 推送时 `Merge image` 必然失败；per-arch 另推单架构裸 `latest` | P1 | 发布 | 加 `flavor: latest=false` 并用临时 tag 实测 tag 推送路径 | **Passed**（`b4068303`；tag 推送 run `38060494037`、main 推送 run `38060467337` 全部 job success，§11/§14） |
| BE-08 | `merge` 的 `Create manifest list` 循环缺 `set -euo pipefail`，管道退出码只反映 `while` 最后一次迭代 | 新增（只读代码审查发现） | 前面的 `imagetools create` 失败可被后续成功掩盖，留下陈旧标签却报绿 | P3 | 发布 | 在 `run:` 首行加 `set -euo pipefail` | **Passed**（`a4f58384`；两条路径 CI 全绿，§11/§14） |
| BE-09 | `merge` 的 `Inspect image` 原为单行 `docker buildx imagetools inspect`，只打印不断言：单架构索引也会绿色通过，发布验收只能靠人工读日志 | 新增（2026-10-11 只读审查） | 发布验收证据强度不足 | P2 | 发布 | 断言索引同时含 `linux/amd64` 与 `linux/arm64`，缺失即非零退出 | **Passed**（`0de5cc72` 实现；main run `38107489273` 与 tag run `38108809200` 的 `Merge image` 全 success，日志实测 `多架构断言通过：linux/amd64 + linux/arm64`） |
| BE-10 | 根 `VERSION` 与 `frontend/package.json` 一致性是 `AGENTS.md` §8 的硬要求，但无自动门禁（历史上长期不一致：`v3.1.6` vs `0.1.0`） | 新增（2026-10-11） | 版本载体可能再次漂移且无人发现 | P2 | 发布 | `verify` 增加比对步骤，不一致即非零退出 | **Passed**（`0de5cc72` 实现；main run `38107489273` 与 tag run `38108809200` 中该步骤 success 且两条 run 整体 success。首次执行该步骤的是 `workflow_dispatch` run `38106888325`（该步骤 success），但该 run 随后被 `concurrency` 取消，**不作为通过证据**） |
| BE-11 | `concurrency.cancel-in-progress: true` 按 ref 取消：同一 ref 连推会取消正在运行的 run（本轮实测 3 次 `cancelled`，含 dispatch run `38106888325` 被 main push run 取消）；若取消落在 per-arch 推送之后、merge 之前，会短暂留下不完整标签（后续 run 收敛） | 新增（2026-10-11 观察） | 发布期间可能短暂存在不完整标签 | P3 | 发布 | 可改为 `cancel-in-progress: ${{ !startsWith(github.ref, 'refs/tags/') }}` | **Passed**（`e57fadda` 实施：`ghcr-image.yml:20` 即为该表达式，分支推送仍允许取消。**局限**：`v0.1.2` 的 tag run 早于该提交，此后无真实 tag 推送执行该分支，见 §16.5） |
| BE-12 | 各 job 无 `timeout-minutes`，卡死最长占用 runner 6h（GitHub 默认上限） | 新增 | 资源占用与排障延迟 | P3 | 发布 | 为 verify/publish/merge 设合理超时 | **Passed**（`e57fadda` 实施：`ghcr-image.yml:29` verify 60 / `:195` check 30 / `:233` build 45 / `:288` merge 15 分钟。`codeql.yml`/`stale.yml` 未设，属登记保留项，见 §16.5） |
| BE-13 | `Assert required integration tests ran` 原按**用例名**匹配 `Postgres\|Redis`；新增集成用例若命名不同会被漏检（当前 20 个集成用例名均含关键字，故现状有效） | 新增 | 未来新增集成用例可能不被门禁覆盖 | P3 | 发布 | 改为「包路径白名单 ∪ 用例名」双重断言 | **Passed**（`e57fadda` 实施：`ghcr-image.yml:86-107` 两路 `grep` 任一命中即 `exit 1`；白名单为 `persistence/relational$`、`runtime/redis$`、`application/account$`。run `38121078190` 第 7 步 success，见 §16.5） |
| BE-14 | 工作流中 `uses:` 未固定 commit SHA；CI 使用 Node 22 而本机 Node 24，仓库未声明 `engines` | 新增 | 供应链与工具链一致性 | P3 | 发布 | 固定 SHA / 声明 `engines` | **Passed**（`e57fadda` 固定 `ghcr-image.yml` 18 处；2026-10-11 补固定 `codeql.yml:38/41/47`（checkout v4.4.0、codeql-action v4.38.3）与 `stale.yml:19`（stale v10.4.0），全仓 22/22 处已固定；`79230b36` 声明 `frontend/package.json` `engines.node >=22` 并同步 `frontend/README.md:15`） |

## 6. 强制保留的前轮修复（回归清单）

架构改造必须保持以下已修复行为，不得在拆分中丢失：

1. 未知 Build 403 沿用既有指纹上限（16 次）终止；**不新增**对未知 403 的账号惩罚或冷却。
2. 视频任务按 ClientKey `AccountScope()` 限制（`AcquirePinnedForKey` + `beginSelectionSessionForKey`）；`ClientKeyID==0` 保持不受限。
3. Voice/STT WebSocket 观察请求取消与截止时间；传输失败仍对已确认时长计费（`usageConfirmed`）。
4. 质量拦截（`shouldHoldQualityStream`）仅作用于 Build 路由，排除 Console 加密推理误判。
5. Build SSO 同意页解析 `consent_token`，保留 HTTP 状态，`Origin`/`Referer` 由同意页 URL 推导。
6. 模型级额度封锁在账号视图与前端可见（`GetModelQuotaBlocks`）。
7. 代理 URL 支持 IPv4 `IP:Port:User:Pass`，且 `{account}` 占位替换**先于**解析以保持粘滞语义。
8. 持久化的低于 `1.0.13` 的 Build 客户端版本回填为推荐版本。

## 7. 后续阶段与回滚

- 阶段顺序与文件范围见 `.pi/plan/前后端全量审计与分阶段模块化升级计划-20261009-1947.md`。
- 回滚：按阶段提交回滚源码与文档；本阶段不涉及生产数据迁移，无需数据回滚。公开协议（路由、DTO、Swagger）必须保持，若确需变更则单独确认。

## 8. CI 真实验证（阶段 2）

`maint/modular-quality-audit` 的草稿 PR #1 触发真实 GitHub Actions（GHCR Image run #4，sha `6f762fb7`），工作流 **conclusion=success**，`Verify` job 全部步骤 success：

| 步骤                                            | 结果    | 说明                                                          |
| ----------------------------------------------- | ------- | ------------------------------------------------------------- |
| Test backend                                    | success | `go test ./... -count=1 -json`，**0 跳过**，2842 通过         |
| Assert required integration tests ran           | success | 20 个外部依赖集成用例全部真实执行（断言未被跳过）             |
| Race backend                                    | success | `go test -race ./... -count=1`，补齐本机 Blocked 的 BE-A4     |
| Vet backend                                     | success | `go vet ./...`                                                |
| Verify Swagger document                         | success | `make swagger` + 精确 diff                                    |
| Verify frontend                                 | success | `pnpm verify`（含依赖边界、结构、门禁自测、覆盖率、体积预算） |
| Install Playwright browser / Run full-stack E2E | success | 真实全栈 E2E                                                  |
| Build image (amd64 / arm64)                     | success | PR 模式镜像构建                                               |

隔离服务：`postgres:17-alpine`（`pg_isready` 健康检查）、`redis:7-alpine`（`redis-cli ping`），`TEST_POSTGRES_ADMIN_DSN` / `TEST_REDIS_ADDRESS` / `TEST_REDIS_DATABASE=9` 只指向本 job 容器，不触碰任何真实服务。

### 首次运行即暴露的用例缺陷（已修复）

`TestPostgresRoutingProjectionAndCredentialHydration` 此前从未在 CI 运行。首次真实执行即失败：用例创建 **Web** 账号，却用 **Build** 池调用 `UpdateMany` 并把返回的 `ErrAccountPoolMismatch` 当作失败。

`UpdateMany` 在 provider 不匹配时返回该错误是**有意的守卫**（`account_repository.go:1625-1632`），另有 `TestAccountRepositoryUpdateManyRejectsMixedProviderBeforeWriting` 专门断言。因此这是**测试期望写错，不是产品缺陷**。修复方式：显式断言跨池更新被拒绝（为 PostgreSQL 侧新增该守卫覆盖），再用正确的 Web 池禁用账号并验证凭据不可用——原意图保留且覆盖增强。

### CI-01：main 的镜像发布因 pnpm 供应链策略失败（既有问题，非本分支引入）

- 现象：`main` @ `7c0493a2` 的 `Publish image (amd64/arm64)` 在 `Build and publish` 失败；同一 commit 的 `Verify` job 通过。该失败自 run #1（`51acd5da`）起持续存在。
- 根因（Docker 内日志）：`pnpm fetch` 触发 `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`，`1 lockfile entries failed verification (433 entries in 2.9s)`。
- 策略来源：仓库未显式配置 `minimumReleaseAge`（`pnpm config get minimumReleaseAge` 返回 `undefined`），约束来自 pnpm 12 的内置默认值；`frontend/pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude: [vite@8.3.4]` 说明此前已命中过一次。
- 时间依赖：本地与 CI 的 `pnpm install` 会缓存校验结果（"verified 1h ago"），Docker 内为全新校验；本分支 PR 模式的镜像构建（同一 Dockerfile、`push: false`）**通过**，说明当前 lockfile 在本次校验时满足策略。
- 处置：**不通过降低安全约束绕过**。原登记为 P2 待处理项，且当时无法在未合并 `main` 的前提下验证。**2026-10-10 更新**：真实阻塞已查明为 GHCR 孤立包（见 §11）并已解除；本节的 pnpm 供应链瞬时原因亦已自愈（`frontend/pnpm-workspace.yaml` 显式固定 `minimumReleaseAge: 1440`）。本条**已解决**，证据见 §11 与 §14。

## 9. 阶段 3 成果（后端契约分层）

- 新增 `internal/ports/provider`：12 个非测试文件 / 1554 行，35 个接口 + 值类型 + 错误类型 + `Registry` 契约接口
- `internal/infra/provider/provider.go`：1468 → **466 行**（仅剩 Registry 实现与编译期断言 `var _ ports.Registry = (*Registry)(nil)`）
- 删除已整体迁移的 `infra/provider/{definition,rate_limit,account_block}.go`
- `internal/application/**` **生产代码**对 `infra/provider` 的依赖：12 个文件 / 206 处 → **0**；94 个消费者文件同步更新
- 新增标准库边界测试 `internal/ports/provider/import_boundary_test.go`：domain / repository / ports 不得 import `internal/infra/`，application 生产代码不得 import `infra/provider`；已用注入违规反证其会失败

验证：`go build ./...`、`go vet ./...`、`go test ./... -count=1` 全部 exit 0（64 包，0 FAIL，20 个外部存储集成用例按预期跳过）；24 个 benchmark 全部编译；`pnpm verify:full` exit 0（6 个 E2E 使用迁移后的后端二进制）。

### 阶段 3 遗留（已登记，非隐藏）

- 22 个 `internal/application/**` **测试**文件仍 import `infra/provider`（仅用 `NewRegistry`），边界测试显式允许；生产代码已为 0。
- 未消除的存量依赖：`infra/security`（7 文件）、`infra/egress`（8 文件）、`infra/config`（1 文件）。本轮只处理确属公共能力契约的 provider，其余逐项判断见阶段报告。
- `Registry.Validate` 仍为 86 行（REV-2 超限），本轮未改动。
- `internal/infra/provider/web/sso_build_test.go` 存在与 HEAD 逐字一致的 gofmt 对齐偏差（存量，未夹带修复）。
- 观察到一个与本改动无关的偶发失败（`infra/egress` 的 `TestPinnedHTTPSClientSOCKS5HReceivesPinnedIP`，Windows loopback reset），单独重跑 3 次通过，该包不在 diff 内。

## 10. 阶段 4 成果（账号模块拆分）

| 文件                                                          |   前 |                                         后 |
| ------------------------------------------------------------- | ---: | -----------------------------------------: |
| `internal/application/account/service.go`                     | 4717 |     **294**（+ 13 个按用例分组的同包文件） |
| `internal/infra/persistence/relational/account_repository.go` | 2846 | **47**（+ 8 个按数据访问关注点分组的文件） |

- 未引入新包，`Service` / `AccountRepository` 的公开方法签名零改动，transport 与 `internal/app` 无需修改
- 拆分等价性以「函数体行多重集比对」证明：`service.go` 4439 = 4439、`account_repository.go` 2706 = 2706，无代码丢失或重复
- application 侧分组：查询与视图组装、导入、Provider 转换、导出、凭据刷新、billing、quota、quota 刷新队列、批量任务、管理操作、检测、观察模型
- 仓储侧分组：分页查询、单账号读取、路由投影（候选/基础 + 路由侧装载）、写入（事务与行锁）、批量更新与清理、状态写入、billing 与 quota

### 新增基准与不变量（QA-03 / BE-03）

- `BenchmarkServiceListPageAggregation`（300 账号 + billing + 额度恢复 + 额度窗口 + 模型封锁 + 审计 token）：**8.60 / 9.81 / 9.61 ms/op，1.573–1.613 MB/op，19 233–19 642 allocs/op**。该包此前**没有任何 benchmark**，这是首个可比基线。
- `TestListPageAggregationQueryCountIsPageSizeIndependent`：pageSize ∈ {1, 20, 50, 300} 时，`Service.List` 的仓储调用序列恒为 `List → SumTokensByAccountsSince → GetBillings → GetQuotaRecoveries → GetQuotaWindows → GetModelQuotaBlocks`（固定 6 次），且每个批量方法只调用一次并收到整页 ID，即调用数不随页大小增长，**不存在 N+1**。计数在仓储边界实现（`relational.Database` 不暴露 GORM 句柄，SQL 级计数需为测试新增生产 API，故采用等价的调用级证据）。
- 回归检查：`BenchmarkRoutingAccountBaseProjectionWithLargePayloads` 拆分后 99.2 / 90.4 / 96.6 ms/op、3 107–3 128 KB/op、62 223–62 270 allocs/op；同机 HEAD 基线 124.3 / 176.5 / 111.5 ms/op、3 083–3 128 KB/op、62 220–62 272 allocs/op → **内存与分配完全一致，无回归**（ns/op 抖动来自本机负载）。

验证：`go build ./...`、`go vet ./...`、`go test ./... -count=1` 全部 exit 0；20 个外部存储集成用例按预期跳过；`pnpm verify` 与 `pnpm test:e2e`（6/6）全绿。

### 阶段 4 遗留（如实登记）

- `infra/persistence/relational/account_links.go` 仍 **776 行**（>600），属存量基线债务，不在本轮两个目标文件范围内。
- 测试文件仍超 600 行：`quota_refresh_test.go` 1434、`credential_refresh_test.go` 909、`account_links_test.go` 753 等，本阶段未拆分。
- 行为完全保持意味着 `Service.List` 仍是 6 次 SQL 往返；本轮**未**做合并优化（属需求外，且需先有实测收益证据）。
- `Registry.Validate` 仍 86 行（REV-2 超限），未改动。

### CI-01 更正与最终诊断（重跑后确认）

上文的「供应链策略」只是**第一层、且是瞬时的**原因；重跑后它已自愈，暴露出真正持续的阻塞。

**证据链**

| 运行                      | Publish 任务耗时           | 结果                                                                                                          |
| ------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------- |
| main run #1（`51acd5da`） | 32s（10:57:11→10:57:43）   | 在早期 `pnpm fetch` 失败（`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`）                                          |
| main run #2 重跑          | ~2min（15:31:43→15:33:16） | 供应链检查已通过（`✓ Lockfile passes supply-chain policies (433 entries in 3.1s)`），构建完成后在**推送**失败 |

**真正的阻塞**（持续、非时间依赖）

```
ERROR: failed to push ghcr.io/jasminetony/grok2api:main-arm64: denied: permission_denied: write_package
```

**根因**：`JasmineTony/grok2api` 是 **2026-10-09T10:34:12Z 重新创建**的（此前被删除并重建），而 GHCR 命名空间下的 `jasminetony/grok2api` 包由**旧仓库实例**创建、在仓库删除后成为**孤立包**。新仓库的 `GITHUB_TOKEN` 对该包没有写权限，因此 `packages: write` 请求被拒。仓库 `default_workflow_permissions` 为 `read`，进一步说明该仓库的 Actions 权限是收紧配置。

注意：工作流本身**是正确的**——`build_ghcr_image` 已声明 `permissions: { contents: read, packages: write }`。因此这不是 YAML 缺陷，无法靠改代码修复。

**为什么分支看起来是绿的**：PR 事件只跑 `check_ghcr_image`（`push: false`，仅构建不推送），永远不会触发推送，因此碰不到该拒绝。分支**无法**修复此问题。

**所需操作（需要 GitHub 设置或具备相应包权限的凭据；包 API 返回 403，我无法代为执行）**

1. 打开 GitHub → 个人头像 → **Packages** → `grok2api` → Package settings → **Connect repository** → 选择 `JasmineTony/grok2api`；随后重跑 main 的失败任务。
2. 或**删除该孤立包**，让新仓库在下一次推送时重新创建并持有它。
3. 可选：Settings → Actions → General → Workflow permissions 改为 "Read and write"，消除歧义（job 级 `packages: write` 仍然保留）。

**已完成的持久修复（本分支）**：`frontend/pnpm-workspace.yaml` 显式固定 `minimumReleaseAge: 1440`（原为 pnpm 12 内置默认值，值不变、行为不变），使这条隐形策略变成可审查的仓库配置，避免同类失败再次以「不可见原因」出现。

## 11. 阶段 5 成果（后端出口与设置拆分）与 CI 状态

维护分支 `d5cc4597`，**CI run #12 = success**；此前 #10（`53f51d63`）、#11（`990bc954`）同为 success。

- `infra/egress/manager.go` 2342 → 拆为 clearance / clearance_refresh / client_cache / fallback / health / lease / node_select / probe
- `application/egress/service.go` 1443 → nodes / binding / proxy_profiles / proxy_url / quality_lease
- `transport/http/egress/handler.go` 1579 → nodes / proxy_profiles / sources / quality_guard / quality_guard_lease
- `application/settings/service.go` → config_apply / editable_config
- 同包内分文件，公开签名零改动；`go build` / `go vet` / `go test ./... -count=1` 全部 exit 0

### CI 运行语义（排障须知）

`.github/workflows/ghcr-image.yml` 配置了 `concurrency.cancel-in-progress`：连续推送会让先前的运行被判为 `cancelled`（不是失败），只有最后一次推送的运行代表当前状态。

### main 分支的镜像发布阻塞（2026-10-10 已解除）

`Publish image (amd64/arm64)` 始终失败：

`ERROR: failed to push ghcr.io/jasminetony/grok2api:main-amd64: denied: permission_denied: write_package`

根因：`JasmineTony/grok2api` 于 2026-10-09T10:34:12Z 重建，而 GHCR 包由旧仓库实例创建、成为孤立包，新仓库的 `GITHUB_TOKEN` 无写权限；仓库 `default_workflow_permissions = read`。工作流 YAML 正确（`packages: write` 已声明），改代码无法修复。**2026-10-10 复核确认**：run `37921816518`（`main`，`7c0493a2`）与 run `38054220100`（tag `v0.1.1`，`b2123a7d`）的 Publish job 日志中 `GITHUB_TOKEN Permissions` 段均已列出 `Packages: write`，却仍以同一条 `permission_denied: write_package` 失败——拒绝发生在**包级授权**，不是 token 权限或工作流声明。另需注意：本仓库只在 `main` 与 `v*.*.*` tag 上触发 push 事件，因此 `maint/modular-quality-audit` 分支上的历史 `GHCR Image` 运行全部是 PR 事件（`Publish`/`Merge` 按 `if` 条件 skipped），从未真正执行过镜像推送，早期「main 的持久阻塞」只在 `main` 推送时可见。

**2026-10-10 已解除（实测）**：`GET /users/JasmineTony/packages/container/grok2api` 显示 `repository = null`、162 个版本全部来自重建前的旧实例，证实「孤立包」。经维护线负责人授权，用具备相应包权限的凭据执行 `DELETE /users/JasmineTony/packages/container/grok2api` → **HTTP 204**（复查 404），再由 CI 重建：新包 2026-10-10T13:57:17Z 创建、`visibility=public`、`repository=JasmineTony/grok2api`。随后重跑 run `38054220100` 的失败任务，`Publish image (amd64)` 与 `(arm64)` 成功；重跑 run `38055278879`（`main`）后 `Publish` 与 `Merge image` 全部 success。注册表实测 9 个 tag（`v0.1.1`、`v0.1.1-amd64`、`v0.1.1-arm64`、`main`、`main-amd64`、`main-arm64`、`latest`、`latest-amd64`、`latest-arm64`），`v0.1.1`/`main`/`latest` 均为 linux/amd64 + linux/arm64 的 `application/vnd.oci.image.index.v1+json`，匿名拉取 HTTP 200。**原「修复方式」中的 UI 连接仓库路径仍然有效，但本次采用删除孤立包并重建，无需人工 UI 操作。**
先前观察到的 `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` 是第一层**瞬时**原因（pnpm 12 内置 24h 供应链策略），重跑后已自愈；本分支已在 `frontend/pnpm-workspace.yaml` 显式固定 `minimumReleaseAge: 1440`（值不变）使该策略可审查。

原修复方式（**已不再需要人工操作**）：Packages → grok2api → Package settings → Connect repository → 选 `JasmineTony/grok2api`；或删除孤立包；然后重跑 main 的失败任务。—— 本次实际采用「删除孤立包并重建」，见上方 2026-10-10 段落。

**2026-10-10 后续修复（工作流缺陷，与孤立包无关）**：孤立包解除后暴露出独立缺陷——tag 推送时 `Merge image` 必然失败。根因：`docker/metadata-action@v5` 未设 `flavor`，默认 `latest=auto` 对 `type=ref,event=tag` **无条件**标记 latest（自动 latest 只继承 `flavor.prefix/suffix`、不继承条目级 `suffix=`），因此 per-arch 步骤在 tag 推送时另推一个单架构裸 `latest`，merge 步骤去找不存在的 `latest-amd64`/`latest-arm64` 而报 `latest-arm64: not found`。已在 `b4068303` 给两个 `Docker metadata` 步骤加 `flavor: latest=false`，并在 `a4f58384` 给 `Create manifest list` 循环加 `set -euo pipefail`（只读审查发现的 P3）。实测：临时 tag `v0.1.1-verify.1` 的 run `38060494037` 与 main 推送 run `38060467337` 全部 job success；验证后已删除临时 tag 与其 3 个镜像版本。登记见 §5 `BE-07`/`BE-08`。

## 12. 阶段 6 成果（Gateway / 推理传输 / Web Provider 拆分）

本阶段把后端三条最重的执行链按职责拆分文件，并做函数级 REV-2 分解。全部为**行为等价搬移**：导出符号、HTTP 契约、SSE 分帧、状态码、错误文案、脱敏与计费/审计顺序均未改变；既有 `*_test.go` 零修改（只新增测试文件）。

### 12.1 文件级拆分

下表「前」为 HEAD `236175e4` 实测，「后」为当前工作树实测（均为文件实际行数）。阶段 6 的工作树叠加了两轮改动（按职责拆文件 + 函数分解），因此部分文件的「后」比拆分当次更大——那是后续函数分解回填所致，不是回退。

| 包 / 文件                              |   前 |      后 | 新增按职责文件                                                                                                                                                                                                                                                   |
| -------------------------------------- | ---: | ------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `application/gateway/service.go`       | 2194 |    1951 | `service_routes.go` 340                                                                                                                                                                                                                                          |
| `application/gateway/selector.go`      | 2247 |    1063 | `selector_cache.go` 678、`selector_health_cache.go` 664                                                                                                                                                                                                          |
| `application/gateway/video.go`         | 1414 |    1304 | `video_tasks.go` 123                                                                                                                                                                                                                                             |
| `application/gateway/voice.go`         |  552 |     304 | `voice_execution.go` 357                                                                                                                                                                                                                                         |
| `application/gateway/quality_retry.go` |  611 |     361 | `quality_decision.go` 258                                                                                                                                                                                                                                        |
| `application/gateway/image.go`         |  378 |     111 | `image_execution.go` 398                                                                                                                                                                                                                                         |
| `transport/http/inference/handler.go`  | 2475 |  **91** | 12 个：`video_handler` 484、`stream_inspector` 421、`stream_copy` 312、`errors` 270、`image_handler` 278、`stream_usage` 206、`response_writer` 226、`media_response` 144、`responses_handler` 157、`models_handler` 100、`chat_handler` 100、`request_types` 97 |
| `infra/provider/web/chat.go`           | 2733 | **439** | 10 个：`chat_search` 396、`chat_response` 368、`anthropic_stream` 337、`chat_parse` 355、`chat_request` 293、`chat_sse` 246、`chat_openai_stream` 280、`chat_card` 198、`chat_types` 141、`web_wire` 99                                                          |
| `infra/provider/web/image.go`          | 1850 | **336** | 8 个：`image_upload` 367、`image_ws_stream` 361、`image_collector` 234、`image_assets` 227、`image_edit_stream` 202、`image_edit` 209、`image_chat` 168、`image_params` 58                                                                                       |

职责划分（一句话/文件）：

- gateway：`service_routes`=公开模型解析与别名、会话候选过滤、媒体路由与可调度媒体路由选择、路由排序；`selector_cache`=分层候选读取、路由 base/overlay 版本与陈旧快照回退、快照裁剪与失效；`selector_health_cache`=冷却/软失败/missing-thinking 惩罚、额度窗口与消费、free/model/payment 封锁标记；`video_tasks`=固定 Worker 池、入队、认领、恢复；`voice_execution`=TTS/STT 共用执行体（账号选择→上游转发→用量/审计结算）；`quality_decision`=加密推理下限、快速 flush/突发 dump 识别与 `ClassifyQualityHold`/`DecideQualityRetry`/`CommitQualityHold`；`image_execution`=图像用例主体。
- inference：`handler.go` 只剩装配 + `Register`（24 条路由原样）+ 共享常量；`request_types`=请求 DTO；`media_response`=媒体响应写出/安全头/写截止时间；`stream_copy`=流与 JSON 拷贝、中止 trailer、内部标记过滤；`stream_inspector`=上游流巡检与安全诊断投影；`stream_usage`=usage 解析/归一/合并；`errors`=错误分类与响应映射。
- provider/web：`chat.go`=Web chat 编排（`ForwardResponse`/`openChat`/状态保存）；`chat_parse`=上游帧解析；`chat_search`=搜索/工具/引用/hosted search；`chat_sse`=Chat SSE 帧与停止序列；`web_wire`=跨协议线上原语；`image_collector`=Imagine 收集器；`image_upload`=上传与回执解码；`image_assets`=资产持久化与 URL。

**零改写证据（非目测）**：非空白非 import 代码行**多重集前后逐条相同**（inference handler 2322 行、web chat 2574、web image 1741）；顶层声明集合（kind+限定名）一致（inference 302=302、web 694=694）；gateway 按文件声明行配对一致（`selector.go` 144=144、`video.go` 49=49、`voice.go` 15=15、`quality_retry.go` 36=36、`image.go` 8=8）；`createResponseAt` 拆分前后均 908 行、逐行 0 差异；脚本直接切片的文件 gofmt 后正文哈希与源一致。

### 12.2 函数级分解（REV-2）

**结论：本阶段把三个包的超限函数从 88 降到 18（降幅 80%）；阶段 6 收尾的后续函数分解把它进一步降到 7（累计降幅 92%），且无一处行数增大。**
下表的「分解前」由 HEAD `236175e4` 的独立 worktree 实测得出（AST 统计，`count` 为包内 >50 行函数总数），「阶段 6 本轮后」为该阶段的记录值，「当前工作树实测」为阶段 6 收尾后由同口径工具重新统计：

| 包                         | 分解前 >50 行（HEAD `236175e4`） | 阶段 6 本轮后 | 当前工作树实测 | 累计消除 |
| -------------------------- | -------------------------------: | ------------: | -------------: | -------: |
| `application/gateway`      |                               32 |             9 |          **7** |       25 |
| `transport/http/inference` |                               18 |         **0** |          **0** |       18 |
| `infra/provider/web`       |                               38 |             9 |          **0** |       38 |
| **合计**                   |                           **88** |        **18** |          **7** |   **81** |

达标示例：`handleVideoCreate` 199→30、`transcribeSpeechRequest` 170→33、`editImage` 108→（≤50）、`sanitizeResponsesEvent` 100→（≤50）、`handleOpenAISpeech` 95→（≤50）、`streamOpenAIResponse` 201→≤50、`ForwardResponse` 184→≤50、`generateWSImageAttempt` 126→≤50、`editImageAttempt` 114→≤50、`generateLiteImageURL` 112→≤50、`buildOpenAIResult` 124→≤50、`executeImage` 259→66、`executeVoice` 237→64、`acquirePinned` 92→≤50、`beginSelectionSessionForKey` 101→≤50、`acquireSegmentedCandidates` 111→≤50、`planCandidateIndexesWithHints` 94→≤50、`segmentedCandidateCohorts` 86→≤50、`ProbeEgressQuality` 153→≤50。

当前仍超限函数**逐项登记**（当前工作树 AST 实测行数，不隐藏、未强行拆）：

- gateway（7）：`createResponseAt` 908、`runVideoJob` 284、`OpenVoiceWebSocket` 247、`acquire` 246、`executeImage` 57、`executeVoice` 54、`CreateVideo` 52
- inference：**0**（`handler.go` 2475→91 后 18 个超限函数全部消除，本阶段无回升）
- web：**0**（阶段 6 收尾拆掉 `openGatewayChat` 93、`SyncQuotaMode` 85、`runGatewayStream` 79、`streamImageEdit` 72、`doWithFollow` 67、`executeWebAccountSetting` 60、`postJSONWithReferer` 58、`DownloadVideo` 53、`pollToken` 53 共 9 个；该包已无 >50 行函数）

结构分布：扣除 `createResponseAt`（908 行，已登记为不强行拆）后剩 6 个——其中 3 个仍是多锁段/状态机量级（`runVideoJob` 284、`OpenVoiceWebSocket` 247、`acquire` 246），3 个仅轻微超限（`executeImage` 57、`executeVoice` 54、`CreateVideo` 52）。

**行数未增大的证据**：`createResponseAt` 在 HEAD 与当前工作树均为 **908** 行（未改动，未强行拆）；`runVideoJob` 284（HEAD 284）、`OpenVoiceWebSocket` 247（HEAD 247）、`acquire` 246（HEAD 246）逐项持平；`executeImage` 与 `executeVoice` 由阶段 6 记录值 66/64 降到 57/54（收尾修复顺手收敛，非搬行）。表内「消除」来自被真正分解的函数，而非把行数搬进新函数。

未拆理由（真实原因，不声称「不可拆」）：gateway 的 `createResponseAt`（908 行）含 `attemptLoop`/`handleResponse`/`afterTeamRateLimit` 三处跨块 `goto`，`err`/`selection`/`fallback`/`qualityAccountAttempts`/`timingHandedOff` 与 `defer` 交织，需先按 image/voice 的返回码枚举方式等价改写控制流；`runVideoJob`/`OpenVoiceWebSocket`/`acquire` 为多锁段 + singleflight 内外双检缓存的分层状态机，需逐个核对锁边界与版本判定，等价提取风险高于收益；`CreateVideo`（52）与 `executeImage`（57）/`executeVoice`（54）为整段事务与结算顺序，拆分会引入跨函数状态传递。**这 7 个是 REV-2 仍未完成的剩余范围，不记为「已通过」。**

验证：三包 `go test` 全通过（inference 138 / provider-web 229 / gateway 311+192 子测试，0 FAIL / 0 SKIP）；`go build ./...`、`go vet ./...` exit 0。测试通过只证明被现有断言覆盖的行为未变，未被断言覆盖的分支不做等价性声明。

### 12.3 强制回归项自检（§6 清单逐条落点）

| 回归项                                             | 阶段 6 后的落点                                                                                                | 结论 |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---- |
| 未知 Build 403 指纹上限、不对未知 403 账号新增惩罚 | `application/gateway/failure.go`（未改），调用点在 `service.go`                                                | 未变 |
| 视频请求 ClientKey AccountScope                    | `video.go::runVideoJob` 内 `AcquirePinnedForKey` / `beginSelectionSessionForKey`（`video_scope_test.go` 未改） | 未变 |
| WebSocket 截止时间与已确认 STT 用量结算            | `voice_ws.go`、`transport/http/inference/voice_ws_handler.go`（未改）                                          | 未变 |
| Build-only 质量拦截                                | `quality_retry.go::shouldHoldQualityStream`（未搬移）                                                          | 未变 |
| consent token 与各状态码处理                       | `quality_probe.go`、`response_media_audit.go`、`provider/web/sso_build.go`（未改）                             | 未变 |
| 模型级额度封锁判定与展示                           | `selector_health_cache.go` 逐行搬移；`models_handler.go::filterModelRoutesForClientKey`                        | 未变 |
| `{account}` 占位符先于代理解析                     | `infra/egress`（未改）                                                                                         | 未变 |
| Build 客户端版本回填                               | `provider/web` 对应文件逐行搬移                                                                                | 未变 |
| 取消/超时不放行后续尝试、不重复计费                | `stream_copy.go` 中止 trailer、`errors.go::classifyCopyError`、gateway 各 `ctx.Err()`/`context.Canceled` 分支  | 未变 |

### 12.3.1 独立审查发现并处理的问题

对 12 个提交做过一次独立只读审查，结论与处置：

| 发现                                                                                                            | 核实方式                                                                                                                 | 处置                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `image_execution.go` 连续两次 `checkLedgerReady()`（复制残留）                                                  | 对照 HEAD `236175e4:gateway/image.go` 实测**只有 1 次**                                                                  | **已删除重复调用**（该检查幂等只读，行为等价且恢复与基线一致）；`go build`/`vet`/gateway 包测试 exit 0                                                                                                                                                                                                                       |
| `voice_execution.go`/`image_execution.go` 尝试循环把上一轮 `err` 带入下一轮，`if err == nil` 可能跳过 `Acquire` | 对照 HEAD `236175e4:gateway/voice.go:357-363`：基线**同样是循环外 `var err error` + `if err == nil` 守卫**，结构逐行一致 | **当次判定为既有行为被忠实保留，非本轮引入**，未在等价搬移范围内改动，并登记为**未覆盖风险**（voice/image 执行链无「第 1 账号失败 → 第 2 账号成功」用例，`voice_ws.go` 亦复用同一写法）。**后续已在 §13.1 作为 P1 缺陷正式修复并补回归测试**；原判断（基线即有）成立，但「既有」不等于「可接受」，修正在等价搬移之外单独提交 |
| `§12.1`「后」列行数过时（叠加了后续函数分解）                                                                   | 用文件实际行数重新实测                                                                                                   | **已更新全表**，并注明「后」为工作树实测、部分数值大于拆分当次是函数分解回填所致                                                                                                                                                                                                                                             |
| `§12.2` 结论「86 → 18」与同节表格「88 → 18」矛盾                                                                | 复核 HEAD 基线实测为 88                                                                                                  | **已更正为 88 / 降幅 80%**                                                                                                                                                                                                                                                                                                   |
| `§12.4` 新增用例数「47（16/13/18）」与文件实际不符                                                              | 实测 `^func Test` 为 22/34/18                                                                                            | **已更正为 74（22/34/18）**                                                                                                                                                                                                                                                                                                  |

审查同时确认无问题：`voice_ws.go` 的 WebSocket 截止时间、`sso_build.go` 的 consent token、`quality_retry.go` 的 Build-only 拦截、`stream_copy.go` 的中止 trailer 与 `errors.go::classifyCopyError` 均未被改写；`selector_cache.go`/`selector_health_cache.go` 未见 `defer` 与显式 `Unlock` 混用导致的重复解锁。

### 12.4 验证

- `go build ./...` exit 0；`go vet ./...` exit 0
- `go test ./... -count=1` exit 0：**64 包 ok / 0 FAIL / 2879 PASS / 20 SKIP**（20 条为 PostgreSQL·Redis 集成用例，本机无隔离服务，属预期；CI 提供隔离服务后必须 0 skip）
- 新增测试 3 文件 / 74 个顶层用例：`application/gateway/refactor_helpers_test.go` 22、`transport/http/inference/refactor_helpers_test.go` 34、`infra/provider/web/refactor_helpers_test.go` 18；覆盖提取出的定价估算、STT 格式化（text/json/verbose_json/rawjson）、媒体 JSON 解码、选择失败码、流分帧与 EOF 处理、导入凭据归一、图像/编辑校验拒绝路径（计数为 `^func Test` 实测，`inference` 侧含 2 处 `t.Run` 子用例）
- `-race` 本机无 cgo，**Blocked**，由 CI 覆盖

## 13. 阶段 6 收尾（P1 缺陷修复 / 函数分解收敛 / benchmark / 去重）

本节记录阶段 6 收尾轮次的实测结果。除下述明确列出的改动外，公开协议（路由、DTO、状态码、错误文案、SSE 分帧、计费/审计顺序）未变。

### 13.1 P1 修复：媒体尝试循环在多账号池下跳过 `Acquire`，把可自愈失败放大为 503

**缺陷（`backend/internal/application/gateway/voice_execution.go`、`image_execution.go`）**：两个尝试循环把 `err` 声明在循环外且每轮不重置，本轮以错误结束并判定需要换号/重试时，下一轮 `if err == nil` 为假 → 跳过 `beginSelectionSessionForKey` + `selection.Acquire`，随即返回 503 `ErrNoAvailableAccount`。**即使账号池中仍有健康账号，第二个账号也从未被租用或尝试**——单账号凭据失效或一次性传输抖动会被放大为下游可见的 503。

**修复**：每轮改用独立 `acquireErr`（`voice_execution.go:161-174`、`image_execution.go:241-251` 各带注释说明「selection 只在第 1 轮建立，其后轮次的租约获取不应受上一轮错误影响」）；`applyVoiceExecutionError` 返回值由 `(retry, carriedErr, fatalErr)` 收敛为 `(retry, err)`，消除跨轮携带错误的载体本身。

**回归测试**：新增 `backend/internal/application/gateway/media_attempt_loop_test.go`（两账号夹具；`mediaAttemptLoopLimiter` 记录每个账号并发槽位的真实获取次数，作为「本轮是否重新获取租约」的可观察证据；`Current` 恒返回 0 避免夹具自身制造饱和假象）：

| 用例                                                            | 断言                                                                                                                                        |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `TestRunVoiceAttemptsReacquiresLeaseAfterRetryableAttemptError` | ① SSO 被拒后第二个账号被**真正租用**并成功返回 200；② 可重试传输失败在**同一账号**上重试 3 次（出口绑定语义保持），且第二个账号一次未被租用 |
| `TestRunImageAttemptsRetryableAttemptErrorSwitchesAccount`      | ③ image 循环 SSO 换号成功、transport 失败以 502 终态（**不是**池耗尽）                                                                      |

**验证**：`go build ./...`、`go vet ./...` exit 0；`go test ./... -count=1` 64 包 ok / 0 FAIL。影响面与回滚：单包单文件修复 + 新增测试，回滚即恢复旧循环语义（会退回 503 放大行为，不建议）。

### 13.2 `infra/provider/web` 新增 6 个基准（解析/归一热点此前无可比基线）

`backend/internal/infra/provider/web/benchmark_test.go` 新增 6 个基准。测量条件：**Go 1.26.1 windows/amd64、`-benchmem -count=3`、未固定 CPU**，下表为三次代表值区间：

| Benchmark                             |         ns/op |    B/op | allocs/op |
| ------------------------------------- | ------------: | ------: | --------: |
| `BenchmarkConsumeJSONObjects`         |   425k – 563k | 180,256 |         4 |
| `BenchmarkParseUpstreamFrame`         |  8.8k – 10.8k |   3,289 |        48 |
| `BenchmarkNormalizeOpenAIInput`       |   191k – 196k |  56,088 |       680 |
| `BenchmarkBuildOpenAIChatResult`      | 14.8k – 20.7k |  10,320 |        85 |
| `BenchmarkParseWeeklyCreditsResponse` |   1.0k – 1.6k |     376 |         7 |
| `BenchmarkInferWebTierFromQuota`      |     172 – 188 |       0 |         0 |

口径说明：未固定 CPU 且未做 5 次中位数，因此**区间值只作基线量级参考**，不作为「优化收益」证据；后续对比必须同机、同 `-count` 重复测量。全仓 `^func Benchmark` 计数由阶段 0 的 12 增至 **19**（`infra/provider/web/benchmark_test.go` 内 6 个，另含阶段 2–4 新增的 1 个账号分页聚合基准）。

### 13.3 后端去重：删除纯转发包装

`internal/infra/provider/web/account_settings.go`：删除纯转发包装 `runWebAccountSetting`（仅把参数原样转给 `runWebAccountSettings`，无附加语义），三处调用点（同文件 55、88、108 行）改为直接调用 `runWebAccountSettings`。行为等价、减少一层无价值间接；无新增依赖。

### 13.4 阶段 6 收尾验证

- `go build ./...` exit 0；`go vet ./...` exit 0
- `go test ./... -count=1`：**64 包 ok / 0 FAIL**
- 函数级 REV-2：三包合计 **7**（详见 §12.2 更新后的表格与逐项登记），未记为全部达标
- `-race` 本机无 cgo，**Blocked**，由 CI 覆盖（本轮未重跑）

### 13.5 P2 修复：`runVideoJob` 固定账号获取失败时跳过换号回退（与 §13.1 同类）

**缺陷（`backend/internal/application/gateway/video.go:499-505`，HEAD 既有，非本轮拆分引入）**：`runVideoJob` 的重试循环把固定账号（首轮为 `job.AccountID`，其后为 403 出口重试的同一账号）的 `AcquirePinnedForKey` 失败错误写回循环级 `err`，随后的回退门 `if lease == nil { ... if err == nil { selection.Acquire(...) } }` 因此被判假 → 跳过会话租约获取，直接 `failVideoJob(..., "account_unavailable", lastErr, ...)`。触发条件：固定账号在重试轮次前被禁用/冷却/能力失效，而账号范围内仍有其它健康账号；任务被误判为账号池耗尽，审计写入的 `error_code=account_unavailable` 还会与从上一轮上游错误解析出的 HTTP 状态自相矛盾。

**归属证据**：`git diff HEAD -- backend/internal/application/gateway/video.go` 只覆盖 `CreateVideo` 的拆分（旧 59–194 行）；`runVideoJob`（421–704）本次未改动，故为基线既有行为，与 §13.1 的 voice/image 循环是同一类缺陷的第三处。

**修复**：固定账号获取失败只排除该账号，不再把错误写回 `err`（`video.go:499-509`），使 `selection.Acquire` 回退按循环注释「Create-stage failures may switch accounts」的既有语义执行。

**回归测试**：新增 `TestVideoPinnedAccountUnavailableFallsBackWithinScope`（`video_scope_test.go`）。夹具扩为三账号（Super 200 / Free 100 / Spare 50），并给 `videoCreateFailoverAdapter` 增加 `onAttempt` 回调，用于在两次尝试之间禁用账号：

| 步骤    | 事件                                                                                                                   |
| ------- | ---------------------------------------------------------------------------------------------------------------------- |
| 前置    | 禁用 Super；`job.AccountID = Super`                                                                                    |
| 第 1 轮 | Super 固定获取失败 → 建立 selection 会话并租到 Free；Free 返回 create 阶段 403 → 固定 Free 重试；`onAttempt` 禁用 Free |
| 第 2 轮 | Free 固定获取失败 → **回退租用 Spare 并成功**                                                                          |

断言：`attempts == [Free, Spare]`，终态 `completed` 且 `AccountID == Spare`。**反向验证**：临时把 `video.go` 还原为旧写法后该用例失败（`attempts=[Free]`，任务以 `account_unavailable` 终止），确认用例确实钉住该缺陷。

**验证**：`go build ./...`、`go vet ./...` exit 0；`go test ./internal/application/gateway -count=1` exit 0（38.4s）；全量结果见 §13.6。回滚：还原该 5 行即回到旧语义（会退回误判池耗尽行为，不建议）。

### 13.6 阶段 7 独立复核与复验（本轮实测）

- **独立只读审查**（针对未提交的 gateway / provider-web 拆分 diff）：确认质量判定与持有扫描、SSE 分帧、403/Statsig 重放、SSO 轮询、额度解码、视频帧解析在 HEAD 测试基线下行为等价；`quality_decision.go` 的四类指纹与 `BoundQualityRetry` 逐条复算无差异；`doWithFollow`/`pollToken`/`syncWeeklyCredits` 的 body 关闭与 timer 停止配对正确；`BenchmarkBuildOpenAIChatResult` 复用 `parsed` 不产生跨迭代污染。发现 1 个 P2（已修复，§13.5）与 3 项 P3（登记如下）。
- **P3 登记（未修改，如实记录）**：① `gateway/video.go:658-661` 的 `if lease == nil` 防御分支在当前 attempt 策略下不可达（`allows(attempt)` 与 `hasNext(attempt)` 互斥），属死代码而非缺陷；② `infra/provider/web/gateway.go:617-619` 的 `collectGatewayToolResult` 注释在拆分时错位到 `gatewayActionSource` 上方；③ `refactor_helpers_test.go` 中 `TestVoiceQuotaModeOnlyResolvesWhenQuotaConsumed` 只覆盖 `consumesQuota=false` 分支，`BenchmarkInferWebTierFromQuota` 的 fixture 全部解析为同一 tier，未进入 `rank[candidate] < rank[detected]` 分支。三者均不改变对外行为，未据「建议」扩大改动。
- **复验结果**：`go build ./...` exit 0；`go vet ./...` exit 0；`go test ./... -count=1` = **64 包 ok / 0 FAIL / 11 包 no test files**；20 个 PostgreSQL·Redis 集成用例 **Skipped**（本机无隔离服务，`TEST_POSTGRES_DSN`/`TEST_REDIS_ADDRESS` 为空，CI 提供后必须 0 skip）；`go test -race` 本机 `CGO_ENABLED=0` **Blocked**，由 Linux CI 覆盖。
- **REV-2 独立复测**：用 stdlib `go/ast` 自建工具重测三包 >50 行函数 = **7**（gateway 7 / inference 0 / provider-web 0），与 §12.2 逐项一致；口径校验用 `createResponseAt` = 908 行（与登记值相同）。
- **基准复测注意**：本次 6 个 `infra/provider/web` 基准是在**两个前端覆盖率进程并行占满 CPU** 的条件下测得（如 `ConsumeJSONObjects` 927k ns/op，§13.2 为 425k–563k），因此不写入基线；§13.2 的区间仍是未并行负载下的参考值，后续对比必须同机同负载。

## 14. 发布登记：v0.1.1（2026-10-10）

维护线首次发布，按 `AGENTS.md` §8 流程执行。**后端验收、CI Verify、容器镜像发布与工作流缺陷修复（P1/P3）均经实测 `Passed`。**

| 项目          | 事实                                                                                                                                                                                                                                                                                          |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 版本与提交    | 根 `VERSION` = `v0.1.1`（此前 `v3.1.6`，`Dockerfile:66` 复制进镜像 `/app/VERSION`）；`frontend/package.json` 同步为 `0.1.1`；发布提交 `b2123a7d0e250948f9f23b941f5a9acd2640ba35`（`main`，由 `maint/modular-quality-audit` fast-forward 合并）                                              |
| tag / Release | annotated `v0.1.1`（tag 对象 `db20ef9638fc27cee5bc915dc7afa84724a34610`）；Release https://github.com/JasmineTony/grok2api/releases/tag/v0.1.1 （本仓库首个 Release，非草稿、非预发布）                                                                                                          |
| 本机验证      | `go build ./...`、`go vet ./...`、`go test ./... -count=1` 均 **exit 0**（75 包：64 ok / 11 无测试文件 / 0 FAIL）；**20** 个 PostgreSQL·Redis 集成用例因本机无隔离服务 **Skipped**（`-v` 实测 `--- SKIP` 计数 20，非 Passed），`-race` 本机 **Blocked**（无 cgo），两者由 Linux CI 覆盖 |
| 远端 CI       | run `38054220100`（tag `v0.1.1`）与 run `38054197912`（`main`）的 Verify job **18 步全部 success**：Test backend、Assert required integration tests ran（PostgreSQL/Redis 用例 **0 跳过**）、Race backend、Vet backend、Swagger 精确 diff、前端 `pnpm verify`、全栈 E2E                            |
| 镜像发布      | **Passed**：删除未链接的孤立包（HTTP 204）后，run `38054220100` attempt 2 的 `Publish image (amd64/arm64)` 成功，run `38055278879`（`main`）attempt 2 全绿；注册表实测 `ghcr.io/jasminetony/grok2api` 9 个 tag，`v0.1.1` / `main` / `latest` 均为 amd64 + arm64 多架构索引，匿名拉取 HTTP 200。详见 §11 与 `frontend/AUDIT.md` §14 |
| 已修复缺陷（P1/P3）| **P1**：tag 推送时 `Merge image` 必然失败——`docker/metadata-action` 默认 `flavor: latest=auto` 会对 `type=ref,event=tag` 无条件生成 `latest`，而 `latest-amd64`/`latest-arm64` 只在 `main` 推送时存在，故 `docker buildx imagetools create` 报 `latest-arm64: not found` → `b4068303` 给两个 `Docker metadata` 步骤加 `flavor: latest=false`。**P3**：`Create manifest list` 循环缺 fail-fast，前面的 `imagetools create` 失败可被后续成功掩盖 → `a4f58384` 加 `set -euo pipefail`。**实测**：tag 推送 run `38060494037`（临时 tag `v0.1.1-verify.1`）与 main 推送 run `38060467337` 全部 job success。完整证据见 `frontend/AUDIT.md` §14 |
| 回滚点        | 源码与配置随提交回退到 `7c0493a2`（发布前的 `main`）；tag `v0.1.1` 与对应 Release 需一并删除。本次不涉及生产数据迁移，无需数据回滚                                                                                              |

## 15. 发布登记：v0.1.2（2026-10-11）

按 `AGENTS.md` §8 执行。本节按发布流程分两次写入：**15.1 远端仓库重建**（重建动作完成即登记）、**15.2 发布与镜像证据**（tag 与镜像产出后登记）。

### 15.1 远端仓库重建（按维护线负责人 2026-10-11 授权）

为规避历史遗留问题，远端 `origin` 已删除并同名重建：旧仓库 `JasmineTony/grok2api`（repo id `1411672647`）于 2026-10-11 删除（HTTP 204），新仓库同名创建（repo id `1413858145`，2026-10-11T02:37:22Z，public、非 fork、默认分支 `main`、Actions 默认 workflow 权限 `read`）；旧 GHCR 包 `ghcr.io/jasminetony/grok2api` 成为孤立包后删除（HTTP 204），新包由本次 CI 首次发布时创建并链接到新仓库。

有意丢弃：PR #1、Release `v0.1.1`、全部 Actions run 历史、tag `v0.1.1` 及其镜像；上游历史 tag 与 `v0.1.1` tag 未推送到新仓库（避免对旧提交触发镜像工作流）。本地已留 `git clone --mirror` 备份（69 个 ref）与旧仓库 ref 清单。完整表格与动机见 `frontend/AUDIT.md` §16.1。

本机验收（2026-10-11，与前端覆盖率门禁并发运行）：`go build ./...` exit 0（10.6s）；`go vet ./...` exit 0（13.1s）；`go test ./... -count=1` exit 0（142.7s，64 包 ok / 2935 用例通过 / 0 失败 / 20 跳过）。20 个 PostgreSQL·Redis 集成用例因本机无隔离服务 **Skipped**，`go test -race ./...` 因 `CGO_ENABLED=0` 且无 C 编译器 **Blocked**（`go: -race requires cgo`）——两者均不记为通过，须以远端 CI 结果为准（见 15.2）。

### 15.2 发布与镜像证据

| 项目             | 事实                                                                                                                                                                                                                                                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 版本载体         | 根 `VERSION` = `v0.1.2`、`frontend/package.json` = `0.1.2`（提交 `9b71efc0`）；新增 CI 门禁 `Verify version carriers are aligned` 在 dispatch / main / tag 三条 run 中均 **success**                                                                                                                                                                              |
| 发布提交         | `34476cd3784cf4f0e89934d6dfca6257e849c54f`（`main` = `maint/modular-quality-audit`）                                                                                                                                                                                                                                                                           |
| tag / Release    | annotated `v0.1.2`，tag 对象 `c2c94e1bb719eab5bea4998bb7b9235fac3f17de`，指向 `34476cd3`；Release https://github.com/JasmineTony/grok2api/releases/tag/v0.1.2 （非草稿、非预发布，target `main`）                                                                                                                                                                 |
| 本机验证         | `go build ./...` / `go vet ./...` / `go test ./... -count=1` 均 **exit 0**（64 包 ok / 2935 用例 / 0 失败 / 20 跳过）；20 个 PostgreSQL·Redis 集成用例 **Skipped**、`-race` **Blocked**（无 cgo），由 CI 覆盖，未记为通过                                                                                                                                        |
| 远端 CI（main）  | run `38107489273`（`push`，ref `main`，sha `34476cd3`）：`Verify` **success**（`Verify version carriers are aligned`、`Test backend`、`Assert required integration tests ran`（**0 跳过**）、`Race backend`、`Vet backend`、`Verify Swagger document`、`Verify frontend`、`Run full-stack E2E`）、`Publish image (amd64)`/`(arm64)` **success**、`Merge image` **success**、`Build image` skipped（PR 路径） |
| 远端 CI（tag）   | run `38108809200`（`push`，ref `v0.1.2`，sha `34476cd3`）：`Verify` + `Publish image (amd64/arm64)` + `Merge image` 全部 **success**                                                                                                                                                                                                                          |
| 多架构断言       | `merge` 日志实测：`检查 ghcr.io/jasminetony/grok2api:main` → 平台 `linux/amd64`、`linux/arm64`、`unknown/unknown`（attestation）→ `多架构断言通过：linux/amd64 + linux/arm64`                                                                                                                                                                                  |
| 镜像             | `ghcr.io/jasminetony/grok2api:v0.1.2` 为 `application/vnd.oci.image.index.v1+json`（`linux/amd64` + `linux/arm64` + 2 个 attestation manifest），digest `sha256:2e5e3ba69ba5c5b463e31c9e65654402bbb6b98af0bfdb84f386d6534f0657c9`；经 ghcr 匿名 token 流程拉取 **HTTP 200** 实测；注册表标签 9 个：`v0.1.2` / `v0.1.2-amd64` / `v0.1.2-arm64` / `main` / `main-amd64` / `main-arm64` / `latest` / `latest-amd64` / `latest-arm64` |
| 过程缺陷（如实登记） | 把 `.github/workflows/ghcr-image.yml` 用 PowerShell 文本往返（`Get-Content -Raw` → `Set-Content -Encoding utf8`）改写，导致中文注释乱码、换行被吞并写入 UTF-8 BOM，GitHub 无法解析该工作流（产生 4 个名为 `.github/workflows/ghcr-image.yml` 的失败 run）。修复：`git checkout <已知可解析提交> -- <路径>` 恢复后用编辑工具重做改动（`34476cd3`，与 `d070144b` 的差异仅 +2 行注释）；4 个失败 run 与 2 个诊断探针 run 已删除。教训：不要用 PowerShell 文本往返改写含非 ASCII 的仓库文件 |
| push 触发异常（如实登记） | 新仓库创建后最初约 5 分钟内的两次 push（`d070144b` 新增工作流、`d2931a58` 仅文档）与一次经 API 创建的临时 tag ref 均未产生 Actions run；自 `39ab8552`（03:07Z）起恢复正常——含 workflow 改动的 push、tag `v0.1.2` push 与仅文档的 push `d2d3a78c`（触发 GHCR run `38109851940` 与 CodeQL run `38109851937`）均正常触发。判定为**新仓库工作流注册延迟**，非工作流缺陷；发布证据由 `main` 与 tag 两条路径的**真实 run** 取得，未以 `workflow_dispatch` 代替发布路径 |
| 未达成项         | 无                                                                                                                                                                                                                                                                                                                                                            |
| 回滚点           | 源码/配置/文档随提交回退到 `57f384c9`（本轮改动前的 `main`）；tag `v0.1.2`、Release 与 GHCR `v0.1.2*` 标签需一并删除。本次不涉及生产数据迁移                                                                                                                                                                                                                     |
| 已知局限         | tag `v0.1.2` 指向 `34476cd3`（发布准备提交），不含发布之后的登记提交 `d2d3a78c`——tag 无法包含自身证据（与 §14 未达成项 ② 同类）；如需 tag 自带登记只能重打 tag 并重发镜像（不可逆，未执行）。`main` 的 `main`/`latest` 镜像随后续 push 重建，`v0.1.2` 标签镜像不再变动 |

## 16. 2026-10-11 后端结构债务清零（BE-01 / BE-04 / BE-05 + P3）

v0.1.2 发布后继续清空已登记存量：**BE-01 的 >1000 行文件类清零**、**BE-04 装配入口拆分完成**、**BE-05 契约收敛确认**，并修复 1 个 P3 注释错位与 1 个 flaky 用例。

### 16.1 文件级拆分（纯代码搬运，零语义改动）

| 目标文件（拆分前）                                                                                                        |               行数 | 拆分后                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------- | -----------------: | ------------------------------------------------------------------------------------------------------------------- |
| `internal/app/application.go`                                                                                             |                861 | `application.go` 309 + `assemble.go` 586 + `lifecycle.go` 234（`New()` 354→27、`Run()` 182→19，helper 全部 ≤50 行） |
| `application/gateway/{service,video,selector}.go`                                                                         |      1931/1326/1044 | 21 个同包文件（`service.go` 保留 29 行头部；`video.go`/`selector.go` 内容搬出后删除空壳）                            |
| `infra/persistence/relational/{model_repository,audit_repository}.go`                                                     |          1327/1133 | 9 个同包文件                                                                                                        |
| `transport/http/account/handler.go`                                                                                       |               1634 | 8 个同包文件                                                                                                        |
| `infra/provider/cli/adapter.go`                                                                                           |               1306 | 9 个同包文件                                                                                                        |
| `infra/provider/conversation/stream.go`                                                                                   |               1055 | 7 个同包文件                                                                                                        |
| `application/audit/service.go`                                                                                            |               1047 | 8 个同包文件                                                                                                        |
| `infra/config/config.go`                                                                                                  |               1003 | 5 个同包文件（配置结构体字段与 `yaml` tag 逐字未变）                                                                |
| `relational/{egress_repository,schema,account_links}.go`                                                                  |           960/882/776 | 16 个同包文件                                                                                                       |
| `provider/cli/{responses_tool_declarations,responses_codex_tools,video}.go`                                               |           943/638/609 | 12 个同包文件                                                                                                       |
| `gateway/{selector_cache,selector_health_cache,quality_retry_scan}.go` + `conversation/messages_request.go`                |           678/664/636/876 | 13 个同包文件                                                                                                       |

- 全部为同包文件级搬运：标识符/签名/接收者/语句顺序/注释逐字不变，未新建包；每批均以「`git show HEAD:<path>` 原文与新文件正文的非空行多重集或区间逐行比对」+ `go build`/`go vet`/包级与全量 `go test` 验证。
- 每轮 `go build ./...`、`go vet ./...` 均 exit 0；最终全量 `go test ./... -count=1`：**64 包 ok / 0 FAIL / 11 无测试文件 / 2935 用例通过 / 20 跳过**。
- 附带修复 P3：`infra/provider/web/gateway.go` 的 `collectGatewayToolResult` 注释从 `gatewayActionSource` 上方移回其函数上方（diff 1/2 行，无行为变化）。

### 16.2 flaky 用例修复（`internal/infra/provider/streamidle`）

全量测试首轮出现 1 次失败：`TestReadCloserResetsDeadlineOnProgress`（`streamidle_test.go:44`，`upstream stream idle timeout`）。根因：用例用 `gap=10ms` 的 `pacedReader` 对 `idle=30ms` 断言「有进度就不超时」，余量仅 3 倍，机器负载下一次 `time.Sleep` 被调度延迟超过剩余阈值即触发（该包不在本轮任何拆分范围内）。

修复（**仅测试文件**，未改生产代码、未弱化断言）：`gap=10ms / chunks=30 / idle=150ms`（单次间隔余量 15 倍，且整段流 ≈300ms > 150ms，保证「缺少 `timer.Reset`」时用例仍会失败）；`TestReadCloserReportsProgressBeforeIdleTimeout` 的 `idle` 由 30ms 提到 200ms（同样只为扩大余量）。

验证：`-count=20` 全过（12.4s）；用 `go test -overlay` 注入「删除 `timer.Reset`」的生产变体后该用例**仍然失败**（`upstream stream idle timeout`），证明判别力未削弱。

### 16.3 验证

- `go build ./...` exit 0（5.35s）；`go vet ./...` exit 0（4.52s）；`go test ./... -count=1` exit 0（重跑：`pass=2935 / fail=0 / skip=20`，64 包 ok）。
- `go test -race ./...` 本机 **Blocked**（`go: -race requires cgo`，`CGO_ENABLED=0` 且无 C 编译器），须由 Linux CI 覆盖。
- 20 个 PostgreSQL·Redis 集成用例本机 **Skipped**（缺 `TEST_POSTGRES_DSN`/`TEST_REDIS_ADDRESS`），由 CI 隔离服务覆盖。

### 16.4 未覆盖与剩余债务

- **>600 行的剩余生产文件 12 个**（§4.2）：除 `gateway/service_request.go`（含存量 `createResponseAt` 908 行，已登记不强行拆）外，其余 11 个为既有文件，本轮未拆分，按 P3 登记（后端不在 REV-1 门禁范围）。
- **函数级 REV-2 存量 7 个未变**（纯文件级搬运不重构函数体）：`createResponseAt` 908、`runVideoJob` 288、`OpenVoiceWebSocket` 247、`acquire` 246、`executeImage` 57、`executeVoice` 54、`CreateVideo` 52（stdlib `go/ast` 复核，仅统计生产代码；`inference` 与 `provider-web` 生产代码为 0）。
- 测试文件 >600 行 38 个（最大 `gateway/service_test.go` 4928）属既有约定，不在门禁范围。
- 语义等价性由「逐行搬运 + 多重集比对 + 编译 + 全量测试」保证；PostgreSQL/Redis 专属路径本机未执行（`Skipped`）。

- **2026-10-11 全量口径复核（新增测量，非新增债务）**：此前 §12.2 / §16.4 的「REV-2 存量 7 个」只统计 `gateway` / `inference` / `provider-web` 三个包（其中 `inference` 0、`provider-web` 0）。以 stdlib `go/parser`+`go/ast` 对 `backend/internal/**` 全量复核（427 个生产文件 / 4113 个函数，口径 `Rbrace.Line - Lbrace.Line + 1`，与 §12.2 登记口径一致，校验点 `createResponseAt` = 908 行吻合）：**>50 行生产函数 174 个**（大型 >200：8；中等 61–200：110；轻微 51–60：56），**>600 行生产文件 12 个**（`docs/docs.go` 945 行为 swag 生成物，已排除）。`gateway` 实测为 5 个——`executeImage` 57→40、`executeVoice` 54→40 已随阶段 6 收尾下降，登记值未同步。
- 结论：后端函数级 REV-2 的「7 项」是**三包口径**，全后端口径为 **174 项 / 12 文件**；两者都不得记为「已通过」，均按 P2/P3 分阶段清偿。后端不在 REV-1 文件门禁扫描范围（`AGENTS.md` §5），该 12 个文件按 P3 登记。 **2026-10-11（续）该 174 项与 12 文件已全部清零，见 §17。**

### 16.5 CI 加固实施与登记（BE-11~BE-14，2026-10-11）

- 实施提交：`e57fadda`（`ghcr-image.yml`：tag 推送不取消、四个 job 超时、集成用例双重断言、`uses:` 固定 SHA）、`79230b36`（`frontend/package.json` 声明 `engines.node >=22` 并同步 README）；本机 2026-10-11 补固定 `codeql.yml` / `stale.yml` 的 4 处浮动 `uses:`。
- 验证 run：`38121078190`（main，`1a510f5d`，其工作流定义含上述全部加固）`conclusion=success`，`Verify` job 第 5–17 步（含 `Verify version carriers are aligned`、`Assert required integration tests ran`、`Race backend`、`Vet backend`、`Verify Swagger document`、`Verify frontend`、`Run full-stack E2E`）全 success，`Publish image (amd64)` / `Publish image (arm64)` / `Merge image` 全 success；同提交 `CodeQL Advanced` run `38121078196` success。
- 未覆盖（如实登记）：`ghcr-image.yml:20` 的 tag 专用表达式自实施后**尚无真实 tag 推送执行**（`v0.1.2` tag run `38108809200` 早于 `e57fadda`），故「tag 推送不被取消」目前只有静态证据；`codeql.yml` / `stale.yml` 仍未设 `timeout-minutes`。

## 17. 2026-10-11（续）后端 REV-2 函数级与文件级全量清零（BE-15）

- **范围与口径**：`backend/internal/**` 全部生产代码（`docs/docs.go` 为 swag 生成物，排除）。函数体行数 = `Rbrace.Line - Lbrace.Line + 1`，与 §12.2 / §16.4 同一口径；文件行数为文件总行数。工具为本轮自建 stdlib `go/parser`+`go/ast` 计数器（扫描 `.go` 且排除 `_test.go` 与 `docs/`）。
- **结果（本机实测）**：以 `HEAD 2148def8` 的独立 worktree 为改动前基线，**>50 行生产函数 163 → 0**、**>600 行生产文件 2 → 0**（基线 2 个为 `application/gateway/service_request.go` 967 行与 `domain/audit/pricing.go` 628 行）。§16.4 登记的 174 项是 §16 时点的全后端口径，两者不矛盾：163 是 §16 之后两轮（`6b39ea93`、`2148def8`）已清偿后的新基线。
- **实施方式**：20 个并行子代理按包/文件切分、边界互不重叠；全部只做「同包未导出辅助函数/方法抽取」与同包文件级搬运。导出签名、接收者类型、错误字符串、日志与 warning 文案、字段与 `json`/`yaml` tag、SQL 文本与参数顺序、语句相对顺序、副作用顺序、锁持有范围与事务边界逐项保持；跨块共享的局部状态改由参数/返回值或函数内局部结构体承载，未引入包级可变状态。
- **最大项**：`createResponseAt` 908 → 24 行（拆出 56 个辅助函数，`service_request.go` 966 → 426 行并拆为 `service_request.go` / `service_request_attempt.go` / `service_request_failure.go` 三个同包文件）；`ForwardResponse`（cli）277 → 45、`Validate`（config）282 → 9、`runVideoJob` 288、`OpenVoiceWebSocket` 247、`acquire`（gateway）246 同批清零。
- **新增同包文件 5 个**（纯搬运/职责归位，标识符逐字未变）：`application/gateway/service_request_attempt.go`、`application/gateway/service_request_failure.go`、`application/gateway/video_job_run.go`、`domain/audit/pricing_reconstruction.go`、`infra/provider/cli/responses_sse_reader.go`（SSE 读取器从 `responses_response.go` 迁出，该文件 642 → 523 行，避免拆分后越过 REV-1）。
- **未改测试**：`git status --porcelain` 中 `_test.go` 命中 **0**；未删除、未弱化任何断言。
- **验证（本机实测）**：
  - `go build ./...` exit 0；`go vet ./...` exit 0。
  - `go test ./... -count=1` exit 0；`-json` 统计 **64 包 ok / 0 FAIL / 2935 用例通过 / 20 跳过 / 11 包无测试文件**——与 §16.3 改动前的计数逐项相同，用例集与判定未被改动。
  - **导出 API 面比对**：自建 `go/ast` 工具导出「包相对路径 + 导出名 + 归一化签名/类型定义」共 **2228 条**，`HEAD 2148def8` 独立 worktree 与工作区**逐条相同（差异 0 条）**，即公共契约未变。
  - 全部改动路径（118 修改 + 5 新增，均在 `backend/internal/**` 内）经「CRLF 归一化后与 `gofmt` 输出比对」判定 `gofmt-clean`；`git diff --check` exit 0。工作区 CRLF 属 `.gitattributes` 约定的本地表现，仓库存储侧始终为 LF。
- **未覆盖（如实登记）**：`go test -race ./...` 本机 **Blocked**（`-race requires cgo`，无 C 编译器），须由 Linux CI 覆盖；20 个 PostgreSQL·Redis 集成用例本机 **Skipped**（缺 `TEST_POSTGRES_DSN`/`TEST_REDIS_ADDRESS`），由 CI 隔离服务覆盖。并发语义（锁持有范围、锁序、`defer` 释放点）由逐函数人工比对与上述用例集保证，**未**由 race 检测器独立验证。
- **拆分过程中被既有测试捕获并修正的真实回归 1 处（正面证据）**：`application/account` 组首轮把 `PermanentAccountDenial` 分支误加 `item.Outcome = BuildDetectOutcomeInvalid`（原实现只写 `Reason`），被既有用例 `TestFinishBuildDetectResponseUsesScopedFailureState` 判失败；提交前已删除该行，提交态与 `2148def8` 逐字一致。说明本轮「不改测试 + 全量用例计数不变」确实具备判别力，而非仅靠目测。
- **既有覆盖缺口（本轮未新增测试，如实登记）**：`application/egress` 的 `rebalanceProvider`、`RunMaintenance`、`TestNodes`、`UpdateManyEnabled`、`applySourceInput` 在被拆分前就没有直接单测；本轮受「只改生产文件、不改 `_test.go`」约束未补测。其行为等价性依据为：逐条对照搬移 + 编译期签名一致 + 整包测试通过。其中 `rebalanceProvider` 的**唯一一处语句重排**（`initialAssignmentIndex` 把 `original`/`assignment` 两张 map 由「随放置循环逐条写入」改为「循环前一次性预填」）已独立复核：放置循环对这两张 map 只写不读，容量/均衡两段在放置循环结束后才首次读取，故最终内容与读取时点一致；`balanceNodeLoads` 的 `moveLimit = capacityMoveLimit - moves` 与原共享计数器 `moves < capacityMoveLimit` 算术等价（容量段最多消耗到 `capacityMoveLimit`，差值非负）。
- **接近 REV-1 上限的文件（观察项）**：`application/egress/operations.go` 581 → 599 行，未越 600 但已贴近；后续在该文件继续拆分前须先做同包文件级搬运。
- **回滚**：`git revert <本提交>`。本次为纯结构拆分，无数据、协议、配置或依赖迁移。

## 18. 2026-10-11（续二）结构/契约机器门禁 + REV-3 全量清零 + 独立对抗审查（BE-16）

### 18.1 新增门禁：把「人工逐轮核对」变成一条命令

| 交付物 | 作用 | 口径 / 契约 |
| --- | --- | --- |
| `backend/tools/structurecheck` | REV-1 / REV-2 / REV-3 机器门禁，基线棘轮 | `--list` 输出 `kind<TAB>路径:行<TAB>函数名<TAB>度量` 的机器可读工作清单；`--update` 收缩基线；无新增/恶化 exit 0、有则 exit 1、基线缺失 exit 2 |
| `backend/structure-baseline.json` | 冻结存量（当前 `files`/`functions`/`nesting` 均为空） | 棘轮语义与前端 `structure-baseline.json` 一致 |
| `backend/tools/apicheck` + `backend/api-baseline.txt` | 导出 API 面契约门禁 | 导出名 + 归一化签名/类型定义/常量取值逐条比对；新增、删除、签名变化均失败 |
| `backend/scripts/verify.sh` + `backend/scripts/README.md` | 后端单一验收入口 | `go build` → `go vet` → `structurecheck` → `apicheck` → `go test -count=1`，失败即停并透传退出码，逐步计时 |
| `.github/workflows/ghcr-image.yml` | CI 接入 | `Verify` job 新增 `Verify backend structure and API contract`（`Vet backend` 之后、`Verify Swagger document` 之前），job 步骤 17 → 18 |
| `frontend/scripts/check-structure.mjs` | 前端补 REV-3 | 嵌套 > 3 层失败；`else if` 与 `if` 同层；`case` 体不加层 |

**嵌套口径（前后端统一）**：计入 `if`（含 `else` 分支，但 **`else if` 与 `if` 同层**）/ `for` / `range` / `switch` / type switch / `select`；`case` / `comm` 子句体不额外加层；函数字面量是独立作用域（Go 侧按 `<closure>` 上报，前端侧归属最近外层具名作用域）。`else { if ... }` 比 `else if` 多一层，属有意保留的不对称口径（已在两侧工具头部写明）。

**`apicheck` 的一处工具误报修正（重要）**：初版把「大写方法名」一律当作公共契约，于是 `compatibleSSEEvent` / `nestingVisitor` 这类**未导出类型**上为实现接口而写的大写方法（`Data()`、`Visit()` 等）也被纳入基线。包外无法命名这些类型，因此它们不是契约。修正为「仅导出类型上的导出方法计入」后，基线由 **2228 收缩为 2062**；经逐条核对，被移除的 **166 条全部是未导出接收者上的方法，0 条导出 API 丢失**。

### 18.2 REV-3 全量清零，以及**对上一轮记录的更正**

- **更正**：§17 与提交 `79e280c0` 声称「REV-3 嵌套越限 6 处全部清零」。该数字来自一个临时工具，其 `if` 分支深度公式被写成 `max(1, child)` 而非 `1 + child`，**系统性少报**（实测对同一棵树，修正后工具与 `structurecheck` 分别报 59 / 61）。该临时工具已废弃，结论以仓库内 `structurecheck` 为准。
- **真实基线**（同一棵树、两种 else-if 口径）：`else if` 计入层 = **59–61**；`else if` 与 `if` 同层（与前端一致，最终采用）= **41**，另加 **2** 处 `<closure>`。
- **处理**：41 处按包切分为 7 组（account 9 / gateway 8 / conversation 8 / cli+console 5 / web+provider 4 / egress+runtime+config 4 / transport 3）由子代理并行清零；2 处 `<closure>`（`application/gateway/video_tasks.go`、`infra/persistence/relational/account_links.go`）由主代理清零。改动全部是「守卫反转 / 提前返回」或「同包未导出辅助函数抽取」。
- **结果**：`go run ./tools/structurecheck` 报 **超限文件 0 / 超限函数 0 / 越限嵌套 0**，基线已收缩为空——此后任何新增越限即判定失败。

### 18.3 独立对抗审查：覆盖与发现的 2 处真实偏差

对上一轮 163 个函数的拆分按批次派发 **9 次只读对抗审查**（gateway `createResponseAt`；cli adapter + config `Validate`；relational 33 方法；account + accountsync + audit + dashboard + media；conversation + console；egress(infra+app) + transport；settings + config + domain/audit + pkg + app + ports + runtime + provider；cli `responses_*`；clientkey）。**确认缺陷 2 处，均已修复并补回归测试**：

1. `application/gateway/service_request_failure.go` 的 `markRetryableAccountState`：`PermanentAccountDenial` 分支被误写成 `return markDeniedAccountAccess(...) || failureHandled`，而原实现是**覆盖**（丢弃额度链结果）。触发条件：Build 403 同时带额度信号、且 `selector.MarkModelAccessDenied` 写库失败时，账号的持久失败标记 `MarkFailure` 会被跳过。修复：去掉 `|| failureHandled`。既有测试集对此**无判别力**（该函数此前无任何直接用例）。
2. `application/clientkey/service_authentication.go` 的 `acquireAuthQuota`：提前返回条件被写成 `MaxConcurrent == 0`，使负值会调用 `Acquire`；原实现只在**正数**时申请租约。当前不可达（应用层与 DB CHECK 均限制 `>= 0`，且两个 limiter 实现把 `limit <= 0` 视为无限），但需触发条件才能自证安全。修复：改为 `<= 0`。

- **另登记 2 处「已核查且等价、但耦合了未声明契约」**（非缺陷）：`relational/client_key_repository.go` 在「事务回调成功但 `Commit()` 失败」这条极窄路径上返回的 `cleaned` 少了当前 key 的行数（只影响一个 perfmetrics 标签，新值反而更准确）；`infra/egress/health.go` 用 `value.ID` 代替入参 `nodeID` 构造 clearance key 与客户端版本（依赖 `GetEgressNode` 返回同 ID 这一未显式声明的契约）。
- **测试覆盖缺口（如实登记，拆分前后一致）**：`application/egress` 的 `rebalanceProvider` / `RunMaintenance` / `TestNodes` / `UpdateManyEnabled` / `applySourceInput`、relational 33 个仓储方法、`console/voice.go`（TTS/STT）、`clientkey` 的 `CanUseModel` 等，在拆分**之前**就没有直接单测。本轮补了 2 处最关键的：`markRetryableAccountState`（8 个子用例，含专门锁定上述缺陷的用例，已用 overlay 变体验证判别力）与 console STT multipart 字段顺序 + TTS JSON 分支（7 个用例，同样以 overlay 变体证明「把 `filler_words` 提前」会失败）。
- **未覆盖**：PostgreSQL / Redis 专属路径本机未执行（缺环境变量）；`go test -race ./...` 本机 **Blocked**（`-race requires cgo`，无 C 编译器），由 Linux CI 覆盖。

### 18.4 缩短单次改造耗时的做法（本轮落实）

1. **机器可读工作清单**：`structurecheck --list` 按严重度输出 `kind<TAB>路径:行<TAB>函数名<TAB>度量`，按包分组即可**机械切分为互不重叠的子任务**——本轮 41 处越限就是这样切成 7 组派发的，无需人工读代码分工。
2. **基线棘轮**：存量冻结、只许持平或下降；子代理只要不新增越限，就无需人工复核「有没有变坏」。
3. **一条命令验收**：`bash backend/scripts/verify.sh` 串起 5 步；迭代期只跑受影响包（`go test ./internal/<pkg>/` 可命中构建缓存），仅最终验收用 `-count=1`。
4. **固定派发模板**：每个子任务固定给出「负责范围 + 口径 + 硬约束 + 自检命令（含工具绝对路径与期望输出）+ 报告格式」，子代理可**自证完成**，主代理不必复算。
5. **对抗审查与写入型任务并行**：审查只读、不阻塞；本轮 2 处「看似等价实则不等价」的改写正是由审查发现（测试集均无判别力），而修复只需 1–2 行。

### 18.5 验证（本机实测）

| 检查 | 结果 |
| --- | --- |
| `go build ./...` / `go vet ./...` | exit 0 |
| `go run ./tools/structurecheck` | 文件 0 / 函数 0 / 嵌套 0，基线同为 0，exit 0 |
| `go run ./tools/apicheck` | 基线条目 2062，当前 2062，逐条一致，exit 0 |
| `bash backend/scripts/verify.sh` | 子代理实测 exit 0，总耗时 165.9s；另以注入故障证明「失败即停 + 退出码透传」（exit 127，步骤 2–5 未执行）、以错误工作目录证明守卫分支（exit 2）。**主代理本机 PATH 无 `bash`，无法复跑该脚本**；其 5 个步骤已由主代理逐条独立执行并全部 exit 0 |
| `cd frontend && pnpm verify` | exit 0；覆盖率 98.00 / 94.30 / 98.28 / 98.68，低于 76% 的文件 0 个；`check:structure` 0/0/0；`test:gates` 15 用例（含 10 个必须失败）全过；体积预算全部在阈值内 |
| 新增回归测试 | `TestMarkRetryableAccountStateCoversEverySignalBranch`（8 子用例）、console STT/TTS 7 用例，全过 |

- **未完成/未验证**：`verify.sh` 的 Linux CI 行为、CI 新步骤的远端执行结果本轮未取得（需推送后由 CI 产生 run id 后登记）；`shellcheck` 本机未安装，脚本未做静态检查。
- **回滚**：门禁与清零是独立提交，可分别 `git revert`；无数据、协议、配置或依赖迁移。

## 19. 2026-10-11（续三）规范重写与结构门禁自证补强（BE-17）

### 19.1 背景与产出

维护线负责人要求对当前项目下的**全部会话**做重复错误取证，并以「通用规则 + 可验证判定」重写根 `AGENTS.md`。取证范围与重复错误分类见 `frontend/AUDIT.md` §18.1 / §18.2（8 个会话、18 类跨会话重复错误）。

重写后 `AGENTS.md` 的 §1–§8 编号与语义**保持稳定**，因此本仓库内引用 `AGENTS.md §N` 的位置无需改动，其中后端侧为：

| 位置 | 引用 | 是否仍成立 |
| --- | --- | --- |
| `backend/scripts/verify.sh:3` | 「对应 AGENTS.md §7 的 backend 部分」 | 成立（§7 验证入口仍在，且已修正 cwd 说明） |
| `backend/scripts/README.md:6` | 「§7 验证入口的 backend 部分，是 §TEST-6 与 REV-1/2/3 的可执行入口」 | 成立 |
| `backend/tools/structurecheck/main.go:1,43,56,62` | REV-1 / REV-2 / REV-3 与 §5 | 成立 |
| `backend/structure-baseline.json:2` 的 `note` | 「存量债务冻结基线（AGENTS.md §5）」 | 成立（§5 仍为「债务与基线（棘轮）」，语义未变） |
| `backend/AUDIT.md` §5（原记行号 `:161`，已漂移） | 「`AGENTS.md` §6 定义的 P2/P3」 | 成立 |
| `backend/AUDIT.md` §14、§15（原记行号 `:503,517`，已漂移） | 「按 `AGENTS.md` §8 流程执行」 | 成立 |
| `.github/workflows/ghcr-image.yml:70,77,117` | §8 版本载体、REV-1/2/3 | 成立 |

### 19.2 与后端相关的文档失真更正

| 编号 | 条目 | 原值 | 新值 | 复现命令 |
| --- | --- | --- | --- | --- |
| C-37 | 导出 API 面条数（`AGENTS.md` §5 两处、`frontend/AUDIT.md`） | 2228 | **2062** | `cd backend && go run ./tools/apicheck` → 「基线条目 2062 条，当前 2062 条。导出 API 面与基线逐条一致。」 |
| C-38 | 「后端不在结构门禁扫描范围（REV-1 仅约束前端）」 | 未纳入 | **已纳入**：`backend/tools/structurecheck` 同口径强制 REV-1/REV-2/REV-3 | `cd backend && go run ./tools/structurecheck` → 「扫描生产 Go 文件：478 个」 |
| C-39 | 「函数级 REV-2 仍为 7 项」「剩余 >600 行生产文件 12 个」 | 7 / 12 | **0 / 0** | 同上 → 超限文件 0 / 超限函数 0 / 越限嵌套 0 |
| C-40 | `AGENTS.md` §7 的 `bash backend/scripts/verify.sh` | 从仓库根执行 | **exit 2**（`scripts/verify.sh:17-18` 校验 cwd） | 静态读取脚本守卫；§7 已改为 `cd backend && bash scripts/verify.sh` |

> C-38/C-39 与 §16.4（`AGENTS.md` §5；原按行号引用 `AGENTS.md` 第 591 行，已越界，按 DOC-4 改为章节引用）的表述冲突，属**同一文档内自相矛盾**：§16.4 是 2026-10-11 当时的快照（按 §12 的 DOC-2 保留原值），但 `AGENTS.md` 的规则文本未随 §17/§18 同步。本轮随 §5 迁移一并更正，指向 §17 与 §18。

### 19.3 `structurecheck` 新增「参与判定的作用域」计数（EVID-3）

重写后的 §4 REV-3 要求「0 越限必须附带参与判定的作用域总数」——此前两个结构门禁都不输出该数字，该规则不可验证（正是 `AGENTS.md` 初稿被审计点名的「门禁写在规范里但机器从未强制」形态）。本轮后端侧补齐：

| 位置 | 改动 |
| --- | --- |
| `backend/tools/structurecheck/main.go` 的 `scanner` | 新增字段 `scopeCount int` |
| 同文件的 `checkFunc` | 每次调用 `s.scopeCount++`（口径：施加 REV-2/REV-3 的函数体数，含每个函数字面量 `<closure>`） |
| 同文件的 `reportCounts` | 新增输出 `参与判定的作用域（REV-3）：N 个（0 越限时据此判断不是漏报）` |
| `backend/tools/structurecheck/main_test.go` | 新增 `TestCheckReportsScopeCount`：夹具 = 2 个具名函数 + 1 个函数字面量，断言输出 `参与判定的作用域（REV-3）：3 个`。该输出行此前没有任何断言，属「规则写进规范、机器未强制」的残留形态，本轮补齐 EVID-3 要求的正样本 |

前端对应改动（`check-structure.mjs` 输出同名字段、`self-test-gates.mjs` 增加正/负样本断言）见 `frontend/AUDIT.md` §18.4。

**判别力证据（§3 TEST-7）**：以 Go `-overlay` 把 `reportCounts` 里的 `scanned.scopeCount` 替换为 `scanned.scopeCount+1` 注入错误变体，`go test -overlay=<变体> -run TestCheckReportsScopeCount ./tools/structurecheck/` → **FAIL（exit 1）**；移除 overlay 后同一命令 → **PASS（exit 0）**。夹具源码与 overlay JSON 只存在于会话 scratch，不入库（§11 CHG-11）。

### 19.4 后端侧的跨会话重复错误（与本目录直接相关）

| 类别 | 取证 | 落点 |
| --- | --- | --- |
| 用一次性临时 AST 工具得出全局结论 | 临时嵌套深度工具 `if` 分支深度写成 `max(1, child)`（应为 `1 + child`），系统性少报，得出 REV-3「6 处」并据此派发 10 个子代理；真值为 41（else-if 同层口径）/ 59–61（else-if 计层） | `AGENTS.md` §10 EVID-4 |
| 门禁自身漏报被当作已达标 | `structurecheck` 初版 nesting 漏报；`apicheck` 初版把未导出接收者上的大写方法计入契约（2228 → 2062） | §10 EVID-3 |
| 「重写」与「搬运」混在同一提交、同一声明下 | 子代理自述 3 个函数「不是纯搬运而是重写」，而 AUDIT 记的是「语句顺序/标识符逐字不变」 | §11 CHG-2 |
| 机械拆分引入真实行为偏差，门禁零发现 | 5 处（含 `markRetryableAccountState` 的 `\|\|` 合并、`acquireAuthQuota` 的 `== 0`、`voice.go` multipart 字段顺序），全部由人工对抗审查或既有测试发现 | §11 CHG-3、§3 TEST-7 |
| 在并行子代理仍改代码时收缩基线 | `--update` 在 9 个并行子代理中途执行（nesting 59 → 2 的中途快照） | §11 CHG-5 |
| 判定用执行框架的 `exitCode` | 命令向 stderr 写内容即被标 ERR（`git commit` 标 ERR 但实际成功提交） | §10 EVID-5 |
| 根因只报第一层 | CI-01 先归因「pnpm 供应链策略」，后更正为「GHCR 容器包与仓库未链接」 | §11 CHG-7 |
| 从静态读取把 CI 项记为 `Passed` | 子代理提案把 BE-11 由 `Pending` 改 `Passed`（仅引 `ghcr-image.yml:20`），被主代理以「需要 run 级证据」拦下 | §10 EVID-1 / EVID-2 |

### 19.5 验证（本机实测）

| 检查 | 结果 |
| --- | --- |
| `gofmt -l tools/structurecheck/main.go` | 空输出 |
| `go vet ./tools/...` | exit 0 |
| `go test ./tools/... -count=1` | exit 0（`apicheck` 1.939s、`structurecheck` 2.213s） |
| `go run ./tools/structurecheck` | exit 0；478 个生产文件，超限文件 0 / 超限函数 0 / 越限嵌套 0，参与判定的作用域 **5472** |
| `go run ./tools/apicheck` | exit 0；基线条目 2062，当前 2062，逐条一致 |

- **未运行（如实登记）**：`bash scripts/verify.sh`（含全量 `go test ./...`）、`go test ./... -count=1`、`go build ./...`、`go test -race ./...` 未在本轮复跑（本轮改动为文档与 `structurecheck` 的一行输出，未触及业务代码）；`go test ./tools/...` 已覆盖被改工具本身。
- **回滚**：`git revert <本提交>`；无数据、协议、配置或依赖迁移。

## 20. 2026-10-11 验收审计、边界测试判别力与静态托管收口（BE-18）

本节记录 2026-10-11 验收审计轮（工作树 `E:\grok2api\.pi\worktrees\acceptance-audit-20261011`，分支 `maint/acceptance-audit-20261011`，基线 HEAD `12e03be94e774dc72148443098e9512561ef395c`）的后端结论。目的：扩展模块边界测试并冻结真实存量例外（BA-01）、给出 `ports/security` 迁移影响设计而不执行迁移（BA-02）、用变异注入取证边界测试的判别力（TEST-7），并收口审计发现的 `/.build-manifest.json` 静态托管缺陷。**只记录实际执行过的命令与原生退出码；未执行、未取到退出码的一律 `Pending`/`Blocked`（§10 EVID-1/EVID-2）。**

### 20.1 本轮后端改动范围

| 类别 | 文件 | 变更（`git diff --numstat`） | 说明 |
| --- | --- | --- | --- |
| 边界规则 | `backend/internal/ports/provider/import_boundary_test.go` | +126 / −40（212 行） | 4 条层规则、精确 (文件,包) 例外表、棘轮、语法/作用域夹具与假通过护栏 |
| 边界夹具 | `backend/internal/ports/provider/import_boundary_fixtures_test.go`（新增） | 272 行（未跟踪） | 对扫描器逻辑做不经文件系统的单元夹具 |
| 静态托管 | `backend/internal/transport/http/frontend.go` | +11 / −0 | 新增 `isHiddenArtifact()`（按已解析相对路径识别产物根点文件）并在 `frontendFile()` 命中分支中拒绝；见 20.7 |
| 回归测试 | `backend/internal/transport/http/server_test.go` | +6 / −0 | 夹具写入 dist 根 `.build-manifest.json`，表驱动新增 3 行（精确路径 + 大小写别名 + 反斜杠别名，均期望 404） |
| 容器构建 | `.dockerignore` | +3 / −0 | 白名单补 `frontend/vitest.config.ts`、`frontend/scripts/`、`frontend/scripts/build-inputs.ts` |

### 20.2 边界规则与冻结例外（BA-01）

规则数组 `layerBoundaries`（`import_boundary_test.go:59-78`），单条结构 `layerBoundary{name,directory,forbidden,includeTests,exceptions}`（:19-25）；匹配语义 `forbids`（:190-198）按包路径前缀判定（`imported == …/internal/<layer>` 或 `HasPrefix(imported, …/internal/<layer>+"/")`），例外按精确 (模块相对文件, 完整包路径) 对匹配（`collectForbiddenImports` :181-184）：

| 规则（name 原文） | directory | 禁入方向 | includeTests | 行号 |
| --- | --- | --- | --- | --- |
| `domain 不反向依赖上层或 infra` | domain | app / application / transport / infra | true | :60-63 |
| `repository 不反向依赖上层或 infra` | repository | app / application / transport / infra | true | :64-67 |
| `ports 不反向依赖上层或 infra` | ports | app / application / transport / infra | true | :68-71 |
| `application 生产依赖边界及 infra 存量` | application | app / transport / infra | false（`_test.go` 豁免，注释 :73-74） | :72-77 |

冻结例外 `applicationInfraExceptions`（:29-57）**27 个生产文件 / 29 对依赖**：`infra/security` 16、`infra/egress` 10、`infra/config` 3（分类统计来自 `classify.ps1`，2026-10-11）。独立核对（`verify_exceptions.ps1` + `go list -e -f '{{.ImportPath}}|{{.Imports}}' ./internal/application/...`，2026-10-11）：**declared 27/29 = actual 27/29，未登记 0 条、冗余 0 条**；`go list` 判定的 6 个命中包（account、adminauth、clientkey、egress、gateway、settings）与文件级结果一致。棘轮 `unusedImportExceptions`（:200-212）+ 断言（:106-108）：依赖消失后例外必须删除，否则 `必须删除已消失的依赖例外`。假通过护栏：`result.files == 0` 直接 `t.Fatal("未扫描到 Go 文件，不能判定边界通过")`（:97-99），并在 :96 输出参与判定的作用域计数。反向依赖实测：domain 30 文件（20 生产 / 10 测试）、repository 14（13/1）、ports 19（12/7），对上层与 infra 命中均为 **0**；application 187 个 `.go` 中 64 个 `_test.go` 被跳过、123 个生产文件参与判定。**口径与相互指针（§4.1 ↔ §5 BE-02 ↔ §20.2 ↔ §22.1 ↔ §31.4）**：本条按 **(文件, 完整包路径) 对**计（`applicationInfraExceptions`，`import_boundary_test.go:30-58`）；§4.1 的「29 处 / 27 个文件」按 **import 行**计，两套计量在本 tip 数值一致（27 / 29）但**判定语义不同**（人工/静态计数 vs 边界测试 AST 冻结表），各自以对应工具输出为准。§31.4 的「存量依赖总数 38」= application 29（本条）+ transport 1（`transportInfraExceptions` `:65-67`）+ infra 8（`infraApplicationExceptions` `:75-84`），**例外面未扩大**。复现：`cd backend && go test ./internal/ports/provider/ -count=1`（本条数字的权威来源；**本轮未执行**，EVID-1）与静态复核（`[System.IO.File]::ReadAllLines` + 正则 `internal/infra/(security|egress|config)"`，扫描 `internal/application` 的 123 个生产 `.go`，本轮实测 29 处 / 27 文件）；`go run ./tools/structurecheck` **不含**边界依赖计数（本 tip 实测其源码无边界/存量依赖字样），结构口径与边界口径是两条独立命令。

### 20.3 判别力取证（TEST-7）：`-overlay` 方法学与 B/C 组

对照（2026-10-11，`backend/`）：`go test ./internal/ports/provider/ -count=1` **exit 0**（`ok … 2.636s`）；`go test -v -run TestLayerImportBoundaries ./internal/ports/provider/ -count=1` **exit 0**，扫描范围非空自证：domain 30 文件/52 imports、repository 14/38、ports 19/69、application 123/960（豁免测试 64、存量依赖 29、违规 0）。

**A 组（任务指定的 `-overlay` 注入生产源）实测失败**：

| 变体 | 注入 | `go test -overlay <ov> ./internal/ports/provider/ -count=1` | 判定 |
| --- | --- | --- | --- |
| A1 | domain/account 副本加 `import _ ".../internal/app"` | exit 1 | Go 编译器先报 `import cycle not allowed`，边界断言未执行，**不是 TEST-7 正样本** |
| A2 | 新增 application 层 `overlay_probe.go`（`import _ infra/security`） | **exit 0** | **未检出（假绿）** |
| A3 | 新增 domain 包内违规文件（`import _ infra/security`，无环） | **exit 0** | **未检出（假绿）** |
| A4 | 新增 `internal/domain/overlay_probe` 包（`import _ app`） | **exit 0** | **未检出（假绿）** |

根因（精确到行）：`forbiddenImports`（`import_boundary_test.go:134-158`）在**测试运行期**用 `filepath.WalkDir` 读真实文件系统；`-overlay` 只替换 go 命令**构建期**的文件读取，测试二进制不看 overlay。**方法学结论：任何「用 `-overlay` 注入生产源来证明本套件判别力」的做法对运行期自扫文件系统的测试必然假绿；A2/A3/A4 的 exit 0 不能判定测试无判别力**（C 组证明落盘违规会被抓到）。有效取证路径只有两条：变异扫描器本身（B 组，被测逻辑就在 `_test.go` 内、无独立生产实现），或在模块副本中落盘违规（C 组）。

| B 组（变异扫描器 `import_boundary_test.go` 副本，工作树不动） | 变异（原→改） | exit | 失败规模与示例原文 |
| --- | --- | --- | --- |
| B1 | :193 `if imported == prefix \|\| strings.HasPrefix(imported, prefix+"/")` → `if imported == prefix`（丢子包匹配） | 1 | 53 个失败子用例；`import_boundary_fixtures_test.go:23: 扫描结果={...violations:[]}, 期望={...violations:[internal/domain/nested/fixture.go:3 -> .../internal/app/bootstrap]}` |
| B2 | :181 例外键 `boundary.exceptions[display]` → `[filepath.Base(display)]`（改为按文件名匹配） | 1 | 7 个失败；`ExceptionsAreExactFilePackagePairs/registered`：`扫描结果={...violations:[internal/application/account/service.go:3 -> .../infra/security] exceptions:[]}` |
| B3 | :144 去掉 `!boundary.includeTests` 条件（下层 `_test.go` 被误豁免） | 1 | 25 个失败；`domain/app_test.go`：`扫描结果={files:0..., skippedTests:1}, 期望={files:1, imports:1}` |
| B4 | :205 `!slices.Contains(...)` 取反（棘轮反向） | 1 | `ExceptionRatchet/keep_dependency` 失败 + 真实树测试触发 :107 `必须删除已消失的依赖例外` |
| B5 | :193 改为 `strings.HasPrefix(imported, prefix)`（丢包边界） | 1 | `SyntaxAndScope/...`：误报 `appsupport`、`infraextra/security`；真实树测试 `违规=12`（:96） |

| C 组（模块副本 `backend-boundary-overlay\C\backend` 落盘违规，工作树不动） | 注入 | exit | 原文 |
| --- | --- | --- | --- |
| C0 | 无（副本保真基线） | 0 | `ok … 3.428s` |
| C1 | `//go:build never_built_probe` + `import _ app`（编译器不可见、扫描可见） | 1 | `test.go:104: 违反分层边界:` / `internal/domain/account/zz_boundary_probe.go:5 -> .../internal/app` |
| C2 | application `service.go` 第 4 行插 `_ "infra/provider"`（该包不在本命令构建图内） | 1 | `internal/application/account/service.go:4 -> .../internal/infra/provider` |
| C3 | 删除 `service.go` 的 `infra/security` import（例外变陈旧） | 1 | `test.go:107: 必须删除已消失的依赖例外:`（存量 29→28、违规 0） |
| C4 | 新增下层 `_test.go`（`package account_test`，`import _ infra/security`，includeTests=true） | 1 | `internal/domain/account/zz_boundary_probe_test.go:3 -> .../internal/infra/security` |
| C5（负对照） | 新增 application `zz_boundary_probe_test.go`（`import _ infra/provider`，本应豁免） | **0** | `ok …` — 证明夹具不是一律失败，R5 豁免是刻意行为 |

判别力映射：R1←C1/C4（编译可见部分由编译器兜底，见 A1）、R2←C2、R3←B2、R4←C3/B4、R5←C4 正例 + C5 负例、R6/R7←B5 与 SyntaxAndScope 夹具。边界测试相对编译器的独有价值：build tag/其它 GOOS 排除文件、下层 `_test.go`、application 冻结清单与棘轮（C2/C3）——这些编译器永远看不到。

### 20.4 R8 FailFast 变异结论（追加轮，同一副本，工作树未动）

命令均为 `cd <copy>; go test ./internal/ports/provider/ -count=1`；原始输出见 scratch `backend-boundary-overlay\C\R8-*.txt`。

| 变异体 | 注入 | exit | 报错关键行 |
| --- | --- | --- | --- |
| base | 无 | 0 | `ok … 3.589s` |
| M-R8a-1 | 构建图内包新增语法错误（无 build tag） | 1 | **编译失败，断言未执行**：`[build failed]` / `syntax error: unexpected {` |
| M-R8a-2 | 同文件加 `//go:build never_built_r8`（编译不可见、扫描可见） | 1 | `import_boundary_test.go:94: 扫描 internal/domain 失败: …zz_r8_syntax.go:5:16: expected ')', found '{'` |
| M-R8a-3 | `internal/application` 新增语法错误文件（不在本命令构建图） | 1 | `import_boundary_test.go:94: 扫描 internal/application 失败: …` |
| M-R8b | 被扫描根目录缺失（`internal/repository` 改名） | 1 | `扫描 internal/repository 失败: … The system cannot find the file specified.` |
| M-R8c | 扫描根存在但 0 个 `.go`（全部改名） | 1 | `test.go:98: 未扫描到 Go 文件，不能判定边界通过` |
| base_after_restore | 全部还原 | 0 | `ok … 2.632s` |
| M-R8d（覆盖缺口探针） | 新增 `internal/zz_r8_newlayer/`（禁 import + 语法错误） | **0** | **未被任何 boundary 覆盖，两类问题都不被发现** |

R8 缺口登记（P2，未改代码）：**G-1** `layerBoundaries` 硬编码 domain/repository/ports/application 四个目录（:59-78），且无「所有 `internal/*` 目录都被某条 boundary 覆盖」的断言——新增 `internal/<new>/` 的禁 import 与语法错误均 exit 0（M-R8d）；R8c 的 0 文件守卫只对硬编码根生效。**G-2** 编译可见文件的语法错误由编译器先兜（M-R8a-1），R8 的正样本必须用 build tag 排除文件、其它 GOOS 文件或不在构建图内的包（M-R8a-2/a3）。

### 20.5 门禁覆盖缺口（BA-01 未收口部分）

边界测试只有 domain/repository/ports/application 四条规则，`internal/transport`、`internal/infra`、`internal/app` **无规则覆盖**，因此下列真实跨层边不判违规、也无豁免登记：

- `internal/transport/http/middleware/request.go:11` → `infra/security`，使用点 `:24 security.NewOpaqueToken(12)`。这是 transport→infra 直连（1 个生产文件），与「Transport → Application → Domain」约定冲突，**但没有任何规则会拦住它，也不在冻结例外表中**（P2 登记，未在本轮扩大改动）。
- `internal/infra/**` 生产文件 → `application`/`app`：0 条（干净）；`internal/infra/**` 测试文件 → `application` 存在（`infra/provider/web/security_test.go:9`、`infra/provider/cli/oauth_test.go:7`、`infra/persistence/relational/*_test.go`），属测试专用且规则未覆盖。
- `internal/app/assemble.go` 是唯一装配入口（`internal/app` 下 5 生产 + 3 测试文件），import infra 属预期，但无门禁约束其扩展。

### 20.6 BA-02：`security` 契约迁移影响清单（本轮只出设计，不执行）

`backend/api-baseline.txt` 的 `internal/infra/security` 条目 16 条（:1628-1643），其中随 `Cipher`/`TokenService` 迁移会改变 scope 前缀的 9 条：`:1631` `NewCipher`、`:1634` `NewTokenService`、`:1637` `(*Cipher).Decrypt`、`:1638` `(*Cipher).Encrypt`、`:1639` `(*TokenService).CreateAccessToken`、`:1640` `(*TokenService).ParseAccessToken`、`:1641` `AdminTokenIdentity`、`:1642` `Cipher`、`:1643` `TokenService`；留在原包的 7 条为密码/令牌原语（`FormatClientKey`、`HashPassword`、`HashToken`、`NewHexToken`、`NewOpaqueToken`、`SplitClientKey`、`VerifyPassword`）。

| 影响项 | 量化结论（`apicheck` 口径推导，非实测输出） |
| --- | --- |
| 基线条目 | 9 removed + 9 added = 18 条 diff，**总数 16→16 不变**；包名保持 `security` 且调用方不改别名时，19 条调用方契约条目（`:27`、`:162`、`:192`、`:200`、`:258`、`:281`、`:322`、`:393`、`:1055`、`:1101`、`:1127`、`:1361`、`:1402`、`:1425`、`:1434`、`:1461`、`:1488`、`:1497` 等）文本不变；引入别名或改包名则最多 19 removed + 19 added |
| 生产改动面 | 引用被迁移符号的生产文件 12 个（`Cipher` 11 + `TokenService` 2，去重 12，清单见 `BA-01-BA-02-boundary-evidence.md` §6.2）+ 迁移源 2 个（`infra/security/cipher.go`、`token.go`）+ 对应测试 2 个；引用面测试文件 39 个 |
| 例外表联动 | `account/service.go`、`clientkey/service.go` 的 `infra/security` 例外迁移后可整条删除（−2），其余 25 条仍需保留；`unusedImportExceptions`（:106-108）会强制删除过期例外；application→ports 不需登记例外 |
| 依赖边界 | `infra/security/token.go:12` 依赖 `github.com/golang-jwt/jwt/v5`；把 `TokenService` 移入 `ports/security` 会把该第三方依赖引入 ports 契约层（`Cipher` 只依赖 stdlib）——若要求 ports 零第三方，`TokenService` 应留 infra 或改为端口接口 |
| 生成物 | `backend/api-baseline.txt` 只能由 `go run ./tools/apicheck --update` 改写（§11 CHG-8）；本迁移属**有意公共契约平移**，需单独批准（§1/§8），**本轮不执行** |

### 20.7 本轮修复的真实缺陷：`/.build-manifest.json` 经 SPA 回退公开托管

背景：前端构建新增 `dist/.build-manifest.json`（输入/产物指纹，`frontend/scripts/build-inputs.ts:5`）。该文件无任何 HTTP 消费方（E2E 只读磁盘 `frontend/.artifacts/e2e/build-manifest.json`，`frontend/e2e/paths.ts:19`），但后端 SPA 回退会把静态目录内的它当公开文件返回。

**判别力证据（§3 TEST-7，先测试后实现）**：在 `server_test.go` 夹具写入 `dist/.build-manifest.json`（:107）并新增表行 `{path: "/.build-manifest.json", status: http.StatusNotFound}`（:122）后、实现前，`go test ./internal/transport/http/ -run TestFrontendStaticFilesAndSPAFallback -count=1` → **exit 1**，原文 `server_test.go:133: status = 200, want 404`（证明该路径此前确实被公开托管 200）。

**修复（最终实现）**：判定改为**按已解析的相对路径**识别「产物根目录下的点文件」——`frontend.go:26-30` 在 `frontendFile()` 命中后调用 `isHiddenArtifact(filePath)`（`frontend.go:94-99`：`path.Dir(path.Clean("/"+filepath.ToSlash(relative))) == "/" && strings.HasPrefix(base, ".")`）。早先的实现（在 `NoRoute` 早退条件里用 `path.Clean(requestPath) == "/.build-manifest.json"` 精确匹配请求路径）已被替换：它只看请求路径，而 `frontendFile` 用 `filepath.Join` 按 OS 语义解析，二者不一致 → Windows 上 `/.BUILD-MANIFEST.JSON`、`/x\..\.build-manifest.json` 这类别名会绕过判定并返回 200（生产 Linux 不受影响，但 E2E 跑在 Windows，断言不具代表性）。改为看解析结果后，别名与大小写差异都被同一处判定覆盖，且不误伤子目录（如 `.well-known/**` 不在根目录，不受影响）。
**回归测试**：`server_test.go` 表新增三行——`/.build-manifest.json`、`/.BUILD-MANIFEST.JSON`、`/x\..\.build-manifest.json`（均期望 404）；夹具在 dist 根写入真实 `.build-manifest.json`（:107）。**平台前提实测**：本机 NTFS 上 `Test-Path ".BUILD-MANIFEST.JSON"` 与 `Test-Path "x\..\.build-manifest.json"` 均为 `True`（两种别名确实解析到同一文件）→ 修复前这两行会 200。

**复测**：实现后 `go test ./internal/transport/http/ -count=1 -run TestFrontendStaticFilesAndSPAFallback -v` → **exit 0（8 个子测试全部 PASS）**；整包 `go test ./internal/transport/http/ -count=1` **exit 0**（3.3s）；`gofmt -l` 两文件 clean；随后 `bash scripts/verify.sh` 再一次 **exit 0**（20:46:10→20:48:24，含结构与 API 基线门禁）。**影响边界**：仅拒绝产物根目录下点文件的公开访问，不影响 `/assets/**` 静态资源、SPA 回退或构建/测试/预算链路（该文件不参与体积预算，`check-bundle-budget.mjs` 只统计 `assets/` 与 HTML 入口）。

### 20.8 后端复验（`bash scripts/verify.sh`，exit 0）

| 项 | 实测（2026-10-11 20:46:10→20:48:24，cwd=`backend`，`D:\softwares\Git\bin\bash.exe`） |
| --- | --- |
| 命令 / 退出码 | `bash scripts/verify.sh` → **exit 0**（133.4s，日志 `be-verify2.out.log` / `be-verify2.exit.txt`） |
| `go build ./...` / `go vet ./...` | 5.609s / 2.740s，均通过 |
| `go run ./tools/structurecheck` | 478 个生产文件；超限文件 0 / 超限函数 0 / 越限嵌套 0；**参与判定的作用域（REV-3）：5473 个**；「结构门禁通过」 |
| `go run ./tools/apicheck` | 基线条目 2062，当前 2062，逐条一致 |
| `go test ./... -count=1` | 66 包 `ok` / 0 `FAIL`（122.879s）；结尾「全部通过」 |

本机限制（如实登记）：`-race` 需 CGO 而本机 `CGO_ENABLED=0` 且无 C 编译器 → **Blocked**（由 Linux CI 的 Race job 覆盖）；PostgreSQL/Redis 集成用例依赖 `TEST_POSTGRES_*`/`TEST_REDIS_*` 隔离服务，本机 `go test` 未带 `-v`，**跳过数未在本轮日志体现 → Pending**（历史登记为 20 条；CI 的「集成用例 0 跳过」断言为唯一硬门禁）。

### 20.9 未达标/未覆盖项与 P2/P3 登记

| 编号 | 项 | 状态与恢复条件 |
| --- | --- | --- |
| BE-G1 | `internal/transport`、`internal/infra`、`internal/app` 无边界规则；`middleware/request.go:11` 的 transport→infra 直连未登记例外 | **已关闭（§29.1）**：transport 规则与例外在 `94caa642`（BE-21）落地；`infra` 规则与 8 条 `infra/egress` 存量例外本轮补齐；`app` 保持带理由的豁免（唯一装配入口） |
| BE-G2 | R8 新目录覆盖缺口（M-R8d exit 0） | **已关闭（§29.2）**：`TestInternalDirectoryCoverageBoundary` + 覆盖登记表在 `94caa642` 落地（M-R8d 已由 exit 0 变 exit 1）；本轮判定抽为纯函数 `directoryCoverageViolations` 并补自证夹具（含未覆盖目录负样本与变异注入证据） |
| BE-G3 | BA-02 `ports/security` 迁移未执行 | P2/需单独批准；执行时按 20.6 清单 + `apicheck --update` + §8 证据 |
| BE-B1 | `go test -race` 本机不可执行 | Blocked（`CGO_ENABLED=0`）；由 CI `Race backend` 覆盖 |
| BE-B2 | 本机无隔离 PostgreSQL/Redis；集成用例跳过数未取到 | Pending；`TEST_POSTGRES_DSN`/`TEST_REDIS_ADDRESS` 就绪后 `go test ./... -count=1 -v` 取 `--- SKIP` 计数，CI 断言 0 跳过 |

### 20.10 后端 benchmark 实测（2026-10-11 21:11–21:17，本轮补跑）

命令（公共形式，**逐包串行**、目录 `backend/`、环境 go1.26.1 windows/amd64、CGO_ENABLED=0、8 逻辑核、`GOMAXPROCS` 未设故 leaf 名带 `-8` 后缀）：

```
go test <pkg> -run '^$' -bench '<正则>' -benchmem -count=5
```

结果：**10/10 包退出码 0**（31 个 leaf × 5 次 = 155 样本，无 `SKIP`/`FAIL`/`panic`）；10 条命令墙钟合计 317.2s，包络约 7m31s。原始输出（含每条命令原文、CWD、START/END 与时区、`EXIT(<包>)=<码>`、每步 `AMBIENT` 采样）见 `scratch/benchmark-run.log`（25,672 B / 304 行，会话 69d18091）。

| leaf（去 `Benchmark` 前缀与 `-8`） | 中位 ns/op | B/op | allocs/op |
| --- | ---: | ---: | ---: |
| ServiceListPageAggregation | 9,217,142 | 1,608,867 | 19,643 |
| SelectorCandidatePlanning | 744,626 | 343,781 | 5,907 |
| SelectorMultiModelCandidateLoad/models_2 | 14,846,243 | 2,818,818 | 34,952 |
| SelectorMultiModelCandidateLoad/models_8 | 28,590,988 | 5,493,095 | 50,920 |
| SelectorSegmentedCandidatePlanning/3000/full | 2,846,571 | 478,708 | 5,924 |
| SelectorSegmentedCandidatePlanning/3000/active_segmented_64 | 1,967,493 | 79,330 | 160 |
| SelectorSegmentedCandidatePlanning/3000/active_segmented_64_full_fallback | 3,542,755 | 693,449 | 5,998 |
| SelectorSegmentedCandidatePlanning/10000/full | 8,166,107 | 1,787,257 | 19,952 |
| SelectorSegmentedCandidatePlanning/10000/active_segmented_64 | 6,243,079 | 236,916 | 162 |
| SelectorSegmentedCandidatePlanning/10000/active_segmented_64_full_fallback | 14,645,858 | 2,539,412 | 20,082 |
| AuditServiceSQLite/attempts-0 | 510,192 | 10,865 | 91 |
| AuditServiceSQLite/attempts-2 | 509,621 | 17,804 | 157 |
| DashboardUsageAggregate/legacy | 80,163,371 | 13,553 | 113 |
| DashboardUsageAggregate/performance | 100,696,825 | 22,236 | 130 |
| RoutingAccountBaseProjectionWithLargePayloads | 74,234,007 | 3,111,974 | 62,257 |
| SelectedCredentialHydration | 258,343 | 143,194 | 155 |
| ConsumeJSONObjects | 407,705 | 180,256 | 4 |
| ParseUpstreamFrame | 8,188 | 3,285 | 48 |
| NormalizeOpenAIInput | 174,768 | 56,085 | 680 |
| BuildOpenAIChatResult | 12,508 | 10,320 | 85 |
| ParseWeeklyCreditsResponse | 948.6 | 376 | 7 |
| InferWebTierFromQuota | 141.3 | 0 | 0 |
| ManagerAcquireCachedBuild | 1,808 | 1,633 | 12 |
| ConcurrencyLimiterCurrentMany | 266,013 | 219,442 | 32 |
| RegistryParallel | 391.7 | 0 | 0 |
| FirstTokenInspection/responses | 1,783 | 320 | 7 |
| FirstTokenInspection/responses_custom_tool | 1,475 | 336 | 7 |
| FirstTokenInspection/chat | 1,798 | 504 | 11 |
| FirstTokenInspection/anthropic | 1,863 | 408 | 10 |
| RequestBodyObservation/plain | 2,842 | 5,382 | 15 |
| RequestBodyObservation/observed | 4,496 | 5,453 | 16 |

口径与限制（不得越读）：

- 中位数为 5 次输出的排序第 3 位；本机无 `benchstat`，未做统计检验。
- 与 §3、§13.2、§16 历史值的差异**不是本轮前后对比**：历史条件未固定（§13.2 自述 `-count=3` 且未固定 CPU），且本轮测量期间有 5–6 个常驻 `node` 进程（对端门禁自测）、`Win32_Processor LoadPercentage` 采样 41% → 偏离 >10% 不可归因于代码变化；分配指纹多数逐字一致（routing projection 62,257 vs 历史 62,220–62,272；`provider/web` 6 个 leaf 的 B/op、allocs/op 与历史完全相同）说明 ns/op 差异主要来自负载与调度。
- `DashboardUsageAggregate` 的 legacy 子基准首个样本是预热离群点（B/op 17,501、allocs 137，其余 4 次 13,539–13,572 / 113），两子基准共享同一 DB 与页缓存，**禁止**把 legacy 与 performance 的差值当收益。
- 本轮未改动任何被基准覆盖的生产路径（diff 只有 `frontend.go` 静态托管排除与测试），故这些数字是**当前基线**，不是优化成果。
- 未覆盖：`-race`（本机 `CGO_ENABLED=0` 不可用，由 CI `Race backend` 覆盖）、隔离 PostgreSQL/Redis 用例（本机无服务，`relational.TestMain` 在无 DSN 时正常结束，集成用例被 `-run '^$'` 过滤，无 `--- SKIP` 行）。
- **后续更新（2026-10-12，见 §28）**：本节「本机无 `benchstat`，未做统计检验」已被取代——`benchstat` 已装并实际执行：§28.1 给出同代码 R1 vs R2 的空对照（45 个比较行中 12 行被判显著 = 26.7%，95% CI 半宽中位 ±36%），结论是**本机不具备 ns/op 判别力**，唯一稳定的是分配指纹；本节提到的 legacy 子基准「首样本预热离群点」也已定位为**基准缺陷**（`dashboard_repository_test.go` 缺 `b.ResetTimer()`，§28.2 已修）。本节数字保留为历史快照，引用时以 §28 为准。
### 20.11 回滚

- **后续更新（2026-10-12，见 §26.3）**：本行「`.dockerignore` 三行白名单回退不影响本机验证」在 `05c616bd` 之后已不成立——`.dockerignore` 现为 `!frontend/scripts/**` + 排除 `frontend/scripts/**/*.test.ts`（共 4 行），且 `!frontend/scripts/**` 是镜像构建**必需**（回退会让容器内 `pnpm build` 报 `TS2307` 失败）。回退方案以 §26.3 为准。
按类别独立回滚：边界测试与夹具回退 `import_boundary_test.go` 并删除 `import_boundary_fixtures_test.go`；静态托管收口回退 `frontend.go` +6/−1 与 `server_test.go` +4/−0（回退后 `/.build-manifest.json` 会重新 200 公开返回，不建议）；`.dockerignore` 三行白名单回退不影响本机验证（真实容器判定仍以 CI `check_ghcr_image` 为准）。本轮无数据、协议、配置（除 `.dockerignore`）或依赖迁移。

### 20.12 收口轮登记：分支、提交与 Swagger 复现（2026-10-11 22:15–22:50）

- **分支与提交**：本轮在 `maint/acceptance-audit-20261011-closeout`（基点 `12e03be9`）上分 7 个单目的提交完成；后端文件分别落在 `22605c8b`（边界测试 + 静态托管，4 文件）与 `0f973931`（本文档同步，4 文件）。详见 `frontend/AUDIT.md` §19.11（含完整提交表与分支纪律 CHG-12）。
- **更正（EVID-8）**：§20.9/§20.11 与 scratch 的 `plan-section6-completion-mapping.md` 曾记「全部改动未提交」→ **现已提交**；复现：`git log --oneline 12e03be9..HEAD` 与 `git status --porcelain`（应为空）。
- **Swagger 阻塞关闭（真实复现）**：`swag@v1.16.6` 按 Makefile 等价参数再生成到 scratch 的输出目录 `docs`，三份产物与 `backend/docs/**` **字节一致**（SHA256 见 `frontend/AUDIT.md` §19.11），`git diff --no-index --exit-code` = 0 且 `git hash-object` == `HEAD:backend/docs/*` ⇒ CI 的 `make swagger` 精确 diff 断言会 exit 0；`backend/docs/**` 未被写入（前后 SHA256 与 mtime 不变）。
- **仍未关闭（本机不可完成）**：`go test -race`（需 Linux/cgo 工具链）、隔离 PostgreSQL/Redis「0 跳过」（需服务）、镜像构建（本机无 docker 且 WSL 无发行版）——三者均由 CI 的 Verify job 覆盖，恢复命令见 §20.9。

### 20.13 收口轮阻塞取证：race、隔离 PG/Redis、CI 运行（2026-10-11 22:40–23:00）

| 阻塞项 | 本机实测（命令 + 退出码 + 原文） | 状态与恢复 |
| --- | --- | --- |
| `go test -race` | ① `$env:CGO_ENABLED=1; go test -race ./internal/app/ -count=1` → **exit 1**：`# runtime/cgo` / `cgo: C compiler "gcc" not found: exec: "gcc": executable file not found in %PATH%` / `FAIL … [build failed]`；② 默认 `go test -race ./internal/app/ -count=1` → **exit 2**：`go: -race requires cgo; enable cgo by setting CGO_ENABLED=1`；③ 全量 `CGO_ENABLED=1 go test -race ./... -count=1` → **exit 1**：68 个 FAIL 行、唯一 unique 错误即上述 gcc 缺失（`ok` 行 0） | **Blocked**（本机无任何 C 编译器）。工具链探测：`winget` 可用（v1.29.380，用户级）、无 choco/scoop、无 `C:\msys64`/`C:\mingw64`/LLVM、**WSL 子系统整体未安装**（`wsl -l -v` 与 `wsl --list --online` 均报「未安装适用于 Windows 的 Linux 子系统」→ 需 `wsl --install` + 重启，且 WSL 内需另装 Linux Go 工具链，会引入与 CI go1.26.1 的版本漂移）。恢复命令（用户级、无需管理员/重启）：`winget install --id BrechtSanders.WinLibs.POSIX.UCRT --accept-source-agreements --accept-package-agreements` → 新 shell → `cd backend; $env:CGO_ENABLED=1; go test -race ./... -count=1`；或由 CI 步骤 `.github/workflows/ghcr-image.yml:109-111` 覆盖 |
| 隔离 PostgreSQL/Redis「0 跳过」 | 三条命令（`TEST_POSTGRES_*`/`TEST_REDIS_*` 均为空）：`./internal/infra/persistence/relational -count=1 -v` → exit 0，**SKIP 17 / PASS 193 / FAIL 0**；`./internal/infra/runtime/redis -count=1 -v` → exit 0，**SKIP 2 / PASS 4**；`./internal/application/account -count=1 -v` → exit 0，**SKIP 1 / PASS 172** ⇒ 合计 **20 条 `--- SKIP`**，与 §20.9 登记 1:1；静态面：全后端仅 6 个 `TEST_*` 变量、20 个 `t.Skip` 站点、无 `b.Skip`/`testing.Short`、CI 与 `scripts/verify.sh` 均无 `-short` | **Blocked**（本机无 psql/pg_ctl/redis-server/redis-cli/docker，WSL 无发行版；无法监听 127.0.0.1:5432/6379）。0 跳过证据只能由 CI Verify job 的 services（`postgres:17-alpine` + `redis:7-alpine`）产出，断言原文见 `.github/workflows/ghcr-image.yml:86-107`；注意 **`Race backend` 步骤不含该 0-skip 断言** |
| CI 运行（覆盖 race、PG+Redis 0 跳过、镜像 check、前端 E2E 等） | `git push -u origin maint/acceptance-audit-20261011-closeout` → **exit 1**，原文：`! [remote rejected] … (refusing to allow an OAuth App to create or update workflow '.github/workflows/codeql.yml' without 'workflow' scope)`；`gh` CLI 不存在；凭据缺工作流作用域 | **Blocked**（缺凭据权限，非代码问题）。所需用户动作：提供具备 `workflow` 权限的推送凭据，随后推送该分支并开草稿 PR（`pull_request`→main 即触发 Verify + check_ghcr_image，不推送镜像）。推送前已按评审准则复核 `git remote -v`（origin=`JasmineTony/grok2api`，upstream 永不推送） |
 
**说明**：Swagger 精确 diff 已在本机闭环（§20.12），不再属于 CI-only 项；`check_ghcr_image` 的多架构构建仍只能由 CI 产出。

## 21. 2026-10-11（续四）门禁工具版本合并与 CI 证据闭环（BE-20）

本节与 `frontend/AUDIT.md` §20 同批。工作分支：**`maint/acceptance-audit-20261011-residual`（新分支）**，起点 `8a1bd20d`。

### 21.1 合入 main 线门禁修复，并用修复后工具复测

| 提交 | 来源 | 内容 |
| --- | --- | --- |
| `83ff5ae7` | `57510159` | `backend/tools/structurecheck`（包级函数字面量漏报、闭包基线键碰撞两处修复）与 `backend/tools/apicheck` 及其自证夹具；搬运，未改语义（CHG-2） |

**复测（本机实测，命令 + 退出码 + 输出）**：

```
cd backend && go run ./tools/structurecheck          # exit 0
扫描生产 Go 文件：478 个
超限文件（> 600 行）：当前 0 个，基线 0 个
超限函数（> 50 行）：当前 0 个，基线 0 个
越限嵌套（> 3 层）：当前 0 个，基线 0 个
参与判定的作用域（REV-3）：5475 个（0 越限时据此判断不是漏报）
结构门禁通过：未新增超限文件、超限函数或越限嵌套。
```

REV-3 作用域 **5472 → 5475**（原值出处更正：5472 记于 §19.5，§20.8 记的是 5473；均属旧工具口径）：工具修复了两处漏报通道后，参与判定的作用域计数上升；结论仍为 0 越限。

### 21.2 CI 证据闭环（更正 §20.13 的三项 Blocked）

RUN `38147560751`「GHCR Image」（`event=pull_request`，`head_sha=b59e5ff6`）`conclusion=success`；其 `Verify` job 与镜像 job 的相关 step：

| step / job | 结论 | 关闭的阻塞项 |
| --- | --- | --- |
| step `Test backend` | success | — |
| step `Assert required integration tests ran` | success | §20.13「隔离 PostgreSQL/Redis 0 跳过」 |
| step `Race backend` | success | §20.13「`go test -race`」 |
| step `Vet backend` | success | — |
| step `Verify Swagger document` | success | §20.12 的 CI 侧 |
| JOB `Build image (amd64)` / `Build image (arm64)` | success | §20.13「镜像构建」 |

**原值 → 新值**：§20.13 记三项为「Blocked（需 CI）」→ 现值为 **CI 侧已取得真实成功结论**；**本机侧仍不声称**（无 C 编译器、无隔离服务）。根因与复现命令见 `frontend/AUDIT.md` §20.2。

### 21.3 与 main 线章节的关系

main 线 `backend/AUDIT.md` §20（BE-18）、§21（BE-19）记录门禁工具修复本身的取证。本分支未逐字搬运（本分支 §20 是同号但内容不同的章节，逐字搬运会产生重复编号并破坏内部交叉引用）；完整原文见 main 线提交 `57510159`。本节的复测结论表明：**在修复后的工具口径下，本分支的后端成果仍为 0 越限**。

### 21.4 仍未闭环项（后端相关）

| 项 | 状态 | 说明 |
| --- | --- | --- |
| BE-G3 `ports/security` 迁移 | 需单独批准 | 架构迁移，本轮未执行 |
| BE-B4 benchmark 统计检验 | **已关闭（§28.1）** | `benchstat` 已装并实际执行统计检验；结论是「本机不具备 ns/op 判别力」，见 §28.1 |
| Linux `-race` 与隔离 PG/Redis 的**本机**证据 | 不适用 | CI 侧已闭环（§21.2），本机不再声称 |
| 交付分支推送与合并 `main` | **Blocked（需授权 + 凭据能力）** | 见 `frontend/AUDIT.md` §20.5 |

## 22. 2026-10-11（续五）模块边界规则扩展至 transport→infra 与 internal 目录覆盖守卫（BE-21）

提交 `94caa642`（`test(backend)`，+135/−0，仅测试文件，未改生产代码）。

### 22.1 规则与例外变化

| 维度 | 变化前 | 变化后 |
| --- | --- | --- |
| 边界规则数 | 4（domain / repository / ports / application） | **5**（新增「transport 生产文件不直连 infra」，`includeTests=false`：handler 测试用真实 infra 装配） |
| 冻结例外 | 27 文件 / 29 对（仅 application） | 27 / 29（未增删）+ **1 / 1**（transport：`internal/transport/http/middleware/request.go -> infra/security`，附理由与使用点） |
| internal 一级目录参与判定 | 4 个规则目录 | **11 个**（5 规则目录 + 6 处带理由的豁免：app、buildinfo、cli、infra、pkg、shared） |

`request.go` 的例外理由：`:11` 的 import 与 `:24` 的 `security.NewOpaqueToken(12)` 属「请求元数据原语」，是 transport 层最小必要依赖；例外按 (文件, 包) 精确匹配，只许持平或删除（棘轮语义）。

### 22.2 验证（本机实测，命令 + 退出码 + 关键输出）

```
cd backend && go test ./internal/ports/provider/ -count=1                       # exit 0
ok github.com/chenyme/grok2api/backend/internal/ports/provider  4.151s

cd backend && go test ./internal/ports/provider/ -run 'Boundar' -v -count=1     # exit 0
scope internal/transport: Go 文件=53, AST imports=462, 豁免测试文件=22, 存量依赖=1, 违规=0
保留存量: internal/transport/http/middleware/request.go -> .../internal/infra/security
参与判定的边界规则=5、Go 文件=239、存量依赖=30
internal 一级目录覆盖（BE-G2）：规则=5、豁免=6、参与判定=11

cd backend && go run ./tools/structurecheck                                      # exit 0
参与判定的作用域（REV-3）：5475 个（0 越限时据此判断不是漏报）
```

### 22.3 判别力取证（scratch 副本注入，工作树未被污染）

方法：整份复制 `backend/` 到 `%PI_SCRATCH_DIR%\be-g1-g2\backend`，在副本上运行同一命令。

| 步骤 | 注入 | 退出码 | 关键输出 |
| --- | --- | --- | --- |
| base | 无 | 0 | `ok … 3.829s` |
| P1 | 新增 `internal/transport/http/zz_boundary_probe.go`（`import _ infra/security`） | **1** | `违反分层边界:` … `zz_boundary_probe.go:3 -> .../internal/infra/security` |
| P2 | 新增一级目录 `internal/zz_probe_layer/probe.go` | **1** | `internal/zz_probe_layer 未被任何规则或覆盖登记覆盖：请扩展 layerBoundaries 或登记豁免理由` |
| P3 | 删除副本 `request.go:11` 的 infra import（使例外失效） | **1** | `存量依赖=0` + `必须删除已消失的依赖例外: …` |
| restore | 还原探针 | 0 | `ok … 4.031s` |

### 22.4 未覆盖与存量缺口（如实登记）

- BE-G1 在 `94caa642` 只收口 transport→infra 方向；当时 `infra` 的存量缺口（`infra/egress` 8 个生产文件依赖 `application/egress`）已在本轮按该计划冻结为 8 条精确例外，并加上 `infra 生产文件不反向依赖上层` 规则（§29.1）。
- `app`（唯一装配入口）保持无自动规则、仅豁免（评审准则）。
- 本包改动后未重跑 `go test ./...`、`bash scripts/verify.sh` 与 `-race`（改动仅 `_test.go`；相关包测试 + `vet` + `structurecheck` 已闭环）；CI 侧由探针分支覆盖（见 §21.2）。

## 23. 2026-10-11（续六）静态托管别名断言的平台语义显式化（BE-22）

提交 `0dc4ac5f`（`test(backend)`）：`internal/transport/http/server_test.go`，+39/−0，生产代码未改动。

**背景（独立复审发现 P3-2）**：`frontend.go` 的根级隐藏产物判定在**解析后的相对路径**上做（`:26-30` + `:99-101`），解析失败时由 `path.Ext(...) != ""` 兜底（`:40-42`）。原两条别名断言（`/.BUILD-MANIFEST.JSON`、`/x\..\.build-manifest.json`）在 NTFS 上走 `isHiddenArtifact`，在大小写敏感的 Linux 上走 `path.Ext` 兜底——**断言读起来像两平台都覆盖了别名归一化，实际覆盖的分支不同**，CI 抓不到 Windows 侧回归。

**改动**：

- 保留两条别名的 HTTP 404 断言（未删、未放宽）；
- 新增白盒分支断言：解析成功且被 `isHiddenArtifact` 命中 → 记录「由 isHiddenArtifact 拦截」；未解析 → 记录「404 依赖 path.Ext 兜底」；**解析成功却未被拦截 → 直接失败**；
- 新增平台无关的 `TestIsHiddenArtifactOnResolvedAliases`：直接断言 `isHiddenArtifact` 把 `".BUILD-MANIFEST.JSON"` 判为根级隐藏产物，而 `build-manifest.json`（非点前缀）、`assets/.build-manifest.json`（非根级）、`assets/app.js` 判为非隐藏——这是 Linux CI 上唯一能覆盖「别名相对路径仍被拦截」的回归点。

**验证（本机实测，命令 + 退出码 + 关键输出）**：

```
cd backend && go test ./internal/transport/http/ -run TestFrontendStaticFilesAndSPAFallback -v -count=1   # exit 0
  server_test.go:124: 别名 /.BUILD-MANIFEST.JSON 归一到 ".BUILD-MANIFEST.JSON"，404 由 isHiddenArtifact 拦截
  server_test.go:124: 别名 /x\..\.build-manifest.json 归一到 ".build-manifest.json"，404 由 isHiddenArtifact 拦截
cd backend && go vet ./internal/transport/http/          # exit 0
cd backend && go test ./internal/transport/http/ -count=1 # exit 0（整包）
cd backend && go run ./tools/structurecheck               # exit 0（REV-3 作用域 5475）
```

**判别力**：删除 `isHiddenArtifact` 调用 → Windows 上别名变为 200 提供文件，断言失败；删除 `path.Ext` 兜底 → 任一平台 `/assets/missing.js` 与别名变为 SPA 200，断言失败；把判定改为精确匹配 `build-manifest.json` → 新增单测在所有平台失败。

**未覆盖（如实登记）**：Linux 侧分支归属为**代码路径推断**（本机无 WSL 发行版、无 docker），由 CI 的 `go test ./...` 落地；分支归属在 HTTP 层不可观测（两条分支都是空 body + 404），故「未解析」分支只做覆盖透明度记录，不构成对 `path.Ext` 谓词的独立断言。

## 24. 2026-10-11（续七）CodeQL 5 条高危告警 triage（BE-23）：全部假阳性

PR #1（head `ci-probe/acceptance-audit-20261011`，`b59e5ff6`）上名为「CodeQL」的 check 报出 5 条高危告警（现象见 `frontend/AUDIT.md` §20.6）。本轮完成 triage。报告与探针在会话 scratch 的 `codeql-triage.md`，**工作树未被修改**。

**前提核对**：两个被点名文件在 PR head `b59e5ff6` 与工作树 HEAD 上**逐字节相同**（blob `2635a64a…`、`78501bc8…`），triage 结论直接适用于被分析版本。

### 24.1 4 × `Clear-text logging of sensitive information` → 假阳性

| 维度 | 事实 | 证据 |
| --- | --- | --- |
| 日志终点 | JSON handler → **stdout**（LevelInfo）；无文件 sink、不写 DB/审计表 | `internal/infra/observability/logger.go:10`（唯一构造者 `internal/cli/run.go:33`） |
| 记录字段 | `request_id`/`account_id`/`provider`/`status`/`upstream_code`/`account_scoped`/`account_blocked` | `service_request_failure.go:154,180,182,284` |
| 秘密字段 | `EncryptedAccessToken`/`EncryptedRefreshToken`/`EncryptedCloudflareCookie`/`OIDCClientID`/`Email`/`UserID` **一个都没记录** | 同上 |
| `credential.ID` | accounts 主键，已由管理 API（`internal/transport/http/account/handler_requests.go:119` 的 `json:"id,string"`）与审计表（`internal/domain/audit/audit.go:49-50`）明文暴露 | 同左 |
| 命中原因 | Go 的**变量名启发式**（`credential` 命中 credential/token/secret 正则），与字段是否为秘密无关 | 字段集合对照 |
| 变更性质 | 本 PR 只**搬运**：归一化后逐字等价于 `origin/main` 的 `gateway/service_request.go`；包级 `account_id` 计数 origin/main = 37、工作树 = 37 | `git diff` + 计数 |

### 24.2 1 × `Uncontrolled data used in path expression` → 假阳性（远程不可达）

- sink `os.Stat(fullPath)`（`internal/transport/http/frontend.go:80`）与 `origin/main` 的同函数体**逐字节相同**，且**第 80 行不在本 PR 的变更行集合内**（本 PR 在该文件只新增 `:27-30`、`:96-102`）；
- 防护链：`:71` `path.Clean("/" + requestPath)`（前导 `/` 吃掉前置 `..`）→ `:76-79` `filepath.Rel` + `..` 前缀拒绝 → `:36-37` 只把包含化后的相对路径交给 `http.FileServer`；
- **实测**（真实 `httpserver.New(deps)` 路由 + 真实 gin NoRoute，静态根外放 marker 文件）：18 条载荷（`/../`、`/../../`、`%2e%2e/`、`..%2f`、`..%5c`、`/x\..\`、`/assets/%2e%2e/%2e%2e/`、`//../`、绝对 `C:/…` 等）**全部 404 且 body 无 marker**；正对照 `/public-marker.txt` = 200 + marker（证明探针有判别力）；既有回归 `go test ./internal/transport/http/ -run "TestFrontendStaticFilesAndSPAFallback|TestIsHiddenArtifactOnResolvedAliases" -count=1` → exit 0；
- **残余向量（P3，部署期前提）**：产物根目录内指向外部的 **junction/symlink** 会被服务（`/link/linked.txt` → 200 返回根外内容）——因为 `os.Stat` 跟随重解析点，而 `filepath.Rel` 是纯字符串比较。非 HTTP 可达、本 PR 前后行为一致；建议仅补注释说明「不解析链接目标」。

### 24.3 处理决定（按 §6 分级）

| 项 | 级别 | 依据 |
| --- | --- | --- |
| CodeQL 5 条告警 | **P2（假阳性，已 triage，不阻塞、不扩张）** | 无秘密泄露、无不变量失效；P0 不成立；P1 的形式依据（check 为 `failure`）根因是假阳性 |
| junction/symlink 残余向量 | P3 | 需「产物目录内含外部链接」的部署期前提，且非 HTTP 可达 |
| 是否要求该 check 变绿 | **维护线口径决策（登记）** | 若要求必需 check 全绿，应在 CodeQL 侧落 allowlist/query-filter 并在此登记；**不得**为消警而改字段集合、删日志或重命名业务字段 |

**未验证**：① 未取到 CodeQL 原始分析 JSON（本机无 `gh`，code-scanning API 返回 401），「为何 path 告警被算成 new」的最小复现命令记录在 `codeql-triage.md` §5；② 未在 Linux 重跑探针（Windows 是别名风险最高的平台）。

## 25. 2026-10-11（续八）静态托管契约核对与缺口（BE-24）

方法：`go build` 真实二进制 + scratch 内隔离 config（`staticPath` 指向只读的 `frontend/dist`）在 `127.0.0.1` 探测；条件请求与暴露实验在 scratch 副本上做。工作树未改动。报告：会话 scratch 的 `stage3-8-static-serving.md`。

### 25.1 已核实成立（代码 + 实测）

| 契约 | 结论 | 证据 |
| --- | --- | --- |
| SPA 回退范围 | `NoRoute` 仅在 `frontendRoot` 成功时注册；非 GET/HEAD 与 `isBackendPath` 前缀（`/api`、`/v1`、`/swagger`、`/healthz`、`/readyz`）→ 404；有扩展名的缺失文件 → 404；其余 → `index.html` + `no-cache` | `frontend.go:14-47,87-95`；实测 `GET /api/admin/v1/does-not-exist`、`/v1/…`、`POST /dashboard`、`/assets/missing.js` 全部 `404 text/plain 18B`；`GET /dashboard` → 200 HTML 657 B |
| 穿越防护 | 原始 socket 载荷 `/../config.yaml`、`/%2e%2e/config.yaml`、`/assets/..%2f..%2fconfig.yaml` 全部 404 | 同左，另见 §24.2 的 18 载荷矩阵 |
| 哈希资源缓存 | `/assets/**` = `public, max-age=31536000, immutable`；其余（`index.html`、`runtime-config.js`、`favicon.ico`、`sponner/**`）= `no-cache` | `frontend.go:31-35`；实测响应头；`dist/assets` 76 文件 100% 匹配 `-<8+字符>.(js|css)` |
| 条件请求 | 内容未变 → 304；内容变更且 mtime 前进 → 200 新内容 | scratch 副本实测 |
| 内部产物 | 根级点文件（`.build-manifest.json`）不可达；镜像内二进制与 `VERSION` 与静态根分离 | `frontend.go:27-30,99-101`；`Dockerfile:65-67` |

### 25.2 未成文未测的三处风险（登记）

1. **无 ETag + 保留 mtime ⇒ 304 陈旧 HTML**：`index.html` 非 `no-store` 且无 `must-revalidate`，正确性依赖「部署会改变 mtime」这一外部假设；实测「内容变更但保留 mtime」返回 304。
2. **Go 侧零传输压缩**：`server.go:122` 中间件链无压缩、`assemble.go:574` 无 wrapper、`go.mod` 的压缩依赖均为 indirect；`dist` 内无 `.gz/.br/.zst`，仓库亦无补压缩的反代。同参数复现：首屏 5 文件 raw = 736,732 B（719.46 KiB）vs gzip9 = 215,744 B（210.69 KiB）⇒ **门禁口径 210.69 KiB vs 真实传输 719.46 KiB（≈3.4×）**。
3. **`staticPath` 指到父目录即公开 config/二进制/数据库**：代码只拒「产物根点文件」，无其他白名单；实测把静态根指向父目录后 `/config.yaml`、`/grok2api.exe`、`/data/backend.db` 全部 200（`/.build-manifest.json` 仍 404）。默认配置安全（`config_defaults.go:22` 为 `./frontend/dist`），风险来自误配置。

### 25.3 测试缺口（按可测性排序，仅建议）

① 穿越/编码别名（httptest + 哨兵文件，删守卫必失败）；② 缓存值精确断言 + `runtime-config.js`/`sponner`/`favicon.ico` 三行；③ 方法/前缀矩阵与 Content-Type 契约；④ 条件请求 304 语义（保留 mtime 场景写成特性化用例）；⑤ `frontendRoot` 失败矩阵；⑥ 静态根暴露边界（断言现行为 + 注释默认安全来自 Dockerfile）；⑦ 压缩：E2E 断言「带 `Accept-Encoding` 仍无 `Content-Encoding`、`content-length` = raw」，并在 AUDIT 登记「预算 = 磁盘 gzip、线上无传输压缩」。

**更正（EVID-8，独立复核 R20 F1/F5）**：① 的「删守卫必失败」是**预期**而非实测。实测修正——**原值**「删 `filepath.Rel` 守卫 ⇒ ① 的 HTTP 用例失败」→ **新值**「删守卫 ⇒ HTTP 层用例仍全绿，CI 无告警（覆盖洞，P2）」。根因：`path.Clean("/"+requestPath)` 已把根处的 `..` 消掉、`http.FileServer` 也把别名归一化回 root 内，故该守卫在 HTTP 层**不可观测**；其唯一触发形态（含 `filepath.Separator` 的别名路径）在 Linux 上不可达（`os.Stat` 先失败）。复现（本机 Windows，`backend/` 下）：把 `frontend.go:77` 改成只判 `err` 后 `go test ./internal/transport/http/ -run TestFrontendStaticExposureRejectsDirectoryTraversal -count=1` **仍 PASS**，同批 `TestFrontendFileRejectsResolvedPathsOutsideRoot` FAIL（该用例仅 Windows 有判别力）。收口：守卫已逐字等价抽出为纯谓词 `isRelativePathWithinRoot`（`frontend.go:92-94`，调用点 `frontend.go:77`），平台无关回归由 `TestIsRelativePathWithinRoot`（`server_test.go:193`）承担，判别力实测为「谓词体改恒 `true` ⇒ 该用例 FAIL」；残留口径边界：该单测覆盖谓词逻辑，删除**调用点**本身仍只由 `TestFrontendFileRejectsResolvedPathsOutsideRoot`（`frontend_exposure_test.go:213`）在 Windows 捕获（Linux 上不可达，同 §25.3 的既有别名口径）。

**更正（EVID-8）**：`backend/AUDIT.md` §20.7（原记行号 `:849`，已漂移）引用 `isHiddenArtifact` 为 `frontend.go:94-99` → 现文件实际为 **`:99-101`**；本轮前端改动在此文件净增 11 行（起点前移 5 行、该函数末尾前移 2 行），其中 sink `os.Stat` 由 `origin/main` 的 `:76` 变为 `:80`（+4）；`origin/main` 版本并无 `isHiddenArtifact`（该函数是本轮新增的前置拦截），故此处以实测行号为准、结论不变。

**未执行**：真实 Docker/Linux 镜像内探测（本机无 Docker）、反代/CDN 场景、浏览器对 `immutable` 的真实复用行为。

## 26. 2026-10-12 后端最终验收与容器构建修复（BE-25）

### 26.1 本机最终验收（`bash scripts/verify.sh`，exit 0）

执行方式：`powershell -NoProfile -ExecutionPolicy Bypass -File runner-be.ps1`（内部 `cd backend; bash scripts/verify.sh *> be-verify-r1.out.log`，退出码写 `be-verify-r1.exit.txt`）→ **`be-verify-r1.exit.txt` = `0`**，耗时 **242.35s**。关键输出：

```
==> go build ./...
==> go vet ./...
==> go run ./tools/structurecheck
扫描生产 Go 文件：478 个
超限文件（> 600 行）：当前 0 个，基线 0 个
超限函数（> 50 行）：当前 0 个，基线 0 个
越限嵌套（> 3 层）：当前 0 个，基线 0 个
参与判定的作用域（REV-3）：5475 个（0 越限时据此判断不是漏报）
结构门禁通过：未新增超限文件、超限函数或越限嵌套。
==> go run ./tools/apicheck
基线条目 2062 条，当前 2062 条。
导出 API 面与基线逐条一致。
==> go test ./... -count=1
（全部 ok，含 backend/tools/structurecheck、backend/tools/apicheck）
全部通过
```

### 26.2 CI 上的后端门禁（两轮）

| run | sha | 后端相关 step | 结论 |
| --- | --- | --- | --- |
| `38189282094` | `118a6ba0` | `Test backend`、`Assert required integration tests ran`、`Race backend`、`Vet backend`、`Verify Swagger document` | 全部 `success`——**Linux `go test -race` 与隔离 PostgreSQL/Redis「0 跳过」在 CI 上闭环**（本机无 cgo 工具链与隔离服务，仅能标记 Blocked） |
| `38191324186` | `a59e0d43` | 同上 | 全部 `success`（容器构建修复后的复跑，整轮 success） |

### 26.3 容器构建缺陷（P1，已修，只有 CI 能发现）

失败现象与原始日志见 `frontend/AUDIT.md` §22.3：`Dockerfile:20` 只 COPY `frontend/scripts/build-inputs.ts`，而 `f8145ff9` 抽出的 `scripts/build-manifest-plugin.ts` 被 `vite.config.ts` 直接 import → 容器内 `pnpm build` 报 `TS2307` 并退出 2。修复提交 `05c616bd`（`COPY frontend/scripts ./scripts`；`.dockerignore` 白名单改为 `!frontend/scripts/**` 并排除测试文件）→ CI R2 整轮 success。本机无 Docker，**该缺陷只能由 CI 的镜像构建覆盖**。

### 26.4 仍未闭环项（后端相关）

| 项 | 状态 | 说明 |
| --- | --- | --- |
| `Verify backend structure and API contract` 的 **CI 侧** | 未闭环（登记） | 该 step 只存在于维护线工作流；探针分支必须保留 `origin/main` 工作流定义（本机凭据缺工作流作用域），故不在 run 中。本机侧已闭环（§26.1） |
| BE-G3 `ports/security` 迁移 | 需单独批准 | 本轮未执行 |
| BE-B4 benchmark 统计检验 | **已关闭（§28.1）** | `benchstat` 已装并实际执行统计检验；结论是「本机不具备 ns/op 判别力」，见 §28.1 |
| 交付分支推送（含 `.github/workflows/**`） | Blocked（需凭据 scope） | 实测 `git push` exit 1；解除条件见 `frontend/AUDIT.md` §20.5 |

## 27. CodeQL 告警存量判定补充证据（BE-26）

**补充证据（2026-10-12，CI 双轮核对）**：仓库 `/code-scanning/alerts?state=open` 的 5 条告警 `created=2026-10-11`、`ref=refs/heads/main`（`go/clear-text-logging` × 4 → `service_request.go:635/637/647/789`；`go/path-injection` × 1 → `transport/http/frontend.go:76`）⇒ 属**存量**告警；名为「CodeQL」的 check-run 在 `b59e5ff6`、`118a6ba0`、`a59e0d43` 三个 sha 上均为 `failure` 且 annotations 完全相同；PR #1/#2 的 `mergeable_state=unstable`（非 `blocked`）⇒ 该 check 不是阻塞合并的必需检查。「同一批告警因重命名/指纹变化被计为 PR 新增」仍为**推断**（未取到 fingerprint 级证据）。

## 28. 2026-10-12 benchmark 统计检验与基准缺陷修复（BE-27）

### 28.1 benchstat 可得性与实际检验（关闭 BE-B4 的「工具未装」登记）

`go install golang.org/x/perf/cmd/benchstat@latest` → exit 0（网络可达；工具装在会话 scratch，未入工作树）。执行 `go test <pkg> -run '^$' -bench . -benchmem -count=10` 两轮（R1/R2），4 包 / 15 个可比 leaf，全部 exit 0。基准实际所在包与 §20.10 一致；注意 `./internal/application/egress/` **不含**基准，egress 基准在 `internal/infra/egress/manager_test.go`。

**结论：本机不具备判定 ns/op 变化的判别力（负面结论，如实登记）。** 同代码 R1 vs R2 的 45 个比较行中 **12 行被判显著（26.7%）**，α=0.05 名义期望仅 2.25 行；sec/op 的 95% CI 半宽（n=30）中位 **±36%**、最大 ±167%，**28/30 > ±10%**。测量窗口内 ambient 负载 2.34–6.14 CPU·s/s（8 核；来源为并发的 Playwright `chrome-headless-shell` 等），说明本轮**未能取得安静窗口**。

**唯一稳定的量是分配指纹**（三轮逐字一致）：`Seg/3000/as64` 160/160/160 allocs、`SelectedCredentialHydration` 155/155/155、`RoutingAccountBaseProjection` 62,257/62,255/62,254 等；§20.10 记录的「legacy 首样本预热离群点」也获独立复现。

### 28.2 发现并修复的基准缺陷（P2）

`BenchmarkDashboardUsageAggregate`（`internal/infra/persistence/relational/dashboard_repository_test.go:143-188`；`b.ResetTimer()` 插入于 `:169`，插入后函数末尾由 185 行顺延为 188 行）在建表并插入 50,000 行后**没有 `b.ResetTimer()`** ⇒ 负载下校准退化到 `b.N=1`，一次性初始化被摊进 ns/op（离群样本 1.02s–5.53s，benchstat 曾报 +1213.59%，p=0.000）。修复：在插入完成后加 `b.ResetTimer()`（并在注释里写明该陷阱）。

**修复验证（本机实测）**：

```
cd backend && gofmt -l internal/infra/persistence/relational/dashboard_repository_test.go   # 无输出，exit 0
cd backend && go vet ./internal/infra/persistence/relational/                                # exit 0
cd backend && go test ./internal/infra/persistence/relational/ -run '^$' \
    -bench BenchmarkDashboardUsageAggregate -benchtime=1x -benchmem                           # exit 0
BenchmarkDashboardUsageAggregate/legacy-8           1   129555100 ns/op   70376 B/op   449 allocs/op
BenchmarkDashboardUsageAggregate/performance-8      1   167337300 ns/op   23768 B/op   143 allocs/op
```

数字回到**百毫秒量级**（不再是秒级离群），说明修复直接消除了该异常来源；`-benchtime=1x` 下 n=1 仍不足以做分布结论，故**不声称**修复前后有性能差异。

### 28.3 仍未执行与不可声称

| 项 | 状态 | 说明 |
| --- | --- | --- |
| 跨 commit「旧 vs 新」A/B | 未执行 | 被基准覆盖的 Go 代码在测量窗口内**逐字节未变**（`git diff --name-only` 对 `backend/*.go`、`backend/internal/**`、`go.mod`、`go.sum` 为空），等价于空对照 |
| `-race` 下的基准 | 未执行 | 本机 `CGO_ENABLED=0`（无 C 编译器） |
| 隔离 PostgreSQL/Redis 上的基准 | 未执行 | 本机无隔离服务 |
| 其余 16 个 leaf | 未执行 | 超出本轮范围 |
| 「无性能回退」结论 | **不可声称** | 26.7% 假阳性率与 ±36% CI 中位宽度不支持该结论（与 §20.10 的自我声明一致） |

## 29. 2026-10-11（续四）门禁自证补强与结构门禁两处真实缺陷修复（BE-18）

> 合并来源：本文件 §29/§30 两章来自 `main` 线（提交 `57510159`、`13626e6c`），由 2026-10-12 的 `main` → `acceptance-audit-20261012-integration` 合并（merge commit）引入，原文只做**章节重编号**（main 的 `§20`→本节 `§29`、main 的 `§21`→`§30`）与随之的交叉引用改写，事实与数字按 §12 DOC-2 作为历史快照保留原值。
>
> 与交付线章节的关系：main 的 `§20(BE-18)`/`§21(BE-19)` 与本文件交付线的 `§20(BE-18)`…`§28(BE-27)` 撞号但内容不同（交付线为 `af14f6b6` 之后的维护线状态），故不重编号交付线既有章节，只在末尾追加；main 侧已过期的表述以交付线 `§26`/`§28` 与 `frontend/AUDIT.md` `§19`/`§23` 的当次结论为准（`Dockerfile:66` 实为 `:67`、`pnpm verify` 已为 13 步、REV-3 作用域数与覆盖率随修复变动），本节按 EVID-8 只作历史记录。
>
> 未并入本节但已由交付线覆盖的 main 侧内容：`83ff5ae7` 已把 `57510159` 的 `backend/tools/**` 7 个文件逐 blob 搬运（见 `frontend/AUDIT.md` §24.1）。

### 29.1 背景与取证方式

§18/§19 交付 `tools/structurecheck`、`tools/apicheck` 与 REV-3 的「参与判定的作用域」输出后，本轮以 **3 组独立只读对抗审查**对上一轮产物取证：① `AGENTS.md` 规则自洽（交叉引用、编号唯一性、BIND-3/BIND-4 与仓库实际命令比对、自相矛盾）；② 后端门禁工具与 CI 接线（口径边界、夹具、退出码、workflow 步骤）；③ 前后端 REV-3 口径交叉验证（7 组语义等价夹具，同一输入喂两套工具比对）。另加主代理的独立复现。

审查发现 **2 处结构门禁真实缺陷**（都会让「0 越限」变成假通过）、**1 处前后端口径差异**与 **6 处 `AGENTS.md` 规则失真**，已全部修复并补夹具与判别力证据。

### 29.2 缺陷 1：包级函数字面量是漏报通道（P1，已修）

| 项 | 内容 |
| --- | --- |
| 现象 | `checkDecls` 只遍历 `parsed.Decls` 里的 `*ast.FuncDecl`，`GenDecl` 初始化器里的 `*ast.FuncLit`（`var h = func(){…}`、`var hs = []func(){…}`、`var m = map[string]func(){…}`）既不参与 REV-2/REV-3，也不计入 `scopeCount` |
| 最小复现 | 夹具 = 包级闭包 + 体内 4 层嵌套；`cd backend && go run ./tools/structurecheck --root <夹具> --list` → 「扫描生产 Go 文件 1 个，当前越限 0 项」，exit 0；check 路径 → 「参与判定的作用域（REV-3）：0 个」 |
| 后果 | 直接违反 REV-3 与 §10 EVID-3 的「0 越限必须附带作用域总数以证明不是漏报」——该数字在这条路径上恰为 0，即判定为假通过 |
| 修复 | `main.go` 的 `checkDecls` 改为对整棵声明树 `ast.Inspect(decl, …)`；`FuncDecl` 与 `GenDecl` 两棵声明树互不包含，闭包仍只计一次（`testdata/deep_nesting.go` 的 `closureNesting` 仍只上报 1 项） |
| 夹具 | 负样本 `testdata/package_closure.go`（包级闭包体内 4 层）；正样本 `testdata/clean.go` 新增 `cleanPackageClosure`（3 层，证明不是无条件报错） |

### 29.3 缺陷 2：闭包基线键碰撞会掩盖恶化（P1，已修）

| 项 | 内容 |
| --- | --- |
| 现象 | 闭包统一用常量键 `<路径>#<closure>`，`currentBaseline` 用 `keepMax` 合并同文件全部闭包 → 同文件 A 闭包 6 层、B 闭包 4 层时，若 A 降到 4 而 B 升到 5，该键仍为 5 < 冻结的 6，被判「已整改」，**B 的恶化被掩盖** |
| 最小复现 | 夹具 v1（A=6 / B=4）→ `--update` 冻结 `probe.go#<closure>` = 6；夹具 v2（A=4 / B=5）→ check 输出「越限嵌套：当前 1 个，基线 2 个」「已整改 2 项」，**exit 0** |
| 修复 | 闭包键改为 `<相对路径>#<closure>@<函数体 { 行号>`（`main.go` 的 `key()`）；具名函数/方法/文件键不变；`keepMax` 仅作同名键兜底 |
| 修复后验证 | 同夹具 v2 → 「超限嵌套继续恶化：`two_closures.go#<closure>@<B 行>` = 5（基线 4）」，exit 1；主代理另以 `probe.go#<closure>@15 = 5（阈值 3）` 独立复现同一结论 |
| 键方案取舍 | 选**行号**而非「文件内闭包序号」：与 `--list` 的 `路径:行号` 定位口径一致、可直接回指源码；代价是闭包整体上下移动会让键变化（旧键报「已整改」、新键报「新增」并**失败**——方向是 fail-fast，不会静默通过）。两侧基线当前均为空对象，无冻结闭包键，抖动成本为零。残余局限：同一物理行内两个都越限的闭包仍共享一个键（越限闭包要求体 >50 行或嵌套 >3 层，实践中不可达） |

### 29.4 前后端 REV-3 口径差异（P2，已登记，非漏报）

7 组语义等价夹具交叉比对结论：**具名**作用域与 `case`/`comm`/`else if` 的口径两侧完全一致；函数字面量两侧都参与判定，但**深度基线不同**：

- 后端 `structurecheck`：函数字面量是独立作用域，从 0 起算深度，上报为 `<closure>`（键含定位）；
- 前端 `check-structure.mjs:193-201`：匿名内联回调不新建键（归属最近外层具名作用域），且**不重置深度**——回调体内嵌套累加到该具名作用域的当前深度。

实测（同一段代码：外层 1 层 + 匿名回调内 4 层）：后端报 `<closure> = 4`、前端报 `closureAtDepth = 5`。两侧都会判失败（**不是漏报**），差异只在数值。已按 §10 EVID-8 在 `AGENTS.md` 的 REV-3 口径段写明并标注 P2；**本项不改变任何一侧的行为**（改行为会动到前端 404 个文件的判定与基线语义，收益不足）。

### 29.5 门禁自证补强（§10 EVID-3）

| 工具 | 补强内容 |
| --- | --- |
| `structurecheck` | 新增 `TestCheckReportsScopeCount`（作用域总数断言）、`TestListDetectsPackageLevelClosure`、`TestCheckFailsOnPackageLevelClosureNesting`、`TestScopeCountIncludesPackageLevelClosures`、`TestScopeCountCountsPackageLevelLiteralForms`（var 组 / `[]func()` / `map[string]func()` 各计一次）、`TestClosureBaselineKeysDoNotMaskEachOther`；`--list` 钉死清单由 5 项改为 6 项；闭包键断言同步为含行号形式 |
| `apicheck` | `main()` 抽出可测入口 `run(args []string, stdout, stderr io.Writer) int`（退出码 0/1/2 与 stderr 文案逐条不变，纯重构）；新增 `testdata/fixture`（1 导出函数 + 1 导出类型 + 1 导出常量）与 6 个端到端用例（正样本、新增/删除/签名变化三个负样本、`--update` 写盘、基线缺失 exit 2）；`valueEntries` 补登记已知口径边界（iota 续行常量不渲染取值：实测 2062 条中 7 条无取值 = const 6 + var 1） |

**判别力证据（§3 TEST-7；全部用 Go `-overlay` 注入错误变体，变体脚本与 overlay JSON 只存在于会话 scratch，不入库）**

| 变体 | 结果 |
| --- | --- |
| structurecheck：恢复旧 `checkDecls`（跳过 `GenDecl`） | exit 1，8 个用例 FAIL，含「包级函数字面量未被 `--list` 检出」「含 4 层包级闭包的夹具应判失败，实际退出码 0」 |
| structurecheck：恢复旧 `key()`（常量闭包键） | exit 1，3 个用例 FAIL，含「越限嵌套：当前 1 个，基线 2 个」+「已整改：`two_closures.go#<closure>@18` / `@3`」（B 的恶化被掩盖） |
| apicheck：`reportDiff` 恒判一致 | exit 1，3 个负样本 FAIL |
| apicheck：基线缺失不报错 | exit 1，仅 `TestRunReportsMissingBaseline` FAIL |
| apicheck：`--update` 不写盘 | exit 1，`TestRunUpdateWritesBaselineFile` + 4 个依赖夹具基线的用例 FAIL |
| apicheck：删除检测失效 | exit 1，`TestRunDetectsRemovedExportInFixture`、`TestRunDetectsSignatureChangeInFixture` FAIL（新增用例仍通过 → 每个负样本各自命中自己的路径，不是同一断言重复） |

### 29.6 `AGENTS.md` 规则失真更正（§10 EVID-8）

| 编号 | 条目 | 原值 | 新值 | 复现命令 |
| --- | --- | --- | --- | --- |
| C-41 | `AGENTS.md` SEC-2 的 `uses:` 固定状态 | 「当前为 tag，登记为 P3」 | **已全部固定到 40 位 SHA**；新增/更新 action 必须继续固定 | `rg -n "uses:" .github/workflows` → 22 处全部形如 `owner/repo@<40 位 sha> # vX.Y.Z`（独立复核：SHA 22 处 / TAG 0 处） |
| C-42 | `AGENTS.md` REV-2 的「匿名内联回调不参与判定」 | 与实现相反 | 改为「只对**具名**函数/方法/具名回调按函数体行数判定」 | 读 `frontend/scripts/check-structure.mjs:193-201` |
| C-43 | `AGENTS.md` REV-3 的「统一口径」 | 未说明深度基线差异 | 补「后端独立从 0 计 / 前端累加到外层具名作用域当前深度」并标注 P2 | §29.4 夹具：后端 4 / 前端 5 |
| C-44 | `AGENTS.md` TEST-3 的 CI 硬门禁指针 | 误指 §7 | 指向 §8 与 `.github/workflows/ghcr-image.yml:86` 的 `Assert required integration tests ran` | 读该 workflow |
| C-45 | `AGENTS.md` 的 `§14.2` / `§14.4` | 编号形式不存在（§14 的子节是 `BIND-n`） | 改为 `BIND-2` / `BIND-4` | 全文检索 `§14\.\d` → 0 处 |
| C-46 | `AGENTS.md` REV-3 的当次实测作用域数（写在规则文件里） | `2524` / `5472` | 删除具体数字，改为「以工具输出为准 + 指向两个 AUDIT」（META-3：逐轮实测不写规范文件） | `go run ./tools/structurecheck` → 见 §29.7 |

其余同批修正（均在同一次改动内完成，未改任何编号）：BIND-4 新增 `TEST-3` 行并从 BIND-5 的枚举中移除、BIND-4 基线列补目录前缀、META-4 的 P 级绑定精确化为「SEC-1/SEC-3/SEC-4 = P0、SEC-2 = P1」并补 §8、META-4/META-5 与 §6 的重复定义按 DOC-1 去重、EVID-1 补 `Failed`/`Skipped`/`Blocked` 语义、§8 恢复「`ghcr.io` 容器包必须与 `origin` 仓库建立链接」的绑定事实（根因见 §11）、§5 补复现命令、BIND-5 补未列条目说明。

### 29.7 验证（本机实测）

| 检查 | 结果 |
| --- | --- |
| `go build ./...` / `go vet ./...` | exit 0 |
| `go run ./tools/structurecheck` | exit 0；478 个生产文件，超限文件 0 / 超限函数 0 / 越限嵌套 0，参与判定的作用域 **5474**（修复前 5472；两个 +1 已分别定位：本修复计入的真实包级闭包 `internal/transport/http/inference/voice_ws_handler.go:27`，以及 `apicheck` 抽出 `run()` 引入的函数） |
| `go run ./tools/apicheck` | exit 0；基线条目 2062，当前 2062，逐条一致（真实基线未被改动：`git diff --numstat -- backend/api-baseline.txt` 为空） |
| `go test ./tools/... -count=1` | exit 0（`apicheck` / `structurecheck` 均 ok） |
| `go test ./... -count=1` | exit 0；66 包 ok、0 FAIL、0 跳过（时点见下） |
| 前端 `pnpm verify` 12 步 | 逐条单独执行全部 exit 0；覆盖率 121 文件 / 1471 用例，98 / 94.3 / 98.28 / 98.68；`check:structure` 404 文件 / 2524 作用域 / 0 越限；`test:gates` 15 用例（含 10 个必须失败）；预算全部在阈值内 |

- **时点说明（EVID-5/EVID-6）**：`go test ./... -count=1` 与前端 `pnpm verify` 的**单命令**执行时点早于本轮修复（`pnpm verify` 的单命令形式还因并发写者改 `frontend/AUDIT.md` 在第 1 步 `format:check` 失败；12 步改为逐条单独执行后全绿）。修复收敛后由主代理重跑的单命令结果见同一次提交的 `frontend/AUDIT.md` 与本节后续更新。两侧基线 JSON 与 `backend/api-baseline.txt` 全程未被改动。
- **未验证/未执行**：`go test -race ./...`（本机无 C 编译器 → Blocked，由 Linux CI 覆盖）；`bash scripts/verify.sh`（本机 PATH 无 `bash`）；CI 远端执行结果需推送后登记。
- **回滚**：门禁修复与文档更正可分别 `git revert`；无数据、协议、配置或依赖迁移。

## 30. 2026-10-11（续五）修复收敛后的单命令全量门禁复测 + 一处 flaky 用例登记（BE-19）

§29.7 留出的「修复收敛后由主代理重跑的单命令结果」如下。所有命令均在 `E:\grok2api\backend`（或 `frontend/`）原样执行，退出码在命令后立即读取 `$LASTEXITCODE`。

### 30.1 复测结果（本机实测）

| 检查 | 结果 |
| --- | --- |
| `go build ./...` / `go vet ./...` | exit 0 |
| `go run ./tools/structurecheck` | exit 0；478 个生产文件，超限文件 0 / 超限函数 0 / 越限嵌套 0，参与判定的作用域 **5474** |
| `go run ./tools/apicheck` | exit 0；基线条目 2062，当前 2062，逐条一致 |
| `go test ./tools/... -count=1` | exit 0（`apicheck` 3.020s、`structurecheck` 3.182s） |
| `go test ./... -count=1` | **exit 1**；77 个包中 65 `ok` / 11 `[no test files]` / **1 `FAIL`**，唯一失败用例见 §30.2 |
| 前端 `pnpm verify`（单命令 12 步） | **exit 0**，逐步明细与数值见 `frontend/AUDIT.md` §26 |
| 四个基线/契约文件 | 未被改动（`git diff --numstat -- backend/api-baseline.txt backend/structure-baseline.json frontend/structure-baseline.json frontend/bundle-budget.json` 为空） |

### 30.2 flaky 用例登记（P2，既有缺陷，非本轮引入）

| 项 | 内容 |
| --- | --- |
| 用例 | `TestWebAccountScriptsRejectConcurrentWorkForTheSameAccount`（`internal/application/account/web_account_scripts_test.go:198`） |
| 现象 | 全量 `go test ./... -count=1` 下 FAIL：`web_account_scripts_test.go:201: context deadline exceeded`（5.71s），该包 170.541s |
| 隔离复现 | `go test ./internal/application/account -run '^TestWebAccountScriptsRejectConcurrentWorkForTheSameAccount$' -count=1` → **exit 0**（5.104s） |
| 根因 | 用例自身用 `context.WithTimeout(..., 3*time.Second)`（同文件 `:198`），而被测写路径进入 `db.WithContext(ctx).Transaction(...)`（`internal/infra/persistence/relational/account_repository_write.go:200`）；SQLite DSN 的 `_pragma=busy_timeout(5000)&_txlock=immediate`（`internal/infra/persistence/relational/database.go:49`）允许 5s 锁等待——满载（该包大量 `t.Parallel()` + 并发会话同时跑前端门禁）时 3s 调用方 deadline 先到期 |
| 归属 | **既有 flaky，与本次改动无关**：本次改动只涉及 `backend/tools/**` 与文档；该用例属 `internal/application/account` |
| 处置 | 按 §6 登记为 P2。按 TEST-4 **不得**以「扩大超时/无条件重试」掩盖；正确修法是让夹具的 deadline 大于 busy_timeout（或注入可控时钟）并给出判别力证据。本轮不做，避免夹带与范围外改动 |

### 30.3 与 §29.7 的口径对齐（EVID-6）

§29.7 记 `go test ./... -count=1` 为「66 包 ok、0 FAIL、0 跳过」，§30.1 记同一条命令为「65 ok + 1 FAIL」。两者**不矛盾**：有测试的包集合相同（66 个），差异只出现在 §30.2 那条对负载敏感的用例上——§29.7 的运行未与该用例争抢 CPU/锁，§30.1 的运行与另一会话的前端全量门禁并发。按 EVID-1，`go test ./...` 在本轮**只能记为 `Failed`（1 条 flaky 用例）**，不得记为 `Passed`；其「非本轮引入」的判定见 §30.2 的归属与隔离复现证据。

- **未验证/未执行**：`go test -race ./...`（本机无 C 编译器 → `Blocked`，由 Linux CI 覆盖）；`bash scripts/verify.sh`（本机 PATH 无 `bash`）；`pnpm test:e2e`；CI 远端执行结果需推送后登记。
- **回滚**：本轮无代码语义改动（门禁工具与其夹具、文档），可 `git revert`；无数据、协议、配置或依赖迁移。
## 31. 2026-10-12 关闭 BE-G1 / BE-G2（后端边界门禁补齐与自证）

### 31.1 BE-G1：`internal/infra` 分层规则 + 8 条存量例外

**缺口**：`94caa642`（BE-21）只落地 transport 规则与 `middleware/request.go` 例外；`internal/infra` 无任何规则（`internalDirectoryCoverageEntries` 的 `infra` 条目只是带理由的豁免）⇒ 新增 `infra` 生产文件直连 `application`/`app`/`transport` 不会被发现。

**改动**：

- 新增规则 `infra 生产文件不反向依赖上层`（`directory: "infra"`、`forbidden: {app, application, transport}`、`includeTests=false`：infra 的装配/集成测试用真实 application 类型）；允许 `infra → domain/ports/repository`（实现契约方向）。
- 新增 `infraApplicationExceptions`，冻结 8 个 `infra/egress` 生产文件 → `application/egress` 的存量依赖，命中行：`clearance.go:11`、`clearance_refresh.go:11`、`fallback.go:10`、`flaresolverr.go:16`、`lease.go:15`、`manager.go:12`、`node_select.go:13`、`probe.go:17`。例外按 (文件, 包) 精确匹配并受 `unusedImportExceptions` 棘轮约束：8 条全部命中（扫描输出 `存量依赖=8`），文件移除依赖时必须同步删除例外。
- `internalDirectoryCoverageEntries` 的 `infra` 由豁免登记改为规则（`规则=6、豁免=5、参与判定=11`）。
- 夹具：`TestImportBoundaryInfraRule`（5 个未登记方向必须报违规 + 5 条例外精确性用例）、`TestImportBoundaryInfraTestFilesExempt`（`_test.go` 豁免）。

**同类扫描范围（CHG-6）**：`internal/infra/**/*.go` 全量扫描（224 文件 / 1578 条 import），对 `app`、`application`、`transport` 三个禁止方向逐一检索，命中 **15 文件 / 16 处**：**8 处生产文件**（本轮冻结）+ **7 处 `_test.go`**（`includeTests=false` 已豁免：`provider/web/security_test.go`、`provider/cli/oauth_test.go`、`persistence/relational/{selector_segmented_integration,postgres_integration,egress_proxy_profile_repository,egress_operations}_test.go`、`egress/buildclient_test.go`）。**未处理项 0**。

**负样本（先证明旧实现通过、新实现失败）**：临时新增 `internal/infra/zz_be_g1_probe/probe.go`（`import _ …/internal/application/egress`）后运行 `go test ./internal/ports/provider/ -run TestLayerImportBoundaries -count=1`：改动前 `ok … 2.607s`（**exit 0**，漏判）；改动后 `--- FAIL: TestLayerImportBoundaries/infra_生产文件不反向依赖上层` + `internal/infra/zz_be_g1_probe/probe.go:3 -> …/internal/application/egress`（**exit 1**）；删除探针后恢复 `ok … 4.068s`（exit 0）。探针目录已删除，工作树无残留。

### 31.2 BE-G2：目录覆盖守卫抽纯函数 + 自证夹具

**缺口**：`94caa642` 已落地 `TestInternalDirectoryCoverageBoundary` + `internalDirectoryCoverageEntries`（M-R8d 由 exit 0 变 exit 1），但判定逻辑内联在测试函数里，**没有任何夹具**，无法证明「守卫失效时会失败」。

**改动**：判定抽为纯函数 `directoryCoverageViolations(present, ruled, entries) []string`（6 类违规消息逐字保留，输出排序以消除 map 迭代顺序的不确定性；`structurecheck` 判定函数与嵌套均未越限），测试函数只负责读取真实目录并断言；新增夹具 `TestDirectoryCoverageGuardFixtures`：**6 条负样本**（未登记新目录、登记规则但无对应 boundary、规则名不一致、登记既无规则也无理由、规则指向已消失目录、登记指向已消失目录）+ **2 条正样本**（豁免理由覆盖、规则对齐）。夹具注释内给出真实目录级负样本的可复现命令。

**负样本（两级）**：

1. 真实目录级：新增 `internal/zz_be_g2_probe/probe.go` 后 `go test ./internal/ports/provider/ -run TestInternalDirectoryCoverageBoundary -count=1` → `--- FAIL` + `internal/zz_be_g2_probe 未被任何规则或覆盖登记覆盖：请扩展 layerBoundaries 或登记豁免理由`（**exit 1**）；删除探针后 exit 0（探针已删除，工作树无残留）。
2. 变异注入（复现 M-R8d 漏判）：把纯函数的 `if !registered {` 改为 `if !registered && coverage.rule != "" {` 后 `go test ./internal/ports/provider/ -run 'TestDirectoryCoverageGuardFixtures|TestInternalDirectoryCoverageBoundary' -count=1` → `--- FAIL: TestDirectoryCoverageGuardFixtures/new_directory_without_rule_or_exemption` + `违规=[], 期望=["internal/zz_new 未被任何规则或覆盖登记覆盖…"]`（**exit 1**）；还原后 exit 0。**该夹具对守卫缺陷有判别力**。

### 31.3 本轮命令与退出码（cwd=`backend`，2026-10-12，Windows/go1.26.1，`CGO_ENABLED=0`）

| 命令 | 退出码 | 关键输出 |
| --- | --- | --- |
| `gofmt -l internal/ports/provider/import_boundary_test.go internal/ports/provider/import_boundary_fixtures_test.go` | 0 | 无输出（同目录既有 `video_error.go` 被 `gofmt -l` 列出，属未触碰的存量，本轮未处理） |
| `go build ./...` | 0 | 无输出 |
| `go vet ./...` | 0 | 无输出 |
| `go run ./tools/structurecheck` | 0 | 生产 Go 文件 483；超限文件 0 / 超限函数 0 / 越限嵌套 0；参与判定的作用域（REV-3）：**5536**；「结构门禁通过」 |
| `go test ./internal/ports/provider/ -count=1` | 0 | `ok … 4.215s`；`scope internal/infra: Go 文件=224, AST imports=1578, 豁免测试文件=109, 存量依赖=8, 违规=0`；`参与判定的边界规则=6、Go 文件=463、存量依赖=38`；`internal 一级目录覆盖（BE-G2）：规则=6、豁免=5、参与判定=11` |

**本轮未执行（如实登记）**：`go test -race`（本机 `CGO_ENABLED=0`，由 CI `Race backend` 覆盖，BE-B1）；隔离 PostgreSQL/Redis 集成用例（本机无服务 → 按 TEST-6 记 `Blocked`，由 CI 隔离服务覆盖）。全量收敛证据见 §31.4。

### 31.4 后续补强：目录覆盖守卫递归判定嵌套包（提交 `93954469`）

**缺口（本批独立审计实测）**：`TestInternalDirectoryCoverageBoundary` 只枚举 `internal/` 的**一级目录**，因此**被豁免目录下的嵌套新包静默漏判**。反例：`internal/pkg/zzprobe/probe.go`（`import _ …/internal/app`）→ 守卫 **exit 0**（漏判）；同一 import 放在 `internal/ports/zzprobe/` → exit 1。

**改动**：枚举改为 `filepath.WalkDir` 递归全量目录（排除 `testdata` 与 `_`/`.` 前缀目录，与 Go 工具链忽略规则一致）；覆盖语义改为「规则覆盖整棵子树 / 豁免登记只覆盖自身」；为 `pkg` 补分层规则（forbidden = app/application/transport/infra，`includeTests=false`），新增存量例外 **0** 条；新增 `TestInternalPackageDirectoriesFixtures` 自证枚举口径，`TestDirectoryCoverageGuardFixtures` 增 6 条嵌套用例。计数由「规则=6、豁免=5、参与判定=11」变为「规则=7、豁免登记=5、参与判定的目录（含嵌套）=82」；存量依赖总数仍为 38（application 29 + transport 1 + infra 8），**例外面未扩大**（相互指针：§4.1 的 import 行计数、§5 BE-02、§20.2 的冻结例外表三者同源；复现 `cd backend && go test ./internal/ports/provider/ -count=1`，**本轮未执行**，EVID-1）。

**负样本（修复前 → 修复后，同一反例）**：

| 反例                                         | 修复前                                    | 修复后                                                                              |
| -------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------- |
| `internal/pkg/zzprobe`（豁免目录下嵌套）     | `--- PASS` + `参与判定=11`，**exit 0**（漏判） | `--- FAIL: TestLayerImportBoundaries/pkg_生产文件不反向依赖上层或_infra`，**exit 1** |
| `internal/shared/zzprobe`（仍为豁免目录）    | exit 0                                    | `--- FAIL` + `internal/shared/zzprobe 未被任何规则或覆盖登记覆盖`，**exit 1**        |

**全量门禁（cwd=`backend`，命令自身退出码）**：

| 命令                                                | 退出码 | 关键输出                                                                                                              |
| --------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------- |
| `go build ./...`                                    | 0      | 无输出                                                                                                                |
| `go vet ./...`                                      | 0      | 无输出                                                                                                                |
| `go run ./tools/structurecheck`                     | 0      | 生产 Go 文件 483；超限文件 0 / 超限函数 0 / 越限嵌套 0；参与判定的作用域（REV-3）：5536                                 |
| `go run ./tools/apicheck`                           | 0      | 基线条目 2062 条，当前 2062 条；导出 API 面与基线逐条一致（基线未被改写）                                              |
| `"D:\softwares\Git\bin\bash.exe" scripts/verify.sh` | 0      | `全部通过`；脚本计时 168.308 秒（PowerShell 计时 187.8s）                                                              |
| `go test ./... -count=1`                            | 0      | 131.2s；`"Action":"fail"` 事件 0；`skip` 事件 31（11 包级 `[no test files]` + 20 测试级环境门控）                       |

**跳过明细（20 条，全部环境门控，与本轮改动无关）**：`internal/infra/persistence/relational` 17 条 `TestPostgres*`、`internal/infra/runtime/redis` 2 条（`TestRedisRuntimeStoreIntegration`、`TestRedisInvalidationBusIntegration`）、`internal/application/account` 1 条（`TestRedisQuotaRefreshCrossInstanceTrailing`）→ 本机无 PostgreSQL/Redis 服务，按 TEST-6 记 **Blocked**（CI 有隔离服务覆盖）。

**未验证/未执行**：`go test -race ./...`（本机 `CGO_ENABLED=0` → Blocked，由 Linux CI 覆盖）；前端门禁与全栈 E2E（不在本项范围）。

**存量观察（未触碰）**：`gofmt -l ./cmd ./internal ./tools` 报 5 个未格式化文件（`internal/application/gateway/selector_test.go`、`internal/infra/provider/web/account_settings.go`、`internal/infra/provider/web/sso_build_test.go`、`internal/ports/provider/video_error.go`、`internal/transport/http/swagger_annotations.go`）；`verify.sh` 无 gofmt 步骤，不影响门禁，登记为 P3。

**回滚**：`git revert 93954469`（仅测试文件与文档，无生产代码、无生成物）。

## 32. 2026-10-12（续）静态托管暴露面定级与本批后端侧登记

> 装配分支：`maint/acceptance-audit-20261012-final`（本文件写入时 HEAD `580fd9e7`）。§29/§30 为 `main` 合并章、§31 为本批后端章，按 META-3 历史章节不改写，新内容追加为 §32。本章只登记**后端侧**的定级与未实施项；前端侧同批登记见 `frontend/AUDIT.md` §28（其 §28.5 的「静态托管暴露面」行即本节 32.1 的前端视角）。

### 32.1 静态托管暴露面定级（§25.2 第 3 项的定级）

§25.2 第 3 项已实测「`staticPath` 指到父目录即公开 config/二进制/数据库」。本批补定级与触发条件：

- **机制**：`frontend.go` 的静态托管除「根级点文件」外**无白名单**；当 `staticPath` 为 `.` 或 `..` 且静态根内存在 `index.html` 时，`GET /config.yaml`、`GET /data/*.db` 返回 200。
- **定级 P2**：默认配置 `./frontend/dist`（`config_defaults.go`）与镜像布局（静态根与二进制/`VERSION` 分离）**不可触发**，需误配置才成立 ⇒ 现存形态记 **P2**。
- **升级条件（P1）**：一旦以该形态部署，泄露面含 `jwtSecret` / `credentialEncryptionKey` / 管理员口令 ⇒ **该形态为 P1**。
- **最小修复方向**：启动期 fail-fast（静态根含 `config.yaml`/`.env`/`*.db`/可执行文件即拒绝启动）或托管白名单。
- **回归命令**：`go test ./internal/transport/http/ -run 'TestFrontendStaticFilesAndSPAFallback|TestFrontendStaticExposure|TestFrontendFileRejectsResolvedPathsOutsideRoot|TestIsRelativePathWithinRoot' -count=1`（用例位于 `internal/transport/http/server_test.go:96`（SPA 回退与隐藏产物）、`internal/transport/http/server_test.go:193`（`isRelativePathWithinRoot` 谓词，平台无关）、`internal/transport/http/frontend_exposure_test.go:82`（暴露面表征，含子目录点文件、Cache-Control 精确值、方法维度与 `frontendRoot` 失败矩阵））。
- **本轮收口（独立复核 R20 F1）**：`filepath.Rel` 包含性守卫（`frontend.go:77`）在 HTTP 层**不可观测**，其唯一触发形态在 Linux 上不可达 ⇒ 删守卫时上述 HTTP 层用例仍全绿（覆盖洞，原值「删守卫必失败」→ 新值「HTTP 层不报警」，见 §25.3 的 EVID-8 更正）。守卫已逐字等价抽出为纯谓词 `isRelativePathWithinRoot`（`frontend.go:92-94`），平台无关回归由 `server_test.go:193` 的 `TestIsRelativePathWithinRoot` 承担，判别力已实测（谓词体改恒 `true` → 该用例 FAIL）。
- **未执行**：真实 Docker/Linux 镜像内探测（本机无 Docker，同 §25.2 的登记）。

### 32.2 本批后端侧未实施登记（P3）

| 项                                                        | 证据                                                                                                                                                                                                                          | 定级 | 处置                                                                                                            |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------- |
| `backend/tools/structurecheck/main.go` 距 REV-1 阈值仅 3 行 | 字节级实测 **597 行**（口径 = 该文件 `:249-259` 的 `countLines`，即 `bytes.Count("\n")`，结尾换行不额外计一行）；主代理记为 598 行，差 1 行，以本节实测为准（EVID-8）⇒ 距 600 仅 3 行余量                                       | P3   | 该文件为门禁工具本体，不在 `structurecheck` 的扫描范围（只扫生产 Go 文件）；如需收紧可把夹具/输出拆到独立文件     |
| `gofmt -l ./cmd ./internal ./tools` 存量 5 个未格式化文件   | 明细见 §31.4；`verify.sh` 无 gofmt 步骤，不影响门禁                                                                                                                                                                           | P3   | 已登记，未处理                                                                                                  |

### 32.3 本批后端新增门禁（BE-28，运行证据待回填）

提交 `0c23f902`（`feat(backend): 新增 Dockerfile 构建输入静态守卫并接入 verify.sh（BE-28）`）新增 `backend/tools/dockerfilecheck/`（`main.go`、`backend.go`、`dockerfile.go`、`dockerignore.go`、`frontend.go`、`main_test.go` 与 `testdata/repo/**` 夹具）并在 `backend/scripts/verify.sh` 增加一步。**本章只登记事实**：该步的运行证据（命令 + 退出码 + 关键输出）由 `frontend/AUDIT.md` §28.4 的 `bash scripts/verify.sh` 回填，**回填前不得记为 `Passed`（EVID-1）**。补充（2026-10-12，本 tip 实测）：该工具的 **CI 接线状态与回填要求见 §34.5**——本 tip 上 `.github/workflows` 内 `dockerfilecheck` 0 命中，CI 真实执行证据待回填。

### 32.4 未执行 / 未验证（如实登记）

- `bash scripts/verify.sh`、`go test ./... -count=1`、`go test -race ./...`、隔离 PostgreSQL/Redis 集成用例：本批未在装配分支上重跑；最终验收由 `frontend/AUDIT.md` §28.4 的表格回填，**回填前不得记为 `Passed`**。
- BE-G3（`ports/security` 迁移）与 `apicheck --update`：需单独授权，未实施（同 `frontend/AUDIT.md` §28.6）。
- 本工作树未安装 Go 工具链依赖之外的前端 `node_modules`，本章不含任何本机复跑的前端命令结论。

## 33. 2026-10-12（续二）计划 5-2/5-6 收口与静态托管测试登记

> 分支 `maint/acceptance-audit-20261012-registration`（基点 `0e8c02b7`）。按 META-3 只追加，§29–§32 既有数字不改写。计划条目编号取自 `.pi/plan/前后端验收审计与增量模块化优化计划-20261011-1936.md`（阶段 5 第 2 项与第 6 项）。**本节未修改任何代码**，结论均为只读核对。

### 33.1 计划 5-2（装配、生命周期、任务退出、请求取消与业务状态转移）——只读核对结论

方法：真实读取本工作树的代码（未新增探针、未改文件）。结论分三类：**已核对成立** / **发现缺陷** / **无法核实**。四项全部核对完毕，**未发现 P0/P1/P2 缺陷**；唯一「无法核实」项见 (c) 末。

#### (a) 装配入口：`internal/app/assemble.go`

**已核对成立。**

- 唯一装配入口 `New`（`assemble.go:139-165`）按**固定顺序**执行 16 个步骤（`:141-158`），任一步返回错误即中止；`assembly.fail`（`:168-176`）按「先关运行态存储、再关数据库」释放已建立资源，与拆分前清理顺序一致（`:50-51` 注释即为该契约）。
- 依赖注入点集中在各 `assembleXxx` 方法，且**被依赖方先于依赖方构造**：如 `:368` `cliAdapter.SetFallbackMarker(a.accountService)` 在 `:366-367` 构造 `accountService` 之后；`:424` `egressManager.SetFailureProber(a.egressService.TestNode)` 在 `:419` 构造 `egressService` 之后；`:449-450` 审计的 commit/drop observer 在 `:430` 的 `clientKeyService` 之后。未发现「先于构造」的悬空注入。
- 生命周期钩子：`assembleHTTPServer`（`:561-576`）把 readiness 闭包（`:562-564`）与 `a.startup.acceptsTraffic` 注入路由（`:573`），`http.Server` 的超时字段（`ReadHeaderTimeout` 10s / `ReadTimeout` / `IdleTimeout` 2m / `MaxHeaderBytes` 64 KiB）在此显式设定；`application()`（`:579-585`）把全部字段映射进 `Application`。

#### (b) 任务退出 / 后台任务：启动、停止、关闭顺序、是否泄漏

**已核对成立（无泄漏证据）。**

- **统一注册与等待**：`Application.Run`（`internal/app/lifecycle.go:16-34`）建 `runCtx` + `sync.WaitGroup`，`defer` 先 `cancelBackground()` 再 `background.Wait()`（`:21-24`），即**先发取消、再等待全部后台任务退出**；所有任务经同一 `start` 闭包注册（`:65-71`）。
- **监督语义**：`runSupervisedTask`（`internal/app/application.go:268-293`）对 panic/异常退出做指数退避重启（1s → `min(backoff*2, 30s)`），并在 `ctx.Done()` 时停止（`:285-290`）；`runPeriodicTask`（`:249-266`）每次执行新建带超时的子 ctx 并**立即 `cancel()`**（`:257-259`），退出路径 `timer.Stop()`（`:251`）。`batch.Do` 包装保证 panic 被转成 `*batch.PanicError` 而非进程崩溃。
- **固定 Worker**：`RunVideoWorkers`（`internal/application/gateway/video_tasks.go:17-46`）`workers.Add(s.mediaWorker)` → 每个 worker 在 `ctx.Done()` 时 `return`（`:27-29`）→ `workers.Wait()`（`:45`）；入队是非阻塞 `select/default`（`:68-80`），队列满时回滚 `mediaQueued` 标记并计数告警，**不会阻塞请求**；任务侧 `TryClaimMediaJob`（`:121-127`）用租约去重。
- **批处理池不持有常驻 goroutine**：`batch.Pool.Do`（`internal/pkg/batch/executor.go:105`）是同步调用 + 槽位信号量；`mapObserved` 的 worker goroutine（`executor.go:331-339`）由 `jobs` channel 与 `sync.WaitGroup` 收敛。
- **关闭顺序**：`Run` 退出时 `defer a.closeAudits()`（`lifecycle.go:18`、`:37-43`，10s 超时，失败只告警）→ 后台任务全部 `Wait()` → 进程退出；`Application.Close`（`application.go:241-247`）关闭运行态存储与数据库。顺序为「审计 → 后台任务 → 运行态存储 → 数据库」。

#### (c) 请求取消：transport → application → infra 的传播与超时

**已核对成立（含一处有意设计，非缺陷）。**

- **入口超时**：`internal/transport/http/server.go:122` 的全局中间件链挂 `middleware.Timeout(deps.RequestTimeout)`；`middleware.Timeout`（`internal/transport/http/middleware/request.go:64-71`）以 `context.WithTimeout(c.Request.Context(), duration)` **写回** `c.Request` 并 `defer cancel()`。各 handler 一律传 `c.Request.Context()` 下探（例：`transport/http/model/handler.go:259` 的 `context.WithCancel`、`settings/handler.go:170`、`system/handler.go:38`）。
- **应用层保留请求 ctx**：网关在 `initializeRequest`（`internal/application/gateway/service_request.go:161-163`）把入参 ctx（含 egress trace）存为 `state.ctx`；上游调用使用由其派生的 `physicalCallCtx`（`service_request.go:388`）⇒ 客户端取消沿 ctx 链传播到 provider 的 HTTP 调用。
- **取消分类**：`service_request_attempt.go:205-208` 把 `state.ctx.Err() != nil || errors.Is(err, context.Canceled)` 归为 HTTP **499** / `request_canceled`；`attempt.go:565-573` 的 `transportStage` 另分 `response_header_timeout` / `request_canceled` / `request_timeout` 三档。
- **有意设计（非缺陷）**：收尾与用量落库**刻意脱离**请求 ctx——`finalization.go:39` 用 `context.WithDeadline(context.Background(), …)`、`:54` 用 `context.WithTimeout(context.Background(), finalizationTimeout)`、`service_request_attempt.go:236` 用 `context.WithoutCancel(state.ctx)`；`finalization.go:52` 的注释写明目的是「避免请求取消或收尾预算耗尽丢失记录」，各阶段另有硬预算（`:11-17`，750ms/1.5s/1s/3s/500ms）。⇒ 客户端取消**不会**回滚已确认用量或丢失审计记录，符合计划第 7 项要求的账本一致性。
- **无法核实**：端到端「客户端断连 → 上游 TCP 连接实际关闭时延」的真实时序**未在本机测量**（需真实上游或可控代理；本机无 Docker、不接外部 Provider）。需要什么才能核实：一个可注入延迟/断连的本地 HTTP 替身 + 连接级观测（`httptrace` 或代理日志）。

#### (d) 业务状态转移（抽 3 条真实路径）

1. **账号认证状态（`active` / `reauthRequired`）——已核对成立。**
   - 状态机定义：`internal/domain/account/account.go:105-109` 的 `type AuthStatus string` + `AuthStatusActive` / `AuthStatusReauthRequired` 两个枚举常量（无自由字符串）。
   - 转移入口单一：`MarkReauthRequired`（`internal/application/account/service_credential_refresh.go:16`）。
   - 并发/幂等：写路径经仓储原子更新，未发现无保护的读改写。

2. **Free 额度恢复状态机（`active` / `exhausted` / `probing`）——已核对成立。**
   - 状态机定义：`internal/domain/account/account_quota.go:82-87`。
   - 推进链：`quotarecovery.Service.Run`（`internal/application/quotarecovery/service.go:54`）→ `runDue`（`:72`）→ `runOne`（`:93`）；`reconcileDue`（`:126`）把「持久化窗口存在但队列缺失」的事件补回（幂等补偿）。
   - **并发保护**：以 `ClaimDueQuotaRecoveries(..., lease)` 认领（带租约，天然去重）；失败按 `backoff`（`:139-142`）重排，退避参数用 `s.mu` 保护（`:48-51`）。

3. **客户端 Key 计费预留 → 结算——已核对成立（幂等语义清晰）。**
   - 预留：`clientkey/service_billing.go:15-42`，先由仓储 `ReserveBillingUsage` 原子判限额（`:26`），`ErrLimitExceeded` 映射为 `ErrBillingLimit`（`:27-30`）。
   - 进程内保护集合：`activeBilling` 由 `activeMu` 保护（写 `:36-38`、删 `:78-82`、快照 `:91-96`）。
   - **幂等/权威性**：`:72-73` 的注释明确「进程内标记只是保护，**持久预留才是权威**，直到 commit / cancel / 过期」；`CleanupExpiredBilling`（`:86-103`）把 `activeBilling` 作为 `protected` 集合传入清理，避免误删正在结算的预留。审计侧通过 `SetCommitObserver` / `SetDropObserver`（`assemble.go:449-450`）回调 `CompleteBillingBatch` / `ReleaseBillingProtectionBatch`，与上述语义一致。

**本节小结**：装配、生命周期/任务退出、请求取消、业务状态转移四项**均已核对成立**，未发现缺陷；唯一「无法核实」为端到端断连时序（需真实上游或代理）。**本轮未改动任何代码**，因此不产生新的回归面。

### 33.2 计划 5-6（按证据选热点并优化）

**本轮不实施性能优化，且不声称无回退。** 依据 `backend/AUDIT.md` §28.1：`benchstat` 已装并实际执行统计检验，结论是**本机不具备 `ns/op` 判别力**——26.7% 的对比被判为「假显著」、CI 半宽中位 **±36%**；§28.3 已明确列出**不可声称项**（无判别力 ⇒ 既不得声称优化收益，也不得声称无回退）。因此按计划第 4 项验收口径「无可复现收益则不合入性能改动，记录『无需调整』」，本轮结论为**不做优化**，`§28.2` 的唯一相关改动是修复基准自身的缺陷（`b.ResetTimer()`），不属于生产路径优化。

**后续重测的前置条件**（缺一不可，否则仍无判别力）：① **安静窗口**——无并行重负载任务（本机 8 逻辑核，性能测量不得与重负载测试并行）；② **固定 `-count`（≥5）** 并在同平台 / 同 Go 版本 / 同 `CGO_ENABLED` 下重复；③ **统计检验**——用 `benchstat` 输出 CI 半宽，只有半宽小到足以分辨目标差异（远小于预期收益）时才据以选热点；④ 有可复现收益时先用 CPU/内存/锁分析与 SQL 查询证据定位根因，再按计划第 6 项的最小面实施。

### 33.3 本批静态托管相关登记（提交 `98cc6f06`、合并 `0e8c02b7`）

- **`98cc6f06`**（`test(backend): 为静态托管的敏感文件暴露面补表征测试（§25.2 风险成测）`）：新增 `backend/internal/transport/http/frontend_exposure_test.go`（`git diff --numstat` = **+202 / −0**），把 §25.2 第 3 项（`staticPath` 指到父目录即公开 config/二进制/数据库）**表征化**为 **5 个顶层用例**：
  `TestFrontendStaticExposureServesSensitiveFilesFromConfiguredRoot`（`:75`）、`TestFrontendStaticExposureRejectsRootLevelDotfiles`（`:105`）、`TestFrontendStaticExposureNotRegisteredWithoutIndexHTML`（`:125`）、`TestFrontendStaticExposureRejectsDirectoryTraversal`（`:151`）、`TestFrontendFileRejectsResolvedPathsOutsideRoot`（`:189`）。
- **合并提交 `0e8c02b7`**：`Merge branch 'maint/acceptance-audit-20261012-static-exposure-test' into maint/acceptance-audit-20261012-final`（本工作树基点）。
- **回归命令（本机实跑，2026-10-12，cwd=`backend`，`CGO_ENABLED=0`）**：

```
go test ./internal/transport/http/ -run 'TestFrontendStaticExposure|TestFrontendFileRejectsResolvedPathsOutsideRoot' -count=1
```

**exit 0**，关键输出：`ok github.com/chenyme/grok2api/backend/internal/transport/http 3.827s`，5 个顶层用例全 `PASS`（穿越用例的子用例含 `//../outside-secret.txt`、`//%2e%2e/outside-secret.txt`、`//..%2foutside-secret.txt`、`//..\outside-secret.txt` 四条 404，另有一条 200 正对照）。注意 §32.1 原回归命令 `-run TestFrontendStaticFilesAndSPAFallback` **不覆盖本批新增用例**——即 R20 的 F5。

**R20 复核两点（按是否已并入如实标注）**：

| 编号 | 内容 | 并入状态（本工作树实测） |
| --- | --- | --- |
| **F1（P2）** | `frontend.go:76-79` 的 `filepath.Rel` 包含性守卫在 **Linux 上不可达**（`path.Clean` 已消掉根处 `..`；唯一触发形态是含 `filepath.Separator` 的别名路径，而 Linux 上 `\` 是普通文件名字符）⇒ 删除该守卫 CI(Linux) 仍为绿，平台无关回归必须由谓词单测承担。 | **待并入**。本工作树 `frontend.go:77` **仍是内联判定**（未抽出谓词）。重构在分支 `maint/acceptance-audit-20261012-static-guard-testable`（提交 `b1d38714`：抽出 `isRelativePathWithinRoot` + 新增 `TestIsRelativePathWithinRoot`，仅改 `frontend.go` 与 `server_test.go`）；实测 `git merge-base --is-ancestor maint/acceptance-audit-20261012-static-guard-testable HEAD` **exit 1** ⇒ 尚未并入。 |
| **F5（P3）** | §32.1 的回归命令未含本批新增用例；§25.3①「穿越/编码别名（httptest + 哨兵文件，删守卫必失败）」的预期**需更正**——该测试缺口已由 `98cc6f06` 的 `TestFrontendStaticExposureRejectsDirectoryTraversal`（哨兵文件在静态根外、断言 404）在 **Windows** 上覆盖；Linux 侧因 F1 的不可达性，仍需谓词单测补足。 | **待并入**。文档更正与 F1 同属 `b1d38714` 所在分支，但该分支当前**只含 `frontend.go` 与 `server_test.go` 两个文件**（无 AUDIT 改动）⇒ §32.1 / §25.3① 的文本更正**尚未落地**。本节按 META-3 只登记事实与并入状态，不改写 §32.1 / §25.3 原文。 |

> **更正（2026-10-12，tip `5625a857`）**：上表 **F1** 与 **F5** 两行的「**待并入** … `exit 1` ⇒ 尚未并入」**已过时**——`b1d38714` 与 `0f0be18d`（经 `e4e3dec7` 并入）**均已并入交付线**。本节只加指针，**不改写上表原文**（META-3 / EVID-8：历史快照保留原值）。复现：`git merge-base --is-ancestor b1d38714 HEAD` → **exit 0**、`git merge-base --is-ancestor 0f0be18d HEAD` → **exit 0**（在 tip `5625a857` 上实测，详见 §35.6）。

**未执行（如实登记）**：本节**未重跑**变异注入验证 F1/F5 的判别力归属（该结论引用 R20 复核，见会话 scratch `plan-progress.md` 的 R20 结论）；`go test ./... -count=1`、`bash scripts/verify.sh`、`-race` 与隔离 PG/Redis 均未在本节范围内重跑（其最新证据见 §31.4、§32.4 与 `frontend/AUDIT.md` §28.4）。

### 33.4 W4-3 指针更正：tree-shaking / 浏览器目标核对不在本文件 §20.10

- **指针更正**：计划 W4-3 要求把「不执行热点优化」与「无 tree-shaking / 浏览器目标专项核对」引用 `be §28.3` 与 `be §20.10`。实测：本文件 §20.10（`:877` 起）是**后端 benchmark 实测**章节（2026-10-11 21:11–21:17），与 tree-shaking / 浏览器目标**无关**；该结论实际登记在 **`frontend/AUDIT.md` §29.3**（本 tip `:1581-1588`，标题「计划 3-5：tree-shaking 与浏览器目标」；该文件由前端批次同步更新，行号可能漂移，以标题为准）。热点优化不做项本身**已登记**在 §33.2（引 §28.1 / §28.3：26.7% 假显著、CI 半宽中位 ±36%）。
- **状态：`登记不做`**。理由：tree-shaking 与浏览器目标沿用 Vite 默认（`build.target='modules'`、`build.minify='esbuild'`、Rollup 默认 DCE），既无 bundle 分析器记录、也无「删除未用导出后体积变化」的专项测量 ⇒ 不臆造任何收益数字；做专项核对还需 `frontend/node_modules` 与额外体积分析工具（新引入依赖需单独授权），本轮工作树不含前端依赖。复现命令（**本轮未执行**，EVID-1）：`cd frontend && pnpm install --frozen-lockfile && pnpm build`，随后对 `frontend/dist` 逐 chunk 做体积/引用分析（分析器需额外工具）；现有可测结论由 `pnpm check:budget` 覆盖（见 `frontend/AUDIT.md` §29.1/§29.3）。

## 34. 2026-10-12（续三）静态托管表征测试、守卫可测化与回归同步

> 分支 `maint/acceptance-audit-20261012-registration-2`（基点 `77d4aa65`）。按 META-3 只追加，§1–§33 既有数字不改写（含 §33.3 对同一提交的先行登记，本节只补其未覆盖项并加指针）。本节登记第五批（2026-10-12 续）后端侧的**测试/生产改动**；标注「引用既有实测」的数字来自各提交验证段或会话 scratch 日志，「本工作树实跑」的仅为 `git show --numstat`/`git log`/`git merge-base --is-ancestor`、文件实读与字节级行数统计（本工作树无 Go 全量运行、无 Docker、`CGO_ENABLED=0`）。

### 34.1 静态托管表征测试（提交 `98cc6f06`，分支 `maint/acceptance-audit-20261012-static-exposure-test`，合并 `0e8c02b7`）

- **`--numstat`（本工作树实跑）**：`backend/internal/transport/http/frontend_exposure_test.go` **+202 / −0**，**仅此一个文件** ⇒ **未改生产代码**（该提交只加测试）。
- **5 个顶层用例**（行号为**当前 HEAD** 实测；该提交当时的行号见 §33.3 的 `75/105/125/151/189`，其后 `186a7500` 在文件上方新增三个 helper 使用例整体下移）：

| 用例                                                        | 当前行号 |
| ----------------------------------------------------------- | -------- |
| `TestFrontendStaticExposureServesSensitiveFilesFromConfiguredRoot` | `:82`    |
| `TestFrontendStaticExposureRejectsRootLevelDotfiles`        | `:116`   |
| `TestFrontendStaticExposureNotRegisteredWithoutIndexHTML`   | `:149`   |
| `TestFrontendStaticExposureRejectsDirectoryTraversal`       | `:175`   |
| `TestFrontendFileRejectsResolvedPathsOutsideRoot`           | `:213`   |

- **回归命令与证据不重复**：`go test ./internal/transport/http/ -run 'TestFrontendStaticExposure|TestFrontendFileRejectsResolvedPathsOutsideRoot' -count=1` **exit 0**（`ok … 3.827s`，5 个顶层用例全 PASS）已登记在 §33.3；本节只加指针，不重复该数字。
- **R20 独立复核结论（本节首次登记 F2/F3，F1/F5 的收口见 §34.2）**：
  - **P2 F1**：`frontend.go` 的 `filepath.Rel` 包含性守卫在 HTTP 层**不可观测**（`http.FileServer` 把别名路径归一化回 root 内），其唯一触发形态（含 `filepath.Separator` 的别名路径）在 Linux 上不可达（`os.Stat` 先失败）⇒ 删掉整个守卫时 CI（Linux）仍为绿。**收口见 §34.2**（已并入最终 tip）。
  - **P3 F2**：`/dashboard` 子例在「`NoRoute` 未注册」与「`NoRoute` 已注册但 SPA 回退目标 `index.html` 缺失」两种形态下结果相同 ⇒ 原注释暗示的判别力不成立；标签 F2 由提交 `186a7500` 的改动说明标注，修复见 §34.2。
  - **P3 F3**：`Cache-Control` 原先只判前缀 ⇒ 已由 `186a7500` 改为按 `frontend.go:31-35` 的实际取值断言完整字符串（`no-cache` / `public, max-age=31536000, immutable`）；F2/F3 同属 R20「另列 5 条可补语义」，对应 `186a7500` 的第 2、4 项。
  - **P3 F5**：§32.1 的回归命令未含本批新增用例、§25.3① 的「删守卫必失败」是**预期**而非实测 ⇒ 已由 `0f0be18d` 以 EVID-8 更正（原值 → 新值及复现命令见该提交对 §25.3① 的补丁）；本节只加指针，不重写 §25.3/§32.1 原文。

### 34.2 守卫可测化与覆盖补强（提交 `b1d38714`、`186a7500`、`0f0be18d`，分支 `maint/acceptance-audit-20261012-static-guard-testable`，合并 `e4e3dec7`）

| 提交       | 标题                                                                   | `--numstat`（本工作树实跑）                                                                              |
| ---------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `b1d38714` | `refactor(backend): 抽出静态托管根内判定谓词并补平台无关单测（F1）`     | `internal/transport/http/frontend.go` +10/−1；`internal/transport/http/server_test.go` +30/−0            |
| `186a7500` | `test(backend): 补静态托管的子目录点文件、缓存头与方法维度固定（F2/P3）` | `internal/transport/http/frontend_exposure_test.go` +134/−5（**不改生产代码**）                          |
| `0f0be18d` | `docs(audit): 同步静态托管回归命令与守卫可观测性更正（F5）`             | `backend/AUDIT.md` +4/−1                                                                                 |

**`b1d38714`：CHG-2 标注「搬运」**

- 包含性判定逐字等价抽出为具名纯函数 `isRelativePathWithinRoot`（本工作树实测：定义在 `frontend.go:92`，调用点 `frontend.go:77` 的 `if err != nil || !isRelativePathWithinRoot(relative)`；`err` 仍先判、求值顺序与 `filepath.Separator` 语义不变）。`filepath.Rel` 调用仍在 `:76`。
- 新增**平台无关表驱动单测** `TestIsRelativePathWithinRoot`（`server_test.go:193`，本工作树实测），不经过 HTTP 与文件系统 ⇒ 关闭 F1 的「删守卫 CI 仍绿」缺口。
- **变异判别力（引用既有实测）**：谓词体临时改成恒 `true` → `go test ./internal/transport/http/ -run TestIsRelativePathWithinRoot -count=1` **exit 1**（出处：`b1d38714` 提交信息）。

**`186a7500`：HTTP 层覆盖补强（不改生产代码）**

- 新增 3 个顶层用例：`TestFrontendStaticExposureCacheControlValues`（`:233`）、`TestFrontendStaticExposureMethodDimension`（`:264`）、`TestFrontendStaticExposureRootFailureMatrix`（`:292`）；文件现为 **332 行 / 8 个顶层用例**（本工作树字节级统计；`98cc6f06` 时 202 行 / 5 用例）。
- 固定维度：夹具新增 `data/.env`（独有内容 `NESTED_JWT_SECRET=TEST-ONLY`）并断言 `GET /data/.env` → **200** 且体含该内容（`isHiddenArtifact` 只拦根级点文件，故子目录点文件被放行——「唯一守卫」的精确边界）；`Cache-Control` 精确值；`HEAD /config.yaml` → 200 + 空体、`POST /config.yaml` → 404 + 空体（按 `frontend.go:22-25` 实测固定）；`frontendRoot` 失败矩阵 4 组（`staticPath` 为空 / 目录不存在 / 路径是普通文件 / `index.html` 是目录）并以正常根作对照；F2 的 `/dashboard` 子例注释修正。
- 复用：抽出 `staticExposureRequest`（`:65`，返回 recorder）供响应头与非 GET 方法复用，`staticExposureGet`（`:72`）委托给它，行为不变。
- **回归（引用既有实测）**：`go test ./internal/transport/http/ -count=1` **exit 0**；`gofmt -l` 无输出；`structurecheck` / `apicheck` **exit 0** 且基线未变（出处：`186a7500` 提交信息）。

**变异判别力第二次实测（B，证实 F1 的归属）**：把调用点改为只判 `err`（`frontend.go:77` 去掉谓词调用）后——`TestFrontendFileRejectsResolvedPathsOutsideRoot` **FAIL（exit 1）**，而 HTTP 层的 `TestFrontendStaticExposureRejectsDirectoryTraversal` 仍 **PASS**（`ok … 3.514s`，含四条 404 子用例与一条 200 正对照）⇒ 直接单测才是该守卫的判别力来源，HTTP 层用例在 Linux 上不可达。出处（引用既有实测）：会话 scratch `mut-TestFrontendStaticExposureRejectsDirectoryTraversal.log` 与 `0f0be18d` 对 §25.3① 的 EVID-8 更正段。

**`0f0be18d` 的文档更正（只加指针）**：修正 §32.1 的回归命令为 `go test ./internal/transport/http/ -run 'TestFrontendStaticFilesAndSPAFallback|TestFrontendStaticExposure|TestFrontendFileRejectsResolvedPathsOutsideRoot|TestIsRelativePathWithinRoot' -count=1` 并逐项标注用例位置；对 §25.3① 做 EVID-8 更正（原值「删 `filepath.Rel` 守卫 ⇒ ① 的 HTTP 用例失败」→ 新值「删守卫 ⇒ HTTP 层用例仍全绿（覆盖洞 P2）」）。该提交已并入最终 tip，本节不重复其文本。

### 34.3 装配与未执行项

- **装配（本工作树实跑）**：`git merge-base --is-ancestor <sha> HEAD` 对 `98cc6f06`、`b1d38714`、`186a7500`、`0f0be18d` **均 exit 0**；合并提交为 `0e8c02b7`（静态暴露测试）与 `e4e3dec7`（守卫可测化），最终 tip `77d4aa65`。`backend/api-baseline.txt` 与 `backend/structure-baseline.json` 相对基点 `0c23f902` **逐 blob 相同**（本工作树实跑，见 `frontend/AUDIT.md` §30.4 表），符合 CHG-8。
- **最终 tip 上的验收（会话 scratch `t5-verify.out.log` / `t5-verify-rerun.out.log`）**：`bash scripts/verify.sh` **run 1 = exit 1**，唯一失败是 `internal/infra/egress` 的 `TestPinnedHTTPSClientSOCKS5HReceivesPinnedIP`（Windows `wsarecv … aborted` 未被测试侧错误白名单覆盖：`pinnedclient_test.go:121` 与 `buildclient_test.go:312-314`）；隔离重跑 **3/3 PASS**、整包 2/2 ok、**完整重跑 exit 0**（67 包 ok，169.3 s）⇒ 判为偶发 flake、与提交无关，已由提交 `e02a5e20` 把两处白名单收敛为同一谓词 `isClosedNetworkError`（覆盖 `closed network connection` / `reset by peer` / `wsarecv` / `aborted` / `wsaeconnaborted`）并保持断言强度（含两次变异判别力实证）。run 1 其余步骤 exit 0：`go build` / `go vet` / `structurecheck`（REV-3 **5537**）/ `apicheck`（**2062/2062**）/ `dockerfilecheck`（必需文件 **900** 个、未被 COPY 覆盖 0、被忽略规则排除 0）；`go test ./...` 跳过 **20** 条（`TEST_POSTGRES_DSN` 16 + `TEST_REDIS_ADDRESS` 3 + 两者同时要求 1），本机无隔离服务 → 按 TEST-6 记 `Blocked`，由 CI 隔离服务覆盖（CI `Assert required integration tests ran` = success，见 `frontend/AUDIT.md` §28.7）。新增静态托管用例（`TestFrontendStaticExposure*` 8 个 + `TestIsRelativePathWithinRoot` + `TestFrontendFileRejectsResolvedPathsOutsideRoot`）在 `-v` 下**全部 PASS**。
- **未验证项**：`0f0be18d` 的 AUDIT 文本更正未逐字复核（只核对 `--numstat` +4/−1 与其改动摘要）；R20 的 F2/F3 编号取自提交 `186a7500` 的改动说明，未取得 R20 原始报告全文（该报告不在本会话 scratch 内）⇒ 编号映射按提交说明登记，未独立复核。

### 34.4 R21/T5 复审与 flaky 收口（分支 `maint/acceptance-audit-20261012-egress-flake`）

| 提交       | 内容                                                                                                                                                                                                                                                                                                                                                                          |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `e02a5e20` | **P2**：把 `internal/infra/egress` 两处测试侧「连接被对端/本机中止」白名单（`pinnedclient_test.go` 的内联判定与 `buildclient_test.go` 的 `isClosedNetworkError`）收敛为**同一谓词**，覆盖 `closed network connection` / `reset by peer` / `wsarecv` / `aborted` / `wsaeconnaborted`（大小写不敏感），消除 Windows 高并发 loopback 下 `WSAECONNABORTED` 造成的偶发失败；**未放宽断言强度**——变异 A（注入非中止类合成错误）与变异 B（把期望 target host 改错）**均 exit 1**，证明容错未退化为「忽略任何错误」 |
| `85e54740` | **P3**：修正 `b1d38714` 抽出谓词后失效的 3 处 `frontend.go:` 注释行号（`server_test.go:166`、`frontend_exposure_test.go:109`/`:125` → `108-110`）；另 9 处经逐条核对**当前正确**未改（含 `server_test.go:186` 的 `76-79`，与主代理任务书中的假设不同）                                                                                                                                       |

**实测（B17，cwd=`backend`）**：`go test ./internal/infra/egress/ -count=1` **3/3 exit 0**；`-run TestPinnedHTTPSClientSOCKS5HReceivesPinnedIP -count=5` **5/5 PASS**；`go test ./... -count=1` **exit 0**（89 s）；`go build` / `go vet` / `structurecheck`（REV-3 **5537**）/ `apicheck`（2062/2062，基线未改）/ `go test ./internal/transport/http/` 均 exit 0。

### 34.5 交付批次登记补齐：dockerfilecheck 的 CI 接线与 tip 自称更正（W4-2）

- **`dockerfilecheck` 的 CI 接线（BE-28 尾项，P2）**：`backend/tools/dockerfilecheck`（提交 `0c23f902`）已接入本地门禁 `backend/scripts/verify.sh:65`；**CI 侧**：本 tip `5625a857` 上 `.github/workflows/ghcr-image.yml` 的 step `Verify backend structure and API contract`（`:119-125`：`set -euo pipefail` + `go run ./tools/structurecheck` + `go run ./tools/apicheck`）**尚未包含**它——全仓 `.github/workflows` 内 `dockerfilecheck` **0 命中**（复现：`git grep -n dockerfilecheck -- .github/workflows` → exit 1，本轮实测）。本发布批次把该工具并入上述同一 step（本工作树不含该提交）；**状态：`已登记`（接线随批次落地）**，**CI 真实执行证据待目标提交的 run 回填 = `Blocked`**：回填内容为 run id + step 名 + conclusion + 该步中 `dockerfilecheck` 行的关键输出，**回填前不得记为 `Passed`**（EVID-1/EVID-2）。本地通路证据引用 §34.3：`bash scripts/verify.sh` 中该步输出「必需文件 **900** 个、未被 COPY 覆盖 0、被忽略规则排除 0」。
- **tip 自称更正（EVID-8，只加指针，不改历史章节）**：§32 的「本文件写入时 HEAD `580fd9e7`」（`:1423`）与 §34.3 的「最终 tip `77d4aa65`」（本 tip `:1592`）都是**写作当时**的工作树自称，不是交付线 tip；交付线 `maint/release-v0-1-3` 实际 tip = `5625a857`，其后 `7764e002`（`backend/AUDIT.md` +9 / `frontend/AUDIT.md` +11）与 `5625a857`（`frontend/AUDIT.md` +21）为**纯文档提交（AUDIT 登记）**，代码与配置逐字未变（复现：`git show --numstat 7764e002 5625a857`，本轮实测；两提交的 `git show --name-only` 只含 `backend/AUDIT.md` 与 `frontend/AUDIT.md`）。

## 35. 证据更正与 CI 取证更正（2026-10-12，tip `5625a857`）

> 分支 `maint/acceptance-audit-20261012-audit-evidence-correction`（基点 = 交付 tip `5625a857`，本节只改本文件）。按 META-3 / EVID-8 只追加：§1–§34 的既有文本与数字**不改写**（§33.3 的两行陈旧状态只加指针，见 §35.6）。标注「本节实跑」的命令在本工作树执行，附命令原文、退出码与关键输出（EVID-2）；标注「引用本轮实测」的数字来自本轮会话记录，**本节未复跑**（原因逐条写明，EVID-1）。

### 35.1 F1（EVID-8 更正）：CI 探针 `bc0bfc52` 不等于 `c250eb75` 的内容

| 项 | 内容 |
| --- | --- |
| 原值（更正前登记） | `bc0bfc52` 的内容等于 `c250eb75`，即探针提交未引入任何差异。 |
| 新值（本节实跑） | `bc0bfc52` 是 `c250eb75` 的**直接子提交（+1 提交）**，标题 `chore(ci-probe): 以 origin/main 工作流定义验证装配后的交付线`；二者差异**仅在 3 个 workflow 文件**：`.github/workflows/codeql.yml`、`.github/workflows/ghcr-image.yml`、`.github/workflows/stale.yml`，合计 `3 files changed, 21 insertions(+), 4 deletions(-)`。 |
| 根因 | 该探针提交自述「本机凭据缺工作流作用域，带工作流改动的推送会被拒」，故刻意保留 `origin/main` 的工作流定义，使探针分支可被推送。 |
| 复现（本节实跑） | `git diff --stat bc0bfc52 c250eb75` → **exit 0**，只列上述 3 个 workflow 文件；`git merge-base --is-ancestor c250eb75 bc0bfc52` → **exit 0**；`git log --oneline -2 bc0bfc52` 第 1 行 `bc0bfc52 chore(ci-probe): …`、第 2 行 `c250eb75 Merge branch 'maint/acceptance-audit-20261012-review-fixes' into maint/acceptance-audit-20261012-final`。 |

```
$ git diff --stat bc0bfc52 c250eb75
 .github/workflows/codeql.yml     |  6 +++---
 .github/workflows/ghcr-image.yml | 17 +++++++++++++++++
 .github/workflows/stale.yml      |  2 +-
 3 files changed, 21 insertions(+), 4 deletions(-)
exit=0
```

### 35.2 F2（未收口项）：交付线新增的两条 CI step 零 run 证据

| step 名 | 位置与执行内容 |
| --- | --- |
| `Verify backend structure and API contract` | `.github/workflows/ghcr-image.yml`，`working-directory: backend`，`set -euo pipefail` 后依次 `go run ./tools/structurecheck`、`go run ./tools/apicheck` |
| `Assert required frontend tests ran` | 同文件，`working-directory: frontend`，`run: pnpm test:results:e2e` |

两条 step 在交付线 tip `5625a857` 的 `.github/workflows/ghcr-image.yml` 中**确实存在**（本节实跑：`git show HEAD:.github/workflows/ghcr-image.yml` 命中两行 `- name:`），但在**所有曾被推送的 sha** 上**均不存在** ⇒ 运行证据为零。复现命令（对 7 个 sha 逐个执行 `git show <sha>:.github/workflows/ghcr-image.yml` 后按两条 step 名精确匹配）：

```
$ for sha in 1a510f5d b59e5ff6 3714cd39 bc0bfc52 542c8084 61f8f0a3 547956eb:
    git show <sha>:.github/workflows/ghcr-image.yml | Select-String -SimpleMatch "<step 名>"
1a510f5d : structure-step=0 ; frontend-step=0     # 1a510f5d = origin/main
b59e5ff6 : structure-step=0 ; frontend-step=0
3714cd39 : structure-step=0 ; frontend-step=0
bc0bfc52 : structure-step=0 ; frontend-step=0
542c8084 : structure-step=0 ; frontend-step=0
61f8f0a3 : structure-step=0 ; frontend-step=0
547956eb : structure-step=0 ; frontend-step=0
exit=0
```

**7/7 零命中（两条 step 各 7 个 sha 全部 0 命中；本节实跑复核）。** 探针 run `38214762730` 的 `Verify` job step 清单已**逐条核对**（本节实跑，GitHub 公共 REST API，见 §35.4 的取证方式）⇒ **25 个 step 中不含这两条**：

```
$ (REST) GET /repos/JasmineTony/grok2api/actions/runs/38214762730/jobs
JOB: Verify | success | steps=25
   - Set up job / Initialize containers / Checkout / Set up Go
   - Verify version carriers are aligned / Test backend
   - Assert required integration tests ran          <- 只有后端这条
   - Race backend / Vet backend / Verify Swagger document / Upload backend test report
   - Set up pnpm / Set up Node.js / Install frontend dependencies / Verify frontend
   - Install Playwright browser / Run full-stack E2E
   - Upload Playwright artifacts / Upload frontend coverage
   - Post Set up Node.js / Post Set up pnpm / Post Set up Go / Post Checkout
   - Stop containers / Complete job
（无 `Verify backend structure and API contract`，无 `Assert required frontend tests ran`）
```

**结论**：这两条 step 的运行证据为零，按 §6 / EVID-1 记 `Pending`，**不得记 `Passed`**；其门禁语义（后端结构+契约、前端测试报告存在性）在交付线上**尚未由任何真实 run 覆盖**。

### 35.3 F3（发布阻塞根因）：推送交付线被凭据拒绝

| 项 | 内容 |
| --- | --- |
| 命令原文（2026-10-12） | `git push origin maint/acceptance-audit-20261012-final:refs/heads/ci-probe/acceptance-audit-20261012-r2` |
| 结果 | **exit 1**，远端返回 `! [remote rejected] … (refusing to allow an OAuth App to create or update workflow .github/workflows/codeql.yml without 'workflow' scope)` |
| 影响 | 交付线相对 `origin/main` 含 3 个 workflow 文件改动（见 §35.1）⇒ **合并 main / 打 tag / Release 全部被该凭据能力阻塞**；阻塞根因是**凭据缺工作流作用域**，而非缺授权。 |
| 复现（本节实跑） | `git remote -v` → `origin https://github.com/JasmineTony/grok2api.git (fetch/push)`、`upstream https://github.com/chenyme/grok2api.git`。 |

- **本节未复跑该 push**（远端写操作，不属本次文档更正的授权范围）；上表命令与远端原文为**本轮实测**记录，按 EVID-1 记 `Failed`（命令实际执行且退出码非 0）。
- **未验证**：换用带 `workflow` scope 的凭据后能否推送成功——该结论需一次真实推送，未执行。

### 35.4 F4（EVID-9 取证更正）：`origin/main` = `1a510f5d` 的 CI 全绿

`gh run` 在本机不可用；证据经 GitHub 公共 REST API 取得（本节实跑 `Invoke-RestMethod`，头 `User-Agent` + `Accept: application/vnd.github+json`）：

```
$ git rev-parse origin/main
1a510f5d31ac5f268a6cb53af3afd9121b713d35

$ (REST) GET /repos/JasmineTony/grok2api/actions/runs?branch=main&per_page=5
38219598125 Close inactive issues and PRs | 1a510f5d | success
38200420879 CodeQL Advanced              | 1a510f5d | success
38121078196 CodeQL Advanced              | 1a510f5d | success
38121078190 GHCR Image                   | 1a510f5d | success
38110961679 CodeQL Advanced              | 0688e1a1 | success

$ (REST) GET /repos/JasmineTony/grok2api/commits/1a510f5d/check-runs
check-runs total = 12
Mark and close inactive issues and PRs | completed | success
Analyze (actions)                      | completed | success
Analyze (javascript-typescript)        | completed | success
Analyze (go)                           | completed | success
Merge image                            | completed | success
Build image (${{ matrix.arch }})       | completed | skipped   <- 矩阵占位 check-run，非失败
Publish image (arm64)                  | completed | success
Publish image (amd64)                  | completed | success
Verify                                 | completed | success
（另有 Analyze 三项重复条目，均为 completed | success）
exit=0
```

- **口径更正（本节实测，EVID-8）**：`commits/1a510f5d/check-runs` 的 12 项**不是**「12 项全部 completed/success」——实测为 **11 项 completed/success + 1 项 `Build image (${{ matrix.arch }})` = completed / `skipped`**（矩阵展开占位 check-run，非失败；同 run 的实际构建由 `Publish image (amd64)` / `Publish image (arm64)` / `Merge image` 的 success 覆盖）。除该 `skipped` 项外**无任何 failure / cancelled**。
- **结论**：用户此前投诉的「当前 main 分支 CI 有报错」在**当前 `origin/main`(`1a510f5d`) 上不成立**；本地 `main`(`13626e6c`) 比 `origin/main` 多 **11** 个未推送提交（本节实跑 `git rev-list --count origin/main..main` → `11`），这 11 个提交**尚未取得任何 CI 证据**（EVID-9：`1a510f5d` 全绿不等于交付线已验证）。

### 35.5 F5（本轮本地复跑证据 @ `c250eb75` 工作树）

**引用本轮实测（本节未复跑；数字与退出码来自本轮会话记录，工作树 = `c250eb75`）**：

| 命令 | 退出码 | 关键输出 |
| --- | --- | --- |
| `pnpm check:structure` | 0 | 扫描源码文件 **405** 个；超限文件 0 / 超限函数 0 / 超限嵌套 0；参与判定的作用域（REV-3）**2527** 个 |
| `pnpm test:gates` | 0 | 门禁自测通过 **85** 个用例（含 68 个必须失败） |
| `pnpm check:budget` | 0 | 首屏关键 JS 闭包 **3** 文件 **194.05 KiB**；全部生产 JS **76** 文件 **624.82 KiB**；全部生产 CSS **1** 文件 **16.65 KiB**；最大 chunk **458.55 KiB** 原始；路由入口 **13** 个 |
| `pnpm typecheck` | 0 | — |
| `pnpm format:check` | 0 | `All matched files use Prettier code style!` |

**提交数口径更正（本节实跑复核，EVID-8）**：交付线 `maint/acceptance-audit-20261012-final`(`5625a857`) 的提交数

```
$ git rev-list --count 0c23f902..5625a857    -> 62    # 相对基点 0c23f902
$ git rev-list --count origin/main..5625a857 -> 115   # 相对 origin/main(1a510f5d)
$ git rev-list --count 13626e6c..5625a857    -> 104   # 相对本地 main(13626e6c)
exit=0
```

### 35.6 F6（文档滞后指针）：§33.3 的「尚未并入」已过时

- §33.3 表内 **F1**/**F5** 两行写「**待并入** … `exit 1` ⇒ 尚未并入」（原实测对象为分支名 `maint/acceptance-audit-20261012-static-guard-testable`），该状态**已过时**：`b1d38714` 与 `0f0be18d` 经合并 `e4e3dec7` **均已并入交付线**。
- 本节实跑（tip `5625a857`）：

```
$ git merge-base --is-ancestor b1d38714 HEAD
exit=0
$ git merge-base --is-ancestor 0f0be18d HEAD
exit=0
$ git merge-base --is-ancestor e4e3dec7 HEAD
exit=0
```

- 处理：**只在 §33.3 表后追加一行指针**（「更正（2026-10-12，tip `5625a857`）」），**未删除、未改写原句**（META-3 / EVID-8：历史快照保留原值，只加指针）。

### 35.7 F7（GAP-5 未登记提交）：`f67e3aa7`、`5377e113`

来源：**计划完成度核对清单 GAP-5**（两个 AUDIT 中检索这两个 sha 均 0 命中）。本节实跑 `git log -1 --format="%h %ad %s%n%b" --date=short <sha>`（exit 0）：

| sha | 类型 | 标题与用途（据提交信息如实概括） |
| --- | --- | --- |
| `f67e3aa7` | 修复（2026-10-12） | `fix(frontend): 限制 TEST_REPORT_ROOT 到系统临时目录（关闭 F4 门禁重定向逃生口）`——原实现中 `TEST_REPORT_ROOT` 无条件生效，任何可见的 CI/包装层 env 改动都能把报告门禁指向伪造的健康报告并拿到 exit 0；改为只允许指向 `os.tmpdir()` 之下（realpath 归一后判定），越界时打印原因并以 **exit 2** 拒绝（不忽略、不降级）。提交自述验证：正常路径 `node scripts/check-test-results.mjs` → exit 0（123 文件 / 1488 用例）；非 tmp 伪造报告 → exit 2（修复前 exit 0）；tmp 内报告 → exit 0（自测装置未破坏，46 用例全绿）；`../` 穿越、同名前缀兄弟目录、tmp 内 junction 全部 exit 2。提交自述**未覆盖**：未新增自测用例固化「非 tmp 拒绝」；残余面——能在 CI/包装层写 tmp 的仍可放伪造报告。 |
| `5377e113` | 合并（2026-10-12） | `Merge branch 'maint/acceptance-audit-20261012-node-test-gate' into maint/acceptance-audit-20261012-final`——把 `node-test-gate` 分支并入交付线（无独立正文）。 |

- **未验证**：上表 `f67e3aa7` 的验证数字与未覆盖项均**引自该提交信息**，本节未复跑（不属本次文档更正范围）。

### 35.8 本节未执行 / 未验证（如实登记）

- **未复跑** F5 的 5 条前端门禁命令（`pnpm check:structure` / `pnpm test:gates` / `pnpm check:budget` / `pnpm typecheck` / `pnpm format:check`）：其数字与退出码为本轮实测记录，本节按 EVID-2 引用并标注来源，**不记为「本节 Passed」**。
- **未复跑** F3 的 push（远端写操作）；**未验证**换用带 `workflow` scope 的凭据后能否推送。
- **未执行**：`bash scripts/verify.sh`、`go test ./... -count=1`、`-race`、隔离 PG/Redis、Swagger 精确 diff、全栈 E2E —— 本节为纯文档更正，未触碰代码。
- **未修改**：除本文件外未改动任何文件；未 commit、未 push。

## 36. 2026-10-12（续）推送凭据元数据清除与 `v0.1.1` 重发（后端与发布侧登记）

本节与 `frontend/AUDIT.md` §38 同批，登记后端与发布相关项；授权本体见 `AGENTS.md` §1「授权登记」末条，凭据元数据禁令见 `AGENTS.md` §13 的 SEC-1。

### 36.1 与 §20.13 / §35.3 / §35.8 的关系（append-only）

- §35.3 的 `Failed` 结论与 §35.8 的「F3 未复跑、换用凭据后能否推送未验证」**保留原值**（META-3 / EVID-8）；本轮按 §8 的绑定事实逐次实测，通道结论与复现登记在 `frontend/AUDIT.md` §37.4，不在本节回改历史结论。
- 按本轮口径收敛凭据描述：§35.3 的复现行只保留 `git remote -v`（移除本地凭据助手配置查询半句）；§20.13 与 §11 的授权叙述改为「具备相应包权限的凭据」。

### 36.2 `v0.1.3` 未登记事实（与 `frontend/AUDIT.md` §38.3 同源）

- **事实**：发布授权 `v0.1.3` 此前**未在任何 AUDIT 中登记**——本节写入时点，`v0.1.3` 在本文件中的出现次数**为 0**。复现：`rg -c "v0\.1\.3" backend/AUDIT.md frontend/AUDIT.md`（两文件均无匹配；唯一登记处是 `AGENTS.md` §1 的两条授权条目）。
- 本文件按 META-3 / EVID-8 **不回改**历史章节；发布证据在回填时登记于本节 §36.3 与 `frontend/AUDIT.md` §38.4。

### 36.3 待补登记项（发布完成后回填）

| 登记项 | 值 |
| --- | --- |
| 文档清除提交 sha（`AGENTS.md` / `frontend/AUDIT.md` / `backend/AUDIT.md`） | `eaae5090`、`706d0645`（收口轮消息过滤后的 sha；收口登记提交见 `frontend/AUDIT.md` §38.6） |
| 重写后 `main` tip sha（后端门禁复跑基准） | `b2a68314`（收口轮消息过滤后 tip；登记提交在其之上） |
 | 目标提交上 `bash scripts/verify.sh`（`go build` / `go vet` / `structurecheck` / `apicheck` / `dockerfilecheck` / `go test -count=1`） | 待补（在最终发布目标提交上复跑后回填） |
| CI run id 与 `Assert required integration tests ran`（0 跳过）step 的 conclusion | 待补 |
| 镜像 digest（含 `merge` 后的 manifest list） | 待补 |

### 36.4 未收口项与残留风险

- GitHub 侧提交缓存/搜索索引、已克隆副本与 CI 日志无法保证清除（与 `frontend/AUDIT.md` §38.5 同口径）；本轮不得声称凭据元数据已彻底清除。
 - 历史重写后，本文件与 `frontend/AUDIT.md` 中引用的历史 sha（`5625a857`、`04a3a5c9` 等）在新的提交图上失效；**sha 映射已登记**于 §36.3 与 `frontend/AUDIT.md` §38.6（旧 `04a3a5c9` → 新 `37fd2dda`，旧远端 tip `4358867f` → 新 `45dd2447`）；旧对象已从本地对象库清除。
- 本节未执行：`bash scripts/verify.sh`、`go test ./... -count=1`、`-race`、隔离 PG/Redis、Swagger 精确 diff、全栈 E2E（纯文档改动）；发布前置在重发目标提交上按 §8 逐项执行。

## 37. 2026-10-12（收口执行轮）远端重建与 `v0.1.1` 重发：后端与镜像证据

**授权与边界**：见 `AGENTS.md` §1「2026-10-12 维护线负责人授权（执行轮）」；凭据元数据按 SEC-1 不登记。

**发布前置门禁（最终 tip `00120cea`）**：`cd backend; bash scripts/verify.sh` → **exit 0**，6/6 步通过，103.6s。

- `go build ./...` 10.5s / `go vet ./...` 3.7s / `go run ./tools/structurecheck` 1.4s / `go run ./tools/apicheck` 1.8s / `go run ./tools/dockerfilecheck` 1.5s / `go test ./... -count=1` 83.7s（78 个包 `ok`，11 个 `[no test files]`，无 FAIL/panic）。
- structurecheck：`扫描生产 Go 文件：483 个`、`参与判定的作用域（REV-3）：5537 个（0 越限时据此判断不是漏报）`；超限文件 / 超限函数 / 越限嵌套 当前 0、基线 0。
- apicheck：`基线条目 2062 条，当前 2062 条。`、`导出 API 面与基线逐条一致。`
- dockerfilecheck：`参与判定：必需文件 900 个（未被 COPY 覆盖 0，被忽略规则排除 0）；COPY 源不可用 0`。
- 口径说明：`verify.sh` 不含 `-race` 与隔离 PG/Redis 的「0 跳过」断言；二者由 CI 的 `Race backend` 与 `Assert required integration tests ran` 步骤承担，见下。

**CI（tag `v0.1.1`）**：`GHCR Image` run `38267217186`（event=push，ref=`v0.1.1`）**conclusion=success**。后端相关 step 全部 success：`Verify version carriers are aligned`、`Test backend`、`Assert required integration tests ran`（0 跳过断言）、`Race backend`、`Vet backend`、`Verify backend structure and API contract`、`Verify Dockerfile covers required inputs`、`Verify Swagger document`；前端与 E2E step（`Verify frontend`、`Run full-stack E2E`、`Assert required frontend tests ran`）同为 success。

**镜像证据**：`ghcr.io/jasminetony/grok2api:v0.1.1` = `sha256:e0a2f395423afdcb097e1c5646cf4756e90cb3ca2ce68c1d4dbecec62d7e0f06`（`application/vnd.oci.image.index.v1+json`）；linux/amd64 = `sha256:7453a6efc7fdabb371dd4959bbc026103b535304266b58944f1bf3659426698a`、linux/arm64 = `sha256:1d040f5998fe5ce14a3712cea385620e70f723a3cf492c10970d20e3cb9f858f`；`v0.1.1-amd64` = `sha256:5f953a5c…`、`v0.1.1-arm64` = `sha256:a8fc0b44…`。容器包新实例 id `15829871`，`repository=JasmineTony/grok2api`（已正确链接）。

**main 线镜像**：run `38270633539`（event=push，ref=`main`）**conclusion=success**；`ghcr.io/jasminetony/grok2api:main` = `application/vnd.oci.image.index.v1+json`（linux/amd64 `sha256:ca0dd2b564f3069d80a634ac002d194cd23f5a518d0e5101b2e1ac68d2934a73`、linux/arm64 `sha256:7de323904fadfa218960baa8fd362e90528d1dd140ef8148688a85c1a13225d2`），`latest` 同源。**未收口项**：`gpgsig` 剥离只影响本地上游提交对象（tree/parent/author/message 未变），上游 tag 从不推送；历史重写后的 sha 映射与完整证据见 `frontend/AUDIT.md` §39；按 §8 固有局限，本条登记提交自身的 run 不在本文件覆盖范围内。

# backend/scripts

## verify.sh — 后端本地验收单一入口

一条命令完成后端全部本地必需检查，替代逐条手敲 `go build` / `go vet` / 结构门禁 / API 契约 / 全量测试。
对应 `AGENTS.md` §7 验证入口的 backend 部分，是 `AGENTS.md` §TEST-6 与 REV-1 / REV-2 / REV-3 的可执行入口。

```bash
cd backend
bash scripts/verify.sh
```

### 依赖

| 项 | 要求 |
| --- | --- |
| Go | 1.26（`backend/go.mod` 声明 `go 1.26`；工具链版本不符时 `go build` 自身报错） |
| Shell | POSIX bash（Linux CI 与 Git Bash 均可）；脚本使用 `set -euo pipefail` |
| 工作目录 | **必须是 `backend/`**：`structurecheck` / `apicheck` 的扫描根与基线路径默认相对当前目录，脚本在缺少 `go.mod` 时以退出码 2 直接报错，不会误扫其它目录 |
| 模块依赖 | 首次运行前需已具备 `go.mod` 依赖（`go mod download`）；`tools/` 下两个门禁只用标准库，不引入额外依赖 |
| 系统时间源 | 优先 GNU `date +%s%N`；缺少 `%N` 的平台退化为秒级精度，不影响判定结果 |

### 步骤（按顺序，失败即停）

| # | 命令 | 覆盖的门禁 | 失败含义 |
| --- | --- | --- | --- |
| 1 | `go build ./...` | §TEST-6 | 编译不通过 |
| 2 | `go vet ./...` | §TEST-6 | 静态检查报告可疑代码 |
| 3 | `go run ./tools/structurecheck` | REV-1 单文件 ≤600 行、REV-2 函数 ≤50 行、REV-3 控制流嵌套 ≤3 层 | 相对基线 `backend/structure-baseline.json` 出现新增或恶化项 |
| 4 | `go run ./tools/apicheck` | 导出 API 面契约（重构不得改变公共签名） | 相对基线 `backend/api-baseline.txt` 出现差异 |
| 5 | `go test ./... -count=1` | §TEST-6 | 任一测试失败（注意下表「本机不覆盖」的跳过用例） |

每步先打印一行 `==> <命令>` 标题，结束后打印该步耗时；全部通过时打印总耗时。

### 退出码

- `0`：五步全部通过。
- 非 `0`：失败步骤自身的退出码，脚本立即停止、不执行后续步骤。两个门禁工具的约定是 `1` = 与基线不一致、`2` = 参数 / 基线缺失 / 扫描失败。
- `2`：未从 `backend/` 目录执行（脚本自检）。

### 本机不能覆盖、必须由 CI 承担的项

CI 侧统一位于 `.github/workflows/ghcr-image.yml` 的 `Verify` job；下表只引用**步骤名**（行号随工作流演进漂移，不作为契约）。

| 项 | 原因与 CI 步骤 |
| --- | --- |
| `go test -race ./...` | **本机可执行**（2026-10-13 实测：`CGO_ENABLED=1`、`gcc` 16.2.0 在 PATH，`go test -race ./... -count=1` **exit 0**，562.7s；竞态检测器另用故意竞争探针验证确实生效）。CI 步骤 `Race backend` 仍作为独立环境复核保留。**注意**：本机该命令对 17 个 Postgres + 2 个 Redis 集成用例是 `SKIP`（缺 `TEST_POSTGRES_*` / `TEST_REDIS_*`），故本地 `-race` 通过**不覆盖**这些用例。 |
| PostgreSQL 集成用例 | 需要 `TEST_POSTGRES_DSN`，CI 另用 `TEST_POSTGRES_ADMIN_DSN` 建临时库。未配置时用例 `t.Skip`（`backend/internal/infra/persistence/relational/postgres_integration_test.go`），因此本地绿色**不代表**这些用例通过。 |
| Redis 集成用例 | 需要 `TEST_REDIS_ADDRESS`，可选 `TEST_REDIS_DATABASE` / `TEST_REDIS_USERNAME` / `TEST_REDIS_PASSWORD`（`backend/internal/infra/runtime/redis/store_integration_test.go`）。未配置即跳过，同样不代表通过。 |
| 「必需集成用例被跳过」断言 | CI 步骤 `Assert required integration tests ran` 把白名单包内任何 skip 判为失败，本脚本不做该断言。 |
| Swagger 精确 diff | `make swagger` 会重写 `backend/docs/**`（写文件），不属本脚本范围。CI 步骤 `Verify Swagger document`。 |
| 前端 `pnpm verify` / 全栈 E2E | 属前端入口（`frontend/` 的 `pnpm verify`、`pnpm verify:full`），不在后端脚本范围。 |

CI 的 `Test backend` / `Vet backend` / `Verify backend structure and API contract` 步骤是本脚本步骤 1–5 的子集；本脚本用于每轮改造的本地快速验收，**不能替代 CI**。

### 副作用

脚本只执行 `go build`（`go build ./...` 不产出仓库内可执行文件）、`go vet`、`go run`、`go test`，只写入 `GOCACHE` 等 Go 缓存目录，不写任何仓库文件，可重复执行。

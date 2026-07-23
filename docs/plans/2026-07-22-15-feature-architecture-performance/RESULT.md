# 第 15 轮迭代结果：Feature 架构拆分、按需加载与性能收敛

- 完成日期：2026-07-23（本地实现与验收阶段）
- 状态：完成
- 基线：`777a4c72a39174b681127ae3f6d94aac278d70b6`
- 工作分支：`codex/feature-architecture-performance`
- 实现分支最终提交：`8cfbc566e6e5acd0996dccc78f852781a478faa6`
- Pull Request：#34 `refactor: complete frontend feature architecture and performance convergence`（Squash 合并）
- `main` 合并提交：`9cfe0953569f249212a3ad17e7f6b2171cdf108e`

## 已交付

### 页面与组件边界

- 账户页拆为 `use-accounts-page-controller.ts`、`accounts-data-table.tsx`、精简 `accounts-page.tsx`/`accounts-workspace.tsx`，保留筛选、排序、批量操作、导入导出、设备授权、配额、Egress、SSE 与状态事件行为。
- 客户端密钥页拆为 controller、展示组件、Dialog 组件和路由包装；移除页面侧任意金额上限，保留服务端错误与通用数值校验。
- 设置页按 Provider、策略、布局基础组件拆分；保留 React Hook Form、推荐 Build 同步、保存/重置与配置键语义。
- 第 14 轮完成的创作控制台、API 文档、请求审计、模型和视频库拆分继续保留。
- 当前所有 `*-page.tsx`、`*-workspace.tsx`、`*-container.tsx` 均不超过 500 行，最大为 490 行。

### 性能与交互

- 延迟路由增加 hover/focus 预取与空闲预取；懒加载失败仍交给路由错误边界处理。
- Dashboard 图表仅在数据可用且进入可视区域或空闲时加载；加载骨架为固定多区高度，避免图表模块替换造成布局跳动。
- Dashboard Top Models、用量治理面板保留固定最小高度；稳定骨架后 Chrome DevTools MCP 采样 CLS 从本轮首次采样的 `0.10` 降至 `0.00`。
- Auth Context 拆分状态与命令订阅；AppShell 密码修改 Dialog 独立组件化，保留错误处理、重置和重新登录语义。
- Tabs 指示器统一使用 requestAnimationFrame 合并 Mutation/Resize/窗口更新；账户 Provider Tabs 补齐关联内容节点，修复移动端 ARIA 严重问题。
- 新增延迟渲染 hook、可取消空闲任务和对应单元测试；新增模型 Dialog 跨 Chromium/Firefox/WebKit 生命周期回归。

### 质量门禁

- 删除第 14 轮架构与代码审计冻结基线；`audit:architecture`、`audit:code` 均达到零冻结项。
- 保留现代 ESLint flat config、Prettier、Knip、重复代码审计和 import 排序；清理未使用认证兼容导出及跨 Fast Refresh 边界的工具函数。
- 未引入全局可变业务状态、直接 `fetch`/`localStorage`、危险执行 API、显式 `any` 或新的跨层依赖。

## 提交记录

| 提交                 | 内容                                                     |
| -------------------- | -------------------------------------------------------- |
| `2ebc17f`            | 第 15 轮计划与索引起始记录                               |
| `e256876`            | 创作控制台、媒体展示基础拆分                             |
| `6f39cae`            | 请求审计展示拆分                                         |
| `a1e7524`            | 模型 controller/view 拆分                                |
| `9e7f34c`            | 客户端密钥 controller/view/Dialog 拆分                   |
| `4782076`            | 账户 controller 与数据表拆分                             |
| `40e1008`            | 设置分区拆分并清零审计基线                               |
| `bffcc00`            | 路由预取、Dashboard 图表延迟加载、Auth/AppShell 性能基础 |
| `b7b8872`            | 延迟渲染可见性单元测试                                   |
| `d477cfa`            | Fast Refresh、未使用导出与工具函数边界修复               |
| `4af659b`            | Provider Tabs ARIA 关联内容修复                          |
| `207c36c`、`bf9ed49` | Dashboard 固定布局骨架与 CSS 包体预算收敛                |
| `46c27c9`            | 模型 Dialog 跨浏览器生命周期回归                         |

## 验证结果

| 检查                             | 结果     | 说明                                                                                                                                     |
| -------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile` | 通过     | pnpm 11.15.1，锁文件无变化。                                                                                                             |
| `pnpm audit --audit-level high`  | 通过     | 未发现已知高危漏洞。                                                                                                                     |
| `pnpm verify`                    | 通过     | 13 个单元测试文件、35 个测试通过；format/typecheck/lint/coverage/build/profile/bundle/chunk/Knip/architecture/code/duplicates 全部通过。 |
| Playwright E2E/axe               | 通过     | 既有 51 项三视口/跨浏览器检查全部通过；新增模型 Dialog 5 项跨浏览器检查全部通过。                                                        |
| Go `go test -p 1 ./...`          | 通过     | 后端全部包通过。                                                                                                                         |
| Go `go vet ./...`                | 通过     | 无报告。                                                                                                                                 |
| govulncheck                      | 通过     | 使用缓存构建的 v1.6.0 扫描；0 个可达漏洞，1 个不可达依赖漏洞已由工具明确标记。                                                           |
| Swagger                          | 通过     | 使用 swag v1.16.6 重新生成，`docs.go`、JSON、YAML 无漂移。                                                                               |
| actionlint                       | 通过     | 本地使用缓存的 v1.7.12 校验 workflow；CI 仍固定使用计划中的 v1.7.7。                                                                     |
| Gitleaks                         | 通过     | 对 Git 跟踪文件快照按 `.gitleaks.toml` 扫描，无泄露；扫描未包含 `.cache` 临时产物。                                                      |
| Markdown/UTF-8/敏感信息/冲突标记 | 通过     | 689 个跟踪文件检查通过。                                                                                                                 |
| Docker/Compose 本地检查          | 环境限制 | 本机未安装 Docker；由 GitHub Actions 的容器配置、amd64/arm64 构建门禁验收。                                                              |
| 后端 race                        | 环境限制 | 本机无 gcc，`CGO_ENABLED=1` 后无法启动 race 构建；Linux CI 的 PostgreSQL race job 仍为正式依据。                                         |

## 性能采样摘要

使用官方 `chrome-devtools-mcp@1.6.0`、isolated/headless、脱敏网络头、memory debugging：

| 页面      | 采样条件                        |     LCP | TTFB |  CLS | Console                            |
| --------- | ------------------------------- | ------: | ---: | ---: | ---------------------------------- |
| 登录      | 本地 Vite，无 API mock          |  709 ms | 8 ms | 0.00 | 1 个预期 refresh 502（后端未启动） |
| Dashboard | 本地 Vite + 仅本地临时 API mock | 2122 ms | 6 ms | 0.00 | 无错误                             |
| 模型路由  | 本地 Vite + 仅本地临时 API mock | 1707 ms | 6 ms | 0.00 | 无错误                             |

- Dashboard 首次使用较窄骨架时 CLS 为 `0.10`；扩大为趋势/模型/治理三段固定高度后复测为 `0.00`。
- 生产构建：入口约 `232.47 kB raw / 74.21 kB gzip`，Dashboard 图表块约 `339.25 kB raw / 91.58 kB gzip`，CSS `89.90 kB raw / 15.70 kB gzip`；71 个 JavaScript chunks，依赖图无环。
- 仅记录聚合指标；原始 Trace、堆快照、网络明细、截图、Cookie、Authorization 和请求正文均仅保存在 `.cache`，未纳入 Git。
- Chrome DevTools MCP 对模型路由完成加载级采样；模型 Dialog 的打开/销毁由 5 项 Playwright 跨浏览器回归覆盖，未把原始交互 Trace 纳入仓库。

## 假设与默认值验证

| 假设/默认值                                                   | 结果 | 证据                                                         |
| ------------------------------------------------------------- | ---- | ------------------------------------------------------------ |
| 不改变公开 API、数据库、配置和发布策略                        | 通过 | 本轮仅修改前端内部边界、测试与文档；后端 Swagger 无漂移。    |
| 不切换 React/Vue、状态库或 React Compiler                     | 通过 | 仍使用 React 19、React Router、TanStack Query 与 Hook Form。 |
| 页面、workspace、container 不超过 500 行                      | 通过 | 架构审计零结果，最大 490 行。                                |
| 不使用全局可变业务状态、直接 fetch/localStorage、危险执行 API | 通过 | `audit:architecture` 零结果。                                |
| 依赖与锁文件不在本轮修改                                      | 通过 | `pnpm install --frozen-lockfile` 无锁文件变化。              |
| 发布策略不变                                                  | 通过 | 未创建版本标签、Release 或 GHCR；普通分支仍只走 Verify。     |

## 偏差、延期项与未解决事项

- 本机无 Docker 和 gcc，容器构建与 race 由 GitHub Actions 的 amd64/arm64、Compose health 和 Linux PostgreSQL race job 验收。
- 本轮没有启用真实用户或生产数据；性能数值是本地实验室样本，不代表 RUM/CrUX。
- Chrome DevTools MCP 没有对真实上游账号执行请求，不采集凭据、Cookie 或请求正文。
- PR #34 的 Backend、race、Frontend、Visual、Firefox/WebKit、Workflow/secret、Container health、CodeQL、amd64/arm64 Docker 检查均已通过，并已于 2026-07-23 Squash 合并。

## 推送门禁证据

- 完整本地验收完成后首次推送分支并创建 PR #34；仅在补记 PR/CI 证据时追加一次文档提交，未推送任何实现中间状态。
- `origin/main` 仍为 `777a4c7`，`git rev-list --left-right --count origin/main...HEAD` 为 `0 14`（在新增 Dialog 测试前为 0 13；当前最终提交包含该测试）。
- 首次推送前已执行 `git fetch origin --prune`，没有发现 `main` 新提交。`CI` run `29982577395` 与 `CodeQL Advanced` run `29982577384` 全绿。
- 未创建版本标签、GitHub Release 或 GHCR 镜像。

## 回滚

- PR 合并前：删除本地分支即可，不影响 `main`。
- PR 合并后：以最终 squash 提交为单位 `git revert`；不涉及数据库迁移回滚。
- 本轮不修改公开 API、配置键、数据库结构或 Go module 路径。

## 最终验收

- [x] 实现符合本地接受范围。
- [x] 本地测试、安全、性能与文档检查完成。
- [x] PR 创建且 GitHub 检查全部通过。
- [x] Squash 合并、远程分支删除与最终 main 同步完成。
- [x] 仓库状态干净且本地 `main` 与远程合并结果一致。

# Iteration result: Dashboard chart spacing fix and 502-vs-upstream diagnosis

- Date completed: 2026-08-16
- Status: Complete
- Base commit: `fde5b41e`
- Final commit: `a68ffda6`
- Pull request: branch `fix/dashboard-chart-spacing-20260816`

## Delivered

1. **仪表盘间距修复**：`DashboardCharts` 原以裸 fragment 返回，`DashboardTopModels`（模型计费 Top 10）与上方趋势图、下方用量治理面板之间无垂直间距（页面外层 `space-y-6` 无法作用于 fragment 子元素，而骨架屏 fallback 自带 `space-y-2`，加载完成瞬间间距消失）。现包裹 `space-y-2` 容器与 fallback 对齐。
2. **502 vs 上游 200 诊断**（代码侧证据 + 部署侧结论，详见 PLAN）：
   - `git diff upstream/main -- backend/internal/infra/provider/cli/` 为空——Build 请求协议栈与上游完全一致，无代码回归；
   - 上游 1.0.4 提交仅改版本常量，UA 格式与本 fork 一致；Build 默认 BaseURL/回退一致；
   - 结论：fork 部署返回 502 由部署侧版本/设置滞后导致（旧 clientVersion 0.2.119 被 xAI 拒绝 → 凭据/请求失败 → 502），处置为升级到本 main 并在运行设置应用推荐 1.0.4（若曾显式保存）。

## Verification results

| Check | Result | Notes |
| --- | --- | --- |
| `prettier --check`（目标文件） | Passed | — |
| `pnpm typecheck` | Passed | — |
| `pnpm test` | Passed | 19 files / 66 tests |
| 浏览器实测 | Passed | TopModels 上/下间距各 8px；父容器 `space-y-2`；前后兄弟为趋势图 grid 与治理 section |

## Deviations from plan

- 无。

## Rollback

单文件 revert 即可。

## Final acceptance

- [x] Implementation matches the accepted scope.
- [x] Checks complete.
- [x] Plan index updated.

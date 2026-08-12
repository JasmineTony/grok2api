# 页面布局优化迭代结果

- Status: Complete
- Date: 2026-08-12
- Base commit: 05daab0 docs: plan page layout optimization
- Implementation commit: `7afd3b1a92eb0e06736167e69a0a2756e23cdbf8`
- Delivery: included in the `v3.6.0` release branch after local acceptance

## Findings

1. 全局内容容器在桌面端的垂直间距和最大宽度不统一，页面之间存在明显的“标题—工具栏—数据区”节奏差异。
2. `ModelsPage` 使用独立的简化标题，缺失共享页面标题的描述层级，导致核心 CRUD 页面与审计、账户页面的视觉结构不一致。
3. `PageToolbar` 在窄屏上仅依赖 `flex-wrap`，筛选器和批量操作可能挤在同一行并产生不可预测换行；数据表本身虽然支持横向滚动，但页面级溢出需要显式隔离。
4. 设置导航在移动端可横向滚动，但路由切换后当前项不一定自动进入可视区域；键盘焦点边界也不够明显。
5. AppShell 导航项触控高度偏小，滚动条出现/消失会改变内容宽度；移动端与桌面端需要共享稳定的导航交互基线。
6. Creative Console 的 flex 子树缺少 `min-w-0`，在模型选择器、面板和错误状态组合下容易把宽度压力传递到页面根节点。
7. Dashboard 头部阴影过重、间距节奏偏紧，信息层级与其他页面不一致。

## Delivered

- 统一 `PageScaffold`：最大内容宽度调整为 1600px，补充 `min-w-0`，在 sm/lg 断点重新平衡水平/垂直内边距。
- 统一 `PageHeader`：增加稳定的底部层级分隔、响应式标题字号，并保留操作区在移动端独立换行。
- 重做 `PageToolbar` 的窄屏排列：移动端改为纵向堆叠，sm 以上恢复横向对齐；增加底部分隔线，降低筛选与批量操作的跳动。
- 为 `DataTableShell`、AppShell、主内容区增加可测试的 `data-layout` 标记，建立布局回归断言。
- AppShell 导航项触控高度提升至 40px，增加 focus-visible ring，导航滚动区域使用 stable scrollbar gutter。
- 设置导航增加 snap 滚动、细滚动条和当前项 `scrollIntoView`，切换路由后自动将活动项居中显示；导航链接增加边框和键盘焦点反馈。
- Models 页面改用共享 `PageHeader`，与 Accounts/Request Audits/Creative Console 等核心页面保持统一标题层级。
- Creative Console 的关键 flex 容器补充 `min-w-0`，避免窄屏模型选择器和面板导致根页面横向溢出。
- Dashboard 调整页面纵向节奏和首屏卡片阴影，减少视觉噪声。
- 新增移动端共享布局 E2E 断言：检查 shell、主内容、scaffold、page header、data table shell 标记；确认表格局部横向滚动但页面根节点不溢出。

## Verification

- `cmd /d /c node_modules\\.bin\\prettier.cmd --check .` ✅
- `cmd /d /c node_modules\\.bin\\tsc.cmd -b` ✅
- `cmd /d /c node_modules\\.bin\\eslint.cmd <changed files> --max-warnings 0` ✅（CSS 文件单独排除，避免 ESLint 忽略警告）
- `cmd /d /c node_modules\\.bin\\vitest.cmd run src/shared/components/foundation.test.tsx src/features/settings/settings-route-shell.test.ts` ✅ 2 files / 11 tests
- `cmd /d /c node_modules\\.bin\\vitest.cmd run --coverage` ✅ 16 files / 47 tests
- `cmd /d /c node_modules\\.bin\\vite.cmd build` ✅
- `node scripts/check-icon-imports.mjs` ✅
- `node scripts/check-ui-symbols.mjs` ✅
- `node scripts/check-bundle-budget.mjs` ✅
- `node scripts/check-chunk-cycles.mjs` ✅
- `node scripts/audit-codebase.mjs` ✅
- `node scripts/audit-architecture.mjs` ✅
- `node scripts/run-knip.mjs` ✅（仅 1 条 `.css` 配置提示）
- `node_modules\\.bin\\jscpd.cmd src --config .jscpd.json` ✅（发现 6 个既有重复片段，低于项目阈值）
- Playwright desktop focus（3 tests）✅：network settings、shared responsive landmarks、runtime settings redirect/navigation；测试命令在断言完成后因 Windows webServer teardown 未自动退出，已手动停止残留进程，不影响断言结果。

## Unresolved

- 尚未在真实 Firefox/WebKit 运行完整跨浏览器矩阵；当前已完成 Chromium desktop project 的重点布局 smoke。
- 未创建或推送 PR；按仓库发布治理，本次只完成本地布局优化和验证，等待茉莉确认后再决定是否创建文档收尾 PR 或发布版本。
- 工作区原有未跟踪 `.claude/`、`.gomodcache/`、`scripts/__pycache__/`、`scripts/tests/__pycache__/` 未触碰、未提交。

## Rollback

- 回滚实现提交即可保留此前 v3.5.6 发布基线；计划文档提交与实现提交分离，便于只撤销布局代码。

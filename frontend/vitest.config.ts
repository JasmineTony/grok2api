import { defineConfig, mergeConfig } from "vitest/config";

import { createViteConfig } from "./vite.config.ts";

// 复用 vite.config.ts 的工厂（plugins / resolve.alias / define）作为唯一来源，
// 避免再维护第二套 "@" -> ./src 别名与构建期常量。
// 测试以 serve 语义解析，保证 __GROK2API_DEV_API_TARGET__ 有确定取值。
const viteConfig = createViteConfig({ command: "serve", mode: "test", isSsrBuild: false, isPreview: false });

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: "jsdom",
      // 并行度与超时口径：交互型用例 + 覆盖率插桩在满载时会把单个用例压到默认超时之上，
      // 属 CPU 饱和/GC 压力，不是逻辑挂起。实测证据（均为本机 8 核、`vitest run --coverage`）：
      //  - 24 文件 / 245 用例：24 worker 18 失败、4 worker 5 失败、1 worker 全过（阶段 5）
      //  - 63 文件 / 682 用例：4 worker 1 个超时；2 worker 全过（阶段 6 早期）
      //  - 155 文件 / 800+ 用例、108 文件 / 1347 用例：满载下 2~3 例超时，逐文件单跑全过
      //  - 阶段 7：`egress-node-actions`（21 用例）与 `egress-operations-extra`（26 用例）
      //    在满载下各有 1–2 例超时；同两个文件单跑分别为 21/21（28.7s）与 26/26（32.2s），
      //    最重用例单跑 wall time 3.5s，其它交互用例 0.5–2.5s
      // 结论：真实挂起会表现为单跑同样超时，而上述用例单跑稳定快速通过，故按实测成本把
      // 单用例上限设为 20s（约等于观测最重用例的 5.7 倍），不用删除用例、放宽断言或无条件重试掩盖失败。
      maxWorkers: 2,
      testTimeout: 20000,
      setupFiles: ["./src/test/setup.ts"],
      // 只接管 *.test.tsx（React 组件测试）；既有 *.test.ts 仍由 `pnpm test` 的 node:test 运行。
      include: ["src/**/*.test.tsx"],
      coverage: {
        provider: "v8",
        reporter: ["text", "lcov"],
        // 覆盖率口径（AGENTS.md TEST-1 / TEST-2）：
        // 阶段 3–5 用「手工维护达标文件清单」，导致未列入的模块（accounts、settings 页面、quality-guard 页面）
        // 长期不可见。阶段 6 起改为「按已重构模块整目录纳入 + 例外逐项登记原因」：
        // 整目录纳入使模块内新增文件自动受门槛约束，例外只用于口径原因（测试分层/barrel/测试支撑），
        // 与 frontend/AUDIT.md 的「未达标登记」一一对应，不静默排除。
        include: [
          "src/app/**",
          "src/features/accounts/**",
          "src/features/audits/**",
          "src/features/client-keys/**",
          "src/features/creative-console/**",
          "src/features/dashboard/**",
          "src/features/docs/**",
          "src/features/media/**",
          "src/features/models/**",
          "src/features/quality-guard/**",
          "src/features/settings/**",
          "src/features/system/**",
          "src/shared/api/**",
          "src/shared/auth/**",
          "src/shared/hooks/**",
          "src/shared/components/virtual-table-body.tsx",
        ],
        exclude: [
          "src/**/*.d.ts",
          // 测试本身不参与业务代码覆盖率
          "src/**/*.test.ts",
          "src/**/*.test.tsx",
          // 测试支撑（fixture / 路由桩），非业务代码
          "src/**/*-test-support.ts",
          "src/**/*-test-support.tsx",
          "src/test/**",
          // 纯逻辑模块：测试位于 node:test 层（同名 `*.test.ts`，由 `pnpm test` 运行；
          // `endpoint-definitions.ts` 由 `api-docs-examples.test.ts` 覆盖），jsdom 覆盖率运行
          // 不统计它们；用例数与断言见 frontend/AUDIT.md「测试分层」。
          "src/features/audits/audit-format.ts",
          "src/features/audits/audit-detail-format.ts",
          "src/features/audits/audit-usage.ts",
          "src/features/dashboard/dashboard-trend-buckets.ts",
          "src/features/dashboard/dashboard-trend-series.ts",
          "src/features/docs/api-docs-examples.ts",
          "src/features/docs/endpoint-definitions.ts",
          // 纯 re-export barrel：无可执行语句，报 0/0/0/0 属统计假象
          "src/features/creative-console/creative-console-api.ts",
        ],
        // 业务 UI 门槛 76%（TEST-1）；自定义 hook 按 TEST-2 单独收紧到 100%。
        // hook 与展示组件必须分离，否则文件级 100% 会把无关渲染分支一并纳入。
        thresholds: {
          lines: 76,
          functions: 76,
          branches: 76,
          statements: 76,
          "src/shared/hooks/use-chart.ts": { lines: 100, functions: 100, branches: 100, statements: 100 },
          "src/features/settings/use-settings.ts": { lines: 100, functions: 100, branches: 100, statements: 100 },
          "src/features/system/use-version-update.ts": { lines: 100, functions: 100, branches: 100, statements: 100 },
          "src/shared/auth/use-auth.ts": { lines: 100, functions: 100, branches: 100, statements: 100 },
          "src/shared/hooks/use-debounced-value.ts": { lines: 100, functions: 100, branches: 100, statements: 100 },
          "src/features/models/use-model-bulk-mutations.ts": {
            lines: 100,
            functions: 100,
            branches: 100,
            statements: 100,
          },
          "src/features/models/use-model-dialogs.ts": { lines: 100, functions: 100, branches: 100, statements: 100 },
          "src/features/models/use-model-form.ts": { lines: 100, functions: 100, branches: 100, statements: 100 },
          "src/features/models/use-model-list.ts": { lines: 100, functions: 100, branches: 100, statements: 100 },
          "src/features/models/use-model-save-mutation.ts": {
            lines: 100,
            functions: 100,
            branches: 100,
            statements: 100,
          },
          "src/features/models/use-model-selection.ts": { lines: 100, functions: 100, branches: 100, statements: 100 },
          // 阶段 7：下列 hook 已实测 statements/branches/functions/lines 全部 100，加入逐文件
          // 门槛锁定，防止回退（AGENTS.md TEST-2）。
          "src/features/quality-guard/use-degrade-accounts.ts": {
            lines: 100,
            functions: 100,
            branches: 100,
            statements: 100,
          },
          "src/features/quality-guard/use-guard-nodes.ts": {
            lines: 100,
            functions: 100,
            branches: 100,
            statements: 100,
          },
          "src/features/quality-guard/use-probe-profiles.ts": {
            lines: 100,
            functions: 100,
            branches: 100,
            statements: 100,
          },
          "src/features/quality-guard/use-guard-node-actions.ts": {
            lines: 100,
            functions: 100,
            branches: 100,
            statements: 100,
          },
          "src/features/creative-console/use-creative-console.ts": {
            lines: 100,
            functions: 100,
            branches: 100,
            statements: 100,
          },
          "src/features/creative-console/use-creative-video.ts": {
            lines: 100,
            functions: 100,
            branches: 100,
            statements: 100,
          },
          "src/features/creative-console/use-creative-voice.ts": {
            lines: 100,
            functions: 100,
            branches: 100,
            statements: 100,
          },
          "src/features/accounts/use-accounts-transfer-flows.ts": {
            lines: 100,
            functions: 100,
            branches: 100,
            statements: 100,
          },
          "src/features/accounts/use-accounts-page-model.ts": {
            lines: 100,
            functions: 100,
            branches: 100,
            statements: 100,
          },
        },
      },
    },
  }),
);

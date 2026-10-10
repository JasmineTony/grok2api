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
      // 并行度与超时口径：交互型用例 + 覆盖率插桩在满载时会把单个用例压到 5s 默认超时之上，
      // 属 CPU 饱和/GC 压力，不是逻辑挂起。实测证据：
      //  - 24 文件 / 245 用例：24 worker 18 失败、4 worker 5 失败、1 worker 全过（阶段 5）
      //  - 63 文件 / 682 用例：4 worker 1 个超时；2 worker 全过（阶段 6 早期）
      //  - 155 文件 / 800+ 用例：2 worker 下 2 个用例超时，同文件单跑 21/21 全过（阶段 6 末）
      // 单用例实测 wall time 本就可达 2–3.2s（egress 交互用例），因此 5s 默认值对重型交互用例过紧。
      // 这里按真实成本设定超时，不通过删除用例、放宽断言或无条件重试来掩盖失败。
      maxWorkers: 2,
      testTimeout: 10000,
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
          // 纯逻辑模块：测试位于 node:test 层（同名 *.test.ts，由 `pnpm test` 运行），
          // jsdom 覆盖率运行不统计它们；用例数与断言见 frontend/AUDIT.md「测试分层」。
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
        },
      },
    },
  }),
);

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
      // 限制并行度：默认按核心数起 worker，在 8 逻辑核机器上跑 24 个文件 + 覆盖率插桩时
      // 会把交互型用例压到 5s 默认超时之上（实测 24 worker 18 失败、4 worker 5 失败、1 worker 全过），
      // 属于 CPU 饱和而非逻辑缺陷。这里固定 4，使本地与 CI 结果可复现；
      // 不通过放宽断言或删除用例来掩盖。
      maxWorkers: 4,
      setupFiles: ["./src/test/setup.ts"],
      // 只接管 *.test.tsx（React 组件测试）；既有 *.test.ts 仍由 `pnpm test` 的 node:test 运行。
      include: ["src/**/*.test.tsx"],
      coverage: {
        provider: "v8",
        reporter: ["text", "lcov"],
        // 覆盖率门槛按 ratchet 逐阶段扩大：只纳入已达 76% 的文件；未达标文件必须显式登记，不得静默排除。
        // 阶段 4 现状：client-keys 与 models 的新模块均已达标并纳入；
        // accounts 拆分出的多数新模块（各弹窗、批量任务、导出等）实测仅 0–45%，
        // 因此**未**纳入门槛，属已登记的未达标项（见 frontend/AUDIT.md 阶段 4 小节），
        // 其行为由账号集成测试覆盖，但不能据此声称满足 TEST-1。
        include: [
          "src/shared/hooks/use-chart.ts",
          "src/features/accounts/account-quota.tsx",
          "src/features/settings/use-settings.ts",
          "src/features/system/use-version-update.ts",
          "src/shared/api/client.ts",
          "src/shared/auth/auth-store.ts",
          "src/shared/auth/use-auth.ts",
          "src/shared/components/virtual-table-body.tsx",
          "src/shared/hooks/use-debounced-value.ts",
          "src/features/models/use-model-bulk-mutations.ts",
          "src/features/models/use-model-dialogs.ts",
          "src/features/models/use-model-form.ts",
          "src/features/models/use-model-list.ts",
          "src/features/models/use-model-save-mutation.ts",
          "src/features/models/use-model-selection.ts",
          "src/features/client-keys/client-key-billing-usage.tsx",
          "src/features/client-keys/client-key-delete-dialogs.tsx",
          "src/features/client-keys/client-key-form-dialog.tsx",
          "src/features/client-keys/client-key-form-fields.tsx",
          "src/features/client-keys/client-key-form-schema.ts",
          "src/features/client-keys/client-key-model-options.tsx",
          "src/features/client-keys/client-key-scope-fields.tsx",
          "src/features/client-keys/client-key-scope-select.tsx",
          "src/features/client-keys/client-key-scope-summary.ts",
          "src/features/client-keys/client-key-secret-dialog.tsx",
          "src/features/client-keys/client-key-status.tsx",
          "src/features/client-keys/client-keys-api.ts",
          "src/features/client-keys/client-keys-page.tsx",
          "src/features/client-keys/client-keys-table.tsx",
          "src/features/client-keys/client-keys-toolbar.tsx",
        ],
        // 业务 UI 门槛 76%（AGENTS.md TEST-1）；自定义 hook 按 AGENTS.md TEST-2 单独收紧到 100%。
        // hook 与展示组件已拆分（shared/hooks/use-chart.ts / use-version-update.ts），
        // 否则文件级阈值会把无关的渲染分支一并纳入 100% 要求。
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

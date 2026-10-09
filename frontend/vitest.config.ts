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
      setupFiles: ["./src/test/setup.ts"],
      // 只接管 *.test.tsx（React 组件测试）；既有 *.test.ts 仍由 `pnpm test` 的 node:test 运行。
      include: ["src/**/*.test.tsx"],
      coverage: {
        provider: "v8",
        reporter: ["text", "lcov"],
        // 覆盖率门槛按 ratchet 只约束本轮新增/修改的组件文件：
        // - accounts-page.tsx（3864 行、依赖大量 hooks/查询/弹窗）无法在不引入大量无关 mock 的前提下单测，故不纳入；
        //   其中本轮新增的模型级封锁分支复用 ModelQuotaBlockTooltip，由 account-quota.tsx 的用例覆盖。
        // - 其余存量文件同样不在本轮达标范围内。
        include: [
          "src/components/ui/use-chart.tsx",
          "src/features/accounts/account-quota.tsx",
          "src/features/settings/use-settings.ts",
          "src/features/system/use-version-update.ts",
          "src/shared/api/client.ts",
          "src/shared/auth/auth-store.ts",
          "src/shared/auth/use-auth.ts",
          "src/shared/components/virtual-table-body.tsx",
          "src/shared/hooks/use-debounced-value.ts",
        ],
        // 业务 UI 门槛 76%（AGENTS.md TEST-1）；自定义 hook 按 AGENTS.md TEST-2 单独收紧到 100%。
        // hook 与展示组件已拆分（use-chart.tsx / use-version-update.ts），
        // 否则文件级阈值会把无关的渲染分支一并纳入 100% 要求。
        thresholds: {
          lines: 76,
          functions: 76,
          branches: 76,
          statements: 76,
          "src/components/ui/use-chart.tsx": { lines: 100, functions: 100, branches: 100, statements: 100 },
          "src/features/settings/use-settings.ts": { lines: 100, functions: 100, branches: 100, statements: 100 },
          "src/features/system/use-version-update.ts": { lines: 100, functions: 100, branches: 100, statements: 100 },
          "src/shared/auth/use-auth.ts": { lines: 100, functions: 100, branches: 100, statements: 100 },
          "src/shared/hooks/use-debounced-value.ts": { lines: 100, functions: 100, branches: 100, statements: 100 },
        },
      },
    },
  }),
);

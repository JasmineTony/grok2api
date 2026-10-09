import { defineConfig, devices } from "@playwright/test";

/**
 * 真实全栈 E2E：真实浏览器 + 生产前端产物 + 真实 Go 服务（临时 SQLite、Memory 运行态）。
 * 每个 worker 由 e2e/fixtures.ts 启动独立后端进程（动态端口、独立临时目录、合成凭据）。
 * 产物统一落在 .artifacts/playwright，已在根 .gitignore 忽略。
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  // 不使用重试掩盖缺陷：失败即为失败，由 trace/screenshot 保留现场。
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { outputFolder: ".artifacts/playwright/html", open: "never" }]],
  outputDir: ".artifacts/playwright/results",
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});

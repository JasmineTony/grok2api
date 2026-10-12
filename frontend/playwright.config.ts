import { defineConfig, devices } from "@playwright/test";

/**
 * 真实全栈 E2E：真实浏览器 + 生产前端产物 + 真实 Go 服务（临时 SQLite、Memory 运行态）。
 * 每个 worker 由 e2e/fixtures.ts 启动独立后端进程（动态端口、独立临时目录、合成凭据）。
 * 产物统一落在 .artifacts/playwright，已在根 .gitignore 忽略。
 *
 * project 矩阵：桌面引擎 + 真实移动设备。
 * - `chromium` 使用 Desktop Chrome，运行全部用例，保持既有断言语义；
 * - `mobile-chromium` 使用 Pixel 5 设备描述符（isMobile/hasTouch/deviceScaleFactor/userAgent），
 *   而不是在桌面引擎上只改 viewport 宽度；
 * - 只有断言桌面布局本身成立的用例（常驻侧栏可见、移动端抽屉按钮隐藏）才带 `@desktop` 标签，
 *   由移动 project 以 grepInvert 排除；其余用例改用与 project 无关的导航入口（`e2e/fixtures.ts` 的
 *   `openNavigation` / `accountControlScope`：桌面取侧栏，移动先开抽屉），两个 project 都运行；
 *   桌面 project 不过滤，用例数不减少。
 *
 * 隔离策略不变：每个 worker 启动独立后端进程，移动 project 只是多了一批 worker。
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
  reporter: [
    ["list"],
    ["html", { outputFolder: ".artifacts/playwright/html", open: "never" }],
    ["json", { outputFile: ".artifacts/playwright/results.json" }],
  ],
  outputDir: ".artifacts/playwright/results",
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    // 桌面基线：全部用例；`mobile-device.e2e.ts` 断言的是移动设备描述符，只在移动 project 有意义。
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, testIgnore: /mobile-device\.e2e\.ts/ },
    { name: "mobile-chromium", use: { ...devices["Pixel 5"] }, grepInvert: /@desktop/ },
  ],
});

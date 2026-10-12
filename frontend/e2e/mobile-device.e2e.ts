import { devices } from "@playwright/test";

import { expect, test } from "./fixtures";

const pixel5 = devices["Pixel 5"];

/**
 * 设备事实自证：确认 `mobile-chromium` 用的是真实设备描述符（Pixel 5），
 * 而不是在桌面引擎上把 viewport 改窄（FE-19-12 的口径要求）。
 *
 * 断言分两层：
 * - 配置层：Playwright 报告的视口等于设备描述符；
 * - 浏览器层：`maxTouchPoints` / `pointer: coarse` / DPR / UA —— 这些**只有真实设备描述符才会产生**，
 *   桌面引擎仅把 viewport 改窄不会带来它们，因此这三条断言就是本口径的判别力来源。
 *
 * 注意：不要用 `window.innerWidth` 断言设备宽度——没有 `<meta name="viewport">` 的页面
 * （例如 `about:blank`）在移动模拟下会退回 980px 的布局视口，与设备描述符无关
 * （实测：期望 393×727、得到 980×1813）。
 *
 * 本文件只验证设备描述符是否生效，不访问后端；桌面 project 以 testIgnore 明确排除。
 */
test("移动 project 应用真实设备描述符：hasTouch、isMobile、DPR 与 UA", async ({ page }) => {
  expect(page.viewportSize()).toEqual(pixel5.viewport);

  await page.goto("about:blank");
  const facts = await page.evaluate(() => ({
    maxTouchPoints: navigator.maxTouchPoints,
    coarsePointer: matchMedia("(pointer: coarse)").matches,
    devicePixelRatio: window.devicePixelRatio,
    userAgent: navigator.userAgent,
  }));

  expect(facts.maxTouchPoints).toBeGreaterThan(0);
  expect(facts.coarsePointer).toBe(true);
  expect(facts.devicePixelRatio).toBeCloseTo(pixel5.deviceScaleFactor, 5);
  expect(facts.userAgent).toBe(pixel5.userAgent);
});

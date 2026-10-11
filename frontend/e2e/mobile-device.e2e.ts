import { devices } from "@playwright/test";

import { expect, test } from "./fixtures";

const pixel5 = devices["Pixel 5"];

/**
 * 设备事实自证：确认 `mobile-chromium` 用的是真实设备描述符（Pixel 5），
 * 而不是在桌面引擎上把 viewport 改窄（FE-19-12 的口径要求）。
 *
 * 断言对象是浏览器侧可见事实：触摸点数、coarse 指针、DPR、视口与 UA 文案。
 * 本文件只验证设备描述符是否生效，不访问后端；桌面 project 以 testIgnore 明确排除。
 */
test("移动 project 应用真实设备描述符：hasTouch、isMobile、DPR 与 UA", async ({ page }) => {
  await page.goto("about:blank");
  const facts = await page.evaluate(() => ({
    maxTouchPoints: navigator.maxTouchPoints,
    coarsePointer: matchMedia("(pointer: coarse)").matches,
    devicePixelRatio: window.devicePixelRatio,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    userAgent: navigator.userAgent,
  }));

  expect(facts.maxTouchPoints).toBeGreaterThan(0);
  expect(facts.coarsePointer).toBe(true);
  expect(facts.devicePixelRatio).toBeCloseTo(pixel5.deviceScaleFactor, 5);
  expect(facts.viewport).toEqual(pixel5.viewport);
  expect(facts.userAgent).toBe(pixel5.userAgent);
});

import { cleanup } from "@testing-library/react";
import { afterEach, beforeAll } from "vitest";

import { loadDeferredResources } from "@/shared/i18n";

// 用 /vitest 入口把 jest-dom 匹配器注册到 vitest 的 expect 上。
// 默认入口（"@testing-library/jest-dom"）依赖全局 expect，而本仓库未开启 test.globals。
import "@testing-library/jest-dom/vitest";

// 未开启 globals 时 @testing-library/react 不会自动注册清理钩子，这里显式注册。
afterEach(() => {
  cleanup();
});

// 非首屏的 12 个领域文案在应用里由 `app/deferred-pages.tsx` 在任何懒加载页面渲染前加载完成；
// 组件测试直接渲染页面组件、绕过了那层懒加载包装，因此在这里复现同一前置条件，
// 否则 `i18n.t("accounts.x")` 会原样回显 key，断言会退化成恒等比较。
beforeAll(async () => {
  await loadDeferredResources();
});

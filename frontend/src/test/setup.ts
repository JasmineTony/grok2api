import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// 用 /vitest 入口把 jest-dom 匹配器注册到 vitest 的 expect 上。
// 默认入口（"@testing-library/jest-dom"）依赖全局 expect，而本仓库未开启 test.globals。
import "@testing-library/jest-dom/vitest";

// 未开启 globals 时 @testing-library/react 不会自动注册清理钩子，这里显式注册。
afterEach(() => {
  cleanup();
});

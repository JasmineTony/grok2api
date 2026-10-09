import { existsSync, readFileSync } from "node:fs";

import { test as base, type APIRequestContext, type Page } from "@playwright/test";

import { startBackendServer } from "./backend-process";
import { buildManifestPath } from "./paths";

/**
 * worker 作用域后端服务的公开句柄（冻结契约，供所有 spec 复用）。
 * baseURL 指向本 worker 独占的真实 Go 服务；凭据为一次性合成管理员。
 */
export type E2EServer = {
  baseURL: string;
  username: string;
  password: string;
  tempDir: string;
};

type BuildManifest = {
  backendBinary: string;
  frontendDist: string;
};

/** 读取 globalSetup 写出的构建清单；缺失或过期都显式失败，不回退到未知产物。 */
function readBuildManifest(): BuildManifest {
  let raw: string;
  try {
    raw = readFileSync(buildManifestPath, "utf8");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`无法读取 E2E 构建清单 ${buildManifestPath}：${reason}；请通过 pnpm test:e2e 运行。`, {
      cause: error,
    });
  }
  const parsed = JSON.parse(raw) as Partial<BuildManifest>;
  if (typeof parsed.backendBinary !== "string" || typeof parsed.frontendDist !== "string") {
    throw new Error(`E2E 构建清单 ${buildManifestPath} 缺少 backendBinary/frontendDist 字段。`);
  }
  if (!existsSync(parsed.backendBinary)) {
    throw new Error(`E2E 构建清单指向的后端二进制不存在：${parsed.backendBinary}`);
  }
  return { backendBinary: parsed.backendBinary, frontendDist: parsed.frontendDist };
}

/**
 * 扩展基础 test：每个 worker 独占一个后端进程（动态端口 + 临时 SQLite/媒体目录 + 合成凭据）。
 * 其它 fixture 与断言能力全部沿用 Playwright 原生实现。
 * 第一个泛型用空键类型（等价于 Record<string, never>，但后者会生成 string 索引签名，
 * 与 worker fixture 冲突并导致 TS2345），表示本层不新增 test 作用域 fixture。
 */
export const test = base.extend<Record<never, never>, { server: E2EServer }>({
  server: [
    // Playwright 要求 fixture 首参必须是对象解构模式；此处不依赖其它 fixture，故为空模式。
    // eslint-disable-next-line no-empty-pattern
    async ({}, provide) => {
      const manifest = readBuildManifest();
      const backend = await startBackendServer({
        binaryPath: manifest.backendBinary,
        frontendDist: manifest.frontendDist,
      });
      try {
        await provide({
          baseURL: backend.baseURL,
          username: backend.username,
          password: backend.password,
          tempDir: backend.tempDir,
        });
      } finally {
        await backend.stop();
      }
    },
    { scope: "worker" },
  ],
  baseURL: async ({ server }, provide) => {
    await provide(server.baseURL);
  },
});

export const expect = base.expect;

/** 通过登录页完成一次真实管理员登录，并等待进入受保护页面。 */
export async function signIn(page: Page, server: E2EServer): Promise<void> {
  await page.goto(`${server.baseURL}/login`);
  await page.locator("#username").fill(server.username);
  await page.locator("#password").fill(server.password);
  await page.getByRole("button", { name: /^(登录|Sign in)$/ }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

/** 直接调用管理 API 登录，返回 accessToken；失败时携带响应体，便于定位。 */
export async function apiLogin(request: APIRequestContext, server: E2EServer): Promise<string> {
  const response = await request.post(`${server.baseURL}/api/admin/v1/auth/login`, {
    data: { username: server.username, password: server.password },
  });
  if (!response.ok()) {
    throw new Error(`管理员 API 登录失败：HTTP ${response.status()} ${await response.text()}`);
  }
  const payload = (await response.json()) as { data?: { tokens?: { accessToken?: unknown } } };
  const accessToken = payload.data?.tokens?.accessToken;
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    throw new Error("管理员 API 登录响应缺少 accessToken");
  }
  return accessToken;
}

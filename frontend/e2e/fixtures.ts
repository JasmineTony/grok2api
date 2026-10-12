import { existsSync, readFileSync } from "node:fs";

import { test as base, type APIRequestContext, type BrowserContext, type Locator, type Page } from "@playwright/test";

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

type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

// 管理面登录接口按用户名限流 12 次/分钟（backend adminauth.checkLoginRate 的
// "admin-login:user" 键），而单个 worker 会运行 16 个用例；若每个用例各自登录，
// 第 13 次起返回 429 loginRateLimited，表现为登录后停在 /login（CI 与本地单 worker
// 均已实际复现）。因此按 worker 复用一次会话与一次 API 令牌，只有「尚未建立或已被
// 注销」时才真正调用登录接口；登录流程本身仍由 auth.e2e 的 fresh 登录与错误密码用例覆盖。
let cachedSession: StorageState | null = null;
let cachedApiToken: string | null = null;

const dashboardHeadingName = /^仪表盘$|^Dashboard$/;
const loginHeadingName = /管理员登录|Admin sign in/;

/**
 * 通过登录页完成一次真实管理员登录，并等待进入受保护页面。
 * `options.fresh` 为真时忽略缓存会话，强制走真实登录（登录流程用例使用）。
 */
export async function signIn(page: Page, server: E2EServer, options: { fresh?: boolean } = {}): Promise<void> {
  if (!options.fresh && cachedSession && (await restoreCachedSession(page, server))) {
    return;
  }
  await page.goto(`${server.baseURL}/login`);
  await page.locator("#username").fill(server.username);
  await page.locator("#password").fill(server.password);
  await page.getByRole("button", { name: /^(登录|Sign in)$/ }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  if (!options.fresh) {
    cachedSession = await page.context().storageState();
  }
}

/** 复用缓存会话并等待应用解析登录状态；落到登录页说明该会话已被注销，返回 false。 */
async function restoreCachedSession(page: Page, server: E2EServer): Promise<boolean> {
  if (cachedSession) {
    await page.context().addCookies(cachedSession.cookies);
  }
  await page.goto(`${server.baseURL}/dashboard`);
  const authenticated = await Promise.race([
    page
      .getByRole("heading", { name: dashboardHeadingName })
      .waitFor({ state: "visible", timeout: 15000 })
      .then(() => true),
    page
      .getByRole("heading", { name: loginHeadingName })
      .waitFor({ state: "visible", timeout: 15000 })
      .then(() => false),
  ]).catch(() => false);
  if (!authenticated) {
    return false;
  }
  await expect(page).toHaveURL(/\/dashboard$/);
  return true;
}

/** 直接调用管理 API 登录，返回 accessToken；失败时携带响应体，便于定位。按 worker 复用。 */
export async function apiLogin(request: APIRequestContext, server: E2EServer): Promise<string> {
  if (cachedApiToken) {
    return cachedApiToken;
  }
  const response = await request.post(`${server.baseURL}/api/admin/v1/auth/login`, {
    data: { username: server.username, password: server.password },
  });
  if (!response.ok()) {
    throw new Error(`管理员 API 登录失败：HTTP ${response.status()} ${await response.text()}`);
  }
  const payload = (await response.json()) as { data?: { tokens?: { accessToken?: unknown } } };
  const accessToken = payload.data?.tokens?.accessToken;
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    throw new Error(`管理员 API 登录响应缺少 accessToken`);
  }
  cachedApiToken = accessToken;
  return accessToken;
}

/** 壳层导航在桌面侧栏与移动端抽屉中共用同一套可访问名称。 */
const navigationName = /^(导航|Navigation)$/;
const openNavigationName = /^(打开导航|Open navigation)$/;
const shellDialogName = "Grok2API";
const navigationTimeoutMs = 15_000;

/**
 * 打开移动端导航抽屉（顶栏菜单按钮 → Sheet），断言其可访问名称与键盘可用性后返回抽屉 dialog。
 * 移动端侧栏仍留在 DOM 中、只是被 CSS 隐藏，因此 `getByTestId` / `getByText` 这类**不**过滤
 * 隐藏元素的查询（`getByRole` 会过滤）必须限定在本作用域内，否则会命中外层侧栏的同一元素。
 * 仅适用于已登录外壳（登录页没有抽屉入口）。
 */
export async function openMobileNavigation(page: Page): Promise<Locator> {
  const trigger = page.getByRole("button", { name: openNavigationName });
  await expect(trigger).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.focus();
  await trigger.press("Enter");
  const dialog = page.getByRole("dialog", { name: shellDialogName, exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAccessibleDescription(navigationName);
  await expect(dialog.getByRole("navigation", { name: navigationName })).toBeVisible();
  return dialog;
}

/** 已打开的抽屉 dialog；未打开返回 null（避免对已打开的抽屉重复触发按钮，导致 aria-expanded 断言自相矛盾）。 */
async function openedShellDialog(page: Page): Promise<Locator | null> {
  const dialog = page.getByRole("dialog", { name: shellDialogName, exact: true });
  return (await dialog.isVisible()) ? dialog : null;
}

/**
 * 当前 project 是否为移动抽屉布局：由「顶栏抽屉按钮」与「常驻侧栏导航」谁先可见竞速判定
 * （同 restoreCachedSession 的竞速模式），不依赖 project 名称字符串。仅适用于已登录外壳。
 */
export async function isDrawerLayout(page: Page): Promise<boolean> {
  const drawerTrigger = page.getByRole("button", { name: openNavigationName });
  const sidebar = page.getByRole("navigation", { name: navigationName });
  const first = await Promise.race([
    drawerTrigger.waitFor({ state: "visible", timeout: navigationTimeoutMs }).then(() => "drawer" as const),
    sidebar.waitFor({ state: "visible", timeout: navigationTimeoutMs }).then(() => "sidebar" as const),
  ]).catch((error: unknown) => {
    throw new Error(`导航入口在 ${navigationTimeoutMs}ms 内既未出现移动端抽屉按钮，也未出现常驻侧栏导航`, {
      cause: error,
    });
  });
  return first === "drawer";
}

/**
 * 返回承载账号控制（用户名、账号菜单、设置入口）的可见作用域：
 * 桌面 project 账号控制常驻侧栏，返回页面作用域；移动 project 先打开抽屉，返回抽屉 dialog。
 */
export async function accountControlScope(page: Page): Promise<Locator> {
  const dialog = await openedShellDialog(page);
  if (dialog !== null) return dialog;
  if (!(await isDrawerLayout(page))) return page.locator("body");
  return openMobileNavigation(page);
}

/** 打开当前布局的导航入口并返回其中的 navigation 作用域（桌面侧栏 / 移动抽屉，抽屉已开则复用）。 */
export async function openNavigation(page: Page): Promise<Locator> {
  const scope = await accountControlScope(page);
  return scope.getByRole("navigation", { name: navigationName });
}

/** 收起移动端抽屉（桌面布局为 no-op）：抽屉打开时页面内容被 aria-hidden，收起后才能做页面级 role 断言。 */
export async function closeMobileNavigation(page: Page): Promise<void> {
  const dialog = await openedShellDialog(page);
  if (dialog === null) return;
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
}

/** 断言当前布局下管理员账号名对用户可见：桌面在常驻侧栏，移动在抽屉内（未打开时先打开抽屉）。 */
export async function expectVisibleUsername(page: Page, username: string): Promise<void> {
  const scope = await accountControlScope(page);
  await expect(scope.getByText(username, { exact: true })).toBeVisible();
}

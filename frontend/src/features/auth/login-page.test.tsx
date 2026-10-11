import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router-dom";
import { toast, Toaster } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LoginPage } from "@/features/auth/login-page";
import { apiRequest, decodeAdminDTO, setAccessToken, type LoginResponseDTO } from "@/shared/api/client";
import { AuthProvider } from "@/shared/auth/auth-context";
import { useAuthStore } from "@/shared/auth/auth-store";
import { useAuth } from "@/shared/auth/use-auth";
import { i18n } from "@/shared/i18n";

// 只替换 fetch：页面、表单校验、Provider、useAuth、API decoder 与状态流均保持真实。
const fetchMock = vi.fn<typeof fetch>();
const loginResponse = vi.fn<() => Promise<Response>>();
const originalLanguage = i18n.language;
const loginPayload: LoginResponseDTO = {
  admin: { id: "auth-test-admin", username: "server-admin" },
  tokens: {
    accessToken: "auth-test-access-token",
    accessTokenExpiresAt: "2026-10-11T12:00:00Z",
    refreshTokenExpiresAt: "2026-10-12T12:00:00Z",
  },
};

function SessionState(): ReactElement {
  const { admin, status } = useAuth();
  return (
    <>
      <output data-testid="auth-session-status">{status}</output>
      <output data-testid="auth-session-admin">{admin ? `${admin.id}:${admin.username}` : ""}</output>
      <Outlet />
    </>
  );
}

async function renderLogin() {
  const user = userEvent.setup();
  const router = createMemoryRouter(
    [
      {
        element: <SessionState />,
        children: [
          { path: "/before-login", element: <p data-testid="auth-previous-page">登录前页面</p> },
          { path: "/login", element: <LoginPage /> },
          { path: "/dashboard", element: <h1 data-testid="auth-dashboard">概览</h1> },
        ],
      },
    ],
    { initialEntries: ["/before-login", "/login"], initialIndex: 1 },
  );
  render(
    <I18nextProvider i18n={i18n}>
      <AuthProvider>
        <RouterProvider router={router} />
        <Toaster />
      </AuthProvider>
    </I18nextProvider>,
  );
  // 等待真实 Provider 完成无会话恢复，避免 restore 与登录请求竞态。
  await waitFor(() => expect(screen.getByTestId("auth-session-status")).toHaveTextContent("anonymous"));
  return { user, router };
}

beforeEach(async () => {
  await i18n.changeLanguage("zh-CN");
  setAccessToken(null);
  useAuthStore.setState({ admin: null, status: "restoring" });
  loginResponse.mockReset().mockImplementation(async () => Response.json({ data: loginPayload }));
  fetchMock.mockReset().mockImplementation(async (input) => {
    const path = new URL(String(input), window.location.origin).pathname;
    if (path === "/api/admin/v1/auth/refresh") {
      return Response.json({ error: { code: "unauthorized", message: "测试会话不存在" } }, { status: 401 });
    }
    if (path === "/api/admin/v1/auth/login") return loginResponse();
    if (path === "/api/admin/v1/me") return Response.json({ data: loginPayload.admin });
    throw new Error(`未预期的网络请求：${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(async () => {
  cleanup();
  toast.dismiss();
  setAccessToken(null);
  vi.unstubAllGlobals();
  await i18n.changeLanguage(originalLanguage);
});

describe("登录页真实认证集成", () => {
  it("提供稳定定位、可访问名称、密码管理器语义与键盘顺序", async () => {
    const { user } = await renderLogin();
    const username = screen.getByTestId("auth-username");
    const password = screen.getByTestId("auth-password");
    const submit = screen.getByTestId("auth-login-submit");

    expect(screen.getByTestId("auth-login-page")).toBeVisible();
    expect(screen.getByTestId("auth-login-title")).toBe(screen.getByRole("heading", { level: 1 }));
    expect(screen.getByTestId("auth-login-form")).toBe(screen.getByRole("form", { name: i18n.t("auth.title") }));
    expect(username).toBe(screen.getByRole("textbox", { name: "用户名" }));
    expect(password).toBe(screen.getByLabelText("密码"));
    expect(submit).toBe(screen.getByRole("button", { name: "登录" }));
    expect(screen.getByTestId("auth-github-link")).toBe(screen.getByRole("link", { name: "GitHub" }));
    expect(username).toHaveAttribute("name", "username");
    expect(username).toHaveAttribute("autocomplete", "username");
    expect(password).toHaveAttribute("name", "password");
    expect(password).toHaveAttribute("type", "password");
    expect(password).toHaveAttribute("autocomplete", "current-password");
    expect(username).not.toHaveAttribute("aria-describedby");
    expect(password).not.toHaveAttribute("aria-describedby");
    expect(username).toHaveFocus();
    await user.tab();
    expect(password).toHaveFocus();
    await user.tab();
    expect(submit).toHaveFocus();
    expect(submit).toBeEnabled();
  });

  it.each([
    { name: "两个字段均为空", username: "", password: "", focus: "username" },
    { name: "仅用户名为空", username: "", password: "synthetic-password", focus: "username" },
    { name: "仅密码为空", username: "root", password: "", focus: "password" },
  ])("$name 时显示关联错误并聚焦首个无效字段，不发送登录请求", async ({ username, password, focus }) => {
    const { user, router } = await renderLogin();
    if (username) await user.type(screen.getByTestId("auth-username"), username);
    if (password) await user.type(screen.getByTestId("auth-password"), password);
    await user.click(screen.getByTestId("auth-login-submit"));

    for (const [field, value, message] of [
      ["username", username, "请输入用户名"],
      ["password", password, "请输入密码"],
    ]) {
      const input = screen.getByTestId(`auth-${field}`);
      if (value) {
        expect(input).toHaveAttribute("aria-invalid", "false");
        expect(screen.queryByTestId(`auth-${field}-error`)).not.toBeInTheDocument();
      } else {
        const error = await screen.findByTestId(`auth-${field}-error`);
        expect(error).toBeVisible();
        expect(error).toHaveAttribute("role", "alert");
        expect(error).toHaveTextContent(message);
        expect(input).toHaveAttribute("aria-invalid", "true");
        expect(input).toHaveAccessibleDescription(message);
      }
    }
    await waitFor(() => expect(screen.getByTestId(`auth-${focus}`)).toHaveFocus());
    expect(screen.getByTestId("auth-login-submit")).toBeEnabled();
    expect(screen.getByTestId("auth-session-status")).toHaveTextContent("anonymous");
    expect(screen.getByTestId("auth-session-admin")).toBeEmptyDOMElement();
    expect(router.state.location.pathname).toBe("/login");
    expect(loginResponse).not.toHaveBeenCalled();
  });

  it("错误凭据显示真实 API 本地化错误、聚焦密码，修正后可以重试", async () => {
    loginResponse.mockResolvedValueOnce(
      Response.json({ error: { code: "invalidCredentials", message: "invalid credentials" } }, { status: 401 }),
    );
    const { user, router } = await renderLogin();
    await user.type(screen.getByTestId("auth-username"), "root");
    await user.type(screen.getByTestId("auth-password"), "wrong-password");
    await user.click(screen.getByTestId("auth-login-submit"));

    expect(await screen.findByText("用户名或密码错误")).toBeVisible();
    expect(screen.getByTestId("auth-password")).toHaveFocus();
    expect(screen.getByTestId("auth-login-submit")).toBeEnabled();
    expect(screen.getByTestId("auth-session-status")).toHaveTextContent("anonymous");
    expect(screen.getByTestId("auth-session-admin")).toBeEmptyDOMElement();
    expect(router.state.location.pathname).toBe("/login");
    expect(fetchMock).toHaveBeenCalledTimes(2); // 首次恢复 + 登录；401 不触发刷新重试。

    await user.clear(screen.getByTestId("auth-password"));
    await user.paste("corrected-synthetic-password");
    await user.keyboard("{Enter}");
    expect(await screen.findByTestId("auth-dashboard")).toBeVisible();
    expect(screen.getByTestId("auth-session-status")).toHaveTextContent("authenticated");
    expect(loginResponse).toHaveBeenCalledTimes(2);
  });

  it("请求中禁用提交，双击、再次点击和密码框 Enter 均不产生重复登录", async () => {
    let resolveLogin!: (response: Response) => void;
    loginResponse.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveLogin = resolve;
      }),
    );
    const { user, router } = await renderLogin();
    await user.type(screen.getByTestId("auth-username"), "root");
    await user.type(screen.getByTestId("auth-password"), "synthetic-password");
    const submit = screen.getByTestId("auth-login-submit");
    await user.dblClick(submit);

    expect(submit).toBeDisabled();
    expect(submit).toHaveAccessibleName("登录中");
    await user.click(submit);
    await user.click(screen.getByTestId("auth-password"));
    await user.keyboard("{Enter}");
    expect(loginResponse).toHaveBeenCalledTimes(1);
    expect(router.state.location.pathname).toBe("/login");
    expect(screen.getByTestId("auth-session-status")).toHaveTextContent("anonymous");
    expect(screen.queryByTestId("auth-dashboard")).not.toBeInTheDocument();

    await act(async () => resolveLogin(Response.json({ data: loginPayload })));
    expect(await screen.findByTestId("auth-dashboard")).toBeVisible();
    expect(screen.getByTestId("auth-session-status")).toHaveTextContent("authenticated");
    expect(loginResponse).toHaveBeenCalledTimes(1);
  });

  it("键盘与粘贴登录保留密码原文，真实解码更新身份和令牌，并替换登录历史", async () => {
    const { user, router } = await renderLogin();
    await user.type(screen.getByTestId("auth-username"), "root");
    await user.tab();
    await user.paste(" synthetic-password ");
    expect(screen.getByTestId("auth-password")).toHaveValue(" synthetic-password ");
    await user.keyboard("{Enter}");

    expect(await screen.findByTestId("auth-dashboard")).toBeVisible();
    expect(screen.queryByTestId("auth-login-page")).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/dashboard");
    expect(screen.getByTestId("auth-session-status")).toHaveTextContent("authenticated");
    expect(screen.getByTestId("auth-session-admin")).toHaveTextContent("auth-test-admin:server-admin");
    const loginCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/auth/login"));
    expect(loginCall?.[1]).toMatchObject({
      method: "POST",
      credentials: "include",
      body: JSON.stringify({ username: "root", password: " synthetic-password " }),
    });
    expect(new Headers(loginCall?.[1]?.headers).has("Authorization")).toBe(false);
    expect(await apiRequest("/api/admin/v1/me", { retryAuth: false }, decodeAdminDTO)).toEqual(loginPayload.admin);
    expect(new Headers(fetchMock.mock.calls.at(-1)?.[1]?.headers).get("Authorization")).toBe(
      "Bearer auth-test-access-token",
    );

    await act(async () => {
      await router.navigate(-1);
    });
    expect(screen.getByTestId("auth-previous-page")).toBeVisible();
    expect(router.state.location.pathname).toBe("/before-login");
    expect(screen.getByTestId("auth-session-status")).toHaveTextContent("authenticated");
  });

  it.each([
    { name: "身份字段无效", data: { ...loginPayload, admin: { id: "auth-test-admin", username: 123 } } },
    { name: "令牌字段缺失", data: { ...loginPayload, tokens: {} } },
  ])("$name 的成功响应被真实 decoder 拒绝，不进入已登录状态", async ({ data }) => {
    loginResponse.mockResolvedValueOnce(Response.json({ data }));
    const { user, router } = await renderLogin();
    await user.type(screen.getByTestId("auth-username"), "root");
    await user.type(screen.getByTestId("auth-password"), "synthetic-password");
    await user.click(screen.getByTestId("auth-login-submit"));

    expect(await screen.findByText("服务返回了无效响应")).toBeVisible();
    expect(screen.getByTestId("auth-password")).toHaveFocus();
    expect(screen.getByTestId("auth-login-submit")).toBeEnabled();
    expect(screen.getByTestId("auth-session-status")).toHaveTextContent("anonymous");
    expect(screen.getByTestId("auth-session-admin")).toBeEmptyDOMElement();
    expect(router.state.location.pathname).toBe("/login");
  });

  it.each([
    { name: "网络异常", error: new Error("测试网络不可用"), message: "测试网络不可用" },
    { name: "非 Error 拒绝", error: "network rejected", message: i18n.t("errors.generic", { lng: "zh-CN" }) },
  ])("$name 显示错误并恢复可提交状态", async ({ error, message }) => {
    loginResponse.mockRejectedValueOnce(error);
    const { user, router } = await renderLogin();
    await user.type(screen.getByTestId("auth-username"), "root");
    await user.type(screen.getByTestId("auth-password"), "synthetic-password");
    await user.click(screen.getByTestId("auth-login-submit"));

    expect(await screen.findByText(message)).toBeVisible();
    expect(screen.getByTestId("auth-password")).toHaveFocus();
    expect(screen.getByTestId("auth-login-submit")).toBeEnabled();
    expect(screen.getByTestId("auth-session-status")).toHaveTextContent("anonymous");
    expect(router.state.location.pathname).toBe("/login");
  });
});

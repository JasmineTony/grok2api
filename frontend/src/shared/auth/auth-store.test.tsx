import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/shared/api/client";
import { useAuthStore } from "@/shared/auth/auth-store";
import { useAuth } from "@/shared/auth/use-auth";

// 只 mock 网络层（@/shared/api/client），被测的 auth-store / use-auth 保持真实实现。
// 用 vi.hoisted 是因为 vi.mock 的工厂会被提升到文件顶部，直接引用普通顶层变量会命中 TDZ。
const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  refreshAccessToken: vi.fn(),
  setAccessToken: vi.fn(),
  subscribeSessionInvalidated: vi.fn(),
  decodeAdminDTO: vi.fn(),
  decodeLoginResponseDTO: vi.fn(),
  decodeLoggedOut: vi.fn(),
}));

vi.mock("@/shared/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/api/client")>();
  return {
    ...actual,
    apiRequest: mocks.apiRequest,
    refreshAccessToken: mocks.refreshAccessToken,
    setAccessToken: mocks.setAccessToken,
    subscribeSessionInvalidated: mocks.subscribeSessionInvalidated,
    decodeAdminDTO: mocks.decodeAdminDTO,
    decodeLoginResponseDTO: mocks.decodeLoginResponseDTO,
    decodeLoggedOut: mocks.decodeLoggedOut,
  };
});

const adminDTO = { id: "admin-1", username: "root" };
const loginResponse = {
  admin: adminDTO,
  tokens: {
    accessToken: "token-1",
    accessTokenExpiresAt: "2026-01-01T00:00:00Z",
    refreshTokenExpiresAt: "2026-01-01T00:00:00Z",
  },
};

let unsubscribe: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  unsubscribe = vi.fn();
  mocks.subscribeSessionInvalidated.mockReturnValue(unsubscribe);
  useAuthStore.setState({ admin: null, status: "restoring" });
});

afterEach(() => {
  // stop() 会清掉 start() 注册的订阅与定时器，避免用例间互相污染。
  useAuthStore.getState().stop();
  vi.useRealTimers();
});

describe("useAuthStore.retryRestore", () => {
  it("refresh 返回 invalid 时进入 anonymous 并清空 admin", async () => {
    useAuthStore.setState({ admin: adminDTO });
    mocks.refreshAccessToken.mockResolvedValue("invalid");

    await useAuthStore.getState().retryRestore();

    expect(useAuthStore.getState().status).toBe("anonymous");
    expect(useAuthStore.getState().admin).toBeNull();
    expect(mocks.apiRequest).not.toHaveBeenCalled();
  });

  it("refresh 返回 unavailable 时进入 unavailable，且不触碰 admin", async () => {
    useAuthStore.setState({ admin: adminDTO });
    mocks.refreshAccessToken.mockResolvedValue("unavailable");

    await useAuthStore.getState().retryRestore();

    expect(useAuthStore.getState().status).toBe("unavailable");
    expect(useAuthStore.getState().admin).toEqual(adminDTO);
  });

  it("refresh 成功且 /me 返回 admin 时进入 authenticated", async () => {
    mocks.refreshAccessToken.mockResolvedValue("refreshed");
    mocks.apiRequest.mockResolvedValue(adminDTO);

    await useAuthStore.getState().retryRestore();

    expect(mocks.apiRequest).toHaveBeenCalledWith("/api/admin/v1/me", { retryAuth: false }, mocks.decodeAdminDTO);
    expect(useAuthStore.getState().admin).toEqual(adminDTO);
    expect(useAuthStore.getState().status).toBe("authenticated");
    expect(mocks.setAccessToken).not.toHaveBeenCalled();
  });

  it("/me 抛 401 时清除 access token 并进入 anonymous", async () => {
    mocks.refreshAccessToken.mockResolvedValue("refreshed");
    mocks.apiRequest.mockRejectedValue(new ApiError(401, "unauthorized", "unauthorized"));

    await useAuthStore.getState().retryRestore();

    expect(mocks.setAccessToken).toHaveBeenCalledWith(null);
    expect(useAuthStore.getState().status).toBe("anonymous");
    expect(useAuthStore.getState().admin).toBeNull();
  });

  it("/me 抛非 401 的 ApiError 时进入 unavailable", async () => {
    mocks.refreshAccessToken.mockResolvedValue("refreshed");
    mocks.apiRequest.mockRejectedValue(new ApiError(503, "sessionRefreshUnavailable", "unavailable"));

    await useAuthStore.getState().retryRestore();

    expect(useAuthStore.getState().status).toBe("unavailable");
    expect(mocks.setAccessToken).toHaveBeenCalledWith(null);
  });

  it("/me 抛非 ApiError 时进入 unavailable", async () => {
    mocks.refreshAccessToken.mockResolvedValue("refreshed");
    mocks.apiRequest.mockRejectedValue(new Error("network down"));

    await useAuthStore.getState().retryRestore();

    expect(useAuthStore.getState().status).toBe("unavailable");
    expect(useAuthStore.getState().admin).toBeNull();
  });
});

describe("useAuthStore.login / logout / changePassword", () => {
  it("login 成功时写入 access token、admin 并进入 authenticated", async () => {
    mocks.apiRequest.mockResolvedValue(loginResponse);

    await useAuthStore.getState().login("root", "secret");

    expect(mocks.apiRequest).toHaveBeenCalledWith(
      "/api/admin/v1/auth/login",
      {
        method: "POST",
        body: { username: "root", password: "secret" },
        authenticated: false,
        retryAuth: false,
      },
      mocks.decodeLoginResponseDTO,
    );
    expect(mocks.setAccessToken).toHaveBeenCalledWith("token-1");
    expect(useAuthStore.getState().admin).toEqual(adminDTO);
    expect(useAuthStore.getState().status).toBe("authenticated");
  });

  it("login 失败时错误向上抛出，且不写入任何状态", async () => {
    const failure = new ApiError(401, "invalidCredentials", "invalid credentials");
    mocks.apiRequest.mockRejectedValue(failure);

    await expect(useAuthStore.getState().login("root", "bad")).rejects.toBe(failure);

    expect(mocks.setAccessToken).not.toHaveBeenCalled();
    expect(useAuthStore.getState().admin).toBeNull();
    expect(useAuthStore.getState().status).toBe("restoring");
  });

  it("logout 请求失败也必须清空为 anonymous（finally 语义）", async () => {
    useAuthStore.setState({ admin: adminDTO, status: "authenticated" });
    mocks.apiRequest.mockRejectedValue(new ApiError(500, "requestFailed", "boom"));

    await expect(useAuthStore.getState().logout()).rejects.toBeInstanceOf(ApiError);

    expect(mocks.apiRequest).toHaveBeenCalledWith(
      "/api/admin/v1/auth/logout",
      { method: "POST", body: {}, authenticated: false, retryAuth: false },
      mocks.decodeLoggedOut,
    );
    expect(mocks.setAccessToken).toHaveBeenCalledWith(null);
    expect(useAuthStore.getState().admin).toBeNull();
    expect(useAuthStore.getState().status).toBe("anonymous");
  });

  it("logout 成功时同样清空为 anonymous", async () => {
    useAuthStore.setState({ admin: adminDTO, status: "authenticated" });
    mocks.apiRequest.mockResolvedValue({ loggedOut: true });

    await useAuthStore.getState().logout();

    expect(mocks.setAccessToken).toHaveBeenCalledWith(null);
    expect(useAuthStore.getState().admin).toBeNull();
    expect(useAuthStore.getState().status).toBe("anonymous");
  });

  it("changePassword 以 PUT 调用接口，并使用忽略响应的解码器", async () => {
    mocks.apiRequest.mockResolvedValue(undefined);

    await useAuthStore.getState().changePassword("old-password", "new-password");

    expect(mocks.apiRequest).toHaveBeenCalledTimes(1);
    const [path, options, decode] = mocks.apiRequest.mock.calls[0] as [
      string,
      Record<string, unknown>,
      () => undefined,
    ];
    expect(path).toBe("/api/admin/v1/me/password");
    expect(options).toEqual({
      method: "PUT",
      body: { currentPassword: "old-password", newPassword: "new-password" },
    });
    expect(decode()).toBeUndefined();
  });

  it("changePassword 的错误向上抛出，且不改变认证状态", async () => {
    useAuthStore.setState({ admin: adminDTO, status: "authenticated" });
    const failure = new ApiError(400, "invalidPassword", "invalid password");
    mocks.apiRequest.mockRejectedValue(failure);

    await expect(useAuthStore.getState().changePassword("old-password", "bad")).rejects.toBe(failure);

    expect(useAuthStore.getState().status).toBe("authenticated");
    expect(useAuthStore.getState().admin).toEqual(adminDTO);
  });
});

describe("useAuthStore 生命周期（start / stop）", () => {
  it("start() 注册会话失效订阅，回调触发时清空为 anonymous", () => {
    useAuthStore.setState({ admin: adminDTO, status: "authenticated" });
    useAuthStore.getState().start();
    const listener = mocks.subscribeSessionInvalidated.mock.calls[0][0] as () => void;
    // 先 stop() 取消 start() 安排的首次 restore 定时器，保证本用例只验证订阅回调。
    useAuthStore.getState().stop();

    listener();

    expect(mocks.subscribeSessionInvalidated).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().admin).toBeNull();
    expect(useAuthStore.getState().status).toBe("anonymous");
  });

  it("start() 在下一个宏任务触发首次 restore，stop() 清理定时器并取消订阅", async () => {
    vi.useFakeTimers();
    const clearTimeoutSpy = vi.spyOn(window, "clearTimeout");
    mocks.refreshAccessToken.mockResolvedValue("invalid");

    useAuthStore.getState().start();
    expect(mocks.refreshAccessToken).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().status).toBe("anonymous");

    useAuthStore.getState().stop();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);

    clearTimeoutSpy.mockRestore();
  });

  it("未 start() 时 stop() 不抛错且无副作用", () => {
    const clearTimeoutSpy = vi.spyOn(window, "clearTimeout");

    expect(() => useAuthStore.getState().stop()).not.toThrow();

    expect(clearTimeoutSpy).not.toHaveBeenCalled();
    expect(unsubscribe).not.toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });
});

describe("useAuth（迁移后保持公共 API）", () => {
  it("返回的字段与 action 引用与 store 一致", () => {
    const state = useAuthStore.getState();

    const { result } = renderHook(() => useAuth());

    expect(result.current.admin).toBeNull();
    expect(result.current.status).toBe("restoring");
    expect(result.current.retryRestore).toBe(state.retryRestore);
    expect(result.current.login).toBe(state.login);
    expect(result.current.logout).toBe(state.logout);
    expect(result.current.changePassword).toBe(state.changePassword);
  });

  it("store 状态变化驱动订阅组件重渲染", () => {
    const { result } = renderHook(() => useAuth());

    act(() => {
      useAuthStore.setState({ admin: adminDTO, status: "authenticated" });
    });

    expect(result.current.admin).toEqual(adminDTO);
    expect(result.current.status).toBe("authenticated");
  });

  it("经 hook 取得的 action 直接作用于 store", async () => {
    mocks.apiRequest.mockResolvedValue(loginResponse);
    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.login("root", "secret");
    });

    expect(result.current.admin).toEqual(adminDTO);
    expect(result.current.status).toBe("authenticated");
  });
});

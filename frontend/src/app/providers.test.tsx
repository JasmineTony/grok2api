import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { toast } from "sonner";
import { AppProviders } from "@/app/providers";
import { useAuthStore } from "@/shared/auth/auth-store";
import { i18n } from "@/shared/i18n";

// AppProviders 的真实契约（providers.tsx）：
//   ThemeProvider(attribute=class) -> QueryClientProvider(retry1/staleTime15s/mutations retry0)
//   -> AuthProvider(生命周期挂 start/stop) -> TooltipProvider(delayDuration=300) + children + Toaster。
// 用真实子组件断言各 Provider 确实生效，而不是断言「渲染不报错」。

// next-themes 依赖 matchMedia；jsdom 未实现该 API，这里补最小替身。
if (typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

/** 读取最近一层 QueryClient 的默认 options，验证 AppProviders 的配置真实落地。 */
function QueryDefaultsProbe() {
  const client = useQueryClient();
  const options = client.getDefaultOptions();
  return (
    <div
      data-testid="query-defaults"
      data-stale-time={options.queries?.staleTime}
      data-query-retry={options.queries?.retry}
      data-mutation-retry={options.mutations?.retry}
      data-refetch-on-focus={String(options.queries?.refetchOnWindowFocus)}
    />
  );
}

/** 验证 AuthProvider 生命周期确实被挂上：挂载即 start，卸载即 stop。 */
function AuthLifecycleProbe() {
  const started = useAuthStore((state) => state.status);
  return <span data-testid="auth-probe">{started}</span>;
}

const startMock = vi.fn();
const stopMock = vi.fn();

beforeEach(async () => {
  await i18n.changeLanguage("zh-CN");
  startMock.mockClear();
  stopMock.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AppProviders Provider 组合", () => {
  it("渲染子节点，并把 QueryClient 默认选项配置到 provider", async () => {
    render(
      <I18nextProvider i18n={i18n}>
        <AppProviders>
          <QueryDefaultsProbe />
        </AppProviders>
      </I18nextProvider>,
    );

    const probe = await screen.findByTestId("query-defaults");
    expect(probe).toHaveAttribute("data-stale-time", "15000");
    expect(probe).toHaveAttribute("data-query-retry", "1");
    expect(probe).toHaveAttribute("data-mutation-retry", "0");
    expect(probe).toHaveAttribute("data-refetch-on-focus", "false");
  });

  it("Toaster 通过 sonner store 真实渲染，并采用 top-right 定位", async () => {
    render(
      <I18nextProvider i18n={i18n}>
        <AppProviders>
          <span data-testid="child">ready</span>
        </AppProviders>
      </I18nextProvider>,
    );

    expect(await screen.findByTestId("child")).toHaveTextContent("ready");
    // sonner 的 Toaster 在无 toast 时刻意不渲染容器；发一条 toast 才能观察到真实挂载结果。
    toast.error("providers-test-toast");

    const toaster = await waitFor(() => {
      const element = document.querySelector("[data-sonner-toaster]");
      expect(element).not.toBeNull();
      return element as HTMLElement;
    });
    expect(toaster).toHaveAttribute("data-y-position", "top");
    expect(toaster).toHaveAttribute("data-x-position", "right");
    expect(await screen.findByText("providers-test-toast")).toBeInTheDocument();
  });

  it("ThemeProvider 真实生效：初始化后把主题写到 documentElement 的 class 上", async () => {
    render(
      <I18nextProvider i18n={i18n}>
        <AppProviders>
          <span>ready</span>
        </AppProviders>
      </I18nextProvider>,
    );

    await waitFor(() => expect(document.documentElement.className.length).toBeGreaterThan(0));
    expect(["light", "dark"]).toContain(document.documentElement.className);
  });

  it("AuthProvider 生命周期随 Provider 树挂载：start 被调用，卸载后 stop 被调用", async () => {
    useAuthStore.setState({ start: startMock, stop: stopMock });
    const { unmount } = render(
      <I18nextProvider i18n={i18n}>
        <AppProviders>
          <AuthLifecycleProbe />
        </AppProviders>
      </I18nextProvider>,
    );

    expect(await screen.findByTestId("auth-probe")).toBeInTheDocument();
    expect(startMock).toHaveBeenCalledTimes(1);
    expect(stopMock).not.toHaveBeenCalled();

    unmount();
    expect(stopMock).toHaveBeenCalledTimes(1);
  });

  it("StrictMode 双挂载下 start/stop 成对平衡，未泄漏订阅", () => {
    useAuthStore.setState({ start: startMock, stop: stopMock });
    const { unmount } = render(
      <StrictMode>
        <I18nextProvider i18n={i18n}>
          <AppProviders>
            <span>ready</span>
          </AppProviders>
        </I18nextProvider>
      </StrictMode>,
    );

    unmount();

    expect(startMock).toHaveBeenCalledTimes(2);
    expect(stopMock).toHaveBeenCalledTimes(2);
  });

  it("即使外层已存在 QueryClient，AppProviders 仍以内层自身配置为准", async () => {
    const outer = new QueryClient({
      defaultOptions: { queries: { retry: 7, staleTime: 1234 } },
    });

    render(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={outer}>
          <AppProviders>
            <QueryDefaultsProbe />
          </AppProviders>
        </QueryClientProvider>
      </I18nextProvider>,
    );

    // AppProviders 内层会新建自己的 QueryClient（providers.tsx 的 useState 初始化），
    // 因此这里断言内层配置优先，避免误以为会继承外部 client。
    const probe = await screen.findByTestId("query-defaults");
    expect(probe).toHaveAttribute("data-stale-time", "15000");
    expect(probe).toHaveAttribute("data-query-retry", "1");
  });
});

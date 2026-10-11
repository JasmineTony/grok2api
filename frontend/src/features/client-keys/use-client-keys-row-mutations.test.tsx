import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ClientKeyDTO } from "@/entities/client-keys/types";
import { createClientKeyDefaults } from "@/features/client-keys/client-key-form-schema";
import { useClientKeyRowMutations } from "@/features/client-keys/use-client-keys-row-mutations";
import { ApiError } from "@/shared/api/client";
import { i18n } from "@/shared/i18n";

// 单行变更 hook 的控制器级测试（AGENTS.md TEST-2）：
// 页面只在 editing !== null 时渲染表单弹窗，所以 `if (!editing)` 守卫无法由页面交互驱动。
// 这里用 renderHook 直接传入 editing: null 真实执行该分支，并把「未注册请求直接失败」作为
// 网络边界，证明守卫在发出任何请求之前就终止。
const apiMock = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock("@/shared/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/api/client")>();
  return { ...actual, apiRequest: apiMock.request };
});

function wrapperFor() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function renderRowMutations(editing: ClientKeyDTO | "new" | null) {
  const callbacks = {
    notifyError: vi.fn(),
    showSecret: vi.fn(),
    closeEditor: vi.fn(),
    closeDelete: vi.fn(),
  };
  const { result } = renderHook(() => useClientKeyRowMutations({ editing, t: (key) => i18n.t(key), ...callbacks }), {
    wrapper: wrapperFor(),
  });
  return { result, ...callbacks };
}

beforeEach(async () => {
  apiMock.request.mockReset();
  apiMock.request.mockImplementation(() => {
    throw new ApiError(500, "unexpectedRequest", "未注册的请求");
  });
  await i18n.changeLanguage("zh-CN");
});

describe("useClientKeyRowMutations", () => {
  it("editing 为 null 时保存直接失败：抛通用错误、不发出请求、不关闭编辑弹窗", async () => {
    const { result, notifyError, showSecret, closeEditor } = renderRowMutations(null);

    await act(async () => {
      await expect(result.current.save.mutateAsync(createClientKeyDefaults())).rejects.toThrow(
        i18n.t("errors.generic"),
      );
    });

    await waitFor(() => expect(notifyError).toHaveBeenCalledTimes(1));
    const [reportedError] = notifyError.mock.calls[0] as [unknown];
    expect(reportedError).toBeInstanceOf(Error);
    expect((reportedError as Error).message).toBe(i18n.t("errors.generic"));
    expect(apiMock.request).not.toHaveBeenCalled();
    expect(showSecret).not.toHaveBeenCalled();
    expect(closeEditor).not.toHaveBeenCalled();
  });
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useMediaDeletion } from "@/features/media/use-media-deletion";
import { i18n } from "@/shared/i18n";

// 媒体删除 hook 测试（AGENTS.md TEST-2）：删除请求是注入依赖，弹窗/分页回退/提示保持真实实现。
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

function wrapper({ children }: { children: ReactNode }) {
  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </I18nextProvider>
  );
}

beforeEach(async () => {
  queryClient.clear();
  await i18n.changeLanguage("zh-CN");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useMediaDeletion", () => {
  it("确认弹窗可开合，成功后关闭弹窗、回退分页并提示删除条数", async () => {
    const successToast = vi.spyOn(toast, "success");
    const deleteRequest = vi.fn(async () => ({ deleted: 2 }));
    const onPageChange = vi.fn();
    const onRemoved = vi.fn();

    const { result } = renderHook(
      () =>
        useMediaDeletion({
          ids: ["job-1", "job-2"],
          deleteRequest,
          invalidateKey: ["media", "videos"],
          deletedMessageKey: "media.videos.deleted",
          trimPage: true,
          page: 3,
          onPageChange,
          onRemoved,
        }),
      { wrapper },
    );

    expect(result.current.confirmOpen).toBe(false);
    act(() => result.current.requestConfirm());
    expect(result.current.confirmOpen).toBe(true);
    act(() => result.current.closeConfirm());
    expect(result.current.confirmOpen).toBe(false);

    act(() => result.current.requestConfirm());
    act(() => result.current.confirm());

    await waitFor(() => expect(deleteRequest).toHaveBeenCalledWith(["job-1", "job-2"]));
    await waitFor(() => expect(onPageChange).toHaveBeenCalledWith(2));
    expect(onRemoved).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.confirmOpen).toBe(false));
    expect(successToast).toHaveBeenCalledWith(i18n.t("media.videos.deleted", { count: 2 }));
    expect(result.current.isPending).toBe(false);
  });

  it("删除失败时提示错误原文并保持选中状态可重试", async () => {
    const errorToast = vi.spyOn(toast, "error");
    const deleteRequest = vi.fn(async () => {
      throw new Error("mediaDeleteFailed");
    });
    const onPageChange = vi.fn();
    const onRemoved = vi.fn();

    const { result } = renderHook(
      () =>
        useMediaDeletion({
          ids: ["job-1"],
          deleteRequest,
          invalidateKey: ["media", "videos"],
          deletedMessageKey: "media.videos.deleted",
          trimPage: false,
          page: 1,
          onPageChange,
          onRemoved,
        }),
      { wrapper },
    );

    act(() => result.current.requestConfirm());
    act(() => result.current.confirm());

    await waitFor(() => expect(errorToast).toHaveBeenCalledWith("mediaDeleteFailed"));
    expect(onPageChange).not.toHaveBeenCalled();
    expect(onRemoved).not.toHaveBeenCalled();
    expect(result.current.confirmOpen).toBe(true);
  });

  it("删除失败且异常不是 Error 时使用通用错误文案", async () => {
    const errorToast = vi.spyOn(toast, "error");
    const deleteRequest = vi.fn(() => Promise.reject("network down"));

    const { result } = renderHook(
      () =>
        useMediaDeletion({
          ids: ["job-1"],
          deleteRequest: deleteRequest as unknown as (ids: string[]) => Promise<{ deleted: number }>,
          invalidateKey: ["media", "videos"],
          deletedMessageKey: "media.videos.deleted",
          trimPage: false,
          page: 1,
          onPageChange: () => {},
        }),
      { wrapper },
    );

    act(() => result.current.requestConfirm());
    act(() => result.current.confirm());

    await waitFor(() => expect(errorToast).toHaveBeenCalledWith(i18n.t("errors.generic")));
    expect(result.current.confirmOpen).toBe(true);
  });
});

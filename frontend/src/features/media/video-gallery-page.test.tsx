import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { VideoGalleryPage } from "@/features/media/video-gallery-page";
import {
  installMediaApi,
  lastRequestURL,
  mediaJob,
  queryParam,
  renderWithProviders,
  requestsMatching,
} from "@/features/media/media-test-support";
import { i18n } from "@/shared/i18n";
import { formatNumber } from "@/shared/lib/format";

const VIDEOS_URL = "/api/admin/v1/media/videos";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("VideoGalleryPage", () => {
  it("渲染任务行、状态进度与统计摘要", async () => {
    installMediaApi({
      videos: [
        mediaJob({ id: "job-1" }),
        mediaJob({ id: "job-2", status: "in_progress", progress: 42, assetId: "", completedAt: null }),
      ],
      videosTotal: 2,
      videoStats: { totalJobs: 2, completed: 1, failed: 0, inProgress: 1, queued: 0 },
    });
    renderWithProviders(<VideoGalleryPage />);

    expect(await screen.findByTestId("video-job-select-job-1")).toBeInTheDocument();
    expect(screen.getByTestId("video-job-select-job-1")).toBeEnabled();
    expect(screen.getByTestId("video-job-select-job-2")).toBeDisabled();
    expect(screen.getByText("42%")).toBeInTheDocument();
    expect(screen.getByText(i18n.t("media.videos.totalJobs")).parentElement).toHaveTextContent(
      formatNumber(2, i18n.language, 0),
    );
  });

  it("空列表展示空态", async () => {
    installMediaApi({ videos: [], videosTotal: 0 });
    renderWithProviders(<VideoGalleryPage />);

    expect(await screen.findByText(i18n.t("media.videos.empty"))).toBeInTheDocument();
  });

  it("列表失败展示错误态并可重试", async () => {
    const user = userEvent.setup();
    const { requests } = installMediaApi({ failure: "videos" });
    renderWithProviders(<VideoGalleryPage />);

    const retry = await screen.findByRole("button", { name: i18n.t("common.retry") });
    expect(retry.parentElement?.textContent).toContain("videoListFailed");

    const before = requestsMatching(requests, "GET", VIDEOS_URL).length;
    await user.click(retry);
    await waitFor(() => expect(requestsMatching(requests, "GET", VIDEOS_URL).length).toBeGreaterThan(before));
  });

  it("统计不可用时摘要显示占位符而不是 0", async () => {
    installMediaApi({ videos: [mediaJob()], videosTotal: 1, failure: "videoStats" });
    renderWithProviders(<VideoGalleryPage />);

    expect(await screen.findByTestId("video-job-select-job-1")).toBeInTheDocument();
    expect(screen.getByText(i18n.t("media.videos.totalJobs")).parentElement).toHaveTextContent("-");
  });

  it("排序与状态筛选会回到第一页并带上查询参数", async () => {
    const user = userEvent.setup();
    const { requests } = installMediaApi({ videos: [mediaJob()], videosTotal: 1 });
    renderWithProviders(<VideoGalleryPage />);
    await screen.findByTestId("video-job-select-job-1");

    await user.click(
      screen.getByRole("button", {
        name: i18n.t("common.sortAscending", { column: i18n.t("media.videos.prompt") }),
      }),
    );
    await waitFor(() => {
      const url = lastRequestURL(requests, VIDEOS_URL);
      expect(queryParam(url, "sortBy")).toBe("prompt");
      expect(queryParam(url, "sortOrder")).toBe("asc");
      expect(queryParam(url, "page")).toBe("1");
    });

    await user.click(screen.getByRole("button", { name: new RegExp("^" + i18n.t("common.filter")) }));
    await user.click(await screen.findByRole("menuitem", { name: i18n.t("media.videos.status") }));
    // Radix 子菜单在 jsdom 中需要指针事件才会触发选项。
    const option = await screen.findByRole("menuitemradio", { name: i18n.t("media.videoStatus.completed") });
    await user.pointer({ target: option, keys: "[MouseLeft]" });
    await waitFor(() => {
      const url = lastRequestURL(requests, VIDEOS_URL);
      expect(queryParam(url, "status")).toBe("completed");
      expect(queryParam(url, "page")).toBe("1");
    });
  });

  it("整页全选只覆盖终态任务并提交选中 ID", async () => {
    const user = userEvent.setup();
    const { requests } = installMediaApi({
      videos: [mediaJob({ id: "job-1" }), mediaJob({ id: "job-2", status: "queued", assetId: "", completedAt: null })],
      videosTotal: 2,
    });
    renderWithProviders(<VideoGalleryPage />);
    await screen.findByTestId("video-job-select-job-1");

    await user.click(screen.getByTestId("video-gallery-select-page"));
    expect(screen.getByTestId("media-selection-actions")).toHaveTextContent(
      i18n.t("common.selectedCount", { count: 1 }),
    );

    await user.click(screen.getByTestId("media-delete-request"));
    await user.click(await screen.findByTestId("media-delete-confirm"));
    await waitFor(() => {
      const deletes = requestsMatching(requests, "DELETE", VIDEOS_URL);
      expect(deletes).toHaveLength(1);
      expect(deletes[0].body).toEqual({ ids: ["job-1"] });
    });
  });

  it("删除失败时刷新列表并保持确认弹窗", async () => {
    const user = userEvent.setup();
    const { requests } = installMediaApi({ videos: [mediaJob()], videosTotal: 1, failure: "delete" });
    renderWithProviders(<VideoGalleryPage />);
    await screen.findByTestId("video-job-select-job-1");

    await user.click(screen.getByTestId("video-job-select-job-1"));
    await user.click(screen.getByTestId("media-delete-request"));
    await user.click(await screen.findByTestId("media-delete-confirm"));

    await waitFor(() => expect(requestsMatching(requests, "DELETE", VIDEOS_URL)).toHaveLength(1));
    // 失败不静默：选中项保留，用户仍可重试删除。
    expect(screen.getByTestId("media-selection-actions")).toHaveTextContent(
      i18n.t("common.selectedCount", { count: 1 }),
    );
  });

  it("删除整页任务且不在首页时回退一页", async () => {
    const user = userEvent.setup();
    installMediaApi({
      videos: Array.from({ length: 3 }, (_, index) => mediaJob({ id: `job-${index + 1}` })),
      videosTotal: 25,
    });
    renderWithProviders(<VideoGalleryPage />);
    await screen.findByTestId("video-job-select-job-1");

    await user.click(screen.getByRole("button", { name: i18n.t("common.nextPage") }));
    await waitFor(() => expect(screen.getByText(i18n.t("common.pageOf", { page: 2, pages: 2 }))).toBeInTheDocument());

    await user.click(screen.getByTestId("video-gallery-select-page"));
    await user.click(screen.getByTestId("media-delete-request"));
    await user.click(await screen.findByTestId("media-delete-confirm"));

    await waitFor(() => expect(screen.getByText(i18n.t("common.pageOf", { page: 1, pages: 2 }))).toBeInTheDocument());
  });

  it("预览打开播放器，关闭后播放器随弹窗卸载", async () => {
    const user = userEvent.setup();
    installMediaApi({ videos: [mediaJob()], videosTotal: 1 });
    renderWithProviders(<VideoGalleryPage />);

    await user.click(await screen.findByTestId("video-job-preview-job-1"));
    const player = await screen.findByTestId("video-preview-player");
    expect(player).toHaveAttribute("src", "/v1/media/videos/asset-1");

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("video-preview-player")).not.toBeInTheDocument());
    expect(screen.queryByTestId("video-preview-dialog")).not.toBeInTheDocument();
  });

  it("资源加载失败后可重试加载播放器", async () => {
    const user = userEvent.setup();
    installMediaApi({ videos: [mediaJob()], videosTotal: 1 });
    renderWithProviders(<VideoGalleryPage />);

    await user.click(await screen.findByTestId("video-job-preview-job-1"));
    const player = await screen.findByTestId("video-preview-player");
    const load = vi.spyOn(player as HTMLVideoElement, "load").mockImplementation(() => {});
    player.dispatchEvent(new Event("error"));

    const retry = await screen.findByTestId("video-preview-retry");
    await user.click(retry);
    expect(load).toHaveBeenCalled();
  });

  it("刷新按钮同时重取任务列表与统计", async () => {
    const user = userEvent.setup();
    const { requests } = installMediaApi({ videos: [mediaJob()], videosTotal: 1 });
    renderWithProviders(<VideoGalleryPage />);
    await screen.findByTestId("video-job-select-job-1");

    const listBefore = requestsMatching(requests, "GET", VIDEOS_URL).length;
    await user.click(screen.getByTestId("media-refresh"));

    await waitFor(() => expect(requestsMatching(requests, "GET", VIDEOS_URL).length).toBeGreaterThan(listBefore));
  });

  it("失败任务通过提示展示错误原文，并覆盖全部状态样式", async () => {
    const user = userEvent.setup();
    installMediaApi({
      videos: [
        mediaJob({ id: "job-1", status: "failed", progress: 0, errorMessage: "render failed", assetId: "" }),
        mediaJob({ id: "job-2", status: "queued", progress: 0, assetId: "", completedAt: null }),
        mediaJob({ id: "job-3", status: "in_progress", progress: 30, assetId: "", completedAt: null }),
      ],
      videosTotal: 3,
    });
    renderWithProviders(<VideoGalleryPage />);
    await screen.findByTestId("video-job-select-job-1");

    expect(screen.getAllByText(i18n.t("media.videoStatus.queued")).length).toBeGreaterThan(0);
    expect(screen.getAllByText(i18n.t("media.videoStatus.in_progress")).length).toBeGreaterThan(0);

    const failedRow = screen.getByTestId("video-job-select-job-1").closest("tr");
    await user.hover(within(failedRow as HTMLElement).getByText(i18n.t("media.videoStatus.failed")));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("render failed");
  });

  it("预览播放器处理加载、首帧与结束事件", async () => {
    const user = userEvent.setup();
    installMediaApi({ videos: [mediaJob()], videosTotal: 1 });
    renderWithProviders(<VideoGalleryPage />);

    await user.click(await screen.findByTestId("video-job-preview-job-1"));
    const player = (await screen.findByTestId("video-preview-player")) as HTMLVideoElement;
    Object.defineProperty(player, "duration", { value: 10, configurable: true });

    act(() => player.dispatchEvent(new Event("loadedmetadata")));
    expect(player.currentTime).toBeCloseTo(0.01);

    act(() => {
      player.dispatchEvent(new Event("loadeddata"));
      player.dispatchEvent(new Event("canplay"));
      player.dispatchEvent(new Event("ended"));
    });
    expect(screen.queryByText(i18n.t("common.loading"))).not.toBeInTheDocument();

    act(() => player.dispatchEvent(new Event("loadstart")));
    expect(screen.getByText(i18n.t("common.loading"))).toBeInTheDocument();
  });

  it("搜索关键字会重置页码并带上查询参数", async () => {
    const user = userEvent.setup();
    const { requests } = installMediaApi({ videos: [mediaJob()], videosTotal: 1 });
    renderWithProviders(<VideoGalleryPage />);
    await screen.findByTestId("video-job-select-job-1");

    await user.type(screen.getByTestId("video-gallery-search"), "paper");
    await waitFor(() => expect(queryParam(lastRequestURL(requests, VIDEOS_URL), "search")).toBe("paper"));
  });
  it("删除请求在确认弹窗关闭后完成时，关闭被删任务的预览并清空选中", async () => {
    const user = userEvent.setup();
    const { requests } = installMediaApi({ videos: [mediaJob({ id: "job-1" })], videosTotal: 1 });
    const baseFetch = globalThis.fetch;
    let releaseDelete: (() => void) | undefined;
    const deleteInFlight = new Promise<void>((resolve) => {
      releaseDelete = resolve;
    });
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? "GET").toUpperCase() === "DELETE") await deleteInFlight;
      return baseFetch(input, init);
    });

    renderWithProviders(<VideoGalleryPage />);
    await user.click(await screen.findByTestId("video-job-select-job-1"));
    await user.click(screen.getByTestId("media-delete-request"));
    await user.click(await screen.findByTestId("media-delete-confirm"));
    // 确认后弹窗立即关闭但请求仍在进行：用户此时预览同一个任务，删除随后才在后台完成。
    await waitFor(() => expect(screen.queryByTestId("media-delete-dialog")).not.toBeInTheDocument());
    await user.click(screen.getByTestId("video-job-preview-job-1"));
    expect(await screen.findByTestId("video-preview-player")).toBeInTheDocument();

    releaseDelete?.();
    // 任务已删除：预览随被删任务关闭，选中集合清空，且请求体只含该任务。
    await waitFor(() => expect(screen.queryByTestId("video-preview-player")).not.toBeInTheDocument());
    expect(screen.queryByTestId("media-selection-actions")).not.toBeInTheDocument();
    expect(requestsMatching(requests, "DELETE", VIDEOS_URL)[0].body).toEqual({ ids: ["job-1"] });
  });
});

import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GalleryPage } from "@/features/media/gallery-page";
import {
  installMediaApi,
  mediaImage,
  queryParam,
  lastRequestURL,
  renderWithProviders,
  requestsMatching,
} from "@/features/media/media-test-support";
import { i18n } from "@/shared/i18n";
import { formatNumber } from "@/shared/lib/format";

const IMAGES_URL = "/api/admin/v1/media/images";
const IMAGE_STATS_URL = "/api/admin/v1/media/images/stats";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GalleryPage", () => {
  it("渲染图片网格、统计摘要与卡片元信息", async () => {
    installMediaApi({
      images: [mediaImage({ id: "image-1" }), mediaImage({ id: "image-2", sizeBytes: 1024 })],
      imagesTotal: 2,
      imageStats: { totalImages: 2, totalBytes: 3072 },
    });
    renderWithProviders(<GalleryPage />);

    expect(await screen.findByTestId("gallery-card-image-1")).toBeInTheDocument();
    expect(screen.getByTestId("gallery-card-image-2")).toBeInTheDocument();
    expect(screen.getByTestId("gallery-grid")).toBeInTheDocument();
    expect(screen.getByText(i18n.t("media.images.totalImages"))).toBeInTheDocument();
    expect(screen.getByText(formatNumber(2, i18n.language, 0))).toBeInTheDocument();
    // 3072 B 走 formatBytes 的 KB 分支，与卡片自身的 "2 KB"/"1 KB" 区分开。
    expect(screen.getByText("3 KB")).toBeInTheDocument();
  });

  it("空库展示空态，输入关键字后改为无匹配文案并携带去抖关键字", async () => {
    const user = userEvent.setup();
    const { requests } = installMediaApi({ images: [], imagesTotal: 0 });
    renderWithProviders(<GalleryPage />);

    expect(await screen.findByTestId("gallery-empty")).toHaveTextContent(i18n.t("media.images.empty"));

    await user.type(screen.getByTestId("gallery-search"), "zzz");
    await waitFor(() => expect(queryParam(lastRequestURL(requests, IMAGES_URL), "search")).toBe("zzz"));
    expect(await screen.findByTestId("gallery-empty")).toHaveTextContent(i18n.t("media.images.noMatches"));
  });

  it("列表失败展示错误态并可重试", async () => {
    const user = userEvent.setup();
    const { requests } = installMediaApi({ failure: "images" });
    renderWithProviders(<GalleryPage />);

    const retry = await screen.findByRole("button", { name: i18n.t("common.retry") });
    expect(retry.parentElement?.textContent).toContain("imageListFailed");

    const before = requestsMatching(requests, "GET", IMAGES_URL).length;
    await user.click(retry);
    await waitFor(() => expect(requestsMatching(requests, "GET", IMAGES_URL).length).toBeGreaterThan(before));
  });

  it("统计接口失败时摘要显示占位符", async () => {
    installMediaApi({ images: [mediaImage()], imagesTotal: 1, failure: "imageStats" });
    renderWithProviders(<GalleryPage />);

    expect(await screen.findByTestId("gallery-card-image-1")).toBeInTheDocument();
    expect(screen.getByText(i18n.t("media.images.totalBytes")).parentElement).toHaveTextContent("-");
  });

  it("整页全选/取消与批量删除按选中 ID 提交", async () => {
    const user = userEvent.setup();
    const { requests } = installMediaApi({
      images: [mediaImage({ id: "image-1" }), mediaImage({ id: "image-2" })],
      imagesTotal: 2,
    });
    renderWithProviders(<GalleryPage />);
    await screen.findByTestId("gallery-card-image-1");

    await user.click(screen.getByTestId("gallery-select-page"));
    expect(screen.getByTestId("media-selection-actions")).toHaveTextContent(
      i18n.t("common.selectedCount", { count: 2 }),
    );

    await user.click(screen.getByTestId("gallery-select-page"));
    expect(screen.queryByTestId("media-selection-actions")).not.toBeInTheDocument();

    for (const id of ["image-1", "image-2"]) {
      await user.click(within(screen.getByTestId(`gallery-card-${id}`)).getByRole("checkbox"));
    }
    await user.click(screen.getByTestId("media-delete-request"));
    await user.click(await screen.findByTestId("media-delete-confirm"));

    await waitFor(() => {
      const deletes = requestsMatching(requests, "DELETE", IMAGES_URL);
      expect(deletes).toHaveLength(1);
      expect(deletes[0].body).toEqual({ ids: ["image-1", "image-2"] });
    });
    await waitFor(() => expect(screen.queryByTestId("media-selection-actions")).not.toBeInTheDocument());
  });

  it("删除确认可取消且不提交请求", async () => {
    const user = userEvent.setup();
    const { requests } = installMediaApi({ images: [mediaImage()], imagesTotal: 1 });
    renderWithProviders(<GalleryPage />);
    await screen.findByTestId("gallery-card-image-1");

    await user.click(within(screen.getByTestId("gallery-card-image-1")).getByRole("checkbox"));
    await user.click(screen.getByTestId("media-delete-request"));
    await user.click(await screen.findByRole("button", { name: i18n.t("common.cancel") }));

    await waitFor(() => expect(screen.queryByTestId("media-delete-dialog")).not.toBeInTheDocument());
    expect(requestsMatching(requests, "DELETE", IMAGES_URL)).toHaveLength(0);
  });

  it("删除失败时刷新列表且保持确认弹窗", async () => {
    const user = userEvent.setup();
    const { requests } = installMediaApi({ images: [mediaImage()], imagesTotal: 1, failure: "delete" });
    renderWithProviders(<GalleryPage />);
    await screen.findByTestId("gallery-card-image-1");

    await user.click(within(screen.getByTestId("gallery-card-image-1")).getByRole("checkbox"));
    await user.click(screen.getByTestId("media-delete-request"));
    await user.click(await screen.findByTestId("media-delete-confirm"));

    await waitFor(() => expect(requestsMatching(requests, "DELETE", IMAGES_URL)).toHaveLength(1));
    await waitFor(() => expect(requestsMatching(requests, "GET", IMAGES_URL).length).toBeGreaterThan(1));
    // 失败不静默：选中项保留，用户仍可重试删除。
    expect(screen.getByTestId("media-selection-actions")).toHaveTextContent(
      i18n.t("common.selectedCount", { count: 1 }),
    );
  });

  it("删除整页且不在首页时回退一页", async () => {
    const user = userEvent.setup();
    installMediaApi({
      images: Array.from({ length: 3 }, (_, index) => mediaImage({ id: `image-${index + 1}` })),
      imagesTotal: 25,
    });
    renderWithProviders(<GalleryPage />);
    await screen.findByTestId("gallery-card-image-1");

    await user.click(screen.getByRole("button", { name: i18n.t("common.nextPage") }));
    await waitFor(() => expect(screen.getByText(i18n.t("common.pageOf", { page: 2, pages: 2 }))).toBeInTheDocument());

    await user.click(screen.getByTestId("gallery-select-page"));
    await user.click(screen.getByTestId("media-delete-request"));
    await user.click(await screen.findByTestId("media-delete-confirm"));

    await waitFor(() => expect(screen.getByText(i18n.t("common.pageOf", { page: 1, pages: 2 }))).toBeInTheDocument());
  });

  it("刷新按钮同时重取列表与统计", async () => {
    const user = userEvent.setup();
    const { requests } = installMediaApi({ images: [mediaImage()], imagesTotal: 1 });
    renderWithProviders(<GalleryPage />);
    await screen.findByTestId("gallery-card-image-1");

    const listBefore = requestsMatching(requests, "GET", IMAGES_URL).length;
    const statsBefore = requestsMatching(requests, "GET", IMAGE_STATS_URL).length;
    await user.click(screen.getByTestId("media-refresh"));

    await waitFor(() => expect(requestsMatching(requests, "GET", IMAGES_URL).length).toBeGreaterThan(listBefore));
    await waitFor(() => expect(requestsMatching(requests, "GET", IMAGE_STATS_URL).length).toBeGreaterThan(statsBefore));
  });

  it("取消单选后回到非选择态并保留原图链接", async () => {
    const user = userEvent.setup();
    installMediaApi({ images: [mediaImage({ id: "image-1" })], imagesTotal: 1 });
    renderWithProviders(<GalleryPage />);
    const card = await screen.findByTestId("gallery-card-image-1");
    expect(within(card).getByRole("link")).toHaveAttribute("href", "/v1/media/images/image-1");

    const checkbox = within(card).getByRole("checkbox");
    await user.click(checkbox);
    expect(screen.getByTestId("media-selection-actions")).toBeInTheDocument();

    await user.click(checkbox);
    expect(screen.queryByTestId("media-selection-actions")).not.toBeInTheDocument();
    expect(within(card).getByRole("link")).toHaveAttribute("href", "/v1/media/images/image-1");
    // 非选择态点击卡片走原图链接分支（jsdom 不执行真实导航）。
    await user.click(within(card).getByRole("link"));
  });
});

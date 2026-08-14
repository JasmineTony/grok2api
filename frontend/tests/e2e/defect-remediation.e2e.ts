import { expect, expectMainReady, test } from "./fixtures";

async function expectOverlayInsideViewport(page: Parameters<typeof expectMainReady>[0]) {
  const overlay = page.locator('[role="menu"]:visible, [role="alertdialog"]:visible').last();
  await expect(overlay).toBeVisible();
  const box = await overlay.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  if (!box || !viewport) return;
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.y).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
}

async function expectNoRootOverflow(page: Parameters<typeof expectMainReady>[0]) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  expect(overflow).toBe(false);
}

test.describe("upstream parity defect remediation", () => {
  test("model filter submenus stay readable inside the viewport", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/models");
    await expectMainReady(page);
    await page.getByRole("button", { name: /Filters|筛选/ }).click();
    const provider = page.getByRole("menuitem", { name: /Model source|模型来源/ });
    await provider.hover();
    const consoleOption = page.getByRole("menuitemradio", { name: /Grok Console/ });
    await expect(consoleOption).toBeVisible();
    await expectOverlayInsideViewport(page);
    await consoleOption.click();
    await expect(page.getByRole("button", { name: /Filters|筛选/ })).toContainText("1");
    await expectNoRootOverflow(page);
  });

  test("network proxy filtering, cleanup confirmation, and source sync state remain reachable", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/settings/network");
    await expectMainReady(page);
    await expect(page.getByText("Console asset subscription upstream")).toBeVisible();
    await expect(page.getByText(/Last sync imported 12|最近导入 12 个/)).toBeVisible();

    const filteredRequest = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return (
        url.pathname.endsWith("/egress-nodes") && url.searchParams.get("probe") === "unhealthy"
      );
    });
    await page.getByRole("combobox", { name: /Health filter|健康筛选/ }).click();
    await page.getByRole("option", { name: /Unhealthy|不可用/ }).click();
    await filteredRequest;
    await expect(page.getByText(/Unhealthy subscription node/)).toBeVisible();
    await expect(page.getByText("Healthy web node")).toHaveCount(0);

    await page.getByRole("button", { name: /Clean all unusable|清理全部不可用/ }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/1/);
    await expect(dialog).toContainText(/3/);
    await expectOverlayInsideViewport(page);

    const cleanupRequest = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        new URL(request.url()).pathname.endsWith("/egress-nodes/cleanup"),
    );
    await dialog.getByRole("button", { name: /Clean nodes|确认清理/ }).click();
    await cleanupRequest;
    await expect(page.getByText(/Cleaned 1 unusable node|已清理 1 个不可用节点/)).toBeVisible();
    await expectNoRootOverflow(page);
  });

  test("creative video generate, edit, and extend operations are available", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/creative-console");
    await expectMainReady(page);
    await page.getByRole("tab", { name: /Video|视频/ }).click();
    const main = page.locator("main");
    const generate = main.getByRole("button", { name: /^(Generate|生成)$/ });
    const edit = main.getByRole("button", { name: /^(Edit|编辑)$/ });
    const extend = main.getByRole("button", { name: /^(Extend|延长)$/ });
    await expect(generate).toBeVisible();
    await expect(edit).toBeVisible();
    await expect(extend).toBeVisible();

    await edit.click();
    await expect(main.getByRole("button", { name: /Source video|源视频/ })).toBeVisible();
    await extend.click();
    await expect(main.getByRole("combobox", { name: /Extend duration|延长时长/ })).toBeVisible();
    await expectNoRootOverflow(page);
  });
});

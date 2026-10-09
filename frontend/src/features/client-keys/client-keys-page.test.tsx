import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { Toaster } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { ClientKeyDTO } from "@/features/client-keys/client-keys-api";
import { ClientKeysPage } from "@/features/client-keys/client-keys-page";
import {
  clientKeyDTO,
  clientKeyPage,
  createFakeApi,
  matchFakeRoute,
  ResizeObserverStub,
  type FakeApiCall,
  type FakeApiRoutes,
} from "@/features/client-keys/client-keys-test-support";
import { ApiError } from "@/shared/api/client";
import { i18n } from "@/shared/i18n";
import { USD_TICKS_PER_DOLLAR } from "@/shared/lib/usd";

// 关键路径组件集成测试（AGENTS.md TEST-3）：只替换 apiRequest 这一网络边界，
// 页面组件、react-query 状态流、DTO decoder、表单校验与错误提示全部保持真实实现。
const apiMock = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock("@/shared/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/api/client")>();
  return { ...actual, apiRequest: apiMock.request };
});

type RecordedCall = [path: string, options: { method?: string; body?: unknown }];

function recordedCalls(): RecordedCall[] {
  return apiMock.request.mock.calls as RecordedCall[];
}

function callsOf(method: string, pathPrefix: string): RecordedCall[] {
  return recordedCalls().filter(
    ([path, options]) => path.startsWith(pathPrefix) && (options.method ?? "GET") === method,
  );
}

function listQueries(): URLSearchParams[] {
  return callsOf("GET", "/api/admin/v1/client-keys?").map(
    ([path]) => new URLSearchParams(path.slice(path.indexOf("?") + 1)),
  );
}

function lastListQuery(): URLSearchParams {
  const queries = listQueries();
  expect(queries.length).toBeGreaterThan(0);
  return queries[queries.length - 1];
}

/** 只 mock 网络边界：未注册的请求直接失败，避免测试静默通过。 */
function installRoutes(routes: FakeApiRoutes): void {
  apiMock.request.mockImplementation(
    createFakeApi((call: FakeApiCall) => {
      const handler = matchFakeRoute(call, routes);
      if (!handler) throw new ApiError(500, "unexpectedRequest", `未注册的请求：${call.method} ${call.path}`);
      return handler(call);
    }),
  );
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
        <TooltipProvider delayDuration={0}>
          <ClientKeysPage />
          <Toaster />
        </TooltipProvider>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

const user = () => userEvent.setup();

beforeEach(async () => {
  apiMock.request.mockReset();
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  await i18n.changeLanguage("zh-CN");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ClientKeysPage 列表加载", () => {
  it("加载成功后展示行、掩码前缀、状态与计费用量", async () => {
    const keys = [
      clientKeyDTO({ id: "key-1", name: "生产密钥", prefix: "abcd1234" }),
      clientKeyDTO({ id: "key-2", name: "停用密钥", prefix: "efgh5678", enabled: false, rpmLimit: 0 }),
      clientKeyDTO({
        id: "key-3",
        name: "限额密钥",
        billingLimitUsdTicks: 20 * USD_TICKS_PER_DOLLAR,
        billedUsageUsdTicks: 5 * USD_TICKS_PER_DOLLAR,
      }),
      clientKeyDTO({ id: "key-4", name: "过期密钥", expiresAt: "2020-01-01T00:00:00.000Z" }),
    ];
    installRoutes({ list: () => clientKeyPage(keys) });

    renderPage();

    expect(await screen.findByTestId("client-keys-row-key-1")).toBeInTheDocument();
    expect(within(screen.getByTestId("client-keys-row-key-1")).getByText("生产密钥")).toBeInTheDocument();
    expect(screen.getByTestId("client-keys-prefix-key-1")).toHaveTextContent("g2a_abcd1234_********");
    expect(screen.getByTestId("client-keys-status-key-1")).toHaveTextContent(i18n.t("keys.statusActive"));
    expect(screen.getByTestId("client-keys-status-key-2")).toHaveTextContent(i18n.t("common.disabled"));
    expect(screen.getByTestId("client-keys-billing-key-1")).toHaveTextContent(i18n.t("keys.unlimited"));
    // 设置用量上限时展示「已用 / 上限」
    expect(screen.getByTestId("client-keys-billing-key-3")).toHaveTextContent("$5.00");
    expect(screen.getByTestId("client-keys-billing-key-3")).toHaveTextContent("$20.00");
    expect(screen.getByTestId("client-keys-status-key-4")).toHaveTextContent(i18n.t("keys.statusExpired"));
    // rpmLimit = 0 表示不限
    expect(within(screen.getByTestId("client-keys-row-key-2")).getAllByText(i18n.t("keys.unlimited")).length).toBe(2);
  });

  it("空结果显示空态文案", async () => {
    installRoutes({ list: () => clientKeyPage([]) });

    renderPage();

    expect(await screen.findByTestId("client-keys-empty")).toHaveTextContent(i18n.t("common.noData"));
    expect(screen.queryByTestId("client-keys-table")).not.toBeInTheDocument();
  });

  it("加载失败展示错误信息，重试后恢复列表", async () => {
    let failed = false;
    installRoutes({
      list: () => {
        if (!failed) {
          failed = true;
          throw new ApiError(503, "unavailable", "密钥服务暂不可用");
        }
        return clientKeyPage([clientKeyDTO({ id: "key-1" })]);
      },
    });

    renderPage();

    expect(await screen.findByTestId("client-keys-error")).toHaveTextContent("密钥服务暂不可用");
    await user().click(
      within(screen.getByTestId("client-keys-error")).getByRole("button", { name: i18n.t("common.retry") }),
    );

    expect(await screen.findByTestId("client-keys-row-key-1")).toBeInTheDocument();
    expect(screen.queryByTestId("client-keys-error")).not.toBeInTheDocument();
  });
});

describe("ClientKeysPage 查询参数", () => {
  it("搜索经过防抖后写入查询参数并回到第 1 页", async () => {
    installRoutes({ list: (call) => clientKeyPage(call.query.get("search") ? [] : [clientKeyDTO({ id: "key-1" })]) });
    renderPage();
    await screen.findByTestId("client-keys-row-key-1");

    await user().type(screen.getByTestId("client-keys-search"), "生产");

    await waitFor(() => expect(lastListQuery().get("search")).toBe("生产"), { timeout: 3_000 });
    expect(lastListQuery().get("page")).toBe("1");
    expect(await screen.findByTestId("client-keys-empty")).toBeInTheDocument();
  });

  it("状态筛选写入 status 参数", async () => {
    installRoutes({ list: (call) => clientKeyPage(call.query.get("status") ? [] : [clientKeyDTO({ id: "key-1" })]) });
    renderPage();
    await screen.findByTestId("client-keys-row-key-1");

    await user().click(screen.getByRole("button", { name: new RegExp(i18n.t("common.filter")) }));
    await user().click(await screen.findByRole("menuitem", { name: i18n.t("keys.status") }));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: i18n.t("common.disabled") }));

    await waitFor(() => expect(lastListQuery().get("status")).toBe("disabled"));
    expect(await screen.findByTestId("client-keys-empty")).toBeInTheDocument();
  });

  it("排序表头切换 sortBy / sortOrder", async () => {
    installRoutes({ list: () => clientKeyPage([clientKeyDTO({ id: "key-1" })]) });
    renderPage();
    await screen.findByTestId("client-keys-row-key-1");

    const sortButton = () =>
      screen.getByRole("button", {
        name: i18n.t("common.sortAscending", { column: i18n.t("keys.name") }),
      });
    await user().click(sortButton());

    await waitFor(() => expect(lastListQuery().get("sortBy")).toBe("name"));
    expect(lastListQuery().get("sortOrder")).toBe("asc");

    await user().click(
      screen.getByRole("button", { name: i18n.t("common.sortDescending", { column: i18n.t("keys.name") }) }),
    );
    await waitFor(() => expect(lastListQuery().get("sortOrder")).toBe("desc"));
  });
});

describe("ClientKeysPage 批量操作与删除", () => {
  it("勾选后出现批量操作，启用会提交所选 id 并清空选择", async () => {
    const keys = [clientKeyDTO({ id: "key-1" }), clientKeyDTO({ id: "key-2", enabled: false })];
    installRoutes({
      list: () => clientKeyPage(keys),
      batchUpdate: (call) => ({ updated: (call.body as { ids: string[] }).ids.length }),
    });
    renderPage();
    await screen.findByTestId("client-keys-row-key-1");

    await user().click(screen.getByTestId("client-keys-select-page"));
    const toolbar = await screen.findByTestId("client-keys-batch-actions");
    expect(toolbar).toHaveTextContent(i18n.t("common.selectedCount", { count: 2 }));

    await user().click(screen.getByTestId("client-keys-batch-enable"));

    expect(await screen.findByText(i18n.t("keys.batchUpdated"))).toBeInTheDocument();
    const batchCalls = callsOf("PATCH", "/api/admin/v1/client-keys/batch");
    expect(batchCalls).toHaveLength(1);
    expect(batchCalls[0][1].body).toEqual({ ids: ["key-1", "key-2"], enabled: true });
    await waitFor(() => expect(screen.queryByTestId("client-keys-batch-actions")).not.toBeInTheDocument());
    expect(screen.getByTestId("client-keys-create")).toBeInTheDocument();
  });

  it("停用按钮提交 enabled=false", async () => {
    installRoutes({ list: () => clientKeyPage([clientKeyDTO({ id: "key-1" })]), batchUpdate: () => ({ updated: 1 }) });
    renderPage();
    await screen.findByTestId("client-keys-row-key-1");

    await user().click(screen.getByTestId("client-keys-select-key-1"));
    await user().click(await screen.findByTestId("client-keys-batch-disable"));

    await waitFor(() => expect(callsOf("PATCH", "/api/admin/v1/client-keys/batch")).toHaveLength(1));
    expect(callsOf("PATCH", "/api/admin/v1/client-keys/batch")[0][1].body).toEqual({
      ids: ["key-1"],
      enabled: false,
    });
  });

  it("删除确认框取消时不发起请求", async () => {
    installRoutes({ list: () => clientKeyPage([clientKeyDTO({ id: "key-1" })]) });
    renderPage();
    await screen.findByTestId("client-keys-row-key-1");

    await user().click(screen.getByTestId("client-keys-actions-key-1"));
    fireEvent.click(await screen.findByTestId("client-keys-delete-key-1"));
    const dialog = await screen.findByTestId("client-keys-delete-dialog");
    expect(dialog).toHaveTextContent(i18n.t("keys.deleteTitle"));

    await user().click(screen.getByTestId("client-keys-delete-dialog-cancel"));

    await waitFor(() => expect(screen.queryByTestId("client-keys-delete-dialog")).not.toBeInTheDocument());
    expect(callsOf("DELETE", "/api/admin/v1/client-keys/key-1")).toHaveLength(0);
    expect(screen.getByTestId("client-keys-row-key-1")).toBeInTheDocument();
  });

  it("确认删除后行消失并提示已删除", async () => {
    let keys = [clientKeyDTO({ id: "key-1" }), clientKeyDTO({ id: "key-2" })];
    installRoutes({
      list: () => clientKeyPage(keys),
      remove: () => {
        keys = keys.filter((key) => key.id !== "key-1");
        return { deleted: true };
      },
    });
    renderPage();
    await screen.findByTestId("client-keys-row-key-2");

    await user().click(screen.getByTestId("client-keys-actions-key-1"));
    fireEvent.click(await screen.findByTestId("client-keys-delete-key-1"));
    await user().click(await screen.findByTestId("client-keys-delete-dialog-confirm"));

    expect(await screen.findByText(i18n.t("keys.deleted"))).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId("client-keys-row-key-1")).not.toBeInTheDocument());
    expect(screen.getByTestId("client-keys-row-key-2")).toBeInTheDocument();
  });

  it("批量删除确认框展示选中数量并提交 ids", async () => {
    const keys = [clientKeyDTO({ id: "key-1" }), clientKeyDTO({ id: "key-2" })];
    installRoutes({ list: () => clientKeyPage(keys), batchDelete: () => ({ deleted: 2 }) });
    renderPage();
    await screen.findByTestId("client-keys-row-key-1");

    await user().click(screen.getByTestId("client-keys-select-page"));
    await user().click(await screen.findByTestId("client-keys-batch-delete"));
    const dialog = await screen.findByTestId("client-keys-batch-delete-dialog");
    expect(dialog).toHaveTextContent(i18n.t("keys.batchDeleteTitle", { count: 2 }));

    await user().click(screen.getByTestId("client-keys-batch-delete-dialog-confirm"));

    await waitFor(() => expect(callsOf("DELETE", "/api/admin/v1/client-keys")).toHaveLength(1));
    expect(callsOf("DELETE", "/api/admin/v1/client-keys")[0][1].body).toEqual({ ids: ["key-1", "key-2"] });
    expect(await screen.findByText(i18n.t("keys.deleted"))).toBeInTheDocument();
  });
});

describe("ClientKeysPage 密钥明文", () => {
  it("复制明文走独立接口并展示复制弹窗", async () => {
    installRoutes({
      list: () => clientKeyPage([clientKeyDTO({ id: "key-1" })]),
      secret: () => ({ secret: "g2a_abcd1234_full-secret" }),
    });
    renderPage();
    await screen.findByTestId("client-keys-row-key-1");

    const u = user();
    await u.click(screen.getByTestId("client-keys-copy-key-1"));

    expect(await screen.findByTestId("client-keys-secret-value")).toHaveTextContent("g2a_abcd1234_full-secret");
    expect(screen.getByTestId("client-keys-secret-dialog")).toHaveTextContent(i18n.t("keys.copySecretTitle"));

    // 弹窗内复制按钮成功后提示已复制（jsdom 无 Clipboard API，显式提供安全上下文与写接口）
    vi.stubGlobal("isSecureContext", true);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, "clipboard", { value: { writeText }, configurable: true });
    await u.click(
      within(screen.getByTestId("client-keys-secret-dialog")).getByRole("button", { name: i18n.t("keys.copySecret") }),
    );

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("g2a_abcd1234_full-secret"));
    expect(await screen.findByText(i18n.t("common.copied"))).toBeInTheDocument();

    // Esc 关闭弹窗走 onOpenChange，明文不再保留在页面上
    await u.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("client-keys-secret-dialog")).not.toBeInTheDocument());
    expect(screen.queryByTestId("client-keys-secret-value")).not.toBeInTheDocument();
  });
});

describe("ClientKeysPage 创建与编辑", () => {
  it("校验失败时提示且不发起创建请求", async () => {
    installRoutes({ list: () => clientKeyPage([]) });
    renderPage();
    await screen.findByTestId("client-keys-empty");

    await user().click(screen.getByTestId("client-keys-create"));
    await user().click(await screen.findByTestId("client-keys-form-submit"));

    expect(await screen.findByTestId("client-keys-form-name-error")).toHaveTextContent(i18n.t("errors.required"));
    expect(callsOf("POST", "/api/admin/v1/client-keys")).toHaveLength(0);
  });

  it("创建成功后展示一次性明文，关闭后列表只保留掩码", async () => {
    let keys: ClientKeyDTO[] = [];
    installRoutes({
      list: () => clientKeyPage(keys),
      create: (call) => {
        const body = call.body as { name: string };
        keys = [clientKeyDTO({ id: "key-new", name: body.name, prefix: "new12345" })];
        return { key: keys[0], secret: "g2a_new12345_once-only" };
      },
    });
    renderPage();
    await screen.findByTestId("client-keys-empty");

    await user().click(screen.getByTestId("client-keys-create"));
    await user().type(await screen.findByTestId("client-keys-form-name"), "临时密钥");
    await user().click(screen.getByTestId("client-keys-form-submit"));

    expect(await screen.findByTestId("client-keys-secret-dialog")).toHaveTextContent(i18n.t("keys.secretTitle"));
    expect(screen.getByTestId("client-keys-secret-value")).toHaveTextContent("g2a_new12345_once-only");
    const createCalls = callsOf("POST", "/api/admin/v1/client-keys");
    expect(createCalls).toHaveLength(1);
    expect((createCalls[0][1].body as { name: string }).name).toBe("临时密钥");

    await user().click(screen.getByTestId("client-keys-secret-close"));

    await waitFor(() => expect(screen.queryByTestId("client-keys-secret-value")).not.toBeInTheDocument());
    expect(await screen.findByTestId("client-keys-row-key-new")).toBeInTheDocument();
    expect(screen.getByTestId("client-keys-prefix-key-new")).toHaveTextContent("g2a_new12345_********");
    expect(screen.queryByText("g2a_new12345_once-only")).not.toBeInTheDocument();
  });

  it("提交中禁用提交按钮，重复点击不会重复创建", async () => {
    let releaseCreate: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      releaseCreate = resolve;
    });
    installRoutes({
      list: () => clientKeyPage([]),
      create: async () => {
        await pending;
        return { key: clientKeyDTO({ id: "key-new" }), secret: "g2a_new_once" };
      },
    });
    renderPage();
    await screen.findByTestId("client-keys-empty");

    await user().click(screen.getByTestId("client-keys-create"));
    await user().type(await screen.findByTestId("client-keys-form-name"), "并发密钥");
    const submit = screen.getByTestId("client-keys-form-submit");
    await user().click(submit);

    await waitFor(() => expect(callsOf("POST", "/api/admin/v1/client-keys")).toHaveLength(1));
    await waitFor(() => expect(submit).toBeDisabled());
    fireEvent.click(submit);
    expect(callsOf("POST", "/api/admin/v1/client-keys")).toHaveLength(1);

    releaseCreate?.();
    expect(await screen.findByTestId("client-keys-secret-value")).toHaveTextContent("g2a_new_once");
  });

  it("编辑提交字段变更并提示已更新", async () => {
    const key = clientKeyDTO({ id: "key-1", name: "旧名称", rpmLimit: 120 });
    installRoutes({
      list: () => clientKeyPage([key]),
      update: (call) => ({ ...key, ...(call.body as Partial<ClientKeyDTO>) }),
    });
    renderPage();
    await screen.findByTestId("client-keys-row-key-1");

    await user().click(screen.getByTestId("client-keys-actions-key-1"));
    fireEvent.click(await screen.findByTestId("client-keys-edit-key-1"));

    const nameInput = await screen.findByTestId("client-keys-form-name");
    expect(nameInput).toHaveValue("旧名称");
    await user().clear(nameInput);
    await user().type(nameInput, "新名称");
    await user().click(screen.getByTestId("client-keys-form-submit"));

    expect(await screen.findByText(i18n.t("keys.updated"))).toBeInTheDocument();
    const updateCalls = callsOf("PATCH", "/api/admin/v1/client-keys/key-1");
    expect(updateCalls).toHaveLength(1);
    expect((updateCalls[0][1].body as { name: string }).name).toBe("新名称");
    await waitFor(() => expect(screen.queryByTestId("client-keys-form-dialog")).not.toBeInTheDocument());
  });

  it("编辑失败时展示接口错误信息且弹窗保留", async () => {
    installRoutes({
      list: () => clientKeyPage([clientKeyDTO({ id: "key-1", name: "旧名称" })]),
      update: () => {
        throw new ApiError(409, "conflict", "密钥名称已存在");
      },
    });
    renderPage();
    await screen.findByTestId("client-keys-row-key-1");

    await user().click(screen.getByTestId("client-keys-actions-key-1"));
    fireEvent.click(await screen.findByTestId("client-keys-edit-key-1"));
    await user().click(await screen.findByTestId("client-keys-form-submit"));

    expect(await screen.findByText("密钥名称已存在")).toBeInTheDocument();
    expect(screen.getByTestId("client-keys-form-dialog")).toBeInTheDocument();
  });
});

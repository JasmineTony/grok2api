import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { Toaster } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { ClientKeyDTO, ClientKeyInput } from "@/features/client-keys/client-keys-api";
import { ClientKeysPage } from "@/features/client-keys/client-keys-page";
import {
  clientKeyDTO,
  clientKeyPage,
  createFakeApi,
  matchFakeRoute,
  modelPage,
  modelRouteDTO,
  ResizeObserverStub,
  type FakeApiCall,
  type FakeApiRoutes,
} from "@/features/client-keys/client-keys-test-support";
import { ApiError } from "@/shared/api/client";
import { i18n } from "@/shared/i18n";
import { USD_TICKS_PER_DOLLAR } from "@/shared/lib/usd";

// 创建/编辑弹窗的范围与模型选择集成测试：只替换 apiRequest，表单、校验、
// models 查询与 scope 摘要逻辑全部保持真实实现。
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

function modelQueries(): URLSearchParams[] {
  return callsOf("GET", "/api/admin/v1/models?").map(
    ([path]) => new URLSearchParams(path.slice(path.indexOf("?") + 1)),
  );
}

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

async function openCreateDialog(keys: ClientKeyDTO[] = []): Promise<void> {
  renderPage();
  await screen.findByTestId(keys.length === 0 ? "client-keys-empty" : `client-keys-row-${keys[0].id}`);
  await user().click(screen.getByTestId("client-keys-create"));
  await screen.findByTestId("client-keys-form-dialog");
}

async function switchToRestrictedModels(): Promise<void> {
  await user().click(screen.getByTestId("client-keys-form-model-scope"));
  fireEvent.click(await screen.findByRole("menuitemradio", { name: i18n.t("keys.restrictedModels") }));
  await screen.findByTestId("client-keys-model-options");
}

beforeEach(async () => {
  apiMock.request.mockReset();
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  await i18n.changeLanguage("zh-CN");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("创建弹窗默认值", () => {
  it("打开创建弹窗展示默认范围摘要与默认开关状态", async () => {
    installRoutes({ list: () => clientKeyPage([]) });
    await openCreateDialog();

    expect(screen.getByTestId("client-keys-form-dialog")).toHaveTextContent(i18n.t("keys.createTitle"));
    expect(screen.getByTestId("client-keys-form-name")).toHaveValue("");
    expect(screen.getByTestId("key-enabled")).toBeChecked();
    expect(screen.getByTestId("key-billing-unlimited")).toBeChecked();
    expect(screen.getByTestId("key-expiry-unlimited")).toBeChecked();
    expect(screen.getByTestId("key-rpm-unlimited")).not.toBeChecked();
    expect(screen.getByTestId("client-keys-form-provider-scope")).toHaveTextContent(i18n.t("keys.allProviders"));
    expect(screen.getByTestId("client-keys-form-tier-scope")).toHaveTextContent(i18n.t("keys.allTiers"));
    expect(screen.getByTestId("client-keys-form-model-scope")).toHaveTextContent(i18n.t("keys.allModels"));
    // 全部模型范围下不请求模型列表
    expect(modelQueries()).toHaveLength(0);
  });
});

describe("模型范围与模型选择", () => {
  it("切换为指定模型后加载模型列表并提交所选模型", async () => {
    const created: ClientKeyInput[] = [];
    installRoutes({
      list: () => clientKeyPage([]),
      models: () => modelPage([modelRouteDTO({ id: "model-1", publicId: "grok-4" })]),
      create: (call) => {
        created.push(call.body as ClientKeyInput);
        return { key: clientKeyDTO({ id: "key-new" }), secret: "g2a_secret" };
      },
    });
    await openCreateDialog();

    await switchToRestrictedModels();
    expect(modelQueries()).toHaveLength(1);

    await user().click(await screen.findByRole("checkbox", { name: i18n.t("common.selectItem", { name: "grok-4" }) }));
    expect(screen.getByTestId("client-keys-form-model-scope")).toHaveTextContent(
      i18n.t("keys.selectedModels", { count: 1 }),
    );

    await user().type(screen.getByTestId("client-keys-form-name"), "限定模型密钥");
    await user().click(screen.getByTestId("client-keys-form-submit"));

    expect(await screen.findByTestId("client-keys-secret-value")).toHaveTextContent("g2a_secret");
    expect(created).toHaveLength(1);
    expect(created[0].allowedModelIds).toEqual(["model-1"]);
    expect(created[0].providerScope).toEqual(["all"]);
  });

  it("指定模型但未选择任何模型时校验失败且不提交", async () => {
    installRoutes({ list: () => clientKeyPage([]), models: () => modelPage([modelRouteDTO()]) });
    await openCreateDialog();

    await switchToRestrictedModels();
    await user().type(screen.getByTestId("client-keys-form-name"), "空模型密钥");
    await user().click(screen.getByTestId("client-keys-form-submit"));

    expect(await screen.findByTestId("client-keys-form-models-error")).toHaveTextContent(
      i18n.t("keys.selectModelRequired"),
    );
    expect(callsOf("POST", "/api/admin/v1/client-keys")).toHaveLength(0);
  });

  // 覆盖插桩 + 真实 300ms 防抖使这些交互用例明显变慢，显式放宽用例超时（默认 5s 会超时）
  it("渠道范围变化时清空已选模型并提示重新选择", async () => {
    installRoutes({
      list: () => clientKeyPage([]),
      models: () => modelPage([modelRouteDTO({ id: "model-1", publicId: "grok-4" })]),
    });
    await openCreateDialog();

    await switchToRestrictedModels();
    await user().click(await screen.findByRole("checkbox", { name: i18n.t("common.selectItem", { name: "grok-4" }) }));

    await user().click(screen.getByTestId("client-keys-form-provider-scope"));
    fireEvent.click(await screen.findByRole("menuitemcheckbox", { name: "Web" }));

    // 渠道范围菜单项阻止了默认关闭行为，按 Esc 关闭菜单后再断言（菜单打开时会 aria-hidden 页面其余部分）
    await user().keyboard("{Escape}");

    expect(await screen.findByText(i18n.t("keys.modelsClearedForScopeChange"))).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("client-keys-form-model-scope")).toHaveTextContent(
        i18n.t("keys.selectedModels", { count: 0 }),
      ),
    );
    expect(screen.getByRole("checkbox", { name: i18n.t("common.selectItem", { name: "grok-4" }) })).not.toBeChecked();
    // 渠道摘要随之更新
    await waitFor(() =>
      expect(screen.getByTestId("client-keys-form-provider-scope")).toHaveTextContent("Build · Console"),
    );
  }, 20_000);

  it("模型搜索与分页写入 models 查询参数", async () => {
    installRoutes({
      list: () => clientKeyPage([]),
      models: (call) =>
        modelPage([modelRouteDTO({ id: "model-1", publicId: "grok-4" })], {
          page: Number(call.query.get("page") ?? 1),
          total: 60,
        }),
    });
    await openCreateDialog();
    await switchToRestrictedModels();

    expect(await screen.findByRole("button", { name: i18n.t("common.nextPage") })).toBeInTheDocument();
    await user().click(screen.getByRole("button", { name: i18n.t("common.nextPage") }));
    await waitFor(() => expect(modelQueries().at(-1)?.get("page")).toBe("2"));

    await user().type(screen.getByTestId("client-keys-model-search"), "grok-4");
    await waitFor(() => expect(modelQueries().at(-1)?.get("search")).toBe("grok-4"), { timeout: 3_000 });
    expect(modelQueries().at(-1)?.get("page")).toBe("1");
  }, 20_000);
});

describe("表单字段与校验", () => {
  it("不限开关禁用数值输入，关闭有效期不限后校验失败", async () => {
    installRoutes({ list: () => clientKeyPage([]) });
    await openCreateDialog();

    // 默认：用量不限，因此金额输入不可编辑
    expect(screen.getByTestId("key-billing-limit")).toBeDisabled();
    await user().click(screen.getByTestId("key-billing-unlimited"));
    expect(screen.getByTestId("key-billing-limit")).not.toBeDisabled();

    await user().click(screen.getByTestId("key-rpm-unlimited"));
    expect(screen.getByTestId("key-rpm")).toBeDisabled();
    await user().click(screen.getByTestId("key-concurrency-unlimited"));
    expect(screen.getByTestId("key-concurrency")).toBeDisabled();

    await user().type(screen.getByTestId("client-keys-form-name"), "期限密钥");
    await user().click(screen.getByTestId("key-expiry-unlimited"));
    await user().click(screen.getByTestId("client-keys-form-submit"));

    expect(await screen.findByTestId("client-keys-form-expires-at-error")).toHaveTextContent(i18n.t("errors.required"));
    expect(callsOf("POST", "/api/admin/v1/client-keys")).toHaveLength(0);

    // 重新开启有效期不限后清除该字段错误
    await user().click(screen.getByTestId("key-expiry-unlimited"));
    await waitFor(() => expect(screen.queryByTestId("client-keys-form-expires-at-error")).not.toBeInTheDocument());
  });

  it("订阅范围选择更新摘要并写入提交体", async () => {
    const created: ClientKeyInput[] = [];
    installRoutes({
      list: () => clientKeyPage([]),
      create: (call) => {
        created.push(call.body as ClientKeyInput);
        return { key: clientKeyDTO({ id: "key-new" }), secret: "g2a_secret" };
      },
    });
    await openCreateDialog();

    const tierScope = () => screen.getByTestId("client-keys-form-tier-scope");
    async function pickTier(name: string): Promise<void> {
      await user().click(tierScope());
      fireEvent.click(await screen.findByRole("menuitemcheckbox", { name }));
      await user().keyboard("{Escape}");
    }

    await pickTier("Super");
    await waitFor(() => expect(tierScope()).toHaveTextContent("Super"));

    await pickTier(i18n.t("keys.allTiersIncludingUnknown"));
    await waitFor(() => expect(tierScope()).toHaveTextContent(i18n.t("keys.allTiers")));

    await pickTier("Super");
    await waitFor(() => expect(tierScope()).toHaveTextContent("Super"));

    await user().type(screen.getByTestId("client-keys-form-name"), "订阅范围密钥");
    await user().click(screen.getByTestId("client-keys-form-submit"));

    expect(await screen.findByTestId("client-keys-secret-value")).toHaveTextContent("g2a_secret");
    expect(created[0].tierScope).toEqual(["super"]);
  }, 20_000);
});

describe("编辑弹窗回填", () => {
  it("受限模型的密钥在编辑时回填已选模型", async () => {
    const key = clientKeyDTO({ id: "key-1", name: "受限密钥", allowedModelIds: ["model-1"] });
    installRoutes({
      list: () => clientKeyPage([key]),
      models: () => modelPage([modelRouteDTO({ id: "model-1", publicId: "grok-4" })]),
    });
    renderPage();
    await screen.findByTestId("client-keys-row-key-1");

    await user().click(screen.getByTestId("client-keys-actions-key-1"));
    fireEvent.click(await screen.findByTestId("client-keys-edit-key-1"));

    expect(await screen.findByTestId("client-keys-model-options")).toBeInTheDocument();
    expect(screen.getByTestId("client-keys-form-model-scope")).toHaveTextContent(
      i18n.t("keys.selectedModels", { count: 1 }),
    );
    expect(
      await screen.findByRole("checkbox", { name: i18n.t("common.selectItem", { name: "grok-4" }) }),
    ).toBeChecked();
  });

  it("别名与启用开关写入提交体", async () => {
    const updated: ClientKeyInput[] = [];
    const key = clientKeyDTO({
      id: "key-1",
      name: "开关密钥",
      rpmLimit: 0,
      maxConcurrent: 0,
      billingLimitUsdTicks: 20 * USD_TICKS_PER_DOLLAR,
      billedUsageUsdTicks: 5 * USD_TICKS_PER_DOLLAR,
    });
    installRoutes({
      list: () => clientKeyPage([key]),
      update: (call) => {
        updated.push(call.body as ClientKeyInput);
        return key;
      },
    });
    renderPage();
    await screen.findByTestId("client-keys-row-key-1");

    await user().click(screen.getByTestId("client-keys-actions-key-1"));
    fireEvent.click(await screen.findByTestId("client-keys-edit-key-1"));
    await user().click(await screen.findByTestId("key-model-aliases"));
    await user().click(screen.getByTestId("key-enabled"));
    await user().click(screen.getByTestId("client-keys-form-submit"));

    expect(await screen.findByText(i18n.t("keys.updated"))).toBeInTheDocument();
    expect(updated).toHaveLength(1);
    expect(updated[0].allowModelAliases).toBe(true);
    expect(updated[0].enabled).toBe(false);
    // 回填「不限」的字段提交时仍以 0 表示，用量上限按 tick 还原
    expect(updated[0].rpmLimit).toBe(0);
    expect(updated[0].maxConcurrent).toBe(0);
    expect(updated[0].billingLimitUsdTicks).toBe(20 * USD_TICKS_PER_DOLLAR);
  });

  it("Esc 与取消按钮关闭弹窗且不提交", async () => {
    installRoutes({ list: () => clientKeyPage([clientKeyDTO({ id: "key-1" })]) });
    renderPage();
    await screen.findByTestId("client-keys-row-key-1");

    // Esc 关闭走 Dialog onOpenChange
    await user().click(screen.getByTestId("client-keys-actions-key-1"));
    fireEvent.click(await screen.findByTestId("client-keys-edit-key-1"));
    await user().keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("client-keys-form-dialog")).not.toBeInTheDocument());

    // 取消按钮关闭
    await user().click(screen.getByTestId("client-keys-actions-key-1"));
    fireEvent.click(await screen.findByTestId("client-keys-edit-key-1"));
    await user().click(await screen.findByTestId("client-keys-form-cancel"));

    await waitFor(() => expect(screen.queryByTestId("client-keys-form-dialog")).not.toBeInTheDocument());
    expect(callsOf("PATCH", "/api/admin/v1/client-keys/key-1")).toHaveLength(0);
    expect(within(screen.getByTestId("client-keys-row-key-1")).getByText("生产密钥")).toBeInTheDocument();
  });
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { Toaster } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { EgressProxyProfiles } from "@/features/settings/egress-proxy-profiles";
import {
  createEgressFakeApi,
  egressProxyProfileListWire,
  egressProxyProfileWire,
  matchEgressRoute,
  ResizeObserverStub,
  type EgressFakeRoutes,
  type FakeApiCall,
} from "@/features/settings/egress-test-support";
import { ApiError } from "@/shared/api/client";
import { i18n } from "@/shared/i18n";

// 关键路径组件集成测试（AGENTS.md TEST-3）：只替换 apiRequest 这一网络边界，
// 代理配置库、settings-api decoder、react-query 状态流与表单校验保持真实实现。
const apiMock = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock("@/shared/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/api/client")>();
  return { ...actual, apiRequest: apiMock.request };
});

type RecordedCall = [path: string, options: { method?: string; body?: unknown }];

function callsOf(method: string, pathPrefix: string): RecordedCall[] {
  return (apiMock.request.mock.calls as RecordedCall[]).filter(
    ([path, options]) => path.startsWith(pathPrefix) && (options.method ?? "GET") === method,
  );
}

function installRoutes(routes: EgressFakeRoutes): void {
  apiMock.request.mockImplementation(
    createEgressFakeApi((call: FakeApiCall) => {
      const handler = matchEgressRoute(call, routes);
      if (!handler) throw new ApiError(500, "unexpectedRequest", `未注册的请求：${call.method} ${call.path}`);
      return handler(call);
    }),
  );
}

function renderProfiles(onCreated = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
        <TooltipProvider delayDuration={0}>
          <EgressProxyProfiles open onOpenChange={() => {}} onCreated={onCreated} />
          <Toaster />
        </TooltipProvider>
      </I18nextProvider>
    </QueryClientProvider>,
  );
  return onCreated;
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

describe("EgressProxyProfiles 配置库列表", () => {
  it("加载成功后展示名称、地址与绑定节点数", async () => {
    installRoutes({
      profiles: () =>
        egressProxyProfileListWire([
          egressProxyProfileWire({ id: "prof-1", name: "机房代理", boundNodeCount: 2 }),
          egressProxyProfileWire({ id: "prof-2", name: "备用代理", proxyDisplay: "", proxyFingerprint: undefined }),
        ]),
    });

    renderProfiles();

    expect(await screen.findByTestId("egress-proxy-profile-row-prof-1")).toBeInTheDocument();
    expect(within(screen.getByTestId("egress-proxy-profile-row-prof-1")).getByText("机房代理")).toBeInTheDocument();
    expect(screen.getByTestId("egress-proxy-profile-nodes-prof-1")).toHaveTextContent("2");
    expect(screen.getByTestId("egress-proxy-profile-nodes-prof-2")).toHaveTextContent("0");
  });

  it("空配置库与搜索无匹配分别展示对应文案", async () => {
    installRoutes({ profiles: () => egressProxyProfileListWire([]) });

    renderProfiles();

    expect(await screen.findByText(i18n.t("egressProxyProfiles.emptyLibrary"))).toBeInTheDocument();

    await user().type(screen.getByTestId("egress-proxy-profiles-search"), "机房");

    await waitFor(() => expect(screen.getByText(i18n.t("egressProxyProfiles.noMatches"))).toBeInTheDocument());
  });

  it("加载失败展示错误信息，重试后恢复列表", async () => {
    let failed = false;
    installRoutes({
      profiles: () => {
        if (!failed) {
          failed = true;
          throw new ApiError(503, "unavailable", "代理配置库暂不可用");
        }
        return egressProxyProfileListWire([egressProxyProfileWire({ id: "prof-1" })]);
      },
    });

    renderProfiles();

    expect(await screen.findByText("代理配置库暂不可用")).toBeInTheDocument();
    await user().click(screen.getByRole("button", { name: i18n.t("common.retry") }));

    expect(await screen.findByTestId("egress-proxy-profile-row-prof-1")).toBeInTheDocument();
  });

  it("翻页请求下一页配置", async () => {
    installRoutes({
      profiles: (call) =>
        egressProxyProfileListWire([egressProxyProfileWire({ id: `prof-${call.query.get("page")}` })], {
          page: Number(call.query.get("page")),
          total: 25,
        }),
    });

    renderProfiles();
    await screen.findByTestId("egress-proxy-profile-row-prof-1");

    await user().click(screen.getByRole("button", { name: i18n.t("common.nextPage") }));

    await waitFor(() => {
      const queries = callsOf("GET", "/api/admin/v1/egress-proxy-profiles?").map(
        ([path]) => new URLSearchParams(path.slice(path.indexOf("?") + 1)),
      );
      expect(queries.some((query) => query.get("page") === "2")).toBe(true);
    });
    expect(await screen.findByTestId("egress-proxy-profile-row-prof-2")).toBeInTheDocument();
  });
});

describe("EgressProxyProfiles 新增与编辑", () => {
  it("新增配置未填名称或地址时保存按钮禁用，创建成功后回调通知", async () => {
    installRoutes({
      profiles: () => egressProxyProfileListWire([]),
      profileCreate: () => egressProxyProfileWire({ id: "prof-9", name: "新代理" }),
    });
    const onCreated = renderProfiles();
    await screen.findByText(i18n.t("egressProxyProfiles.emptyLibrary"));

    await user().click(screen.getByTestId("egress-proxy-profiles-add"));
    const dialog = await screen.findByTestId("egress-proxy-profiles-dialog");
    expect(within(dialog).getByTestId("egress-proxy-profile-form-save")).toBeDisabled();

    await user().type(within(dialog).getByTestId("egress-proxy-profile-name"), "新代理");
    expect(within(dialog).getByTestId("egress-proxy-profile-form-save")).toBeDisabled();

    await user().type(within(dialog).getByTestId("egress-proxy-profile-url"), "socks5h://host:1080");
    await user().click(within(dialog).getByTestId("egress-proxy-profile-form-save"));

    await waitFor(() => expect(callsOf("POST", "/api/admin/v1/egress-proxy-profiles")).toHaveLength(1));
    expect(callsOf("POST", "/api/admin/v1/egress-proxy-profiles")[0][1].body).toEqual({
      name: "新代理",
      proxyURL: "socks5h://host:1080",
    });
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(i18n.t("egressProxyProfiles.saved"))).toBeInTheDocument();
  });

  it("编辑配置时可显示明文地址并提交 PUT", async () => {
    installRoutes({
      profiles: () => egressProxyProfileListWire([egressProxyProfileWire({ id: "prof-1", name: "机房代理" })]),
      profileReveal: () => ({ proxyURL: "socks5h://user:pass@host:1080" }),
      profileUpdate: () => egressProxyProfileWire({ id: "prof-1", name: "机房代理改" }),
    });
    renderProfiles();
    await screen.findByTestId("egress-proxy-profile-row-prof-1");

    await user().click(screen.getByTestId("egress-proxy-profile-actions-prof-1"));
    fireEvent.click(await screen.findByTestId("egress-proxy-profile-edit-prof-1"));
    const dialog = await screen.findByTestId("egress-proxy-profiles-dialog");
    // 编辑态下敏感地址初始为空，必须先点击 reveal 触发按需拉取明文
    // （组件契约见 egress-proxy-profile-form-fields.tsx 的 EgressProxyProfileURLField）。
    await user().click(within(dialog).getByTestId("egress-proxy-profile-reveal"));
    await waitFor(() =>
      expect(within(dialog).getByTestId("egress-proxy-profile-url")).toHaveValue("socks5h://user:pass@host:1080"),
    );
    expect(within(dialog).getByTestId("egress-proxy-profile-url")).toHaveAttribute("type", "text");

    const nameInput = within(dialog).getByTestId("egress-proxy-profile-name");
    await user().clear(nameInput);
    await user().type(nameInput, "机房代理改");
    await user().click(within(dialog).getByTestId("egress-proxy-profile-form-save"));

    await waitFor(() => expect(callsOf("PUT", "/api/admin/v1/egress-proxy-profiles/prof-1")).toHaveLength(1));
    expect(callsOf("PUT", "/api/admin/v1/egress-proxy-profiles/prof-1")[0][1].body).toEqual({
      name: "机房代理改",
      proxyURL: undefined,
    });
  });
});

describe("EgressProxyProfiles 删除确认", () => {
  it("已绑定节点的配置禁止删除", async () => {
    installRoutes({
      profiles: () => egressProxyProfileListWire([egressProxyProfileWire({ id: "prof-1", boundNodeCount: 3 })]),
    });
    renderProfiles();
    await screen.findByTestId("egress-proxy-profile-row-prof-1");

    await user().click(screen.getByTestId("egress-proxy-profile-actions-prof-1"));

    const deleteItem = await screen.findByTestId("egress-proxy-profile-delete-prof-1");
    expect(deleteItem).toBeDisabled();
    expect(deleteItem).toHaveTextContent(i18n.t("egressProxyProfiles.deleteBlocked", { count: 3 }));
  });

  it("未绑定节点的配置删除确认可取消", async () => {
    installRoutes({
      profiles: () => egressProxyProfileListWire([egressProxyProfileWire({ id: "prof-1", boundNodeCount: 0 })]),
    });
    renderProfiles();
    await screen.findByTestId("egress-proxy-profile-row-prof-1");

    await user().click(screen.getByTestId("egress-proxy-profile-actions-prof-1"));
    fireEvent.click(await screen.findByTestId("egress-proxy-profile-delete-prof-1"));
    expect(await screen.findByTestId("egress-proxy-profile-delete-dialog")).toHaveTextContent(
      i18n.t("egressProxyProfiles.deleteTitle"),
    );

    await user().click(screen.getByTestId("egress-proxy-profile-delete-cancel"));

    await waitFor(() => expect(screen.queryByTestId("egress-proxy-profile-delete-dialog")).not.toBeInTheDocument());
    expect(callsOf("DELETE", "/api/admin/v1/egress-proxy-profiles/prof-1")).toHaveLength(0);
    expect(screen.getByTestId("egress-proxy-profile-row-prof-1")).toBeInTheDocument();
  });

  it("确认删除后提交请求并提示已删除", async () => {
    installRoutes({
      profiles: () => egressProxyProfileListWire([egressProxyProfileWire({ id: "prof-1", boundNodeCount: 0 })]),
      profileRemove: () => ({ deleted: true }),
    });
    renderProfiles();
    await screen.findByTestId("egress-proxy-profile-row-prof-1");

    await user().click(screen.getByTestId("egress-proxy-profile-actions-prof-1"));
    fireEvent.click(await screen.findByTestId("egress-proxy-profile-delete-prof-1"));
    await user().click(await screen.findByTestId("egress-proxy-profile-delete-confirm"));

    await waitFor(() => expect(callsOf("DELETE", "/api/admin/v1/egress-proxy-profiles/prof-1")).toHaveLength(1));
    expect(await screen.findByText(i18n.t("egressProxyProfiles.deleted"))).toBeInTheDocument();
  });
});

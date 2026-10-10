import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ChartConfig } from "@/components/ui/chart";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { DashboardDTO } from "@/features/dashboard/dashboard-api";
import { DashboardPage } from "@/features/dashboard/dashboard-page";
import { DashboardTrendChart } from "@/features/dashboard/dashboard-trend-chart";
import { i18n } from "@/shared/i18n";
import { formatNumber } from "@/shared/lib/format";

// jsdom 中 ResponsiveContainer 量不到尺寸、不渲染 children；只替换该组件。
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  const React = await import("react");
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children?: ReactNode }) =>
      React.createElement(
        "div",
        { "data-testid": "chart-responsive-container" },
        // 显式给出尺寸，recharts 才会渲染坐标轴、序列与图例。
        React.isValidElement(children)
          ? React.cloneElement(children as React.ReactElement<{ width?: number; height?: number }>, {
              width: 600,
              height: 280,
            })
          : children,
      ),
  };
});

const DASHBOARD_URL = "/api/admin/v1/dashboard";
const PREFERENCES_KEY = "grok2api:dashboard-preferences";

function dashboardFixture(overrides: Partial<DashboardDTO> = {}): DashboardDTO {
  return {
    period: "30d",
    generatedAt: "2026-01-31T00:00:00Z",
    range: { start: "2026-01-01T00:00:00Z", end: "2026-01-31T00:00:00Z" },
    resources: {
      activeAccounts: 3,
      totalAccounts: 4,
      buildAccounts: 2,
      webAccounts: 1,
      consoleAccounts: 1,
      enabledModels: 5,
      totalModels: 6,
      activeClientKeys: 2,
      totalClientKeys: 3,
    },
    usage: {
      requests: 120,
      successfulRequests: 118,
      failedRequests: 2,
      inputTokens: 1000,
      cachedInputTokens: 250,
      outputTokens: 500,
      reasoningTokens: 0,
      tokens: 1500,
      billedCostUsdTicks: 12_345_678,
      successRate: 98.3,
      averageFirstTokenMs: 420,
      outputTokensPerSecond: 12.5,
      firstTokenSamples: 100,
      throughputSamples: 90,
    },
    series: [
      {
        start: "2026-01-01T00:00:00Z",
        end: "2026-01-02T00:00:00Z",
        requests: 4,
        inputTokens: 10,
        cachedInputTokens: 0,
        outputTokens: 5,
        reasoningTokens: 0,
        tokens: 15,
        billedCostUsdTicks: 1000,
      },
      {
        start: "2026-01-02T00:00:00Z",
        end: "2026-01-03T00:00:00Z",
        requests: 0,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        tokens: 0,
        billedCostUsdTicks: 0,
      },
    ],
    activity: [
      { start: "2026-01-01T00:00:00Z", requests: 4 },
      { start: "2026-01-02T00:00:00Z", requests: 0 },
      { start: "2026-02-05T00:00:00Z", requests: 1 },
    ],
    topModels: [
      {
        model: "grok-4",
        requests: 3,
        inputTokens: 400,
        cachedInputTokens: 100,
        outputTokens: 200,
        reasoningTokens: 5,
        tokens: 600,
        billedCostUsdTicks: 5_000_000,
      },
      {
        model: "grok-4-fast",
        requests: 2,
        inputTokens: 200,
        cachedInputTokens: 0,
        outputTokens: 100,
        reasoningTokens: 0,
        tokens: 25_000,
        billedCostUsdTicks: 0,
      },
      {
        model: "grok-4-mini",
        requests: 1,
        inputTokens: 100,
        cachedInputTokens: 0,
        outputTokens: 50,
        reasoningTokens: 0,
        tokens: 2_500_000,
        billedCostUsdTicks: 1_000,
      },
    ],
    providers: [{ provider: "grok_build", requests: 4, successfulRequests: 3, tokens: 600 }],
    ...overrides,
  };
}

type DashboardApiOptions = { dashboard?: DashboardDTO; failure?: boolean };

function installDashboardApi(options: DashboardApiOptions = {}): { urls: string[] } {
  const urls: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (url.startsWith("/api/admin/v1/system/version")) {
      return jsonResponse({
        currentVersion: "1.0.0",
        latestVersion: "1.0.0",
        updateAvailable: false,
        status: "up_to_date",
        checkedAt: null,
        releaseUrl: "",
        releaseNotes: "",
        error: "",
      });
    }
    if (url.startsWith(DASHBOARD_URL)) {
      if (options.failure) return errorResponse();
      return jsonResponse(options.dashboard ?? dashboardFixture());
    }
    throw new Error(`unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { urls };
}

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify({ data }), { headers: { "Content-Type": "application/json" } });
}

function errorResponse(): Response {
  return new Response(JSON.stringify({ error: { code: "dashboardFailed", message: "dashboardFailed" } }), {
    status: 500,
    headers: { "Content-Type": "application/json" },
  });
}

function dashboardUrls(urls: string[]): string[] {
  return urls.filter((url) => url.startsWith(DASHBOARD_URL));
}

function renderDashboardPage(): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={0}>
          <MemoryRouter>
            <DashboardPage />
          </MemoryRouter>
        </TooltipProvider>
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("DashboardPage", () => {
  it("Top 模型 tokens 按 K/M 单位压缩展示", async () => {
    installDashboardApi();
    renderDashboardPage();

    expect(await screen.findByText("25K")).toBeInTheDocument();
    expect(screen.getByText("2.5M")).toBeInTheDocument();
  });
  it("按默认 30 天查询并渲染指标、面板与数据", async () => {
    const { urls } = installDashboardApi();
    renderDashboardPage();

    expect(await screen.findByText("grok-4")).toBeInTheDocument();
    const url = new URL(dashboardUrls(urls)[0], "http://localhost");
    expect(url.searchParams.get("period")).toBe("30d");
    expect(url.searchParams.get("timezone")).not.toBeNull();

    expect(screen.getByRole("heading", { name: i18n.t("dashboard.title") })).toBeInTheDocument();
    expect(screen.getByText(i18n.t("dashboard.accountCount"))).toBeInTheDocument();
    expect(screen.getByText(i18n.t("dashboard.topModels"))).toBeInTheDocument();
    expect(screen.getByText(i18n.t("dashboard.activityTitle"))).toBeInTheDocument();
    expect(screen.getByText(i18n.t("dashboard.resourcesTitle"))).toBeInTheDocument();
    expect(screen.getByText(i18n.t("dashboard.providerDistribution"))).toBeInTheDocument();
    expect(screen.getByText(i18n.t("dashboard.trend"))).toBeInTheDocument();
    expect(
      screen.getByText(i18n.t("dashboard.requestSuccessRate", { rate: formatNumber(98.3, i18n.language, 1) })),
    ).toBeInTheDocument();
  });

  it("切换时间范围会以新的查询 key 重新请求", async () => {
    const user = userEvent.setup();
    const { urls } = installDashboardApi();
    renderDashboardPage();
    await screen.findByText("grok-4");

    await user.click(screen.getByRole("tab", { name: "7d" }));

    await waitFor(() => {
      const periods = dashboardUrls(urls).map((item) => new URL(item, "http://localhost").searchParams.get("period"));
      expect(periods).toContain("7d");
    });
    expect(JSON.parse(window.localStorage.getItem(PREFERENCES_KEY) ?? "{}")).toEqual({ periodDays: 7 });
  });

  it("读取本地偏好的时间范围与查询参数一致", async () => {
    window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ periodDays: 1 }));
    const { urls } = installDashboardApi();
    renderDashboardPage();
    await screen.findByText("grok-4");

    expect(new URL(dashboardUrls(urls)[0], "http://localhost").searchParams.get("period")).toBe("24h");
  });

  it("趋势图例可切换显隐，Provider 色带悬浮展示明细", async () => {
    const user = userEvent.setup();
    installDashboardApi();
    renderDashboardPage();
    await screen.findByText("grok-4");

    const legend = screen.getByTestId("dashboard-trend-legend-tokens");
    expect(legend).toHaveAttribute("aria-pressed", "true");
    await user.click(legend);
    expect(legend).toHaveAttribute("aria-pressed", "false");
    await user.click(legend);
    expect(legend).toHaveAttribute("aria-pressed", "true");

    const stripes = screen.getByTestId("dashboard-provider-stripes");
    fireEvent.pointerMove(stripes, { clientX: 10, clientY: 60 });
    expect(await screen.findByTestId("dashboard-provider-stripe-tooltip")).toBeInTheDocument();
    fireEvent.pointerLeave(stripes);
    await waitFor(() => expect(screen.queryByTestId("dashboard-provider-stripe-tooltip")).not.toBeInTheDocument());
  });

  it("空数据展示占位提示", async () => {
    installDashboardApi({
      dashboard: dashboardFixture({
        series: [],
        activity: [],
        topModels: [],
        providers: [],
        usage: {
          requests: 0,
          successfulRequests: 0,
          failedRequests: 0,
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          tokens: 0,
          billedCostUsdTicks: 0,
          successRate: 0,
        },
        resources: {
          activeAccounts: 0,
          totalAccounts: 0,
          buildAccounts: 0,
          webAccounts: 0,
          consoleAccounts: 0,
          enabledModels: 0,
          totalModels: 0,
          activeClientKeys: 0,
          totalClientKeys: 0,
        },
      }),
    });
    renderDashboardPage();

    expect(await screen.findByText(i18n.t("dashboard.noTrendData"))).toBeInTheDocument();
    expect(screen.getByText(i18n.t("dashboard.noTopModels"))).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-provider-stripes")).toBeInTheDocument();
    const providerPanel = screen.getByRole("region", { name: i18n.t("dashboard.providerDistribution") });
    expect(within(providerPanel).getByText(i18n.t("models.providerGrokBuild"))).toBeInTheDocument();
    expect(within(providerPanel).getByText(i18n.t("models.providerGrokWeb"))).toBeInTheDocument();
    expect(within(providerPanel).getByText(i18n.t("console.name"))).toBeInTheDocument();
    expect(within(providerPanel).getAllByText(formatNumber(0, i18n.language, 1) + "%").length).toBeGreaterThan(0);
  });

  it("查询失败且无缓存数据时展示错误态并可重试", async () => {
    const user = userEvent.setup();
    const { urls } = installDashboardApi({ failure: true });
    renderDashboardPage();

    const retry = await screen.findByRole("button", { name: i18n.t("common.retry") });
    expect(retry.parentElement?.textContent).toContain("dashboardFailed");

    const before = dashboardUrls(urls).length;
    await user.click(retry);
    await waitFor(() => expect(dashboardUrls(urls).length).toBeGreaterThan(before));
  });

  it("隐藏多条序列时重新分配坐标轴", async () => {
    const user = userEvent.setup();
    installDashboardApi();
    renderDashboardPage();
    await screen.findByText("grok-4");

    for (const series of ["tokens", "billing", "requests"]) {
      const legend = screen.getByTestId(`dashboard-trend-legend-${series}`);
      await user.click(legend);
      expect(legend).toHaveAttribute("aria-pressed", "false");
    }
    expect(screen.getByTestId("dashboard-trend-legend-tokens")).toHaveAttribute("aria-pressed", "false");
  });

  it("偏好数据无法解析时回退到默认 30 天", async () => {
    window.localStorage.setItem(PREFERENCES_KEY, "{not-json");
    const { urls } = installDashboardApi();
    renderDashboardPage();
    await screen.findByText("grok-4");

    expect(new URL(dashboardUrls(urls)[0], "http://localhost").searchParams.get("period")).toBe("30d");
  });

  it("偏好中的时间范围非法时回退到默认 30 天", async () => {
    window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ periodDays: 5 }));
    const { urls } = installDashboardApi();
    renderDashboardPage();
    await screen.findByText("grok-4");

    expect(new URL(dashboardUrls(urls)[0], "http://localhost").searchParams.get("period")).toBe("30d");
  });
});

describe("DashboardTopModels 与趋势图细节", () => {
  it("无请求无 Tokens 的模型行展示占位与零值样式", async () => {
    installDashboardApi({
      dashboard: dashboardFixture({
        topModels: [
          {
            model: "grok-4-idle",
            requests: 0,
            inputTokens: 0,
            cachedInputTokens: 0,
            outputTokens: 0,
            reasoningTokens: 0,
            tokens: 0,
            billedCostUsdTicks: 0,
          },
        ],
      }),
    });
    renderDashboardPage();

    const model = await screen.findByText("grok-4-idle");
    const row = model.closest("tr");
    expect(row).not.toBeNull();
    // 无缓存/推理用量时不追加对应明细项。
    expect(within(row as HTMLElement).getByText(/输入 0 · 输出 0$/)).toBeInTheDocument();
    expect(row).toHaveTextContent("$0.00");
  });

  it("时间序列全为零时展示无趋势数据空态", async () => {
    installDashboardApi({
      dashboard: dashboardFixture({
        series: [
          {
            start: "2026-01-01T00:00:00Z",
            end: "2026-01-02T00:00:00Z",
            requests: 0,
            inputTokens: 0,
            cachedInputTokens: 0,
            outputTokens: 0,
            reasoningTokens: 0,
            tokens: 0,
            billedCostUsdTicks: 0,
          },
        ],
      }),
    });
    renderDashboardPage();

    expect(await screen.findByText(i18n.t("dashboard.noTrendData"))).toBeInTheDocument();
    expect(screen.queryByTestId("dashboard-trend-legend-tokens")).not.toBeInTheDocument();
  });
});

describe("DashboardTrendChart 悬浮提示", () => {
  const chartConfig: ChartConfig = { billing: { label: "Billing" }, tokens: { label: "Tokens" } };

  function renderTrendChart() {
    return render(
      <I18nextProvider i18n={i18n}>
        <DashboardTrendChart
          chartData={[
            {
              requests: 12,
              tokens: 3400,
              billing: 12.5,
              start: "2026-01-01T00:00:00Z",
              tooltipLabel: "2026-01-01 00:00 – 01:00",
            },
          ]}
          xTicks={["2026-01-01T00:00:00Z"]}
          chartConfig={chartConfig}
          period="30d"
          seriesKey="30d"
          locale={i18n.language}
          hiddenSeries={new Set()}
          axisSides={{ tokens: "left", billing: "right" }}
          loading={false}
          onToggleSeries={() => {}}
        />
      </I18nextProvider>,
    );
  }

  it("悬浮时按序列格式化数值、展示桶区间标签并在缺少配置时回退为序列名", async () => {
    const { container } = renderTrendChart();
    const wrapper = container.querySelector(".recharts-wrapper");
    expect(wrapper).not.toBeNull();

    fireEvent.mouseMove(wrapper as Element, { clientX: 300, clientY: 120 });
    expect(await screen.findByText("2026-01-01 00:00 – 01:00")).toBeInTheDocument();
    const tooltip = container.querySelector(".recharts-tooltip-wrapper");
    expect(tooltip).not.toBeNull();
    const box = within(tooltip as HTMLElement);
    expect(box.getByText("Billing")).toBeInTheDocument();
    expect(box.getByText("$12.50")).toBeInTheDocument();
    expect(box.getByText("Tokens")).toBeInTheDocument();
    expect(box.getByText("3,400")).toBeInTheDocument();
    // requests 未配置标签时回退为序列名，数值按普通数字格式化。
    expect(box.getByText("requests")).toBeInTheDocument();
    expect(box.getByText("12")).toBeInTheDocument();
  });
});

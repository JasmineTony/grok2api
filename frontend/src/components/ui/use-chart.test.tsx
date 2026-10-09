import { render, renderHook, screen } from "@testing-library/react";
import { type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { ChartContainer } from "@/components/ui/chart";
import { ChartProvider, useChart, type ChartConfig } from "@/components/ui/use-chart";

// ResponsiveContainer 在 jsdom 中量不到尺寸、不会渲染 children；这里只替换它，
// 以便验证 ChartContainer 确实通过 use-chart 的 Provider 提供上下文。
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  const React = await import("react");
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children?: ReactNode }) =>
      React.createElement("div", { "data-testid": "chart-responsive-container" }, children),
  };
});

const config: ChartConfig = {
  requests: { label: "请求数", color: "var(--chart-1)" },
};

function ConfigProbe() {
  const { config: chartConfig } = useChart();
  return <span data-testid="chart-config-probe">{String(chartConfig.requests?.label)}</span>;
}

describe("useChart", () => {
  it("在 ChartProvider 之外调用时抛出明确错误", () => {
    // React 会把渲染期异常同时打到 console.error，测试里静音以免污染输出。
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => renderHook(() => useChart())).toThrow("useChart must be used within a <ChartContainer />");

    consoleError.mockRestore();
  });

  it("在 ChartProvider 内返回同一份 config 引用", () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ChartProvider config={config}>{children}</ChartProvider>
    );

    const { result } = renderHook(() => useChart(), { wrapper });

    expect(result.current.config).toBe(config);
  });

  it("ChartContainer 通过 Provider 向子组件提供 config", () => {
    render(
      <ChartContainer config={config}>
        <ConfigProbe />
      </ChartContainer>,
    );

    expect(screen.getByTestId("chart-responsive-container")).toBeInTheDocument();
    expect(screen.getByTestId("chart-config-probe")).toHaveTextContent("请求数");
  });
});

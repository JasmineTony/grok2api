import * as React from "react";

// Chart 原语的上下文与取值 hook 单独成文件：AGENTS.md TEST-2 要求自定义 hook
// 语句/分支/函数/行覆盖率 100%，而 chart.tsx 其余部分（tooltip/legend 渲染）
// 无法在文件级阈值下同时达标，故把 hook 与渲染拆开。
// Format: { THEME_NAME: CSS_SELECTOR }
export const THEMES = { light: "", dark: ".dark" } as const;

export type ChartConfig = {
  [k in string]: {
    label?: React.ReactNode;
    icon?: React.ComponentType;
  } & ({ color?: string; theme?: never } | { color?: never; theme: Record<keyof typeof THEMES, string> });
};

type ChartContextProps = {
  config: ChartConfig;
};

const ChartContext = React.createContext<ChartContextProps | null>(null);

export function ChartProvider({ config, children }: { config: ChartConfig; children: React.ReactNode }) {
  return <ChartContext.Provider value={{ config }}>{children}</ChartContext.Provider>;
}

export function useChart(): ChartContextProps {
  const context = React.useContext(ChartContext);

  if (!context) {
    throw new Error("useChart must be used within a <ChartContainer />");
  }

  return context;
}

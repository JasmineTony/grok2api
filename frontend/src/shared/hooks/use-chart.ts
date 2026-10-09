import * as React from "react";

// Chart 原语的上下文与取值 hook 单独成文件：AGENTS.md TEST-2 要求自定义 hook
// 语句/分支/函数/行覆盖率 100%，而 chart.tsx 其余部分（tooltip/legend 渲染）
// 无法在文件级阈值下同时达标，故把 hook 与渲染拆开。
// 本文件只放上下文与 hook，Provider 组件留在 chart.tsx，避免同一文件同时导出
// 组件与非组件（react-refresh/only-export-components）。
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

export const ChartContext = React.createContext<ChartContextProps | null>(null);

export function useChart(): ChartContextProps {
  const context = React.useContext(ChartContext);

  if (!context) {
    throw new Error("useChart must be used within a <ChartContainer />");
  }

  return context;
}

import { useState } from "react";

import type { ModelRouteDTO } from "@/entities/model/types";
import { toggleSelection } from "@/features/models/model-selection";

// 模型表格的跨行选择状态：只暴露“本页/本组”两种批量选择入口，避免调用方直接操作 Set。

export type ModelSelectionController = {
  selected: Set<string>;
  clear: () => void;
  togglePage: (ids: string[], checked: boolean) => void;
  toggleGroup: (routes: ModelRouteDTO[], checked: boolean) => void;
};

export function useModelSelection(): ModelSelectionController {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  function clear(): void {
    setSelected(new Set());
  }

  function togglePage(ids: string[], checked: boolean): void {
    setSelected((current) => toggleSelection(current, ids, checked));
  }

  function toggleGroup(routes: ModelRouteDTO[], checked: boolean): void {
    setSelected((current) =>
      toggleSelection(
        current,
        routes.map((route) => route.id),
        checked,
      ),
    );
  }

  return { selected, clear, togglePage, toggleGroup };
}

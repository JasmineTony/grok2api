import { useState } from "react";

export type MediaSelection = {
  selected: ReadonlySet<string>;
  togglePage: (ids: readonly string[], checked: boolean) => void;
  toggleItem: (id: string, checked: boolean) => void;
  clear: () => void;
};

/** 媒体列表多选：整页全选/取消与单行切换，语义与原页面内联实现一致。 */
export function useMediaSelection(): MediaSelection {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  function togglePage(ids: readonly string[], checked: boolean): void {
    setSelected((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  function toggleItem(id: string, checked: boolean): void {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function clear(): void {
    setSelected(new Set());
  }

  return { selected, togglePage, toggleItem, clear };
}

import type { ModelRouteGroup } from "@/features/models/model-display";

// 模型表格选择状态的纯计算：从 models-page.tsx 拆出，便于与 hook 解耦验证。

export function toggleSelection(current: ReadonlySet<string>, ids: string[], checked: boolean): Set<string> {
  const next = new Set(current);
  for (const id of ids) {
    if (checked) next.add(id);
    else next.delete(id);
  }
  return next;
}

export function pageSelectionState(
  pageIDs: string[],
  selected: ReadonlySet<string>,
): { selectedOnPage: string[]; allPageSelected: boolean } {
  const selectedOnPage = pageIDs.filter((id) => selected.has(id));
  return { selectedOnPage, allPageSelected: pageIDs.length > 0 && selectedOnPage.length === pageIDs.length };
}

export function selectedGroupCount(items: ModelRouteGroup[] | undefined, selected: ReadonlySet<string>): number {
  return items?.filter((group) => group.routes.some((route) => selected.has(route.id))).length ?? 0;
}

import { useState } from "react";

import type { AccountProvider } from "@/features/accounts/accounts-api";

/** Keeps bulk selection scoped to the active provider to avoid cross-pool actions. */
export function useAccountSelection(provider: AccountProvider, pageIDs: readonly string[]) {
  const [selection, setSelection] = useState(() => ({
    provider,
    ids: new Set<string>(),
  }));
  const selected = selection.provider === provider ? selection.ids : new Set<string>();
  const selectedOnPage = pageIDs.filter((id) => selected.has(id));
  const allPageSelected = pageIDs.length > 0 && selectedOnPage.length === pageIDs.length;

  function resetSelection(nextProvider = provider): void {
    setSelection({ provider: nextProvider, ids: new Set() });
  }

  function togglePage(checked: boolean): void {
    setSelection((current) => {
      const next = new Set(current.provider === provider ? current.ids : []);
      for (const id of pageIDs) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return { provider, ids: next };
    });
  }

  function toggleAccount(id: string, checked: boolean): void {
    setSelection((current) => {
      const next = new Set(current.provider === provider ? current.ids : []);
      if (checked) next.add(id);
      else next.delete(id);
      return { provider, ids: next };
    });
  }

  return {
    selected,
    selectedOnPage,
    allPageSelected,
    resetSelection,
    togglePage,
    toggleAccount,
  };
}

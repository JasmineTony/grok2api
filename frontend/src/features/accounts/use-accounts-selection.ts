import { useMemo, useState } from "react";

import type { AccountProvider } from "@/features/accounts/accounts-dto";

type AccountSelection = { provider: AccountProvider; ids: Set<string> };

export type AccountsSelection = {
  selected: Set<string>;
  selectedIds: string[];
  selectedIdsKey: string;
  hasSelection: boolean;
  toggleAccount: (id: string, checked: boolean) => void;
  togglePage: (pageIds: string[], checked: boolean) => void;
  clearSelection: () => void;
  reselect: (provider: AccountProvider) => void;
};

export function useAccountsSelection(provider: AccountProvider): AccountsSelection {
  const [selection, setSelection] = useState<AccountSelection>(() => ({ provider: "grok_build", ids: new Set() }));
  const selected = useMemo(
    () => (selection.provider === provider ? selection.ids : new Set<string>()),
    [selection, provider],
  );
  const selectedIdsKey = useMemo(() => Array.from(selected).sort().join(","), [selected]);
  const selectedIds = useMemo(() => (selectedIdsKey ? selectedIdsKey.split(",") : []), [selectedIdsKey]);
  const setChecked = (ids: string[], checked: boolean): void => {
    setSelection((current) => {
      const next = new Set(current.provider === provider ? current.ids : []);
      for (const id of ids) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return { provider, ids: next };
    });
  };
  const toggleAccount = (id: string, checked: boolean): void => setChecked([id], checked);
  const togglePage = (pageIds: string[], checked: boolean): void => setChecked(pageIds, checked);
  const clearSelection = (): void => setSelection((current) => ({ provider: current.provider, ids: new Set() }));
  const reselect = (value: AccountProvider): void => setSelection({ provider: value, ids: new Set() });
  return {
    selected,
    selectedIds,
    selectedIdsKey,
    hasSelection: selectedIds.length > 0,
    toggleAccount,
    togglePage,
    clearSelection,
    reselect,
  };
}

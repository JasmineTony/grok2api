import { useCallback, useState } from "react";

export type DataTableQueryState = {
  page: number;
  pageSize: number;
  search: string;
};

export function useDataTableQueryState(initial: Partial<DataTableQueryState> = {}) {
  const [state, setState] = useState<DataTableQueryState>({
    page: 1,
    pageSize: 20,
    search: "",
    ...initial,
  });
  const setSearch = useCallback(
    (search: string) => setState((current) => ({ ...current, page: 1, search })),
    [],
  );
  const setPage = useCallback(
    (page: number) => setState((current) => ({ ...current, page: Math.max(1, page) })),
    [],
  );
  const setPageSize = useCallback(
    (pageSize: number) =>
      setState((current) => ({ ...current, page: 1, pageSize: Math.max(1, pageSize) })),
    [],
  );
  const reset = useCallback(
    () => setState({ page: 1, pageSize: initial.pageSize ?? 20, search: initial.search ?? "" }),
    [initial.pageSize, initial.search],
  );
  return { ...state, setSearch, setPage, setPageSize, reset };
}

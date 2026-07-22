import { useCallback, useMemo, useState } from "react";

export function useBulkSelection() {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const ids = useMemo(() => [...selected], [selected]);
  const clear = useCallback(() => setSelected(new Set()), []);
  const toggle = useCallback((id: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  const toggleMany = useCallback((values: readonly string[], checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      for (const id of values) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);
  return { selected, ids, count: selected.size, setSelected, clear, toggle, toggleMany };
}

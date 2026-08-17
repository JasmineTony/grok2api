import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { isAbortError, showAccountError } from "@/features/accounts/account-page-utils";
import { accountMutationInvalidationKeys } from "@/features/accounts/account-query-keys";
import {
  type AccountTaskProgressDTO,
  type BuildDetectItemDTO,
  detectBuildAccounts,
} from "@/features/accounts/account-tasks-api";
import { useApiClient } from "@/shared/api/use-api-client";

const emptyDetectCounts = (): Record<BuildDetectItemDTO["outcome"], number> => ({
  ok: 0,
  invalid: 0,
  failed: 0,
});

export function useAccountDetection({
  selected,
  clearSelection,
}: {
  selected: Set<string>;
  clearSelection: () => void;
}) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const invalidateAccountData = useCallback(() => {
    for (const queryKey of accountMutationInvalidationKeys()) {
      void queryClient.invalidateQueries({ queryKey });
    }
  }, [queryClient]);
  const showError = (error: unknown) => showAccountError(error, t);
  const abortRef = useRef<AbortController | null>(null);
  const outcomeByIDRef = useRef(new Map<string, BuildDetectItemDTO["outcome"]>());
  const [mode, setMode] = useState<"selected" | "all" | null>(null);
  const [progress, setProgress] = useState<AccountTaskProgressDTO | null>(null);
  const [items, setItems] = useState<BuildDetectItemDTO[]>([]);
  const [counts, setCounts] = useState(emptyDetectCounts);

  useEffect(() => () => abortRef.current?.abort(), []);

  const appendItem = useCallback((item: BuildDetectItemDTO) => {
    const previousOutcome = outcomeByIDRef.current.get(item.id);
    outcomeByIDRef.current.set(item.id, item.outcome);
    if (previousOutcome !== item.outcome) {
      setCounts((previous) => ({
        ...previous,
        ...(previousOutcome
          ? { [previousOutcome]: Math.max(0, previous[previousOutcome] - 1) }
          : {}),
        [item.outcome]: previous[item.outcome] + 1,
      }));
    }
    setItems((previous) => {
      const next = previous.filter((entry) => entry.id !== item.id);
      next.unshift(item);
      return next.slice(0, 200);
    });
  }, []);

  const mutation = useMutation({
    mutationFn: (targetMode: "selected" | "all") => {
      const controller = new AbortController();
      abortRef.current = controller;
      setProgress(null);
      outcomeByIDRef.current.clear();
      setCounts(emptyDetectCounts());
      setItems([]);
      return detectBuildAccounts(
        apiClient,
        targetMode === "all" ? { all: true } : { ids: [...selected] },
        { onProgress: setProgress, onItem: appendItem },
        controller.signal,
      );
    },
    onSuccess: (result, targetMode) => {
      if (targetMode === "selected") clearSelection();
      toast.success(
        t(targetMode === "all" ? "accounts.allDetected" : "accounts.batchDetected", result),
      );
    },
    onError: (error) => {
      if (!isAbortError(error)) showError(error);
    },
    onSettled: () => {
      abortRef.current = null;
      invalidateAccountData();
    },
  });

  function open(targetMode: "selected" | "all"): void {
    setProgress(null);
    outcomeByIDRef.current.clear();
    setCounts(emptyDetectCounts());
    setItems([]);
    setMode(targetMode);
  }

  function close(): void {
    if (mutation.isPending) abortRef.current?.abort();
    setMode(null);
    setProgress(null);
    if (!mutation.isPending) setItems([]);
  }

  return { mode, progress, items, counts, mutation, open, close };
}

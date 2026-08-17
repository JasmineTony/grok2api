import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { accountMutationInvalidationKeys } from "@/features/accounts/account-query-keys";

export function useAccountDataInvalidation() {
  const queryClient = useQueryClient();
  return useCallback(() => {
    for (const queryKey of accountMutationInvalidationKeys()) {
      void queryClient.invalidateQueries({ queryKey });
    }
  }, [queryClient]);
}

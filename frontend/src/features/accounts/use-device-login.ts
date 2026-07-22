import { type Dispatch, type SetStateAction, useCallback } from "react";

import { type DeviceSessionDTO, startDeviceAuthorization } from "@/features/accounts/accounts-api";
import type { DeviceAuthorizationStatus } from "@/features/accounts/use-device-authorization";
import { useApiClient } from "@/shared/api/use-api-client";

/** Starts a device login while keeping the page component free of transport details. */
export function useStartDeviceLogin({
  setOpen,
  setSession,
  setStatus,
  onError,
}: {
  setOpen: Dispatch<SetStateAction<boolean>>;
  setSession: Dispatch<SetStateAction<DeviceSessionDTO | null>>;
  setStatus: Dispatch<SetStateAction<DeviceAuthorizationStatus>>;
  onError: (error: unknown) => void;
}): () => Promise<void> {
  const apiClient = useApiClient();
  return useCallback(async () => {
    setOpen(true);
    setStatus("starting");
    setSession(null);
    try {
      const session = await startDeviceAuthorization(apiClient);
      setSession(session);
      setStatus("pending");
    } catch (error) {
      setStatus("failed");
      onError(error);
    }
  }, [apiClient, onError, setOpen, setSession, setStatus]);
}

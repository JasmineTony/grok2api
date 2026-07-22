import { useCallback, type Dispatch, type SetStateAction } from "react";

import {
  startDeviceAuthorization,
  type DeviceSessionDTO,
} from "@/features/accounts/accounts-api";
import type { DeviceAuthorizationStatus } from "@/features/accounts/use-device-authorization";

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
  return useCallback(async () => {
    setOpen(true);
    setStatus("starting");
    setSession(null);
    try {
      const session = await startDeviceAuthorization();
      setSession(session);
      setStatus("pending");
    } catch (error) {
      setStatus("failed");
      onError(error);
    }
  }, [onError, setOpen, setSession, setStatus]);
}

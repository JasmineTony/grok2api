import { useEffect, type Dispatch, type SetStateAction } from "react";
import type { TFunction } from "i18next";
import { toast } from "sonner";

import {
  pollDeviceAuthorization,
  type DeviceSessionDTO,
} from "@/features/accounts/accounts-api";
import { ApiError } from "@/shared/api/client";

export type DeviceAuthorizationStatus = "starting" | "pending" | "failed";

/** Polls a device authorization session and always cancels work on dialog close. */
export function useDeviceAuthorization({
  open,
  session,
  status,
  setOpen,
  setSession,
  setStatus,
  invalidateAccountData,
  t,
}: {
  open: boolean;
  session: DeviceSessionDTO | null;
  status: DeviceAuthorizationStatus;
  setOpen: Dispatch<SetStateAction<boolean>>;
  setSession: Dispatch<SetStateAction<DeviceSessionDTO | null>>;
  setStatus: Dispatch<SetStateAction<DeviceAuthorizationStatus>>;
  invalidateAccountData: () => void;
  t: TFunction;
}): void {
  useEffect(() => {
    if (!open || !session || status !== "pending") return;

    const controller = new AbortController();
    let timeout = 0;
    const poll = async () => {
      try {
        const result = await pollDeviceAuthorization(
          session.sessionId,
          controller.signal,
        );
        if (result.status === "succeeded" || result.status === "syncFailed") {
          if (result.status === "syncFailed")
            toast.warning(t("accounts.createdWithSyncFailure"));
          else toast.success(t("accounts.created"));
          setOpen(false);
          setSession(null);
          invalidateAccountData();
          return;
        }
        timeout = window.setTimeout(poll, session.intervalSeconds * 1000);
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 429) {
          timeout = window.setTimeout(
            poll,
            (session.intervalSeconds + 5) * 1000,
          );
          return;
        }
        setStatus("failed");
        toast.error(
          error instanceof Error ? error.message : t("errors.generic"),
        );
      }
    };

    timeout = window.setTimeout(poll, session.intervalSeconds * 1000);
    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [
    invalidateAccountData,
    open,
    session,
    setOpen,
    setSession,
    setStatus,
    status,
    t,
  ]);
}

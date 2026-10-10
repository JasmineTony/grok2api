import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  pollDeviceAuthorization,
  startDeviceAuthorization,
  type DeviceSessionDTO,
} from "@/features/accounts/accounts-api";
import type { AccountsFlowContext } from "@/features/accounts/accounts-flow-context";
import { ApiError } from "@/shared/api/client";

type DeviceStatus = "starting" | "pending" | "failed";

export type AccountsDeviceFlow = {
  open: boolean;
  status: DeviceStatus;
  session: DeviceSessionDTO | null;
  language: string;
  onOpenChange: (open: boolean) => void;
  onRetry: () => void;
  login: () => void;
};

/** Grok Build 设备授权：轮询期间 429 退避 5s，其余错误直接落失败态。 */
function useDeviceAuthorizationPolling(input: {
  ctx: AccountsFlowContext;
  open: boolean;
  session: DeviceSessionDTO | null;
  status: DeviceStatus;
  setOpen: (open: boolean) => void;
  setSession: (session: DeviceSessionDTO | null) => void;
  setStatus: (status: DeviceStatus) => void;
}): void {
  const { ctx, open, session, status, setOpen, setSession, setStatus } = input;
  const { t, invalidate } = ctx;
  useEffect(() => {
    if (!open || !session || status !== "pending") return;
    const controller = new AbortController();
    let timeout = 0;
    const poll = async (): Promise<void> => {
      try {
        const result = await pollDeviceAuthorization(session.sessionId, controller.signal);
        if (result.status === "succeeded" || result.status === "syncFailed") {
          if (result.status === "succeeded") toast.success(t("accounts.created"));
          else toast.warning(t("accounts.createdWithSyncFailure"));
          setOpen(false);
          setSession(null);
          invalidate();
          return;
        }
        timeout = window.setTimeout(() => void poll(), session.intervalSeconds * 1000);
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 429) {
          timeout = window.setTimeout(() => void poll(), (session.intervalSeconds + 5) * 1000);
          return;
        }
        setStatus("failed");
        toast.error(error instanceof Error ? error.message : t("errors.generic"));
      }
    };
    timeout = window.setTimeout(() => void poll(), session.intervalSeconds * 1000);
    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [open, session, status, invalidate, t, setOpen, setSession, setStatus]);
}

/** Grok Build 设备授权：轮询期间 429 退避 5s，其余错误直接落失败态。 */
export function useAccountsDeviceFlow(ctx: AccountsFlowContext): AccountsDeviceFlow {
  const { showError } = ctx;
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<DeviceSessionDTO | null>(null);
  const [status, setStatus] = useState<DeviceStatus>("starting");
  useDeviceAuthorizationPolling({ ctx, open, session, status, setOpen, setSession, setStatus });
  const login = (): void => {
    setOpen(true);
    setStatus("starting");
    setSession(null);
    void startDeviceAuthorization()
      .then((next) => {
        setSession(next);
        setStatus("pending");
      })
      .catch((error: unknown) => {
        setStatus("failed");
        showError(error);
      });
  };
  return {
    open,
    status,
    session,
    language: ctx.language,
    onOpenChange: setOpen,
    onRetry: login,
    login,
  };
}

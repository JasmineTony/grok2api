import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import {
  acceptWebAccountTerms,
  clearAccountCooldown,
  enableWebAccountNSFW,
  refreshAccountBilling,
  refreshAccountQuota,
  refreshAccountToken,
  setWebAccountBirthDate,
} from "@/features/accounts/accounts-api";
import type { AccountsFlowContext } from "@/features/accounts/accounts-flow-context";
import type { WebAccountConfirmationTarget } from "@/features/accounts/web-account-settings";

export type AccountRowMutations = {
  refreshBilling: (id: string) => void;
  refreshToken: (id: string) => void;
  clearCooldown: (id: string) => void;
  refreshQuota: (id: string) => void;
  cooldownPending: boolean;
  confirmation: {
    target: WebAccountConfirmationTarget | null;
    onTargetChange: (target: WebAccountConfirmationTarget | null) => void;
    onConfirm: (target: WebAccountConfirmationTarget) => void;
    pending: boolean;
    busy: boolean;
  };
};

/** 单行凭据/额度刷新：成功后统一失效账号与总览查询。 */
function useCredentialRowMutations(ctx: AccountsFlowContext) {
  const { t, invalidate, showError } = ctx;
  const billing = useMutation({
    mutationFn: refreshAccountBilling,
    onSuccess: () => {
      invalidate();
      toast.success(t("accounts.billingRefreshed"));
    },
    onError: showError,
  });
  const token = useMutation({
    mutationFn: refreshAccountToken,
    onSuccess: () => {
      invalidate();
      toast.success(t("accounts.authRefreshed"));
    },
    onError: showError,
  });
  const cooldown = useMutation({
    mutationFn: clearAccountCooldown,
    onSuccess: () => {
      invalidate();
      toast.success(t("accounts.cooldownCleared"));
    },
    onError: showError,
  });
  const quota = useMutation({
    mutationFn: refreshAccountQuota,
    onSuccess: () => {
      invalidate();
      toast.success(t("accounts.billingRefreshed"));
    },
    onError: showError,
  });
  return { billing, token, cooldown, quota };
}

function webConfirmationMessageKey(action: WebAccountConfirmationTarget["action"]): string {
  if (action === "acceptTerms") return "webAccountSettings.termsAccepted";
  if (action === "setBirthDate") return "webAccountSettings.birthDateSaved";
  return "webAccountSettings.nsfwEnabled";
}

/** Grok Web 协议动作（条款/生日/NSFW）需要二次确认，成功后刷新账号。 */
function useWebAccountConfirmation(ctx: AccountsFlowContext) {
  const [target, setTarget] = useState<WebAccountConfirmationTarget | null>(null);
  const mutation = useMutation({
    mutationFn: (next: WebAccountConfirmationTarget) => {
      if (next.action === "acceptTerms") return acceptWebAccountTerms(next.account.id);
      if (next.action === "setBirthDate") return setWebAccountBirthDate(next.account.id);
      return enableWebAccountNSFW(next.account.id);
    },
    onSuccess: (_, next) => {
      setTarget(null);
      toast.success(ctx.t(webConfirmationMessageKey(next.action)));
    },
    onError: ctx.showError,
    onSettled: ctx.invalidate,
  });
  return { target, setTarget, mutation };
}

export function useAccountRowMutations(ctx: AccountsFlowContext): AccountRowMutations {
  const credentials = useCredentialRowMutations(ctx);
  const confirmation = useWebAccountConfirmation(ctx);
  return {
    refreshBilling: (id) => credentials.billing.mutate(id),
    refreshToken: (id) => credentials.token.mutate(id),
    clearCooldown: (id) => credentials.cooldown.mutate(id),
    refreshQuota: (id) => credentials.quota.mutate(id),
    cooldownPending: credentials.cooldown.isPending,
    confirmation: {
      target: confirmation.target,
      onTargetChange: confirmation.setTarget,
      onConfirm: (next) => confirmation.mutation.mutate(next),
      pending: confirmation.mutation.isPending,
      busy: confirmation.mutation.isPending,
    },
  };
}

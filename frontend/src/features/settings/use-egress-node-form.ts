import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  egressNodeInputForProxyProfile,
  egressNodeInputForScope,
  egressNodeInputFromNode,
  emptyEgressNodeInput,
} from "@/features/settings/egress-node-form-values";
import { egressNodeMutationError } from "@/features/settings/egress-node-mutations";
import { getEgressNodeProxyURL } from "@/entities/egress/egress-api";
import type { EgressNodeDTO, EgressNodeInput, EgressScope } from "@/entities/egress/egress-dto";

export type EgressNodeForm = {
  editing: EgressNodeDTO | null | undefined;
  form: EgressNodeInput;
  proxyVisible: boolean;
  revealedProxyURL: string;
  revealPending: boolean;
  openDialog: (node: EgressNodeDTO | null) => void;
  closeDialog: () => void;
  changeScope: (scope: EgressScope, defaultUserAgents: Record<EgressScope, string> | undefined) => void;
  chooseProxyProfile: (value: string) => void;
  updateForm: (changes: Partial<EgressNodeInput>) => void;
  bindCreatedProfile: (profileId: string) => void;
  toggleProxyVisible: () => void;
};

/** 节点弹窗的草稿状态与「揭示已保存代理地址」：明文只在揭示成功后写入草稿。 */
function useEgressNodeDraft() {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<EgressNodeDTO | null | undefined>(undefined);
  const [form, setForm] = useState<EgressNodeInput>(emptyEgressNodeInput);
  const [proxyVisible, setProxyVisible] = useState(false);
  const [revealedProxyURL, setRevealedProxyURL] = useState("");

  const revealProxy = useMutation({
    mutationFn: () => {
      if (!editing) throw new Error(t("egressProxyProfiles.revealUnavailable"));
      return getEgressNodeProxyURL(editing.id);
    },
    onSuccess: ({ proxyURL }) => {
      setRevealedProxyURL(proxyURL);
      setProxyVisible(true);
      setForm((current) => ({ ...current, proxyURL }));
    },
    onError: egressNodeMutationError(t),
  });

  function resetReveal(): void {
    setProxyVisible(false);
    setRevealedProxyURL("");
  }

  function toggleProxyVisibility(): void {
    setProxyVisible((visible) => !visible);
  }

  function updateForm(changes: Partial<EgressNodeInput>): void {
    setForm((current) => ({ ...current, ...changes }));
  }

  return {
    editing,
    setEditing,
    form,
    setForm,
    proxyVisible,
    revealedProxyURL,
    revealProxy,
    resetReveal,
    toggleProxyVisibility,
    updateForm,
  };
}

/**
 * 节点弹窗表单：草稿初始化、作用域与代理配置切换、揭示可见性。
 * 字段规则集中在 egress-node-form-values，这里只保留 React 状态接线。
 */
export function useEgressNodeForm(): EgressNodeForm {
  const draft = useEgressNodeDraft();
  const { editing, setEditing, form, setForm, proxyVisible, revealedProxyURL, revealProxy, resetReveal } = draft;
  const { toggleProxyVisibility, updateForm } = draft;

  function openDialog(node: EgressNodeDTO | null): void {
    setForm(node ? egressNodeInputFromNode(node) : emptyEgressNodeInput);
    resetReveal();
    setEditing(node);
  }

  function closeDialog(): void {
    setEditing(undefined);
  }

  function changeScope(scope: EgressScope, defaultUserAgents: Record<EgressScope, string> | undefined): void {
    setForm((current) => egressNodeInputForScope(current, scope, defaultUserAgents));
  }

  function chooseProxyProfile(value: string): void {
    resetReveal();
    updateForm(egressNodeInputForProxyProfile(editing, value));
  }

  function bindCreatedProfile(profileId: string): void {
    resetReveal();
    updateForm({ proxyProfileId: profileId, proxyURL: "" });
  }

  function toggleProxyVisible(): void {
    if (revealedProxyURL) toggleProxyVisibility();
    else revealProxy.mutate();
  }

  return {
    editing,
    form,
    proxyVisible,
    revealedProxyURL,
    updateForm,
    revealPending: revealProxy.isPending,
    openDialog,
    closeDialog,
    changeScope,
    chooseProxyProfile,
    bindCreatedProfile,
    toggleProxyVisible,
  };
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import {
  createProbeProfile,
  deleteProbeProfile,
  listProbeProfiles,
  updateProbeProfile,
  type ProbeProfile,
} from "@/features/quality-guard/quality-guard-api";

// 探测配置的状态与写操作：从 probe-profiles-panel.tsx 拆出。
// 查询 key、失效范围（profiles + quality-guard）与保存/启用/删除语义保持不变。

export type ProbeProfileDraft = {
  name: string;
  prompt: string;
  expectedText: string;
  matchMode: string;
  requireThinking: boolean;
};

export function emptyProbeDraft(): ProbeProfileDraft {
  return { name: "", prompt: "", expectedText: "", matchMode: "last_line", requireThinking: false };
}

export function probeDraftFromProfile(profile: ProbeProfile): ProbeProfileDraft {
  return {
    name: profile.name,
    prompt: profile.prompt,
    expectedText: profile.expected_text ?? "",
    matchMode: profile.match_mode || "contains",
    requireThinking: profile.require_thinking,
  };
}

export type ProbeProfilesController = {
  items: ProbeProfile[];
  activeProfileId?: string;
  editing: ProbeProfile | null | undefined;
  draft: ProbeProfileDraft;
  setDraft: (draft: ProbeProfileDraft) => void;
  deleting: ProbeProfile | null;
  saving: boolean;
  activating: boolean;
  deletingPending: boolean;
  beginCreate: () => void;
  beginEdit: (profile: ProbeProfile) => void;
  closeEditor: () => void;
  beginDelete: (profile: ProbeProfile) => void;
  closeDelete: () => void;
  save: () => void;
  activate: (profile: ProbeProfile) => void;
  remove: (profile: ProbeProfile) => void;
};

function useProbeProfileRefresh(): () => void {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["quality-guard-profiles"] });
    void queryClient.invalidateQueries({ queryKey: ["quality-guard"] });
  };
}

function useProbeProfileSave(
  draft: ProbeProfileDraft,
  editing: ProbeProfile | null | undefined,
  onSaved: () => void,
  refresh: () => void,
) {
  const { t } = useTranslation();
  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        name: draft.name.trim(),
        prompt: draft.prompt.trim(),
        expectedText: draft.expectedText.trim(),
        matchMode: draft.matchMode,
        requireThinking: draft.requireThinking,
      };
      if (editing && !editing.built_in) return updateProbeProfile(editing.id, payload);
      return createProbeProfile(payload);
    },
    onSuccess: () => {
      toast.success(t("qualityGuard.profileSaved"));
      onSaved();
      refresh();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : t("errors.generic")),
  });
  return { save: mutation.mutate, saving: mutation.isPending };
}

function useProbeProfileActivate(refresh: () => void) {
  const { t } = useTranslation();
  const mutation = useMutation({
    mutationFn: (profile: ProbeProfile) =>
      updateProbeProfile(profile.id, {
        name: profile.name,
        prompt: profile.prompt,
        expectedText: profile.expected_text ?? "",
        matchMode: profile.match_mode,
        requireThinking: profile.require_thinking,
        active: true,
      }),
    onSuccess: () => {
      toast.success(t("qualityGuard.profileSaved"));
      refresh();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : t("errors.generic")),
  });
  return { activate: mutation.mutate, activating: mutation.isPending };
}

function useProbeProfileDelete(onDeleted: () => void, refresh: () => void) {
  const { t } = useTranslation();
  const mutation = useMutation({
    mutationFn: (profile: ProbeProfile) => deleteProbeProfile(profile.id),
    onSuccess: () => {
      toast.success(t("qualityGuard.profileDeleted"));
      onDeleted();
      refresh();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : t("errors.generic")),
  });
  return { remove: mutation.mutate, deletingPending: mutation.isPending };
}

export function useProbeProfiles(): ProbeProfilesController {
  const query = useQuery({ queryKey: ["quality-guard-profiles"], queryFn: listProbeProfiles });
  const refresh = useProbeProfileRefresh();
  const [editing, setEditing] = useState<ProbeProfile | null | undefined>(undefined);
  const [draft, setDraft] = useState<ProbeProfileDraft>(emptyProbeDraft);
  const [deleting, setDeleting] = useState<ProbeProfile | null>(null);

  const closeEditor = () => setEditing(undefined);
  const save = useProbeProfileSave(draft, editing, closeEditor, refresh);
  const activate = useProbeProfileActivate(refresh);
  const remove = useProbeProfileDelete(() => setDeleting(null), refresh);

  return {
    items: query.data?.items ?? [],
    activeProfileId: query.data?.activeProfileId,
    editing,
    draft,
    setDraft,
    deleting,
    saving: save.saving,
    activating: activate.activating,
    deletingPending: remove.deletingPending,
    beginCreate: () => {
      setEditing(null);
      setDraft(emptyProbeDraft());
    },
    beginEdit: (profile) => {
      setEditing(profile);
      setDraft(probeDraftFromProfile(profile));
    },
    closeEditor,
    beginDelete: (profile) => setDeleting(profile),
    closeDelete: () => setDeleting(null),
    save: save.save,
    activate: activate.activate,
    remove: remove.remove,
  };
}

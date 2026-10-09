import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { ProbeProfileDraft, ProbeProfilesController } from "@/features/quality-guard/use-probe-profiles";

// 探测配置新增/编辑/查看弹窗：从 probe-profiles-panel.tsx 拆出。内置配置只读、字段与校验保持不变。

type DraftFieldProps = {
  draft: ProbeProfileDraft;
  setDraft: (draft: ProbeProfileDraft) => void;
  readonly: boolean;
};

function ProbeProfileBasics({ draft, setDraft, readonly }: DraftFieldProps) {
  const { t } = useTranslation();
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="probe-profile-name">{t("qualityGuard.profileName")}</Label>
        <Input
          id="probe-profile-name"
          value={draft.name}
          disabled={readonly}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          data-testid="probe-profile-name"
        />
      </div>
      <div className="space-y-2">
        <Label>{t("qualityGuard.profileMatch")}</Label>
        <Select
          value={draft.matchMode}
          disabled={readonly}
          onValueChange={(matchMode) => setDraft({ ...draft, matchMode })}
        >
          <SelectTrigger data-testid="probe-profile-match">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="last_line">{t("qualityGuard.profileMatchLastLine")}</SelectItem>
            <SelectItem value="contains">{t("qualityGuard.profileMatchContains")}</SelectItem>
            <SelectItem value="regex">{t("qualityGuard.profileMatchRegex")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="probe-profile-expected">{t("qualityGuard.profileExpected")}</Label>
        <Input
          id="probe-profile-expected"
          value={draft.expectedText}
          disabled={readonly}
          onChange={(event) => setDraft({ ...draft, expectedText: event.target.value })}
          data-testid="probe-profile-expected"
        />
        <p className="text-xs text-muted-foreground">{t("qualityGuard.profileExpectedHelp")}</p>
      </div>
    </>
  );
}

function ProbeProfilePromptField({ draft, setDraft, readonly }: DraftFieldProps) {
  const { t } = useTranslation();
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="probe-profile-prompt">{t("qualityGuard.profilePrompt")}</Label>
        <Textarea
          id="probe-profile-prompt"
          value={draft.prompt}
          disabled={readonly}
          onChange={(event) => setDraft({ ...draft, prompt: event.target.value })}
          data-testid="probe-profile-prompt"
        />
      </div>
      <div className="flex items-start justify-between gap-4 rounded-md border p-3">
        <div className="space-y-1">
          <Label htmlFor="probe-profile-thinking">{t("qualityGuard.profileRequireThinking")}</Label>
          <p className="text-xs text-muted-foreground">{t("qualityGuard.profileRequireThinkingHelp")}</p>
        </div>
        <Switch
          id="probe-profile-thinking"
          checked={draft.requireThinking}
          disabled={readonly}
          onCheckedChange={(requireThinking) => setDraft({ ...draft, requireThinking })}
        />
      </div>
    </>
  );
}

export function ProbeProfileDialog({ controller }: { controller: ProbeProfilesController }) {
  const { t } = useTranslation();
  const { editing, draft, setDraft, saving, closeEditor, save } = controller;
  const readonly = Boolean(editing?.built_in);
  return (
    <Dialog
      open={editing !== undefined}
      onOpenChange={(open) => {
        if (!open && !saving) closeEditor();
      }}
    >
      <DialogContent
        className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-[560px]"
        data-testid="probe-profile-dialog"
      >
        <DialogHeader>
          <DialogTitle>
            {editing
              ? t(readonly ? "qualityGuard.profileView" : "qualityGuard.profileEdit")
              : t("qualityGuard.profileCreate")}
          </DialogTitle>
          <DialogDescription>{t("qualityGuard.profilesHelp")}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3.5"
          onSubmit={(event) => {
            event.preventDefault();
            if (!readonly) save();
          }}
        >
          <ProbeProfileBasics draft={draft} setDraft={setDraft} readonly={readonly} />
          <ProbeProfilePromptField draft={draft} setDraft={setDraft} readonly={readonly} />
          <ProbeProfileDialogFooter draft={draft} saving={saving} readonly={readonly} closeEditor={closeEditor} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ProbeProfileDialogFooter({
  draft,
  saving,
  readonly,
  closeEditor,
}: {
  draft: ProbeProfileDraft;
  saving: boolean;
  readonly: boolean;
  closeEditor: () => void;
}) {
  const { t } = useTranslation();
  return (
    <DialogFooter>
      <Button type="button" variant="secondary" size="sm" onClick={closeEditor}>
        {t("common.cancel")}
      </Button>
      {readonly ? null : (
        <Button
          type="submit"
          size="sm"
          disabled={!draft.name.trim() || !draft.prompt.trim() || saving}
          data-testid="probe-profile-save"
        >
          {saving ? <Spinner /> : null}
          {t("common.save")}
        </Button>
      )}
    </DialogFooter>
  );
}

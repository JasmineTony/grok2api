import type { ReactNode } from "react";
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
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import type { EgressNodeDTO, EgressNodeInput } from "@/features/settings/settings-api";

// 守护节点新增/编辑弹窗：从 quality-guard-page.tsx 拆出。字段、校验与提交行为保持不变，
// 仅按「通用字段 / 代理字段」拆成两个子组件，避免单组件过长。

function NodeField({
  label,
  controlId,
  help,
  children,
}: {
  label: string;
  controlId: string;
  help?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={controlId}>{label}</Label>
      {children}
      {help ? <p className="whitespace-pre-line text-xs leading-5 text-muted-foreground">{help}</p> : null}
    </div>
  );
}

function NodeGeneralFields({
  form,
  onFormChange,
}: {
  form: EgressNodeInput;
  onFormChange: (form: EgressNodeInput) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <div className="flex items-center justify-between gap-4 rounded-md bg-muted/45 px-3 py-2.5">
        <Label htmlFor="quality-node-enabled">{t("settings.egress.enabled")}</Label>
        <Switch
          id="quality-node-enabled"
          checked={form.enabled}
          onCheckedChange={(enabled) => onFormChange({ ...form, enabled })}
          data-testid="guard-node-enabled"
        />
      </div>
      <NodeField label={t("settings.egress.name")} controlId="quality-node-name">
        <Input
          id="quality-node-name"
          autoFocus
          value={form.name}
          onChange={(event) => onFormChange({ ...form, name: event.target.value })}
          data-testid="guard-node-name"
        />
      </NodeField>
      <NodeField label={t("settings.egress.scope")} controlId="quality-node-scope">
        <div
          id="quality-node-scope"
          className="flex h-9 items-center rounded-md border bg-muted/30 px-3 text-sm text-muted-foreground"
        >
          {t("settings.egress.scopeBuild")}
        </div>
      </NodeField>
    </>
  );
}

function NodeProxyFields({
  form,
  editingNode,
  onFormChange,
}: {
  form: EgressNodeInput;
  editingNode: EgressNodeDTO | null | undefined;
  onFormChange: (form: EgressNodeInput) => void;
}) {
  const proxyConfigured = Boolean(editingNode?.proxyConfigured || form.proxyURL?.trim());
  return (
    <>
      <NodeCapacityField form={form} onFormChange={onFormChange} />
      <NodeProxyURLField form={form} editingNode={editingNode} onFormChange={onFormChange} />
      <NodeProxyPoolField form={form} proxyConfigured={proxyConfigured} onFormChange={onFormChange} />
    </>
  );
}

function NodeCapacityField({
  form,
  onFormChange,
}: {
  form: EgressNodeInput;
  onFormChange: (form: EgressNodeInput) => void;
}) {
  const { t } = useTranslation();
  return (
    <NodeField
      label={t("settings.egress.capacity")}
      controlId="quality-node-capacity"
      help={t("qualityGuard.nodeCapacityHelp")}
    >
      <Input
        id="quality-node-capacity"
        type="number"
        min={0}
        max={100000}
        placeholder={t("settings.egress.unlimited")}
        value={form.accountCapacity || ""}
        onChange={(event) => onFormChange({ ...form, accountCapacity: Number(event.target.value) })}
        data-testid="guard-node-capacity"
      />
    </NodeField>
  );
}

function NodeProxyURLField({
  form,
  editingNode,
  onFormChange,
}: {
  form: EgressNodeInput;
  editingNode: EgressNodeDTO | null | undefined;
  onFormChange: (form: EgressNodeInput) => void;
}) {
  const { t } = useTranslation();
  return (
    <NodeField
      label={t("settings.egress.proxyURL")}
      controlId="quality-node-proxy"
      help={t("settings.egress.proxyProtocols")}
    >
      <Input
        id="quality-node-proxy"
        type="password"
        autoComplete="new-password"
        placeholder={
          editingNode?.proxyConfigured ? t("settings.egress.keepConfigured") : "socks5h://user:pass@host:port"
        }
        value={form.proxyURL ?? ""}
        onChange={(event) => {
          const proxyURL = event.target.value;
          onFormChange({
            ...form,
            proxyURL,
            proxyPool: editingNode?.proxyConfigured || proxyURL.trim() ? form.proxyPool : false,
          });
        }}
        data-testid="guard-node-proxy"
      />
    </NodeField>
  );
}

function NodeProxyPoolField({
  form,
  proxyConfigured,
  onFormChange,
}: {
  form: EgressNodeInput;
  proxyConfigured: boolean;
  onFormChange: (form: EgressNodeInput) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-start justify-between gap-4 rounded-md bg-muted/45 px-3 py-2.5">
      <div className="space-y-1">
        <Label htmlFor="quality-node-proxy-pool">{t("settings.egress.proxyPool")}</Label>
        <p className="max-w-[390px] text-xs leading-5 text-muted-foreground">{t("settings.egress.proxyPoolHelp")}</p>
      </div>
      <Switch
        id="quality-node-proxy-pool"
        className="mt-0.5"
        checked={form.proxyPool}
        disabled={!proxyConfigured}
        onCheckedChange={(proxyPool) => onFormChange({ ...form, proxyPool })}
      />
    </div>
  );
}

export function NodeEditor({
  open,
  editingNode,
  form,
  onFormChange,
  onOpenChange,
  onSave,
  saving,
}: {
  open: boolean;
  editingNode: EgressNodeDTO | null | undefined;
  form: EgressNodeInput;
  onFormChange: (form: EgressNodeInput) => void;
  onOpenChange: (open: boolean) => void;
  onSave: () => void;
  saving: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-[520px]"
        data-testid="guard-node-editor"
      >
        <DialogHeader className="pr-8">
          <DialogTitle>{editingNode ? t("settings.egress.editTitle") : t("settings.egress.addTitle")}</DialogTitle>
          <DialogDescription>{t("qualityGuard.nodeEditorDescription")}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3.5"
          onSubmit={(event) => {
            event.preventDefault();
            onSave();
          }}
        >
          <NodeGeneralFields form={form} onFormChange={onFormChange} />
          <NodeProxyFields form={form} editingNode={editingNode} onFormChange={onFormChange} />
          <NodeEditorFooter form={form} saving={saving} onOpenChange={onOpenChange} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

function NodeEditorFooter({
  form,
  saving,
  onOpenChange,
}: {
  form: EgressNodeInput;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <DialogFooter>
      <Button type="button" variant="secondary" size="sm" disabled={saving} onClick={() => onOpenChange(false)}>
        {t("common.cancel")}
      </Button>
      <Button type="submit" size="sm" disabled={!form.name.trim() || saving} data-testid="guard-node-save">
        {saving ? <Spinner /> : null}
        {t("common.save")}
      </Button>
    </DialogFooter>
  );
}

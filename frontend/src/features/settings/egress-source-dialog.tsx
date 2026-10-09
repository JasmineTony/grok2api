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
import { EgressScopeSelect } from "@/features/settings/egress-scope-select";
import type { EgressScope, EgressSourceDTO } from "@/features/settings/settings-api";
import type { EgressSourceForm } from "@/features/settings/egress-source-form";

export type EgressSourceDialogProps = {
  editing: EgressSourceDTO | null | undefined;
  form: EgressSourceForm;
  invalidProxy: boolean;
  pending: boolean;
  scopeLabel: (scope: EgressScope) => string;
  onFormChange: (changes: Partial<EgressSourceForm>) => void;
  onClose: () => void;
  onSubmit: () => void;
};

/** 订阅源新增/编辑弹窗：基础信息、路由与刷新参数分组渲染。 */
export function EgressSourceDialog(props: EgressSourceDialogProps) {
  const { t } = useTranslation();
  const { editing, form, invalidProxy, pending, onClose, onSubmit } = props;
  const submitDisabled =
    !form.name.trim() ||
    (!editing && !form.url.trim()) ||
    (form.proxyEnabled && !editing?.proxyConfigured && !form.proxyURL.trim()) ||
    invalidProxy ||
    pending;
  return (
    <Dialog
      open={editing !== undefined}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-[520px]"
        data-testid="egress-source-dialog"
      >
        <DialogHeader className="pr-8">
          <DialogTitle>{editing ? t("settings.egress.editSource") : t("settings.egress.addSource")}</DialogTitle>
          <DialogDescription>{t("settings.egress.sourceDialogDescription")}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3.5"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onSubmit();
          }}
        >
          <EgressSourceBasicFields {...props} />
          <EgressSourceRoutingFields {...props} />
          <EgressSourceIntervalFields form={form} onFormChange={props.onFormChange} />
          <EgressSourceDialogFooter pending={pending} disabled={submitDisabled} onClose={onClose} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EgressSourceBasicFields({ editing, form, scopeLabel, onFormChange }: EgressSourceDialogProps) {
  const { t } = useTranslation();
  return (
    <>
      <EgressSourceToggle
        label={t("settings.egress.enabled")}
        checked={form.enabled}
        onChange={(enabled) => onFormChange({ enabled })}
      />
      <EgressSourceControl label={t("settings.egress.name")}>
        <Input
          value={form.name}
          onChange={(event) => onFormChange({ name: event.target.value })}
          data-testid="egress-source-name"
        />
      </EgressSourceControl>
      <EgressSourceControl label={t("settings.egress.scope")}>
        <EgressScopeSelect value={form.scope} scopeLabel={scopeLabel} onChange={(scope) => onFormChange({ scope })} />
      </EgressSourceControl>
      <EgressSourceControl label={t("settings.egress.subscriptionURL")}>
        <Input
          type="password"
          autoComplete="new-password"
          placeholder={editing?.urlConfigured ? t("settings.egress.keepConfigured") : "https://..."}
          value={form.url}
          onChange={(event) => onFormChange({ url: event.target.value })}
          data-testid="egress-source-url"
        />
      </EgressSourceControl>
    </>
  );
}

function EgressSourceRoutingFields({ editing, form, invalidProxy, onFormChange }: EgressSourceDialogProps) {
  const { t } = useTranslation();
  return (
    <>
      <EgressSourceToggle
        label={t("settings.egress.subscriptionProxy")}
        checked={form.proxyEnabled}
        onChange={(proxyEnabled) => onFormChange({ proxyEnabled })}
      />
      {form.proxyEnabled ? (
        <EgressSourceControl label={t("settings.egress.subscriptionProxyURL")}>
          <Input
            type="password"
            autoComplete="new-password"
            aria-invalid={invalidProxy}
            placeholder={editing?.proxyConfigured ? t("settings.egress.keepConfigured") : "http://proxy.example:8080"}
            value={form.proxyURL}
            onChange={(event) => onFormChange({ proxyURL: event.target.value })}
            data-testid="egress-source-proxy-url"
          />
          {invalidProxy ? (
            <p className="text-xs text-destructive" data-testid="egress-source-proxy-invalid">
              {t("settings.egress.invalidSubscriptionProxy")}
            </p>
          ) : null}
        </EgressSourceControl>
      ) : null}
    </>
  );
}

function EgressSourceIntervalFields({
  form,
  onFormChange,
}: {
  form: EgressSourceForm;
  onFormChange: (changes: Partial<EgressSourceForm>) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <EgressSourceControl label={t("settings.egress.refreshInterval")}>
        <Input
          type="number"
          min={60}
          max={86400}
          value={form.refreshIntervalSeconds}
          onChange={(event) => onFormChange({ refreshIntervalSeconds: Number(event.target.value) })}
          data-testid="egress-source-refresh-interval"
        />
      </EgressSourceControl>
      <EgressSourceControl label={t("settings.egress.capacity")}>
        <Input
          type="number"
          min={0}
          max={100000}
          placeholder={t("settings.egress.unlimited")}
          value={form.defaultAccountCapacity || ""}
          onChange={(event) => onFormChange({ defaultAccountCapacity: Number(event.target.value) })}
          data-testid="egress-source-capacity"
        />
      </EgressSourceControl>
    </div>
  );
}

function EgressSourceControl({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <Label className="text-xs font-medium">{label}</Label>
      {children}
    </div>
  );
}

function EgressSourceToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex min-h-10 items-center justify-between gap-4 rounded-md bg-muted/45 px-3">
      <Label className="text-xs font-medium">{label}</Label>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function EgressSourceDialogFooter({
  pending,
  disabled,
  onClose,
}: {
  pending: boolean;
  disabled: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <DialogFooter>
      <Button type="button" size="sm" variant="secondary" onClick={onClose} data-testid="egress-source-dialog-cancel">
        {t("common.cancel")}
      </Button>
      <Button type="submit" size="sm" disabled={disabled} data-testid="egress-source-dialog-save">
        {pending ? <Spinner /> : null}
        {t("common.save")}
      </Button>
    </DialogFooter>
  );
}

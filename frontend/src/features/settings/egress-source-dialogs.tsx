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
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import type { ImportForm, SourceForm } from "@/features/settings/egress-operations-model";
import { Control, ScopeSelect, ToggleControl } from "@/features/settings/egress-operations-ui";
import type { EgressScope, EgressSourceDTO } from "@/features/settings/settings-api";

type SourceDialogProps = {
  editing: EgressSourceDTO | null | undefined;
  form: SourceForm;
  pending: boolean;
  proxyError: string;
  scopeLabel: (scope: EgressScope) => string;
  onClose: () => void;
  onChange: (next: SourceForm) => void;
  onSubmit: () => void;
};

export function EgressSourceDialog({
  editing,
  form,
  pending,
  proxyError,
  scopeLabel,
  onClose,
  onChange,
  onSubmit,
}: SourceDialogProps) {
  const { t } = useTranslation();
  const updateForm = (patch: Partial<SourceForm>) => onChange({ ...form, ...patch });
  return (
    <Dialog open={editing !== undefined} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-[520px]">
        <DialogHeader className="pr-8">
          <DialogTitle>
            {editing ? t("settings.egress.editSource") : t("settings.egress.addSource")}
          </DialogTitle>
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
          <ToggleControl
            controlId="egress-source-enabled"
            label={t("settings.egress.enabled")}
            checked={form.enabled}
            onChange={(enabled) => updateForm({ enabled })}
          />
          <Control controlId="egress-source-name" label={t("settings.egress.name")}>
            <Input
              id="egress-source-name"
              value={form.name}
              onChange={(event) => updateForm({ name: event.target.value })}
            />
          </Control>
          <Control controlId="egress-source-scope" label={t("settings.egress.scope")}>
            <ScopeSelect
              id="egress-source-scope"
              value={form.scope}
              onChange={(scope) => updateForm({ scope })}
              scopeLabel={scopeLabel}
            />
          </Control>
          <Control controlId="egress-source-url" label={t("settings.egress.subscriptionURL")}>
            <div className="space-y-2">
              <div className="flex min-w-0 gap-2">
                <Input
                  id="egress-source-url"
                  type="password"
                  autoComplete="new-password"
                  placeholder={
                    editing?.urlConfigured ? t("settings.egress.keepConfigured") : "https://..."
                  }
                  value={form.url}
                  onChange={(event) => updateForm({ url: event.target.value, clearUrl: false })}
                />
                {editing?.urlConfigured ? (
                  <Button
                    type="button"
                    size="sm"
                    variant={form.clearUrl ? "secondary" : "outline"}
                    onClick={() => updateForm({ url: "", clearUrl: !form.clearUrl })}
                  >
                    {form.clearUrl
                      ? t("settings.egress.cancelClearSubscriptionURL")
                      : t("settings.egress.clearSubscriptionURL")}
                  </Button>
                ) : null}
              </div>
              {editing?.urlConfigured && !form.clearUrl && !form.url ? (
                <p className="text-xs text-muted-foreground">
                  {t("settings.egress.keepConfigured")}
                </p>
              ) : null}
            </div>
          </Control>
          <Control controlId="egress-source-proxy" label={t("settings.egress.subscriptionProxy")}>
            <div className="space-y-2">
              <div className="flex min-w-0 gap-2">
                <Input
                  id="egress-source-proxy"
                  type="password"
                  autoComplete="new-password"
                  placeholder={
                    editing?.proxyConfigured
                      ? t("settings.egress.keepConfigured")
                      : "socks5h://user:pass@host:port"
                  }
                  value={form.proxyURL}
                  onChange={(event) =>
                    updateForm({ proxyURL: event.target.value, clearProxyURL: false })
                  }
                />
                {editing?.proxyConfigured ? (
                  <Button
                    type="button"
                    size="sm"
                    variant={form.clearProxyURL ? "secondary" : "outline"}
                    onClick={() => updateForm({ proxyURL: "", clearProxyURL: !form.clearProxyURL })}
                  >
                    {form.clearProxyURL
                      ? t("settings.egress.cancelClearSubscriptionProxy")
                      : t("settings.egress.clearSubscriptionProxy")}
                  </Button>
                ) : null}
              </div>
              {proxyError ? <p className="text-xs text-destructive">{proxyError}</p> : null}
              {editing?.proxyConfigured && !form.clearProxyURL && !form.proxyURL ? (
                <p className="text-xs text-muted-foreground">
                  {t("settings.egress.keepConfigured")}
                </p>
              ) : null}
            </div>
          </Control>
          <div className="grid gap-3 sm:grid-cols-2">
            <Control
              controlId="egress-source-refresh-interval"
              label={t("settings.egress.refreshInterval")}
            >
              <Input
                id="egress-source-refresh-interval"
                type="number"
                min={60}
                max={86400}
                value={form.refreshIntervalSeconds}
                onChange={(event) =>
                  updateForm({ refreshIntervalSeconds: Number(event.target.value) })
                }
              />
            </Control>
            <Control controlId="egress-source-capacity" label={t("settings.egress.capacity")}>
              <Input
                id="egress-source-capacity"
                type="number"
                min={0}
                max={100000}
                placeholder={t("settings.egress.unlimited")}
                value={form.defaultAccountCapacity || ""}
                onChange={(event) =>
                  updateForm({ defaultAccountCapacity: Number(event.target.value) })
                }
              />
            </Control>
          </div>
          <DialogFooter>
            <Button type="button" size="sm" variant="secondary" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={
                !form.name.trim() ||
                (!editing && !form.url.trim()) ||
                Boolean(proxyError) ||
                pending
              }
            >
              {pending ? <Spinner /> : null}
              {t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type ImportDialogProps = {
  open: boolean;
  form: ImportForm;
  pending: boolean;
  scopeLabel: (scope: EgressScope) => string;
  onOpenChange: (open: boolean) => void;
  onChange: (next: ImportForm) => void;
  onSubmit: () => void;
};

export function EgressImportDialog({
  open,
  form,
  pending,
  scopeLabel,
  onOpenChange,
  onChange,
  onSubmit,
}: ImportDialogProps) {
  const { t } = useTranslation();
  const updateForm = (patch: Partial<ImportForm>) => onChange({ ...form, ...patch });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto">
        <DialogHeader className="pr-8">
          <DialogTitle>{t("settings.egress.importText")}</DialogTitle>
          <DialogDescription>{t("settings.egress.importDialogDescription")}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3.5"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onSubmit();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Control controlId="egress-import-name" label={t("settings.egress.name")}>
              <Input
                id="egress-import-name"
                value={form.name}
                onChange={(event) => updateForm({ name: event.target.value })}
              />
            </Control>
            <Control controlId="egress-import-scope" label={t("settings.egress.scope")}>
              <ScopeSelect
                id="egress-import-scope"
                value={form.scope}
                onChange={(scope) => updateForm({ scope })}
                scopeLabel={scopeLabel}
              />
            </Control>
          </div>
          <Control controlId="egress-import-capacity" label={t("settings.egress.capacity")}>
            <Input
              id="egress-import-capacity"
              type="number"
              min={0}
              max={100000}
              placeholder={t("settings.egress.unlimited")}
              value={form.accountCapacity || ""}
              onChange={(event) => updateForm({ accountCapacity: Number(event.target.value) })}
            />
          </Control>
          <Control controlId="egress-import-proxy-list" label={t("settings.egress.proxyList")}>
            <Textarea
              id="egress-import-proxy-list"
              className="min-h-40 font-mono text-xs"
              value={form.content}
              onChange={(event) => updateForm({ content: event.target.value })}
            />
          </Control>
          <DialogFooter>
            <Button type="button" size="sm" variant="secondary" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={!form.name.trim() || !form.content.trim() || pending}
            >
              {pending ? <Spinner /> : null}
              {t("settings.egress.importText")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

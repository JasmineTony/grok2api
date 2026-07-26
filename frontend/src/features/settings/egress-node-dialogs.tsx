import { useQuery } from "@tanstack/react-query";
import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import {
  type EgressNodeDTO,
  type EgressNodeInput,
  type EgressScope,
  listEgressHealthChecks,
} from "@/features/settings/settings-api";
import { useApiClient } from "@/shared/api/use-api-client";
import { EmptyState, ErrorState, LoadingState } from "@/shared/components/data-state";
import { formatDateTime } from "@/shared/lib/format";

type EgressNodeEditorDialogProps = {
  editing: EgressNodeDTO | null | undefined;
  form: EgressNodeInput;
  pending: boolean;
  onClose: () => void;
  onFormChange: (next: EgressNodeInput) => void;
  onScopeChange: (scope: EgressScope) => void;
  onSubmit: () => void;
};

export function EgressNodeEditorDialog({
  editing,
  form,
  pending,
  onClose,
  onFormChange,
  onScopeChange,
  onSubmit,
}: EgressNodeEditorDialogProps) {
  const { t } = useTranslation();
  const updateForm = (patch: Partial<EgressNodeInput>) => onFormChange({ ...form, ...patch });

  return (
    <Dialog open={editing !== undefined} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-[520px]">
        <DialogHeader className="pr-8">
          <DialogTitle>
            {editing ? t("settings.egress.editTitle") : t("settings.egress.addTitle")}
          </DialogTitle>
          <DialogDescription>{t("console.egressDialogDescription")}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <div className="flex items-center justify-between gap-4 rounded-md bg-muted/45 px-3 py-2.5">
            <Label htmlFor="egress-enabled">{t("settings.egress.enabled")}</Label>
            <Switch
              id="egress-enabled"
              checked={form.enabled}
              onCheckedChange={(enabled) => updateForm({ enabled })}
            />
          </div>
          <Field label={t("settings.egress.name")} controlId="egress-name">
            <Input
              id="egress-name"
              value={form.name}
              onChange={(event) => updateForm({ name: event.target.value })}
            />
          </Field>
          <Field label={t("settings.egress.scope")} controlId="egress-scope">
            <Select
              value={form.scope}
              onValueChange={(value) => onScopeChange(value as EgressScope)}
            >
              <SelectTrigger id="egress-scope">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="grok_build">{t("settings.egress.scopeBuild")}</SelectItem>
                <SelectItem value="grok_web">{t("settings.egress.scopeWeb")}</SelectItem>
                <SelectItem value="grok_console">{t("console.name")}</SelectItem>
                <SelectItem value="grok_web_asset">{t("settings.egress.scopeWebAsset")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field
            label={t("settings.egress.proxyURL")}
            controlId="egress-proxy"
            description={t("settings.egress.proxyProtocols")}
          >
            <Input
              id="egress-proxy"
              type="password"
              autoComplete="new-password"
              placeholder={
                editing?.proxyConfigured
                  ? t("settings.egress.keepConfigured")
                  : "socks5h://user:pass@host:port"
              }
              value={form.proxyURL}
              onChange={(event) => updateForm({ proxyURL: event.target.value })}
            />
          </Field>
          <Field
            label={t("settings.egress.accountCapacity")}
            controlId="egress-account-capacity"
            description={t("settings.egress.accountCapacityHelp")}
          >
            <Input
              id="egress-account-capacity"
              type="number"
              min={0}
              max={100000}
              value={form.accountCapacity}
              onChange={(event) => updateForm({ accountCapacity: Number(event.target.value) })}
            />
          </Field>
          <div className="flex items-center justify-between gap-4 rounded-md bg-muted/45 px-3 py-2.5">
            <div className="space-y-0.5">
              <Label htmlFor="egress-proxy-pool">{t("settings.egress.proxyPool")}</Label>
              <p className="text-xs text-muted-foreground">{t("settings.egress.proxyPoolHelp")}</p>
            </div>
            <Switch
              id="egress-proxy-pool"
              checked={Boolean(form.proxyPool)}
              onCheckedChange={(proxyPool) => updateForm({ proxyPool })}
            />
          </div>
          {form.scope !== "grok_build" ? (
            <Field label={t("settings.egress.userAgent")} controlId="egress-user-agent">
              <Input
                id="egress-user-agent"
                value={form.userAgent}
                onChange={(event) => updateForm({ userAgent: event.target.value })}
              />
            </Field>
          ) : null}
          {form.scope !== "grok_build" ? (
            <Field label={t("settings.egress.cloudflareCookie")} controlId="egress-cookie">
              <Input
                id="egress-cookie"
                type="password"
                autoComplete="new-password"
                placeholder={
                  editing?.cookieConfigured
                    ? t("settings.egress.keepConfigured")
                    : "cf_clearance=...; __cf_bm=..."
                }
                value={form.cloudflareCookies}
                onChange={(event) => updateForm({ cloudflareCookies: event.target.value })}
              />
            </Field>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="secondary" size="sm" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" size="sm" disabled={!form.name.trim() || pending}>
              {pending ? <Spinner /> : null}
              {t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function EgressNodeHistoryDialog({
  node,
  onClose,
}: {
  node: EgressNodeDTO | null;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const apiClient = useApiClient();
  const query = useQuery({
    queryKey: ["egress-health-checks", node?.id],
    queryFn: () => listEgressHealthChecks(apiClient, node?.id ?? ""),
    enabled: Boolean(node),
  });

  return (
    <Dialog open={Boolean(node)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("settings.egress.history")}</DialogTitle>
          <DialogDescription>{node?.name}</DialogDescription>
        </DialogHeader>
        {query.isPending ? <LoadingState className="min-h-32" /> : null}
        {query.isError ? (
          <ErrorState message={query.error.message} onRetry={() => void query.refetch()} />
        ) : null}
        {query.data?.items.length === 0 ? (
          <EmptyState message={t("settings.egress.noHistory")} />
        ) : null}
        {query.data?.items.length ? (
          <div className="space-y-2 overflow-y-auto pr-1">
            {query.data.items.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-3 rounded-md border p-3 text-xs"
              >
                <div>
                  <Badge variant={item.healthy ? "secondary" : "destructive"}>
                    {t(item.healthy ? "settings.egress.healthy" : "settings.egress.unhealthy")}
                  </Badge>
                  {item.errorCode ? (
                    <span className="ml-2 text-muted-foreground">{item.errorCode}</span>
                  ) : null}
                </div>
                <div className="text-right text-muted-foreground">
                  <div>{item.durationMs} ms</div>
                  <div>{formatDateTime(item.checkedAt, i18n.language)}</div>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  controlId,
  description,
  children,
}: {
  label: string;
  controlId: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={controlId}>{label}</Label>
      {children}
      {description ? (
        <p className="text-xs leading-5 text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}

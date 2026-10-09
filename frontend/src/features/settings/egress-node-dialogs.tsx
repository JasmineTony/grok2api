import type { TFunction } from "i18next";
import { CircleHelp, Eye, EyeOff } from "lucide-react";
import type { ReactNode } from "react";
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
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EgressScopeSelect } from "@/features/settings/egress-scope-select";
import { ProxyProfilePicker } from "@/features/settings/egress-proxy-profile-picker";
import type { ClearanceMode, EgressNodeDTO, EgressNodeInput, EgressScope } from "@/features/settings/settings-api";
import type { EgressImportForm } from "@/features/settings/egress-import-form";

type EgressNodeDialogProps = {
  open: boolean;
  editing: EgressNodeDTO | null | undefined;
  form: EgressNodeInput;
  clearanceMode: ClearanceMode;
  proxyVisible: boolean;
  revealPending: boolean;
  savePending: boolean;
  scopeLabel: (scope: EgressScope) => string;
  onFormChange: (changes: Partial<EgressNodeInput>) => void;
  onScopeChange: (scope: EgressScope) => void;
  onProfileChange: (profileId: string) => void;
  onOpenProfileLibrary: () => void;
  onToggleProxyVisible: () => void;
  onClose: () => void;
  onSubmit: () => void;
};

/** 出口节点新增/编辑弹窗：字段拆分为基础信息、作用域、代理与凭据四组。 */
export function EgressNodeDialog(props: EgressNodeDialogProps) {
  const { t } = useTranslation();
  const { editing, form, savePending, onClose, onSubmit } = props;
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-[520px]"
        data-testid="egress-node-dialog"
      >
        <EgressNodeDialogHeader editing={editing} />
        <form
          className="space-y-3.5"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onSubmit();
          }}
        >
          <EgressNodeDialogFields {...props} />
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onClose}
              data-testid="egress-node-dialog-cancel"
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={!form.name.trim() || savePending}
              data-testid="egress-node-dialog-save"
            >
              {savePending ? <Spinner /> : null}
              {t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EgressNodeDialogFields(props: EgressNodeDialogProps) {
  return (
    <>
      <EgressNodeBasicsFields form={props.form} onFormChange={props.onFormChange} />
      <EgressNodeScopeFields {...props} />
      <EgressNodeProxyFields {...props} />
      <EgressNodeCredentialFields
        editing={props.editing}
        form={props.form}
        clearanceMode={props.clearanceMode}
        onFormChange={props.onFormChange}
      />
    </>
  );
}

function EgressNodeBasicsFields({
  form,
  onFormChange,
}: {
  form: EgressNodeInput;
  onFormChange: (changes: Partial<EgressNodeInput>) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <div className="flex items-center justify-between gap-4 rounded-md bg-muted/45 px-3 py-2.5">
        <Label htmlFor="egress-enabled">{t("settings.egress.enabled")}</Label>
        <Switch
          id="egress-enabled"
          checked={form.enabled}
          onCheckedChange={(enabled) => onFormChange({ enabled })}
          data-testid="egress-node-enabled"
        />
      </div>
      <EgressField label={t("settings.egress.name")} controlId="egress-name">
        <Input
          id="egress-name"
          value={form.name}
          onChange={(event) => onFormChange({ name: event.target.value })}
          data-testid="egress-node-name"
        />
      </EgressField>
      <EgressField label={t("settings.egress.capacity")} controlId="egress-capacity">
        <Input
          id="egress-capacity"
          type="number"
          min={0}
          max={100000}
          placeholder={t("settings.egress.unlimited")}
          value={form.accountCapacity || ""}
          onChange={(event) => onFormChange({ accountCapacity: Number(event.target.value) })}
          data-testid="egress-node-capacity"
        />
      </EgressField>
    </>
  );
}

function EgressNodeScopeFields({
  form,
  clearanceMode,
  scopeLabel,
  onScopeChange,
}: {
  form: EgressNodeInput;
  clearanceMode: ClearanceMode;
  scopeLabel: (scope: EgressScope) => string;
  onScopeChange: (scope: EgressScope) => void;
}) {
  const { t } = useTranslation();
  const showClearance = form.scope !== "grok_build" && form.scope !== "grok_console_asset";
  return (
    <>
      <EgressField label={t("settings.egress.scope")} controlId="egress-scope">
        <EgressScopeSelect id="egress-scope" value={form.scope} scopeLabel={scopeLabel} onChange={onScopeChange} />
      </EgressField>
      {showClearance ? (
        <div className="flex h-10 items-center justify-between gap-4 rounded-md bg-muted/45 px-3">
          <span className="text-xs font-medium">{t("settings.egress.clearance")}</span>
          <Badge variant="secondary" className="shrink-0 text-[10px]" data-testid="egress-node-clearance-mode">
            {clearanceMode === "flaresolverr"
              ? t("settings.web.clearanceFlareSolverr")
              : clearanceMode === "on_demand"
                ? t("settings.web.clearanceOnDemand")
                : t("settings.web.clearanceManual")}
          </Badge>
        </div>
      ) : null}
    </>
  );
}

function EgressNodeProxyFields(props: EgressNodeDialogProps) {
  const { t } = useTranslation();
  const { editing, form, onProfileChange, onOpenProfileLibrary } = props;
  return (
    <>
      {!editing?.sourceId ? (
        <EgressField
          label={t("egressProxyProfiles.assignment")}
          controlId="egress-proxy-profile"
          help={t("egressProxyProfiles.assignmentHelp")}
        >
          <ProxyProfilePicker
            value={form.proxyProfileId && form.proxyProfileId !== "0" ? form.proxyProfileId : "manual"}
            onChange={onProfileChange}
            onCreate={onOpenProfileLibrary}
          />
        </EgressField>
      ) : null}
      <EgressProxyURLField {...props} />
      <EgressProxyPoolToggle editing={editing} form={form} onFormChange={props.onFormChange} />
    </>
  );
}

function EgressProxyURLField({
  editing,
  form,
  proxyVisible,
  revealPending,
  onFormChange,
  onToggleProxyVisible,
}: Pick<
  EgressNodeDialogProps,
  "editing" | "form" | "proxyVisible" | "revealPending" | "onFormChange" | "onToggleProxyVisible"
>) {
  const { t } = useTranslation();
  const managedByProfile = Boolean(form.proxyProfileId && form.proxyProfileId !== "0");
  const placeholder = egressProxyURLPlaceholder(t, editing, managedByProfile);
  return (
    <EgressField
      label={t("settings.egress.proxyURL")}
      controlId="egress-proxy"
      help={t("settings.egress.proxyProtocols")}
    >
      <div className="flex gap-2">
        <Input
          id="egress-proxy"
          type={proxyVisible ? "text" : "password"}
          autoComplete="new-password"
          disabled={managedByProfile}
          placeholder={placeholder}
          value={form.proxyURL}
          onChange={(event) => {
            const proxyURL = event.target.value;
            onFormChange({
              proxyURL,
              proxyProfileId: editing?.proxyProfileId ? "0" : undefined,
              proxyPool: editing?.proxyConfigured || proxyURL.trim() ? form.proxyPool : false,
            });
          }}
          data-testid="egress-node-proxy-url"
        />
        <EgressProxyRevealButton
          visible={proxyVisible}
          pending={revealPending}
          disabled={managedByProfile}
          onToggle={onToggleProxyVisible}
        />
      </div>
    </EgressField>
  );
}

function EgressProxyPoolToggle({
  editing,
  form,
  onFormChange,
}: {
  editing: EgressNodeDTO | null | undefined;
  form: EgressNodeInput;
  onFormChange: (changes: Partial<EgressNodeInput>) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-start justify-between gap-4 rounded-md bg-muted/45 px-3 py-2.5">
      <div className="space-y-1">
        <Label htmlFor="egress-proxy-pool">{t("settings.egress.proxyPool")}</Label>
        <p className="max-w-[390px] text-xs leading-5 text-muted-foreground">{t("settings.egress.proxyPoolHelp")}</p>
      </div>
      <Switch
        id="egress-proxy-pool"
        className="mt-0.5"
        checked={form.proxyPool}
        disabled={!editing?.proxyConfigured && !form.proxyURL?.trim() && !form.proxyProfileId}
        onCheckedChange={(proxyPool) => onFormChange({ proxyPool })}
        data-testid="egress-node-proxy-pool"
      />
    </div>
  );
}

function EgressNodeCredentialFields({
  editing,
  form,
  clearanceMode,
  onFormChange,
}: {
  editing: EgressNodeDTO | null | undefined;
  form: EgressNodeInput;
  clearanceMode: ClearanceMode;
  onFormChange: (changes: Partial<EgressNodeInput>) => void;
}) {
  const { t } = useTranslation();
  const showUserAgent =
    form.scope !== "grok_build" && (clearanceMode === "manual" || form.scope === "grok_console_asset");
  const showCookies = form.scope !== "grok_build" && form.scope !== "grok_console_asset" && clearanceMode === "manual";
  return (
    <>
      {showUserAgent ? (
        <EgressField label={t("settings.egress.userAgent")} controlId="egress-user-agent">
          <Input
            id="egress-user-agent"
            value={form.userAgent}
            onChange={(event) => onFormChange({ userAgent: event.target.value })}
            data-testid="egress-node-user-agent"
          />
        </EgressField>
      ) : null}
      {showCookies ? (
        <EgressField label={t("settings.egress.cloudflareCookie")} controlId="egress-cookie">
          <Input
            id="egress-cookie"
            type="password"
            autoComplete="new-password"
            placeholder={
              editing?.cookieConfigured ? t("settings.egress.keepConfigured") : "cf_clearance=...; __cf_bm=..."
            }
            value={form.cloudflareCookies}
            onChange={(event) => onFormChange({ cloudflareCookies: event.target.value })}
            data-testid="egress-node-cookie"
          />
        </EgressField>
      ) : null}
    </>
  );
}

type EgressImportDialogProps = {
  open: boolean;
  form: EgressImportForm;
  pending: boolean;
  scopeLabel: (scope: EgressScope) => string;
  onFormChange: (changes: Partial<EgressImportForm>) => void;
  onClose: () => void;
  onSubmit: () => void;
};

/** 代理文本批量导入弹窗。 */
export function EgressImportDialog(props: EgressImportDialogProps) {
  const { t } = useTranslation();
  const { form, pending, onClose, onSubmit } = props;
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-[620px]"
        data-testid="egress-import-dialog"
      >
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
          <EgressImportFields form={form} scopeLabel={props.scopeLabel} onFormChange={props.onFormChange} />
          <EgressImportDialogFooter form={form} pending={pending} onClose={onClose} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EgressImportFields({
  form,
  scopeLabel,
  onFormChange,
}: {
  form: EgressImportForm;
  scopeLabel: (scope: EgressScope) => string;
  onFormChange: (changes: Partial<EgressImportForm>) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <EgressField label={t("settings.egress.name")} controlId="egress-import-name">
          <Input
            id="egress-import-name"
            value={form.name}
            onChange={(event) => onFormChange({ name: event.target.value })}
            data-testid="egress-import-name"
          />
        </EgressField>
        <EgressField label={t("settings.egress.scope")} controlId="egress-import-scope">
          <EgressScopeSelect
            id="egress-import-scope"
            value={form.scope}
            scopeLabel={scopeLabel}
            onChange={(scope) => onFormChange({ scope })}
          />
        </EgressField>
      </div>
      <EgressField label={t("settings.egress.capacity")} controlId="egress-import-capacity">
        <Input
          id="egress-import-capacity"
          type="number"
          min={0}
          max={100000}
          placeholder={t("settings.egress.unlimited")}
          value={form.accountCapacity || ""}
          onChange={(event) => onFormChange({ accountCapacity: Number(event.target.value) })}
          data-testid="egress-import-capacity"
        />
      </EgressField>
      <EgressImportContentField value={form.content} onChange={(content) => onFormChange({ content })} />
    </>
  );
}

function EgressField({
  label,
  controlId,
  description,
  help,
  children,
}: {
  label: string;
  controlId: string;
  description?: string;
  help?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <Label htmlFor={controlId}>{label}</Label>
        {help ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="text-muted-foreground transition-colors hover:text-foreground"
                aria-label={help}
              >
                <CircleHelp className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-80 whitespace-pre-line">{help}</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
      {children}
      {description ? (
        <p className="whitespace-pre-line text-xs leading-5 text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}

function EgressProxyRevealButton({
  visible,
  pending,
  disabled,
  onToggle,
}: {
  visible: boolean;
  pending: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className="shrink-0"
      disabled={pending || disabled}
      aria-label={t(visible ? "egressProxyProfiles.hide" : "egressProxyProfiles.reveal")}
      onClick={onToggle}
      data-testid="egress-node-reveal-proxy"
    >
      {pending ? <Spinner /> : visible ? <EyeOff /> : <Eye />}
    </Button>
  );
}

function EgressImportDialogFooter({
  form,
  pending,
  onClose,
}: {
  form: EgressImportForm;
  pending: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <DialogFooter>
      <Button type="button" size="sm" variant="secondary" onClick={onClose} data-testid="egress-import-dialog-cancel">
        {t("common.cancel")}
      </Button>
      <Button
        type="submit"
        size="sm"
        disabled={!form.name.trim() || !form.content.trim() || pending}
        data-testid="egress-import-dialog-submit"
      >
        {pending ? <Spinner /> : null}
        {t("settings.egress.importText")}
      </Button>
    </DialogFooter>
  );
}

function EgressImportContentField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { t } = useTranslation();
  return (
    <EgressField label={t("settings.egress.proxyList")} controlId="egress-import-list">
      <Textarea
        className="min-h-52 font-mono text-xs"
        id="egress-import-list"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        data-testid="egress-import-content"
      />
    </EgressField>
  );
}

function egressProxyURLPlaceholder(t: TFunction, editing: EgressNodeDTO | null | undefined, managedByProfile: boolean) {
  if (managedByProfile) return t("egressProxyProfiles.managedByProfile");
  if (editing?.proxyConfigured) return t("settings.egress.keepConfigured");
  return "socks5h://user:pass@host:port";
}

function EgressNodeDialogHeader({ editing }: { editing: EgressNodeDTO | null | undefined }) {
  const { t } = useTranslation();
  return (
    <DialogHeader className="pr-8">
      <DialogTitle>{editing ? t("settings.egress.editTitle") : t("settings.egress.addTitle")}</DialogTitle>
      <DialogDescription>{t("console.egressDialogDescription")}</DialogDescription>
    </DialogHeader>
  );
}

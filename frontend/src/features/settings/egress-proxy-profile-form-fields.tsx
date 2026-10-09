import { Eye, EyeOff } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import type { EgressProxyProfileDTO } from "@/features/settings/settings-api";

export type EgressProxyProfileFormValues = { name: string; proxyURL: string };

export type EgressProxyProfileFieldsProps = {
  editing: EgressProxyProfileDTO | null;
  form: EgressProxyProfileFormValues;
  proxyVisible: boolean;
  revealPending: boolean;
  onFormChange: (changes: Partial<EgressProxyProfileFormValues>) => void;
  onToggleProxyVisible: () => void;
};

/** 代理配置表单字段：名称与代理地址（地址支持按需显示明文）。 */
export function EgressProxyProfileFields(props: EgressProxyProfileFieldsProps) {
  const { t } = useTranslation();
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="proxy-profile-name">{t("egressProxyProfiles.name")}</Label>
        <Input
          id="proxy-profile-name"
          autoComplete="off"
          data-1p-ignore
          data-lpignore="true"
          data-form-type="other"
          value={props.form.name}
          onChange={(event) => props.onFormChange({ name: event.target.value })}
          data-testid="egress-proxy-profile-name"
        />
      </div>
      <EgressProxyProfileURLField {...props} />
    </>
  );
}

function EgressProxyProfileURLField({
  editing,
  form,
  proxyVisible,
  revealPending,
  onFormChange,
  onToggleProxyVisible,
}: EgressProxyProfileFieldsProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <Label htmlFor="proxy-profile-url">{t("settings.egress.proxyURL")}</Label>
      <div className="flex gap-2">
        <Input
          id="proxy-profile-url"
          type={proxyVisible ? "text" : "password"}
          autoComplete="off"
          data-1p-ignore
          data-lpignore="true"
          data-form-type="other"
          placeholder={editing ? t("settings.egress.keepConfigured") : "socks5h://user:pass@host:port"}
          value={form.proxyURL}
          onChange={(event) => onFormChange({ proxyURL: event.target.value })}
          data-testid="egress-proxy-profile-url"
        />
        {editing ? (
          <EgressProxyProfileRevealButton
            visible={proxyVisible}
            pending={revealPending}
            onToggle={onToggleProxyVisible}
          />
        ) : null}
      </div>
      <p className="whitespace-pre-line text-xs leading-5 text-muted-foreground">
        {t("settings.egress.proxyProtocols")}
      </p>
    </div>
  );
}

function EgressProxyProfileRevealButton({
  visible,
  pending,
  onToggle,
}: {
  visible: boolean;
  pending: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className="shrink-0"
      disabled={pending}
      aria-label={t(visible ? "egressProxyProfiles.hide" : "egressProxyProfiles.reveal")}
      onClick={onToggle}
      data-testid="egress-proxy-profile-reveal"
    >
      {pending ? <Spinner /> : visible ? <EyeOff /> : <Eye />}
    </Button>
  );
}

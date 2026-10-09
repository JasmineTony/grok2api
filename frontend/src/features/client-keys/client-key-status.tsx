import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import type { ClientKeyDTO } from "@/features/client-keys/client-keys-api";

/** 密钥状态徽标：停用优先于过期，避免同一密钥出现两个状态。 */
export function ClientKeyStatus({ value, referenceTime }: { value: ClientKeyDTO; referenceTime: number }) {
  const { t } = useTranslation();
  const testId = `client-keys-status-${value.id}`;
  if (!value.enabled) {
    return (
      <Badge variant="outline" className="text-muted-foreground" data-testid={testId}>
        {t("common.disabled")}
      </Badge>
    );
  }
  if (value.expiresAt && new Date(value.expiresAt).getTime() <= referenceTime) {
    return (
      <Badge variant="secondary" className="bg-amber-500/10 text-amber-700 dark:text-amber-300" data-testid={testId}>
        {t("keys.statusExpired")}
      </Badge>
    );
  }
  return (
    <Badge
      variant="secondary"
      className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      data-testid={testId}
    >
      {t("keys.statusActive")}
    </Badge>
  );
}

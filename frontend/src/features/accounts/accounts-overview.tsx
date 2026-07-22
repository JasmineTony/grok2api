import type { TFunction } from "i18next";

import { AccountsSummary } from "@/features/accounts/accounts-summary";
import { PageHeader } from "@/shared/components/page-header";

type ProviderSummary = { total: number; available: number };

/** Presents the stable page heading and account health summary independently from table state. */
export function AccountsOverview({
  t,
  locale,
  loading,
  unavailable,
  build,
  web,
  console,
  abnormal,
  recovering,
  risk,
  disabled,
  invalid,
}: {
  t: TFunction;
  locale: string;
  loading: boolean;
  unavailable: boolean;
  build: ProviderSummary;
  web: ProviderSummary;
  console: ProviderSummary;
  abnormal: number;
  recovering: number;
  risk: number;
  disabled: number;
  invalid: number;
}) {
  return (
    <>
      <PageHeader
        title={t("accounts.title")}
        description={t("console.accountsDescription")}
      />
      <AccountsSummary
        loading={loading}
        unavailable={unavailable}
        locale={locale}
        labels={{
          build: t("accounts.buildAccountCount"),
          web: t("accounts.webAccountCount"),
          console: t("accounts.consoleAccountCount"),
          abnormal: t("accounts.abnormalAccountCount"),
          cooldown: t("accounts.statusCooldown"),
          risk: t("accounts.riskAccountCount", { count: "" }).trim(),
          disabled: t("accounts.statusDisabled"),
          reauth: t("accounts.statusReauthRequired"),
        }}
        details={{
          build: t("accounts.routableAccountCount", {
            count: build.available.toLocaleString(locale),
          }),
          web: t("accounts.routableAccountCount", {
            count: web.available.toLocaleString(locale),
          }),
          console: t("accounts.routableAccountCount", {
            count: console.available.toLocaleString(locale),
          }),
        }}
        build={build}
        web={web}
        console={console}
        abnormal={abnormal}
        recovering={recovering}
        risk={risk}
        disabled={disabled}
        invalid={invalid}
      />
    </>
  );
}

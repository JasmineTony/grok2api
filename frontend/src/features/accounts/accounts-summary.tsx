import { Compass, SquareTerminal, TriangleAlert, Webhook } from "lucide-react";

import { AccountMetricPanel } from "@/features/accounts/account-presentation";

export type AccountsSummaryLabels = {
  build: string;
  web: string;
  console: string;
  abnormal: string;
  cooldown: string;
  risk: string;
  disabled: string;
  reauth: string;
};

export type AccountsSummaryDetails = {
  build: string;
  web: string;
  console: string;
};

export function AccountsSummary({
  loading,
  unavailable,
  locale,
  labels,
  details,
  build,
  web,
  console,
  abnormal,
  recovering,
  risk,
  disabled,
  invalid,
}: {
  loading: boolean;
  unavailable: boolean;
  locale: string;
  labels: AccountsSummaryLabels;
  details: AccountsSummaryDetails;
  build: { total: number; available: number };
  web: { total: number; available: number };
  console: { total: number; available: number };
  abnormal: number;
  recovering: number;
  risk: number;
  disabled: number;
  invalid: number;
}) {
  const number = (value: number) =>
    new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
  return (
    <section className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      <AccountMetricPanel
        tone="text-quota-product-1"
        icon={<SquareTerminal />}
        loading={loading}
        label={labels.build}
        value={unavailable ? "-" : number(build.total)}
        detail={details.build}
      />
      <AccountMetricPanel
        tone="text-quota-product-2"
        icon={<Compass />}
        loading={loading}
        label={labels.web}
        value={unavailable ? "-" : number(web.total)}
        detail={details.web}
      />
      <AccountMetricPanel
        tone="text-quota-product-4"
        icon={<Webhook />}
        loading={loading}
        label={labels.console}
        value={unavailable ? "-" : number(console.total)}
        detail={details.console}
      />
      <AccountMetricPanel
        tone={abnormal > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}
        icon={<TriangleAlert />}
        loading={loading}
        label={labels.abnormal}
        value={unavailable ? "-" : number(abnormal)}
        detail={[
          `${labels.cooldown} ${number(recovering)}`,
          `${labels.risk} ${number(risk)}`,
          `${labels.disabled} ${number(disabled)}`,
          `${labels.reauth} ${number(invalid)}`,
        ].join(" · ")}
      />
    </section>
  );
}

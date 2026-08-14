import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";

import { EgressNodes } from "@/features/settings/egress-nodes";
import { SettingsSection } from "@/features/settings/settings-layout";
import { useSettingsRoute } from "@/features/settings/settings-route-context";

const EgressOperations = lazy(async () => ({
  default: (await import("@/features/settings/egress-operations")).EgressOperations,
}));

export function NetworkSettingsPage() {
  const { t } = useTranslation();
  const { form } = useSettingsRoute();

  return (
    <div className="space-y-8">
      <SettingsSection title={t("settings.egress.title")}>
        <Suspense fallback={<div className="h-32 animate-pulse rounded-lg bg-muted/30" />}>
          <EgressOperations
            scopeLabel={(scope) =>
              t(
                `settings.egress.scope${
                  scope === "grok_build"
                    ? "Build"
                    : scope === "grok_web"
                      ? "Web"
                      : scope === "grok_console"
                        ? "Console"
                        : scope === "grok_console_asset"
                          ? "ConsoleAsset"
                          : "WebAsset"
                }`,
              )
            }
          />
        </Suspense>
        <EgressNodes clearanceMode={form.watch("providerWeb.clearanceMode")} />
      </SettingsSection>
    </div>
  );
}

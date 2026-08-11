import { Controller } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DurationInput, SettingsField, SettingsSection } from "@/features/settings/settings-layout";
import { useSettingsRoute } from "@/features/settings/settings-route-context";

export function WebSettingsPage() {
  const { t } = useTranslation();
  const { form } = useSettingsRoute();
  const statsigMode = form.watch("providerWeb.statsigMode");
  const statsigManualConfigured = form.watch("providerWeb.statsigManualConfigured");

  return (
    <div className="space-y-8">
      <SettingsSection title={t("settings.web.title")}>
        <div className="space-y-0">
          <SettingsField
            controlId="web-base-url"
            className="sm:col-span-2"
            label={t("settings.web.baseURL")}
            description={t("settings.web.baseURLHelp")}
            error={form.formState.errors.providerWeb?.baseURL?.message}
          >
            <Input id="web-base-url" {...form.register("providerWeb.baseURL")} />
          </SettingsField>
          <SettingsField
            controlId="web-statsig-mode"
            className="sm:col-span-2"
            label={t("settings.web.statsigMode")}
            description={t("settings.web.statsigModeHelp")}
            error={form.formState.errors.providerWeb?.statsigMode?.message}
          >
            <Controller
              control={form.control}
              name="providerWeb.statsigMode"
              render={({ field }) => (
                <Tabs value={field.value} onValueChange={field.onChange}>
                  <TabsList id="web-statsig-mode" className="grid w-full grid-cols-2 bg-muted/55">
                    <TabsTrigger value="manual" className="font-normal">
                      {t("settings.web.statsigManual")}
                    </TabsTrigger>
                    <TabsTrigger value="url" className="font-normal">
                      {t("settings.web.statsigURL")}
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              )}
            />
          </SettingsField>
          {statsigMode === "manual" ? (
            <SettingsField
              controlId="web-statsig-manual"
              className="sm:col-span-2"
              label={t("settings.web.statsigValue")}
              description={t("settings.web.statsigValueHelp")}
              badge={statsigManualConfigured ? t("settings.web.statsigConfigured") : undefined}
              error={form.formState.errors.providerWeb?.statsigManualValue?.message}
            >
              <Input
                id="web-statsig-manual"
                type="password"
                autoComplete="off"
                placeholder={
                  statsigManualConfigured
                    ? t("settings.web.statsigKeepConfigured")
                    : t("settings.web.statsigValuePlaceholder")
                }
                {...form.register("providerWeb.statsigManualValue")}
              />
            </SettingsField>
          ) : (
            <SettingsField
              controlId="web-statsig-url"
              className="sm:col-span-2"
              label={t("settings.web.statsigSignerURL")}
              description={t("settings.web.statsigSignerURLHelp")}
              error={form.formState.errors.providerWeb?.statsigSignerURL?.message}
            >
              <Input
                id="web-statsig-url"
                type="url"
                placeholder="http://grok-signer-go:8788/sign"
                {...form.register("providerWeb.statsigSignerURL")}
              />
            </SettingsField>
          )}
          <SettingsField
            controlId="web-clearance-mode"
            className="sm:col-span-2"
            label={t("settings.web.clearanceMode")}
            description={t("settings.web.clearanceModeHelp")}
            error={form.formState.errors.providerWeb?.clearanceMode?.message}
          >
            <Controller
              control={form.control}
              name="providerWeb.clearanceMode"
              render={({ field }) => (
                <Tabs value={field.value} onValueChange={field.onChange}>
                  <TabsList id="web-clearance-mode" className="grid w-full grid-cols-2 bg-muted/55">
                    <TabsTrigger value="manual" className="font-normal">
                      {t("settings.web.clearanceManual")}
                    </TabsTrigger>
                    <TabsTrigger value="flaresolverr" className="font-normal">
                      {t("settings.web.clearanceFlareSolverr")}
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              )}
            />
          </SettingsField>
          {form.watch("providerWeb.clearanceMode") === "flaresolverr" ? (
            <>
              <SettingsField
                controlId="web-flaresolverr-url"
                className="sm:col-span-2"
                label={t("settings.web.flareSolverrURL")}
                description={t("settings.web.flareSolverrURLHelp")}
                error={form.formState.errors.providerWeb?.flareSolverrURL?.message}
              >
                <Input
                  id="web-flaresolverr-url"
                  type="url"
                  {...form.register("providerWeb.flareSolverrURL")}
                />
              </SettingsField>
              <SettingsField
                controlId="web-clearance-timeout"
                label={t("settings.web.clearanceTimeout")}
                description={t("settings.web.clearanceTimeoutHelp")}
                error={form.formState.errors.providerWeb?.clearanceTimeout?.message}
              >
                <Controller
                  control={form.control}
                  name="providerWeb.clearanceTimeout"
                  render={({ field }) => (
                    <DurationInput
                      id="web-clearance-timeout"
                      value={field.value}
                      onChange={field.onChange}
                    />
                  )}
                />
              </SettingsField>
              <SettingsField
                controlId="web-clearance-refresh"
                label={t("settings.web.clearanceRefresh")}
                description={t("settings.web.clearanceRefreshHelp")}
                error={form.formState.errors.providerWeb?.clearanceRefresh?.message}
              >
                <Controller
                  control={form.control}
                  name="providerWeb.clearanceRefresh"
                  render={({ field }) => (
                    <DurationInput
                      id="web-clearance-refresh"
                      value={field.value}
                      onChange={field.onChange}
                    />
                  )}
                />
              </SettingsField>
            </>
          ) : null}
          <SettingsField
            controlId="web-quota-timeout"
            label={t("settings.web.quotaTimeout")}
            description={t("settings.web.quotaTimeoutHelp")}
            error={form.formState.errors.providerWeb?.quotaTimeout?.message}
          >
            <Controller
              control={form.control}
              name="providerWeb.quotaTimeout"
              render={({ field }) => (
                <DurationInput
                  id="web-quota-timeout"
                  value={field.value}
                  onChange={field.onChange}
                />
              )}
            />
          </SettingsField>
          <SettingsField
            controlId="web-chat-timeout"
            label={t("settings.web.chatTimeout")}
            description={t("settings.web.chatTimeoutHelp")}
            error={form.formState.errors.providerWeb?.chatTimeout?.message}
          >
            <Controller
              control={form.control}
              name="providerWeb.chatTimeout"
              render={({ field }) => (
                <DurationInput
                  id="web-chat-timeout"
                  value={field.value}
                  onChange={field.onChange}
                />
              )}
            />
          </SettingsField>
          <SettingsField
            controlId="web-stream-idle-timeout"
            label={t("settings.web.streamIdleTimeout")}
            description={t("settings.web.streamIdleTimeoutHelp")}
            error={form.formState.errors.providerWeb?.streamIdleTimeout?.message}
          >
            <Controller
              control={form.control}
              name="providerWeb.streamIdleTimeout"
              render={({ field }) => (
                <DurationInput
                  id="web-stream-idle-timeout"
                  value={field.value}
                  onChange={field.onChange}
                />
              )}
            />
          </SettingsField>
          <SettingsField
            controlId="web-recovery-base"
            label={t("settings.web.recoveryBackoffBase")}
            description={t("settings.web.recoveryBackoffBaseHelp")}
            error={form.formState.errors.providerWeb?.recoveryBackoffBase?.message}
          >
            <Controller
              control={form.control}
              name="providerWeb.recoveryBackoffBase"
              render={({ field }) => (
                <DurationInput
                  id="web-recovery-base"
                  value={field.value}
                  onChange={field.onChange}
                />
              )}
            />
          </SettingsField>
          <SettingsField
            controlId="web-recovery-max"
            label={t("settings.web.recoveryBackoffMax")}
            description={t("settings.web.recoveryBackoffMaxHelp")}
            error={form.formState.errors.providerWeb?.recoveryBackoffMax?.message}
          >
            <Controller
              control={form.control}
              name="providerWeb.recoveryBackoffMax"
              render={({ field }) => (
                <DurationInput
                  id="web-recovery-max"
                  value={field.value}
                  onChange={field.onChange}
                />
              )}
            />
          </SettingsField>
        </div>
      </SettingsSection>
    </div>
  );
}

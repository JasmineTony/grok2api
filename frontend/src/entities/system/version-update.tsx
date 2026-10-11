import { ArrowUpRight, Info, RefreshCw } from "lucide-react";
import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { VersionInfoDTO } from "@/entities/system/system-api";
import { useCheckForUpdates, useVersionInfo } from "@/entities/system/use-version-update";
import { cn } from "@/shared/lib/cn";
import { formatDateTime } from "@/shared/lib/format";

export function CurrentVersionLabel() {
  const versionQuery = useVersionInfo();
  const version = versionQuery.data?.currentVersion;
  if (!version) return null;
  return <span className="font-mono text-[10px] font-normal text-muted-foreground">{version}</span>;
}

export function VersionUpdateBanner() {
  const { t } = useTranslation();
  const versionQuery = useVersionInfo();
  const checkMutation = useCheckForUpdates();
  const version = versionQuery.data;
  if (!version?.updateAvailable) return null;

  return (
    <section className="flex flex-col gap-3 rounded-lg bg-amber-500/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-medium">{t("updates.available", { version: version.latestVersion })}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t("updates.currentSummary", { version: version.currentVersion })}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {version.releaseUrl ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2.5 text-xs font-normal text-muted-foreground hover:text-foreground"
            asChild
          >
            <a href={version.releaseUrl} target="_blank" rel="noreferrer">
              {t("updates.viewRelease")}
              <ArrowUpRight className="size-3.5" />
            </a>
          </Button>
        ) : null}
        {version.releaseUrl ? <span className="mx-1 h-3 w-px bg-border/70" /> : null}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2.5 text-xs font-normal text-muted-foreground hover:text-foreground"
          disabled={checkMutation.isPending}
          onClick={() => checkMutation.mutate()}
        >
          {checkMutation.isPending ? <Spinner /> : <RefreshCw className="size-3.5" />}
          {t("updates.checkNow")}
        </Button>
      </div>
    </section>
  );
}

/** 说明区：版本检查是手动动作，不会自动下载或应用更新。 */
function VersionUpdateNotice() {
  const { t } = useTranslation();
  return (
    <div className="flex items-start gap-3 rounded-md bg-amber-500/10 px-4 py-3">
      <Info className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-300" />
      <div className="min-w-0">
        <p className="text-xs font-medium">{t("updates.noteTitle")}</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{t("updates.noteDescription")}</p>
      </div>
    </div>
  );
}

type CurrentVersionFieldProps = {
  version: string | undefined;
  checking: boolean;
  onCheck: () => void;
};

/** 当前版本字段：展示版本号并提供手动检查入口。 */
function CurrentVersionField({ version, checking, onCheck }: CurrentVersionFieldProps) {
  const { t } = useTranslation();
  return (
    <VersionField label={t("updates.currentVersion")} description={t("updates.currentVersionHelp")}>
      <div className="flex min-w-0 items-center gap-2">
        <div className="min-w-0 flex-1">
          <VersionValue>{version || "-"}</VersionValue>
        </div>
        <Button type="button" variant="secondary" size="sm" className="shrink-0" disabled={checking} onClick={onCheck}>
          {checking ? <Spinner /> : <RefreshCw />}
          {t("updates.checkNow")}
        </Button>
      </div>
    </VersionField>
  );
}

/** 只读版本字段：最新版本、状态点与上次检查时间。 */
function VersionDetailFields({ version }: { version: VersionInfoDTO | undefined }) {
  const { t, i18n } = useTranslation();
  return (
    <>
      <VersionField label={t("updates.latestVersion")} description={t("updates.latestVersionHelp")}>
        <VersionValue>{version?.latestVersion || t("updates.notChecked")}</VersionValue>
      </VersionField>
      <VersionField label={t("updates.statusLabel")} description={t("updates.statusLabelHelp")}>
        <VersionValue>
          {version?.status ? (
            <span
              className={cn(
                "size-1.5 shrink-0 rounded-full bg-muted-foreground",
                version.status === "up_to_date" && "bg-emerald-500",
                version.status === "update_available" && "bg-amber-500",
                version.status === "check_failed" && "bg-destructive",
              )}
            />
          ) : null}
          <span>{version ? t(`updates.status.${version.status}`) : t("common.loading")}</span>
        </VersionValue>
      </VersionField>
      <VersionField label={t("updates.checkedAt")} description={t("updates.checkedAtHelp")}>
        <VersionValue>
          {version?.checkedAt ? formatDateTime(version.checkedAt, i18n.language) : t("updates.neverChecked")}
        </VersionValue>
      </VersionField>
    </>
  );
}

/** 发布说明区：既无说明也无链接时整段不渲染。 */
function ReleaseNotesSection({ version }: { version: VersionInfoDTO | undefined }) {
  const { t } = useTranslation();
  if (!version || (!version.releaseNotes && !version.releaseUrl)) return null;

  return (
    <section className="space-y-3">
      <div className="flex min-h-8 items-center justify-between gap-3 px-1">
        <div>
          <h3 className="text-sm font-medium tracking-tight">{t("updates.releaseNotes")}</h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{t("updates.releaseNotesHelp")}</p>
        </div>
        {version.releaseUrl ? (
          <Button type="button" variant="secondary" size="sm" asChild>
            <a href={version.releaseUrl} target="_blank" rel="noreferrer">
              {t("updates.openRelease")}
              <ArrowUpRight />
            </a>
          </Button>
        ) : null}
      </div>
      <div className="min-w-0 rounded-md bg-secondary/35 px-4 py-3">
        <p className="whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">
          {version.releaseNotes || t("updates.noReleaseNotes")}
        </p>
      </div>
    </section>
  );
}

export function VersionUpdateSection() {
  const { t } = useTranslation();
  const versionQuery = useVersionInfo();
  const checkMutation = useCheckForUpdates();
  const version = versionQuery.data;
  const requestError = versionQuery.error instanceof Error ? versionQuery.error.message : "";
  const checkError = checkMutation.error instanceof Error ? checkMutation.error.message : "";
  const error = version?.error || checkError || requestError;
  const checking = versionQuery.isPending || checkMutation.isPending;

  return (
    <div className="w-full space-y-8">
      <section className="space-y-3">
        <div className="flex min-h-8 items-center px-1">
          <h2 className="text-sm font-medium tracking-tight">{t("updates.title")}</h2>
        </div>
        <VersionUpdateNotice />
        <div className="space-y-0">
          <CurrentVersionField
            version={version?.currentVersion}
            checking={checking}
            onCheck={() => checkMutation.mutate()}
          />
          <VersionDetailFields version={version} />
        </div>
        {error ? <p className="text-xs leading-5 text-destructive">{error}</p> : null}
      </section>

      <ReleaseNotesSection version={version} />
    </div>
  );
}

function VersionField({ label, description, children }: { label: string; description: string; children: ReactNode }) {
  return (
    <div className="min-w-0 py-4">
      <div className="grid min-w-0 gap-2.5 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] sm:items-center sm:gap-8">
        <div className="min-w-0">
          <p className="text-xs font-medium">{label}</p>
          <p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">{description}</p>
        </div>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}

function VersionValue({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-8 min-w-0 items-center gap-2 rounded-md bg-secondary/55 px-3 py-1 text-xs font-medium">
      {children}
    </div>
  );
}

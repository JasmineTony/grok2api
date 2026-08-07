import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Info, RefreshCw } from "lucide-react";
import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { checkForUpdates, getVersionInfo } from "@/entities/system/system-api";
import { useApiClient } from "@/shared/api/use-api-client";
import { cn } from "@/shared/lib/cn";
import { formatDateTime } from "@/shared/lib/format";
import { SafeMarkdown } from "@/shared/security/safe-markdown";

const versionQueryKey = ["system-version"] as const;

function useVersionInfo() {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: versionQueryKey,
    queryFn: () => getVersionInfo(apiClient),
    staleTime: 60_000,
    retry: 1,
  });
}

function useCheckForUpdates() {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => checkForUpdates(apiClient),
    onSuccess: (value) => queryClient.setQueryData(versionQueryKey, value),
  });
}

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
        <p className="text-sm font-medium">
          {t("updates.available", { version: version.latestVersion })}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t("updates.currentSummary", { version: version.currentVersion })}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {version.releaseUrl ? (
          <Button variant="ghost" size="sm" className="h-7 px-2.5 text-xs" asChild>
            <a href={version.releaseUrl} target="_blank" rel="noreferrer">
              {t("updates.viewRelease")}
              <ArrowUpRight className="size-3.5" />
            </a>
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2.5 text-xs"
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

export function VersionAboutSection() {
  const { t } = useTranslation();
  const versionQuery = useVersionInfo();
  const version = versionQuery.data;
  const error = getVersionError(version, versionQuery.error, null);

  return (
    <section className="w-full space-y-8">
      <div className="min-w-0 px-1">
        <h3 className="text-sm font-medium tracking-tight">{t("settings.navigation.about")}</h3>
        <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
          {t("updates.noteDescription")}
        </p>
      </div>

      <div className="space-y-0">
        <VersionField
          label={t("updates.currentVersion")}
          description={t("updates.currentVersionHelp")}
        >
          <VersionValue>{version?.currentVersion || "-"}</VersionValue>
        </VersionField>
        <VersionField label={t("updates.repository")} description={t("updates.repositoryHelp")}>
          <VersionValue>{version?.repository || "JasmineTony/grok2api"}</VersionValue>
        </VersionField>
        <VersionField
          label={t("updates.upstreamVersion")}
          description={t("updates.upstreamVersionHelp", {
            repository: version?.upstreamRepository || "chenyme/grok2api",
          })}
        >
          <VersionValue>
            <span className="min-w-0 flex-1 truncate">
              {version?.upstreamLatestVersion || t("updates.notChecked")}
            </span>
            {version?.upstreamReleaseUrl ? (
              <a
                className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                href={version.upstreamReleaseUrl}
                target="_blank"
                rel="noreferrer"
                aria-label={t("updates.openRelease")}
              >
                <ArrowUpRight className="size-3.5" />
              </a>
            ) : null}
          </VersionValue>
        </VersionField>
      </div>
      {error ? <InlineVersionError message={error} /> : null}
    </section>
  );
}

export function VersionChangelogSection() {
  const { t, i18n } = useTranslation();
  const versionQuery = useVersionInfo();
  const checkMutation = useCheckForUpdates();
  const version = versionQuery.data;
  const error = getVersionError(version, versionQuery.error, checkMutation.error);

  return (
    <section className="w-full space-y-8">
      <div className="flex min-h-8 flex-col gap-3 px-1 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-sm font-medium tracking-tight">
            {t("settings.navigation.changelog")}
          </h3>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
            {t("updates.releaseNotesHelp")}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={versionQuery.isPending || checkMutation.isPending}
            onClick={() => checkMutation.mutate()}
          >
            {versionQuery.isPending || checkMutation.isPending ? <Spinner /> : <RefreshCw />}
            {t("updates.checkNow")}
          </Button>
          {version?.releaseUrl ? (
            <Button type="button" variant="secondary" size="sm" asChild>
              <a href={version.releaseUrl} target="_blank" rel="noreferrer">
                {t("updates.openRelease")}
                <ArrowUpRight />
              </a>
            </Button>
          ) : null}
        </div>
      </div>

      <div className="space-y-0">
        <VersionField
          label={t("updates.latestVersion")}
          description={t("updates.latestVersionHelp")}
        >
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
            {version?.checkedAt
              ? formatDateTime(version.checkedAt, i18n.language)
              : t("updates.neverChecked")}
          </VersionValue>
        </VersionField>
      </div>

      <div className="min-w-0 rounded-xl border border-border/60 bg-secondary/30 px-4 py-4">
        {versionQuery.isPending ? (
          <div className="flex min-h-8 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Spinner />
            {t("common.loading")}
          </div>
        ) : (
          <SafeMarkdown content={version?.releaseNotes || t("updates.noReleaseNotes")} />
        )}
      </div>
      {error ? <InlineVersionError message={error} /> : null}
    </section>
  );
}

function getVersionError(
  version: ReturnType<typeof useVersionInfo>["data"],
  queryError: unknown,
  mutationError: unknown,
): string {
  const requestError = queryError instanceof Error ? queryError.message : "";
  const checkError = mutationError instanceof Error ? mutationError.message : "";
  return version?.error || version?.upstreamError || checkError || requestError;
}

function InlineVersionError({ message }: { message: string }) {
  return (
    <div className="mt-3 flex items-start gap-2 rounded-md bg-destructive/8 px-3 py-2 text-xs leading-5 text-destructive">
      <Info className="mt-0.5 size-3.5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

function VersionField({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: ReactNode;
}) {
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

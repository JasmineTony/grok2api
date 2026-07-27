import { AlertTriangle, ArrowLeft, RotateCcw, Save } from "lucide-react";
import { useEffect } from "react";
import { FormProvider } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Link, NavLink, Outlet, useBlocker, useLocation } from "react-router-dom";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SettingsRouteContext } from "@/features/settings/settings-route-context";
import {
  isReadOnlySettingsPath,
  settingsRoutes,
  shouldBlockSettingsNavigation,
} from "@/features/settings/settings-route-navigation";
import { useSettings } from "@/features/settings/use-settings";
import { ErrorState } from "@/shared/components/data-state";
import { cn } from "@/shared/lib/cn";

export function SettingsRouteShell() {
  const { t } = useTranslation();
  const location = useLocation();
  const { form, settingsQuery, updateMutation, reset } = useSettings();
  const readOnlyRoute = isReadOnlySettingsPath(location.pathname);
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    shouldBlockSettingsNavigation(
      form.formState.isDirty,
      currentLocation.pathname,
      nextLocation.pathname,
    ),
  );

  useEffect(() => {
    if (!form.formState.isDirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [form.formState.isDirty]);

  if (settingsQuery.isError) {
    return (
      <ErrorState
        message={settingsQuery.error.message}
        onRetry={() => void settingsQuery.refetch()}
      />
    );
  }

  const snapshot = settingsQuery.data;
  const loading = settingsQuery.isPending;
  const recommendedBuild = snapshot?.recommendedProviderBuild;
  const syncRecommendedBuild = () => {
    if (!recommendedBuild) return;
    form.setValue("providerBuild.clientVersion", recommendedBuild.clientVersion, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });
    form.setValue("providerBuild.userAgent", recommendedBuild.userAgent, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });
  };

  return (
    <FormProvider {...form}>
      <form
        className="w-full space-y-5"
        onSubmit={form.handleSubmit((values) => updateMutation.mutate(values))}
      >
        <header className="flex min-h-8 items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-medium">{t("settings.title")}</h1>
            <p className="sr-only">{t("settings.description")}</p>
          </div>
          {!readOnlyRoute ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    aria-label={t("common.reset")}
                    disabled={loading || updateMutation.isPending || !form.formState.isDirty}
                    onClick={reset}
                  >
                    <RotateCcw />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("common.reset")}</TooltipContent>
              </Tooltip>
              <Button
                type="submit"
                size="sm"
                disabled={loading || updateMutation.isPending || !form.formState.isDirty}
              >
                {updateMutation.isPending ? <Spinner /> : <Save />}
                {t("common.save")}
              </Button>
            </div>
          ) : null}
        </header>

        <nav aria-label={t("settings.navigation.label")} className="overflow-x-auto border-b">
          <div className="flex w-max gap-1 pb-2">
            {settingsRoutes.map((route) => (
              <NavLink
                key={route.to}
                to={route.to}
                end={route.end}
                onMouseEnter={() => void route.preload()}
                onFocus={() => void route.preload()}
                className={({ isActive }) =>
                  cn(
                    "rounded-md px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground",
                    isActive && "bg-muted text-foreground",
                  )
                }
              >
                {t(`settings.navigation.${route.key}`)}
              </NavLink>
            ))}
          </div>
        </nav>

        {readOnlyRoute && form.formState.isDirty ? (
          <div
            role="status"
            className="flex flex-col gap-3 rounded-lg bg-amber-500/10 px-4 py-3 text-xs sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex min-w-0 items-start gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-300" />
              <div>
                <p className="font-medium text-foreground">{t("settings.readOnlyDirty.title")}</p>
                <p className="mt-1 leading-5 text-muted-foreground">
                  {t("settings.readOnlyDirty.description")}
                </p>
              </div>
            </div>
            <Button type="button" variant="secondary" size="sm" className="shrink-0" asChild>
              <Link to="/settings">
                <ArrowLeft />
                {t("settings.readOnlyDirty.back")}
              </Link>
            </Button>
          </div>
        ) : null}

        {loading ? <SettingsRouteSkeleton /> : null}
        {snapshot ? (
          <SettingsRouteContext.Provider
            value={{
              form,
              snapshot,
              loading,
              updatePending: updateMutation.isPending,
              syncRecommendedBuild,
            }}
          >
            <div className="min-w-0">
              <Outlet />
            </div>
          </SettingsRouteContext.Provider>
        ) : null}
      </form>

      <AlertDialog
        open={blocker.state === "blocked"}
        onOpenChange={(open) => {
          if (!open && blocker.state === "blocked") blocker.reset();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("settings.unsaved.title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("settings.unsaved.description")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => blocker.state === "blocked" && blocker.reset()}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => blocker.state === "blocked" && blocker.proceed()}
            >
              {t("settings.unsaved.discard")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </FormProvider>
  );
}

export function SettingsRouteSkeleton() {
  return (
    <div className="grid gap-4" aria-hidden="true">
      <div className="hidden h-44 animate-pulse rounded-xl bg-muted/30 lg:block" />
      <div className="space-y-3">
        <div className="h-10 animate-pulse rounded-xl bg-muted/45" />
        <div className="h-72 animate-pulse rounded-xl bg-muted/30" />
      </div>
    </div>
  );
}

import { RotateCcw } from "lucide-react";
import { useEffect } from "react";
import { FormProvider } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { NavLink, Outlet, useBlocker } from "react-router-dom";

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
  settingsRoutes,
  shouldBlockSettingsNavigation,
} from "@/features/settings/settings-route-navigation";
import { useSettings } from "@/features/settings/use-settings";
import { ErrorState } from "@/shared/components/data-state";
import { cn } from "@/shared/lib/cn";

export function SettingsRouteShell() {
  const { t } = useTranslation();
  const { form, settingsQuery, updateMutation, reset } = useSettings();
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
              {updateMutation.isPending ? <Spinner /> : null}
              {t("common.save")}
            </Button>
          </div>
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
            <Outlet />
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
      <div className="hidden h-44 animate-pulse rounded-lg bg-muted/30 lg:block" />
      <div className="space-y-3">
        <div className="h-10 animate-pulse rounded-lg bg-muted/45" />
        <div className="h-72 animate-pulse rounded-lg bg-muted/30" />
      </div>
    </div>
  );
}

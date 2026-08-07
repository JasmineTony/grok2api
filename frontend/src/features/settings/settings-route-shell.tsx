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
        className="w-full"
        onSubmit={form.handleSubmit((values) => updateMutation.mutate(values))}
      >
        <div className="grid min-w-0 gap-8 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-12">
          <aside className="min-w-0 lg:sticky lg:top-12 lg:self-start">
            <div className="px-2 lg:px-3">
              <h1 className="text-xl font-medium tracking-tight">{t("settings.title")}</h1>
              <p className="sr-only">{t("settings.description")}</p>
            </div>

            <nav
              aria-label={t("settings.navigation.label")}
              className="-mx-1 mt-5 flex gap-1 overflow-x-auto px-1 pb-2 lg:mx-0 lg:mt-6 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0"
            >
              {settingsRoutes.map((route, index) => {
                const previousRoute = settingsRoutes[index - 1];
                const startsGroup = index > 0 && previousRoute?.group !== route.group;
                const Icon = route.icon;

                return (
                  <div
                    key={route.to}
                    className={cn(
                      "shrink-0 lg:w-full",
                      startsGroup &&
                        "ml-2 border-l pl-3 lg:ml-0 lg:mt-3 lg:border-l-0 lg:border-t lg:pl-0 lg:pt-3",
                    )}
                  >
                    <NavLink
                      to={route.to}
                      end={route.end}
                      onMouseEnter={() => void route.preload()}
                      onFocus={() => void route.preload()}
                      className={({ isActive }) =>
                        cn(
                          "flex h-10 min-w-40 items-center gap-2.5 rounded-xl px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground lg:w-full lg:min-w-0",
                          isActive && "bg-muted text-foreground",
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <Icon
                            className={cn(
                              "size-4 shrink-0 text-muted-foreground",
                              isActive && "text-primary",
                            )}
                            strokeWidth={1.8}
                          />
                          <span className="truncate">{t(`settings.navigation.${route.key}`)}</span>
                        </>
                      )}
                    </NavLink>
                  </div>
                );
              })}
            </nav>
          </aside>

          <div className="min-w-0">
            {!readOnlyRoute && form.formState.isDirty ? (
              <div
                data-testid="settings-edit-actions"
                className="sticky top-3 z-30 mb-5 flex justify-end"
              >
                <div className="flex items-center gap-1 rounded-xl border bg-background p-1 shadow-sm">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        aria-label={t("common.reset")}
                        disabled={loading || updateMutation.isPending}
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
                    className="h-8"
                    disabled={loading || updateMutation.isPending}
                  >
                    {updateMutation.isPending ? <Spinner /> : <Save />}
                    {t("common.save")}
                  </Button>
                </div>
              </div>
            ) : null}

            {readOnlyRoute && form.formState.isDirty ? (
              <div
                role="status"
                className="mb-6 flex flex-col gap-3 rounded-xl border border-amber-500/15 bg-amber-500/8 px-4 py-3 text-xs sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 items-start gap-2.5">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-300" />
                  <div>
                    <p className="font-medium text-foreground">
                      {t("settings.readOnlyDirty.title")}
                    </p>
                    <p className="mt-1 leading-5 text-muted-foreground">
                      {t("settings.readOnlyDirty.description")}
                    </p>
                  </div>
                </div>
                <Button type="button" variant="secondary" size="sm" className="shrink-0" asChild>
                  <Link to="/settings/build">
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
                <div className="settings-pane-enter min-w-0">
                  <Outlet />
                </div>
              </SettingsRouteContext.Provider>
            ) : null}
          </div>
        </div>
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
    <div className="space-y-4" aria-hidden="true">
      <div className="h-8 w-40 animate-pulse rounded-lg bg-muted/50" />
      <div className="space-y-3">
        <div className="h-16 animate-pulse rounded-xl bg-muted/35" />
        <div className="h-16 animate-pulse rounded-xl bg-muted/25" />
        <div className="h-16 animate-pulse rounded-xl bg-muted/20" />
      </div>
    </div>
  );
}

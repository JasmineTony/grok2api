import { useTranslation } from "react-i18next";
import { useRouteError } from "react-router-dom";

import { describeRouteError } from "@/app/route-error";
import { Button } from "@/components/ui/button";

export function RouteErrorBoundary() {
  const { t } = useTranslation();
  const error = useRouteError();
  const detail = describeRouteError(error);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-5 py-12">
      <section
        className="w-full max-w-md rounded-xl border bg-card p-6 text-center shadow-sm"
        role="alert"
      >
        <h1 className="text-lg font-medium">{t("errors.generic")}</h1>
        {detail ? <p className="mt-2 break-words text-sm text-muted-foreground">{detail}</p> : null}
        <Button className="mt-5" size="sm" onClick={() => window.location.reload()}>
          {t("common.retry")}
        </Button>
      </section>
    </main>
  );
}

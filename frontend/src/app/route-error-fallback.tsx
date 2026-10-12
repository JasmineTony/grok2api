import { useEffect, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { useRouteError } from "react-router-dom";

import { Button } from "@/components/ui/button";

/**
 * 数据路由（`createBrowserRouter`）的 errorElement。
 *
 * 路由子树在渲染期抛出的错误——包括 `app/deferred-pages.tsx` 里 React.lazy 的页面 chunk
 * 加载 rejection 与 `shared/i18n` 的 deferred 文案 chunk 失败——由 React Router 的
 * RenderErrorBoundary 捕获后渲染这里，把「出错即整棵路由子树消失」变成可恢复的错误界面：
 * 用户能读到本地化说明并一键重新加载，而不是停在 React Router 的默认英文错误页。
 *
 * 文案取自首屏同步资源（`resources/initial.ts` 的 common 领域）：失败时 deferred 文案 chunk
 * 可能恰好没有加载成功，因此这些 key 不能放进 deferred 资源。
 */
export function RouteErrorFallback(): ReactElement {
  const { t } = useTranslation();
  const error = useRouteError();

  // 失败不得静默吞掉：原始错误原样打到控制台，便于定位是哪个 chunk 或页面炸了。
  useEffect(() => {
    console.error("[route-error] 路由渲染失败，已展示可恢复错误界面", error);
  }, [error]);

  return (
    <div
      role="alert"
      aria-labelledby="route-error-title"
      data-testid="route-error-fallback"
      className="flex min-h-screen items-center justify-center bg-background px-6"
    >
      <div className="max-w-sm text-center">
        <h1 id="route-error-title" className="text-lg font-medium">
          {t("common.pageLoadFailedTitle")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("common.pageLoadFailedDescription")}</p>
        <Button size="sm" className="mt-5" onClick={() => window.location.reload()}>
          {t("common.reloadPage")}
        </Button>
      </div>
    </div>
  );
}

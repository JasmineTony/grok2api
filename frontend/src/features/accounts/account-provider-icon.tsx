import { Compass, SquareTerminal, Webhook } from "lucide-react";
import type { ReactNode } from "react";

import type { AccountProvider } from "@/features/accounts/accounts-dto";
import { cn } from "@/shared/lib/cn";

/** 账号池图标：固定映射到静态图标组件，避免在渲染期动态创建组件。 */
export function LinkedTargetIcon({ target }: { target: AccountProvider }): ReactNode {
  const className = cn("size-3.5 shrink-0", linkedTargetIconClass(target));
  if (target === "grok_build") return <SquareTerminal className={className} aria-hidden />;
  if (target === "grok_console") return <Webhook className={className} aria-hidden />;
  return <Compass className={className} aria-hidden />;
}

function linkedTargetIconClass(target: AccountProvider): string {
  if (target === "grok_build") return "text-quota-product-1";
  if (target === "grok_console") return "text-quota-product-4";
  return "text-quota-product-2";
}

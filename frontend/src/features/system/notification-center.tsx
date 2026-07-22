import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Check, CircleCheck } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  acknowledgeNotification,
  listNotifications,
  markNotificationRead,
  type NotificationDTO,
} from "@/entities/notification/notification-api";
import { useApiClient } from "@/shared/api/use-api-client";
import { cn } from "@/shared/lib/cn";
import { formatDateTime } from "@/shared/lib/format";

const queryKey = ["notifications"] as const;
export function NotificationCenter() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const apiClient = useApiClient();
  const query = useQuery({
    queryKey,
    queryFn: () => listNotifications(apiClient),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const update = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "read" | "ack" }) =>
      action === "read"
        ? markNotificationRead(apiClient, id)
        : acknowledgeNotification(apiClient, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });
  const items = query.data?.items ?? [];
  const unread = items.filter((item) => item.status === "unread").length;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative size-7 text-muted-foreground"
          aria-label={t("notifications.title")}
        >
          <Bell className="size-4" />
          {unread > 0 ? (
            <span className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-destructive" />
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[min(360px,calc(100vw-24px))] p-0">
        <DropdownMenuLabel className="px-3 py-2.5 text-xs font-medium">
          {t("notifications.title")}
          <span className="ml-2 text-muted-foreground">
            {t("notifications.unread", { count: unread })}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="max-h-[420px] overflow-y-auto p-1">
          {query.isPending ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              {t("common.loading")}
            </p>
          ) : items.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              {t("notifications.empty")}
            </p>
          ) : (
            items.map((item) => (
              <NotificationItem
                key={item.id}
                item={item}
                locale={i18n.language}
                pending={update.isPending}
                onAction={(action) => update.mutate({ id: item.id, action })}
              />
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
function NotificationItem({
  item,
  locale,
  pending,
  onAction,
}: {
  item: NotificationDTO;
  locale: string;
  pending: boolean;
  onAction: (action: "read" | "ack") => void;
}) {
  const { t } = useTranslation();
  return (
    <div className={cn("rounded-md px-3 py-2.5", item.status === "unread" && "bg-secondary/55")}>
      <div className="flex items-start gap-2">
        <span
          className={cn(
            "mt-1.5 size-1.5 shrink-0 rounded-full bg-sky-500",
            item.severity === "warning" && "bg-amber-500",
            item.severity === "error" && "bg-destructive",
          )}
        />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium">{item.title}</p>
          <p className="mt-1 line-clamp-3 text-xs leading-5 text-muted-foreground">{item.body}</p>
          <p className="mt-1 text-[10px] text-muted-foreground">
            {formatDateTime(item.createdAt, locale)}
          </p>
        </div>
      </div>
      {item.status !== "acknowledged" ? (
        <div className="mt-2 flex justify-end gap-1">
          {item.status === "unread" ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={pending}
              onClick={() => onAction("read")}
            >
              <Check className="size-3.5" />
              {t("notifications.markRead")}
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={pending}
            onClick={() => onAction("ack")}
          >
            <CircleCheck className="size-3.5" />
            {t("notifications.acknowledge")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

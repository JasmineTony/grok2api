import type { DegradeSummaryDTO } from "@/features/quality-guard/quality-guard-api";
import { cn } from "@/shared/lib/cn";

// 降级时间线柱状图：从 degrade-accounts-panel.tsx 拆出，柱高与标签抽稀规则保持不变。

function shortSeriesLabel(label: string) {
  const hour = label.match(/(\d{1,2})(?::\d{2})?$/);
  return hour ? hour[1].padStart(2, "0") : label;
}

export function SeriesChart({
  series,
  empty,
  title,
}: {
  series: DegradeSummaryDTO["series"];
  empty: string;
  title: string;
}) {
  const max = Math.max(1, ...series.map((item) => item.count));
  const labelStep = series.length > 12 ? Math.ceil(series.length / 8) : 1;
  return (
    <section className="flex h-full min-h-64 flex-col overflow-hidden rounded-lg bg-card" data-testid="degrade-series">
      <div className="shrink-0 border-b px-4 py-4 sm:px-5">
        <h2 className="text-sm font-medium">{title}</h2>
      </div>
      <div className="flex min-h-0 flex-1 items-stretch gap-1 px-4 pb-3 pt-2 sm:px-5">
        {series.length === 0 ? (
          <p className="self-center text-xs text-muted-foreground">{empty}</p>
        ) : (
          series.map((item, index) => {
            const height = item.count <= 0 ? 0 : Math.max(6, Math.round((item.count / max) * 100));
            const showLabel = index % labelStep === 0 || index === series.length - 1;
            return (
              <div
                key={`${item.label}-${index}`}
                className="flex min-w-0 flex-1 flex-col"
                title={`${item.label}: ${item.count}`}
              >
                <div className="relative min-h-0 flex-1">
                  <div
                    className={cn(
                      "absolute inset-x-0 bottom-0 rounded-t-sm",
                      item.severe > 0 && item.severe >= item.count * 0.5 ? "bg-destructive" : "bg-amber-500",
                    )}
                    style={{ height: `${height}%` }}
                  />
                </div>
                <div className="mt-1 h-4 text-center text-[10px] tabular-nums text-muted-foreground">
                  {showLabel ? shortSeriesLabel(item.label) : ""}
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

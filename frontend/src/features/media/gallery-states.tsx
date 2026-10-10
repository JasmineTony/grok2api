import { Image as ImageIcon } from "lucide-react";

/** 图库空态：图标 + 文案（搜索无结果与完全空库共用）。 */
export function GalleryEmptyState({ message }: { message: string }) {
  return (
    <div
      className="flex min-h-72 flex-col items-center justify-center gap-3 text-center text-muted-foreground"
      data-testid="gallery-empty"
    >
      <span className="flex size-10 items-center justify-center rounded-full bg-muted/70">
        <ImageIcon className="size-5 stroke-1.5" />
      </span>
      <p className="text-sm">{message}</p>
    </div>
  );
}

/** 首屏加载骨架：10 个卡片占位。 */
export function ImageGridLoading() {
  return (
    <div
      className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5"
      aria-hidden="true"
      data-testid="gallery-loading"
    >
      {Array.from({ length: 10 }, (_, index) => (
        <div key={index} className="min-w-0">
          <div className="aspect-square animate-pulse rounded-lg bg-muted" />
          <div className="space-y-2 px-0.5 pt-2.5">
            <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
            <div className="h-2.5 w-1/2 animate-pulse rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}

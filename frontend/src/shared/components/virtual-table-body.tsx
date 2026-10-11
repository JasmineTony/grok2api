import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";

import { TableBody, TableCell, TableRow } from "@/components/ui/table";

const DEFAULT_OVERSCAN = 12;
const MIN_VIRTUALIZED_ROWS = 20;

type VirtualTableBodyProps<T> = {
  items: readonly T[];
  colSpan: number;
  rowHeight: number;
  renderRow: (item: T, index: number) => ReactNode;
  overscan?: number;
};

type VisibleRange = { start: number; end: number };

// VirtualTableBody keeps the native table structure and an internal table
// viewport while mounting only the visible rows. Fixed-height management tables
// are a good fit and keep large page sizes from creating thousands of Radix
// controls, tooltips, and menu triggers at once.
export function VirtualTableBody<T>({
  items,
  colSpan,
  rowHeight,
  renderRow,
  overscan = DEFAULT_OVERSCAN,
}: VirtualTableBodyProps<T>): ReactElement {
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const frameRef = useRef<number | null>(null);
  const enabled = items.length > MIN_VIRTUALIZED_ROWS;
  const [range, setRange] = useState<VisibleRange>(() => ({
    start: 0,
    end: enabled ? Math.min(items.length, 50) : items.length,
  }));

  const updateRange = useCallback(() => {
    if (!enabled || !bodyRef.current) {
      setRange((current) =>
        current.start === 0 && current.end === items.length ? current : { start: 0, end: items.length },
      );
      return;
    }
    const next = resolveVisibleRange(bodyRef.current, items.length, rowHeight, overscan);
    setRange((current) => (current.start === next.start && current.end === next.end ? current : next));
  }, [enabled, items.length, overscan, rowHeight]);

  useLayoutEffect(() => observeTableViewport(bodyRef.current, frameRef, updateRange), [updateRange]);

  const safeStart = enabled && items.length > 0 ? Math.min(range.start, items.length - 1) : 0;
  const safeEnd = enabled && items.length > 0 ? Math.max(safeStart + 1, Math.min(items.length, range.end)) : 0;
  const visibleItems = enabled ? items.slice(safeStart, safeEnd) : items;
  const topHeight = enabled ? safeStart * rowHeight : 0;
  const bottomHeight = enabled ? Math.max(0, items.length - safeEnd) * rowHeight : 0;

  return (
    <TableBody ref={bodyRef}>
      {topHeight > 0 ? <VirtualSpacer colSpan={colSpan} height={topHeight} /> : null}
      {visibleItems.map((item, index) => renderRow(item, safeStart + index))}
      {bottomHeight > 0 ? <VirtualSpacer colSpan={colSpan} height={bottomHeight} /> : null}
    </TableBody>
  );
}

/** 按表格主体与滚动容器的实际位置换算需要渲染的行区间（含 overscan）。 */
function resolveVisibleRange(body: HTMLElement, itemCount: number, rowHeight: number, overscan: number): VisibleRange {
  const rect = body.getBoundingClientRect();
  const scrollContainer = body.closest<HTMLElement>("[data-slot=table-scroll-container]");
  const containerRect = scrollContainer?.getBoundingClientRect();
  const viewportTop = Math.max(0, containerRect?.top ?? 0);
  const viewportBottom = Math.min(window.innerHeight, containerRect?.bottom ?? window.innerHeight);
  const relativeTop = Math.max(0, viewportTop - rect.top);
  const relativeBottom = Math.min(rect.height, viewportBottom - rect.top);
  const start = Math.max(0, Math.floor(relativeTop / rowHeight) - overscan);
  const end = Math.min(itemCount, Math.ceil(Math.max(relativeTop, relativeBottom) / rowHeight) + overscan);
  return { start, end };
}

/**
 * Subscribes to window/container scroll and resize, collapsing a burst of events
 * into at most one animation frame. The returned cleanup removes every listener,
 * disconnects the observer and cancels the pending frame.
 */
function observeTableViewport(
  body: HTMLElement | null,
  frameRef: RefObject<number | null>,
  updateRange: () => void,
): () => void {
  const scrollContainer = body?.closest<HTMLElement>("[data-slot=table-scroll-container]") ?? null;
  const scheduleUpdate = () => {
    if (frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      updateRange();
    });
  };
  scheduleUpdate();
  window.addEventListener("scroll", scheduleUpdate, { passive: true });
  window.addEventListener("resize", scheduleUpdate);
  scrollContainer?.addEventListener("scroll", scheduleUpdate, { passive: true });
  let observer: ResizeObserver | null = null;
  if (typeof ResizeObserver !== "undefined" && scrollContainer !== null) {
    observer = new ResizeObserver(scheduleUpdate);
    observer.observe(scrollContainer);
  }
  return () => {
    window.removeEventListener("scroll", scheduleUpdate);
    window.removeEventListener("resize", scheduleUpdate);
    scrollContainer?.removeEventListener("scroll", scheduleUpdate);
    observer?.disconnect();
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
  };
}

function VirtualSpacer({ colSpan, height }: { colSpan: number; height: number }) {
  return (
    <TableRow aria-hidden="true" className="pointer-events-none border-0 hover:bg-transparent">
      <TableCell colSpan={colSpan} className="p-0" style={{ height }} />
    </TableRow>
  );
}

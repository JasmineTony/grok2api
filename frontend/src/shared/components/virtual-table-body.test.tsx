import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Table, TableCell, TableRow } from "@/components/ui/table";
import { VirtualTableBody } from "@/shared/components/virtual-table-body";

const ROW_HEIGHT = 30;
const COL_SPAN = 2;
// jsdom 的 window.innerHeight 为 768；滚动容器视口固定在 [100, 700]，
// 表格主体高度 6000（200 行 × 30px），使各分支的行区间可精确推算。
const BODY_TOP = 100;
const BODY_HEIGHT = 6_000;
const CONTAINER_TOP = 100;
const CONTAINER_BOTTOM = 700;

type Geometry = { top: number; bottom: number };

function stubRect(element: Element, { top, bottom }: Geometry): void {
  element.getBoundingClientRect = () =>
    ({
      top,
      bottom,
      height: bottom - top,
      left: 0,
      right: 0,
      width: 0,
      x: 0,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect;
}

function makeItems(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `item-${index}`);
}

function renderRow(item: string, index: number) {
  return (
    <TableRow key={item} data-testid={`row-${index}`}>
      <TableCell>{item}</TableCell>
    </TableRow>
  );
}

let frameCallbacks: FrameRequestCallback[] = [];
let frameId = 0;
let requestAnimationFrameSpy: ReturnType<typeof vi.spyOn>;

function flushFrame(): void {
  const callbacks = frameCallbacks;
  frameCallbacks = [];
  act(() => {
    for (const callback of callbacks) callback(0);
  });
}

function renderedIndexes(container: HTMLElement): number[] {
  return [...container.querySelectorAll("tbody tr[data-testid^='row-']")].map((row) =>
    Number(row.getAttribute("data-testid")?.replace("row-", "")),
  );
}

function spacerHeights(container: HTMLElement): string[] {
  return [...container.querySelectorAll("tbody tr[aria-hidden='true'] td")].map(
    (cell) => (cell as HTMLElement).style.height,
  );
}

function renderVirtualTable({
  items,
  overscan,
  withContainer = true,
}: {
  items: string[];
  overscan?: number;
  withContainer?: boolean;
}) {
  const view = render(
    withContainer ? (
      <Table>
        <VirtualTableBody
          items={items}
          colSpan={COL_SPAN}
          rowHeight={ROW_HEIGHT}
          overscan={overscan}
          renderRow={renderRow}
        />
      </Table>
    ) : (
      <table>
        <VirtualTableBody
          items={items}
          colSpan={COL_SPAN}
          rowHeight={ROW_HEIGHT}
          overscan={overscan}
          renderRow={renderRow}
        />
      </table>
    ),
  );

  const scrollContainer = view.container.querySelector<HTMLElement>('[data-slot="table-scroll-container"]');
  const body = view.container.querySelector<HTMLTableSectionElement>("tbody");
  if (!body) throw new Error("tbody 未渲染");
  stubRect(body, { top: BODY_TOP, bottom: BODY_TOP + BODY_HEIGHT });
  if (scrollContainer) stubRect(scrollContainer, { top: CONTAINER_TOP, bottom: CONTAINER_BOTTOM });

  return { ...view, scrollContainer, body };
}

beforeEach(() => {
  frameCallbacks = [];
  frameId = 0;
  requestAnimationFrameSpy = vi
    .spyOn(window, "requestAnimationFrame")
    .mockImplementation((callback: FrameRequestCallback) => {
      frameCallbacks.push(callback);
      frameId += 1;
      return frameId;
    });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("VirtualTableBody 阈值与初值", () => {
  it("行数不超过阈值时不虚拟化，全部行直接渲染且无占位行", () => {
    const view = renderVirtualTable({ items: makeItems(20) });

    expect(renderedIndexes(view.container)).toEqual([...Array(20).keys()]);
    flushFrame();
    expect(renderedIndexes(view.container)).toEqual([...Array(20).keys()]);
    expect(spacerHeights(view.container)).toEqual([]);
  });

  it("行数超过阈值时初始渲染 50 行，帧回调后按视口收缩", () => {
    const view = renderVirtualTable({ items: makeItems(200) });

    expect(renderedIndexes(view.container)).toHaveLength(50);
    flushFrame();

    expect(renderedIndexes(view.container)).toEqual([...Array(32).keys()]);
    // 只渲染 0..31，底部占位补齐剩余 168 行。
    expect(spacerHeights(view.container)).toEqual(["5040px"]);
  });

  it("自定义 overscan 为 0 时只渲染视口内的行", () => {
    const view = renderVirtualTable({ items: makeItems(200), overscan: 0 });

    flushFrame();

    expect(renderedIndexes(view.container)).toEqual([...Array(20).keys()]);
    expect(spacerHeights(view.container)).toEqual(["5400px"]);
  });
});

describe("VirtualTableBody 视口更新", () => {
  it("窗口滚动后按新位置更新可见区间与上下占位高度", () => {
    const view = renderVirtualTable({ items: makeItems(200) });
    flushFrame();

    // 模拟向下滚动 900px：表格主体相对视口上移。
    stubRect(view.body, { top: BODY_TOP - 900, bottom: BODY_TOP - 900 + BODY_HEIGHT });
    window.dispatchEvent(new Event("scroll"));
    flushFrame();

    expect(renderedIndexes(view.container)).toEqual(Array.from({ length: 44 }, (_, index) => index + 18));
    expect(spacerHeights(view.container)).toEqual(["540px", "4140px"]);
  });

  it("容器滚动与 resize 同样触发更新，且同一帧内只调度一次", () => {
    const view = renderVirtualTable({ items: makeItems(200) });
    flushFrame();
    expect(requestAnimationFrameSpy).toHaveBeenCalledTimes(1);

    stubRect(view.body, { top: BODY_TOP - 900, bottom: BODY_TOP - 900 + BODY_HEIGHT });
    view.scrollContainer?.dispatchEvent(new Event("scroll"));
    window.dispatchEvent(new Event("resize"));
    window.dispatchEvent(new Event("scroll"));

    // 三个事件在同一帧内合并为一次 requestAnimationFrame。
    expect(requestAnimationFrameSpy).toHaveBeenCalledTimes(2);
    flushFrame();
    expect(renderedIndexes(view.container)).toEqual(Array.from({ length: 44 }, (_, index) => index + 18));
  });

  it("没有滚动容器时以窗口视口为基准计算区间", () => {
    const view = renderVirtualTable({ items: makeItems(200), withContainer: false });

    flushFrame();

    expect(view.scrollContainer).toBeNull();
    expect(renderedIndexes(document.body)).toEqual([...Array(35).keys()]);
    expect(spacerHeights(document.body)).toEqual(["4950px"]);
  });
});

describe("VirtualTableBody 生命周期", () => {
  it("挂载时观察滚动容器，卸载时断开 ResizeObserver、取消待执行帧并移除监听", () => {
    const observer = { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
    const resizeObserverSpy = vi.fn(function ResizeObserverMock() {
      return observer;
    });
    vi.stubGlobal("ResizeObserver", resizeObserverSpy);

    const view = renderVirtualTable({ items: makeItems(200) });
    flushFrame();

    expect(resizeObserverSpy).toHaveBeenCalledTimes(1);
    expect(observer.observe).toHaveBeenCalledWith(view.scrollContainer);
    const framesBeforeUnmount = requestAnimationFrameSpy.mock.calls.length;

    // 卸载前先排队一帧，验证卸载时会被取消。
    window.dispatchEvent(new Event("scroll"));
    view.unmount();

    expect(observer.disconnect).toHaveBeenCalledTimes(1);
    expect(requestAnimationFrameSpy).toHaveBeenCalledTimes(framesBeforeUnmount + 1);
    expect(window.cancelAnimationFrame).toHaveBeenCalledWith(frameId);

    window.dispatchEvent(new Event("scroll"));
    expect(requestAnimationFrameSpy).toHaveBeenCalledTimes(framesBeforeUnmount + 1);
  });

  it("items 收缩到阈值以下时取消虚拟化并渲染全部行", () => {
    const view = renderVirtualTable({ items: makeItems(30) });
    flushFrame();
    expect(renderedIndexes(view.container)).toEqual([...Array(30).keys()]);

    view.rerender(
      <Table>
        <VirtualTableBody items={makeItems(15)} colSpan={COL_SPAN} rowHeight={ROW_HEIGHT} renderRow={renderRow} />
      </Table>,
    );
    flushFrame();

    expect(renderedIndexes(view.container)).toEqual([...Array(15).keys()]);
    expect(spacerHeights(view.container)).toEqual([]);
  });
});

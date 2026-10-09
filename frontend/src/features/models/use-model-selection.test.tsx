import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { modelRoute } from "@/features/models/models-test-support";
import { useModelSelection } from "@/features/models/use-model-selection";

// 选择状态契约：整页勾选、按分组勾选、清空，均以选中 id 集合为断言对象。

const routes = [modelRoute(), modelRoute({ id: "route-2" })];
describe("useModelSelection", () => {
  it("初始状态为空集合", () => {
    const { result } = renderHook(() => useModelSelection());

    expect(result.current.selected.size).toBe(0);
  });

  it("togglePage 勾选与取消本页 id", () => {
    const { result } = renderHook(() => useModelSelection());

    act(() => result.current.togglePage(["route-1", "route-2"], true));
    expect([...result.current.selected]).toEqual(["route-1", "route-2"]);

    act(() => result.current.togglePage(["route-1"], false));
    expect([...result.current.selected]).toEqual(["route-2"]);
  });

  it("toggleGroup 按分组路由勾选与取消", () => {
    const { result } = renderHook(() => useModelSelection());

    act(() => result.current.toggleGroup(routes, true));
    expect([...result.current.selected]).toEqual(["route-1", "route-2"]);

    act(() => result.current.toggleGroup(routes, false));
    expect(result.current.selected.size).toBe(0);
  });

  it("clear 清空已有选择", () => {
    const { result } = renderHook(() => useModelSelection());

    act(() => result.current.togglePage(["route-1"], true));
    expect(result.current.selected.size).toBe(1);

    act(() => result.current.clear());
    expect(result.current.selected.size).toBe(0);
  });
});

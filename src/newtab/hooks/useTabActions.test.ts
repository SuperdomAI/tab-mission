import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTabActions, persistSession } from "./useTabActions";
import { useTabStore } from "../../store/tabStore";
import { makeTab } from "../../test/factory";

function chromeMock() {
  return (globalThis as unknown as { chrome: typeof chrome }).chrome;
}

beforeEach(() => {
  useTabStore.setState({ tabs: [] });
});

describe("useTabActions.closeMany", () => {
  it("removes optimistically AND batches into a single chrome.tabs.remove call", async () => {
    useTabStore.setState({
      tabs: [makeTab({ id: 1 }), makeTab({ id: 2 }), makeTab({ id: 3 })],
    });
    const { result } = renderHook(() => useTabActions());
    await act(async () => {
      await result.current.closeMany([1, 2]);
    });
    const c = chromeMock();
    expect(c.tabs.remove).toHaveBeenCalledTimes(1); // batched, not a loop
    expect(c.tabs.remove).toHaveBeenCalledWith([1, 2]);
    // optimistic: store updated immediately
    expect(useTabStore.getState().tabs.map((t) => t.id)).toEqual([3]);
  });

  it("no-ops on empty input", async () => {
    const { result } = renderHook(() => useTabActions());
    await act(async () => {
      await result.current.closeMany([]);
    });
    expect(chromeMock().tabs.remove).not.toHaveBeenCalled();
  });
});

describe("useTabActions.saveAndClose — critical ordering + pinned safety", () => {
  it("persists the session BEFORE closing, and never closes pinned tabs", async () => {
    const tabs = [
      makeTab({ id: 1, isPinned: false }),
      makeTab({ id: 2, isPinned: true }), // must NOT be closed
      makeTab({ id: 3, isPinned: false }),
    ];
    useTabStore.setState({ tabs });
    const { result } = renderHook(() => useTabActions());
    await act(async () => {
      await result.current.saveAndClose("Forgotten", tabs);
    });
    const c = chromeMock();
    // session write happened before the tab removal
    const setOrder = (c.storage.local.set as any).mock.invocationCallOrder[0];
    const removeOrder = (c.tabs.remove as any).mock.invocationCallOrder[0];
    expect(setOrder).toBeLessThan(removeOrder);
    // pinned tab #2 excluded
    expect(c.tabs.remove).toHaveBeenCalledWith([1, 3]);
  });
});

describe("useTabActions.hibernateMany — honest count, skips pinned/hibernated", () => {
  it("discards only eligible tabs and returns the success count", async () => {
    const tabs = [
      makeTab({ id: 1 }),
      makeTab({ id: 2, isPinned: true }),
      makeTab({ id: 3, isHibernated: true }),
    ];
    const { result } = renderHook(() => useTabActions());
    let count = 0;
    await act(async () => {
      count = await result.current.hibernateMany(tabs);
    });
    const c = chromeMock();
    expect(c.tabs.discard).toHaveBeenCalledTimes(1); // only #1
    expect(c.tabs.discard).toHaveBeenCalledWith(1);
    expect(count).toBe(1);
  });
});

describe("persistSession", () => {
  it("awaits a storage.local.set with the snapshot (last-50 capped)", async () => {
    await persistSession("My session", [
      { title: "A", url: "https://a.com", favIconUrl: "" },
    ]);
    const c = chromeMock();
    expect(c.storage.local.set).toHaveBeenCalledTimes(1);
    const arg = (c.storage.local.set as any).mock.calls[0][0];
    expect(arg.sessions[0].name).toBe("My session");
    expect(arg.sessions[0].tabs).toHaveLength(1);
  });
});

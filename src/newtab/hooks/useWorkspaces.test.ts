import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useWorkspaces } from "./useWorkspaces";
import { useTabStore } from "../../store/tabStore";
import { makeTab } from "../../test/factory";
import type { Workspace } from "../../types/index";

function chromeMock() {
  return (globalThis as unknown as { chrome: typeof chrome }).chrome;
}

beforeEach(() => {
  useTabStore.setState({ tabs: [], workspaces: [], workspaceUndo: null });
});

describe("useWorkspaces.focus", () => {
  it("persists the workspace BEFORE closing, and never sets aside pinned tabs", async () => {
    const stash = [
      makeTab({ id: 1, title: "AWS", isPinned: false }),
      makeTab({ id: 2, title: "Pinned docs", isPinned: true }),
      makeTab({ id: 3, title: "Jira", isPinned: false }),
    ];
    useTabStore.setState({ tabs: stash });
    const { result } = renderHook(() => useWorkspaces());

    await act(async () => {
      await result.current.focus("japan trip", stash);
    });

    const c = chromeMock();
    // workspace persisted before any tab removal
    const setOrder = (c.storage.local.set as any).mock.invocationCallOrder[0];
    const removeOrder = (c.tabs.remove as any).mock.invocationCallOrder[0];
    expect(setOrder).toBeLessThan(removeOrder);
    // pinned #2 not closed
    expect(c.tabs.remove).toHaveBeenCalledWith([1, 3]);
    // workspace recorded with only the non-pinned tabs
    const ws = useTabStore.getState().workspaces.at(-1)!;
    expect(ws.goal).toBe("japan trip");
    expect(ws.tabs).toHaveLength(2);
    // undo buffer set
    expect(useTabStore.getState().workspaceUndo?.count).toBe(2);
  });
});

describe("useWorkspaces.undoLast", () => {
  it("reopens the stashed tabs and clears the workspace + undo", async () => {
    const ws: Workspace = {
      id: "workspace-1",
      schemaVersion: 1,
      goal: "x",
      createdAt: Date.now(),
      tabs: [
        { title: "A", url: "https://a.com", favIconUrl: "" },
        { title: "B", url: "https://b.com", favIconUrl: "" },
      ],
    };
    useTabStore.setState({
      workspaces: [ws],
      workspaceUndo: { workspaceId: ws.id, createdAt: Date.now(), count: 2 },
    });
    const { result } = renderHook(() => useWorkspaces());

    await act(async () => {
      await result.current.undoLast();
    });

    const c = chromeMock();
    expect(c.tabs.create).toHaveBeenCalledTimes(2); // both reopened
    expect(useTabStore.getState().workspaces).toHaveLength(0);
    expect(useTabStore.getState().workspaceUndo).toBeNull();
  });
});

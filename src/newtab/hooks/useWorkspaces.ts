import { useCallback } from "react";
import { useTabStore } from "../../store/tabStore";
import { useTabActions } from "./useTabActions";
import type { EnrichedTab, Workspace, WorkspaceUndo } from "../../types/index";
import { WORKSPACE_SCHEMA_VERSION } from "../../types/index";

const UNDO_TTL_MS = 24 * 60 * 60_000; // undo valid for 24h or until next stash
const MAX_WORKSPACES = 50;

function snapshot(tabs: EnrichedTab[]) {
  return tabs.map((t) => ({ title: t.title, url: t.url, favIconUrl: t.favIconUrl }));
}

/**
 * Phase 2 Workspaces. `focus` sets aside the given tabs into a named workspace
 * and closes them — but persists the workspace + undo buffer BEFORE any close,
 * so a crash can never lose tabs. Pinned tabs are never set aside. `undoLast`
 * reopens the just-stashed tabs and discards that workspace.
 */
export function useWorkspaces() {
  const workspaces = useTabStore((s) => s.workspaces);
  const undo = useTabStore((s) => s.workspaceUndo);
  const setWorkspaces = useTabStore((s) => s.setWorkspaces);
  const setWorkspaceUndo = useTabStore((s) => s.setWorkspaceUndo);
  const { closeMany } = useTabActions();

  const reopen = useCallback(async (tabs: Workspace["tabs"]) => {
    for (const t of tabs) {
      if (!t.url) continue;
      try {
        await chrome.tabs.create({ url: t.url, active: false });
      } catch (e) {
        console.error("[TMC] reopen tab error:", e);
      }
    }
  }, []);

  const focus = useCallback(
    async (goal: string, stashTabs: EnrichedTab[]): Promise<Workspace | null> => {
      const closeable = stashTabs.filter((t) => !t.isPinned);
      if (closeable.length === 0) return null;

      const ws: Workspace = {
        id: `workspace-${Date.now()}`,
        schemaVersion: WORKSPACE_SCHEMA_VERSION,
        goal,
        createdAt: Date.now(),
        tabs: snapshot(closeable),
      };
      const next = [...workspaces, ws].slice(-MAX_WORKSPACES);
      const undoBuf: WorkspaceUndo = {
        workspaceId: ws.id,
        createdAt: Date.now(),
        count: closeable.length,
      };

      // Persist workspace + undo BEFORE closing anything.
      await chrome.storage.local.set({ workspaces: next, workspaceUndo: undoBuf });
      setWorkspaces(next);
      setWorkspaceUndo(undoBuf);

      await closeMany(closeable.map((t) => t.id));
      return ws;
    },
    [workspaces, closeMany, setWorkspaces, setWorkspaceUndo],
  );

  const restore = useCallback(
    async (id: string) => {
      const ws = workspaces.find((w) => w.id === id);
      if (ws) await reopen(ws.tabs);
    },
    [workspaces, reopen],
  );

  const remove = useCallback(
    async (id: string) => {
      const next = workspaces.filter((w) => w.id !== id);
      const nextUndo = undo?.workspaceId === id ? null : undo;
      await chrome.storage.local.set({ workspaces: next, workspaceUndo: nextUndo });
      setWorkspaces(next);
      if (undo?.workspaceId === id) setWorkspaceUndo(null);
    },
    [workspaces, undo, setWorkspaces, setWorkspaceUndo],
  );

  const undoLast = useCallback(async () => {
    if (!undo) return;
    const fresh = Date.now() - undo.createdAt <= UNDO_TTL_MS;
    const ws = workspaces.find((w) => w.id === undo.workspaceId);
    if (fresh && ws) await reopen(ws.tabs);
    // remove the stashed workspace + clear undo
    const next = workspaces.filter((w) => w.id !== undo.workspaceId);
    await chrome.storage.local.set({ workspaces: next, workspaceUndo: null });
    setWorkspaces(next);
    setWorkspaceUndo(null);
  }, [undo, workspaces, reopen, setWorkspaces, setWorkspaceUndo]);

  const validUndo = undo && Date.now() - undo.createdAt <= UNDO_TTL_MS ? undo : null;

  return { workspaces, undo: validUndo, focus, restore, remove, undoLast };
}

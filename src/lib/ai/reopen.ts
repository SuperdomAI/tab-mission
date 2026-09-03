/**
 * Ask AI `reopenClosedTab` tool — optional `sessions` grant (mirrors the F6
 * page-reading pattern: requested only at the user's explicit opt-in in
 * Settings, revocable). Nothing else in the extension needs this permission.
 */

export const REOPEN_PERMISSION = ["sessions"] as const;

function chromePermissions() {
  return (globalThis as { chrome?: typeof chrome }).chrome?.permissions;
}

/** True when the `sessions` grant is currently held. */
export async function hasReopenPermission(): Promise<boolean> {
  const perms = chromePermissions();
  if (!perms) return true; // non-extension context (tests)
  return perms.contains({ permissions: [...REOPEN_PERMISSION] });
}

/** Request the grant; resolves false when the user denies. Never throws. */
export async function requestReopenPermission(): Promise<boolean> {
  try {
    const perms = chromePermissions();
    if (!perms) return true;
    if (await hasReopenPermission()) return true;
    return perms.request({ permissions: [...REOPEN_PERMISSION] });
  } catch {
    return false;
  }
}

/** Revoke the grant (optional permissions can be removed). Never throws. */
export async function revokeReopenPermission(): Promise<boolean> {
  try {
    const perms = chromePermissions();
    if (!perms) return true;
    return perms.remove({ permissions: [...REOPEN_PERMISSION] });
  } catch {
    return false;
  }
}

/** A closable-tab entry from `chrome.sessions.getRecentlyClosed`. */
export interface RecentlyClosedEntry {
  sessionId?: string;
  title?: string;
  url?: string;
}

/**
 * Pick the reopen target from `chrome.sessions.getRecentlyClosed()` output.
 * Window-level entries (a whole window closed) are skipped — auto-restoring
 * a window would surprise the user; only tab-level closes are reopened. The
 * most recent tab-level entry wins. Returns the raw entry so the executor
 * can read its sessionId/title.
 */
export function resolveReopenTarget(
  entries: { tab?: RecentlyClosedEntry; window?: unknown }[],
): { entry: RecentlyClosedEntry } | { error: "empty" } {
  const tab = entries.find((e) => e.tab && e.tab.sessionId && e.tab.title);
  if (!tab?.tab) return { error: "empty" };
  return { entry: tab.tab };
}
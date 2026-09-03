import type { SavedSession } from "../types/index";

/**
 * Restore-then-autosave dedup. `restoreSession` opens a new window from a
 * session snapshot; closing that window later fires the `windows.onRemoved`
 * auto-save, which would persist a near-duplicate of the restored session.
 * Identity = the tab URL multiset (order-insensitive, multiplicity-aware):
 * restore recreates the exact same URLs, but a user may have reordered tabs.
 */
export function sessionTabSetSignature(tabs: { url?: string }[]): string {
  return tabs
    .map((t) => t.url)
    .filter((u): u is string => Boolean(u))
    .sort()
    .join("\u0000");
}

/**
 * Returns the first existing session whose tab-set matches the candidate,
 * or undefined when none does. An empty candidate never matches (a restored
 * session always has URLs; the SW already skips empty windows earlier).
 */
export function findDuplicateSession(
  existing: SavedSession[],
  candidate: Pick<SavedSession, "tabs"> | { tabs: { url?: string }[] },
): SavedSession | undefined {
  const candidateSig = sessionTabSetSignature(candidate.tabs);
  if (candidateSig === "") return undefined;
  return existing.find((s) => sessionTabSetSignature(s.tabs) === candidateSig);
}
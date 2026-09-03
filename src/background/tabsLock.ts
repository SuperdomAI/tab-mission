// ─── Tab storage mutex ────────────────────────────────────────────────────────
// Every background handler does an async read-modify-write of the whole `tabs`
// array. Chrome fires several tab events near-simultaneously (closing a tab
// fires onRemoved + onActivated together), and without serialization two
// in-flight handlers interleave on the awaits — a stale full-array write can
// resurrect a just-closed tab in storage (UI shows ghosts) until the next
// worker wake runs syncExistingTabs(). Chain all tab mutations through this
// lock so each handler sees the latest committed array.
let tabsLock: Promise<unknown> = Promise.resolve();

export function withTabsLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = tabsLock.then(fn, fn);
  tabsLock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
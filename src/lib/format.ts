/** Compact human duration, e.g. 45s · 12m · 3.1h. */
export function msToHuman(ms: number): string {
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

/** Compact "time ago", e.g. now · 12m · 3h · 2d. */
export function shortAgo(ts: number | null, now: number = Date.now()): string {
  if (ts === null) return "";
  const d = now - ts;
  if (d < 60_000) return "now";
  if (d < 3_600_000) return `${Math.round(d / 60_000)}m`;
  if (d < 86_400_000) return `${Math.round(d / 3_600_000)}h`;
  return `${Math.round(d / 86_400_000)}d`;
}

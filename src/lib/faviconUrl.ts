import type { EnrichedTab } from "../types/index";

/**
 * Pure builder for Chrome's built-in favicon endpoint. Kept separate from the
 * `chrome.runtime` lookup so it is trivially testable.
 *   base = chrome.runtime.getURL("/_favicon/")  ->  chrome-extension://<id>/_favicon/
 */
export function buildFaviconUrl(
  base: string,
  pageUrl: string,
  size = 32,
): string {
  const u = new URL(base);
  u.searchParams.set("pageUrl", pageUrl);
  u.searchParams.set("size", String(size));
  return u.toString();
}

/**
 * Favicon URL for a tab via the `_favicon/` API (needs the "favicon"
 * manifest permission). Returns "" when chrome/runtime is unavailable (tests
 * without the mock) or the tab has no usable URL — callers fall back to a
 * letter tile.
 */
export function faviconUrl(pageUrl: string, size = 32): string {
  const runtime = (globalThis as { chrome?: typeof chrome }).chrome?.runtime;
  if (!runtime?.getURL || !pageUrl) return "";
  return buildFaviconUrl(runtime.getURL("/_favicon/"), pageUrl, size);
}

/** First alphanumeric character for the letter-tile fallback. */
export function letterFor(tab: Pick<EnrichedTab, "domain" | "title">): string {
  const src = tab.domain || tab.title || "?";
  const match = src.replace(/^www\./, "").match(/[a-z0-9]/i);
  return (match ? match[0] : "?").toUpperCase();
}

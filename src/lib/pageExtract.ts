/**
 * F6 page-content extraction — the inline function `chrome.scripting.
 * executeScript` runs inside the closed page (it must be fully
 * self-contained: no closure references, no imports). The pure helpers
 * (`truncatePageText`) are extracted so they stay unit-testable; the DOM
 * read is deliberately thin. Extraction is UI-context only (the new-tab
 * page holds the `scripting` permission + host grants the user opted into).
 */

import { PAGE_TEXT_CAP } from "./ai/prompts";

/** Cap page text fed to the summarize prompt (prompt-size budget, F6). */
export { PAGE_TEXT_CAP };

export interface ExtractedPage {
  title: string;
  metaDescription: string;
  text: string;
}

/** Truncate to the prompt budget at a word-ish boundary (no mid-word cuts). */
export function truncatePageText(text: string, cap: number = PAGE_TEXT_CAP): string {
  if (text.length <= cap) return text;
  const cut = text.slice(0, cap);
  const space = cut.lastIndexOf(" ");
  return (space > cap * 0.8 ? cut.slice(0, space + 1) : cut).trim();
}

/**
 * Runs inside the target page: grabs the title, meta description, and
 * visible body text, truncated to the prompt budget. `document` is a
 * parameter only so tests can pass a fake — `executeScript` serializes the
 * function source and the default evaluates in the page.
 */
export function extractPageText(doc: Document = document): ExtractedPage {
  const meta = doc.querySelector<HTMLMetaElement>('meta[name="description"]');
  const body = doc.body;
  return {
    title: (doc.title ?? "").trim(),
    metaDescription: (meta?.content ?? "").trim(),
    text: truncatePageText(
      (body?.innerText || body?.textContent || "").trim(),
    ),
  };
}
import { describe, it, expect } from "vitest";
import {
  CLOSE_TAB_TOOL,
  closeResultText,
  detectCloseProposals,
  extractCloseTitles,
  resolveCloseTarget,
} from "./chatTools";
import { makeTab } from "../../test/factory";

describe("CLOSE_TAB_TOOL", () => {
  it("is an Ollama-style function tool requiring a title", () => {
    expect(CLOSE_TAB_TOOL.type).toBe("function");
    expect(CLOSE_TAB_TOOL.function.name).toBe("closeTab");
    expect(CLOSE_TAB_TOOL.function.parameters.required).toEqual(["title"]);
  });
});

describe("resolveCloseTarget", () => {
  const tabs = [
    makeTab({ id: 1, title: "Inbox", domain: "mail.google.com" }),
    makeTab({ id: 2, title: "Inbox", domain: "mail.google.com" }),
    makeTab({ id: 3, title: "Pinned", domain: "x.com", isPinned: true }),
    makeTab({ id: 4, title: "Deep dive", domain: "x.com" }),
  ];

  it("returns every open tab with the exact title", () => {
    const r = resolveCloseTarget({ title: "Inbox" }, tabs);
    expect("tabs" in r && r.tabs.map((t) => t.id)).toEqual([1, 2]);
    expect("tabs" in r && r.skippedPinned).toBe(0);
  });

  it("matches case-insensitively after trimming", () => {
    const r = resolveCloseTarget({ title: "  deep DIVE " }, tabs);
    expect("tabs" in r && r.tabs.map((t) => t.id)).toEqual([4]);
  });

  it("reports pinned matches but never returns them for closing", () => {
    const r = resolveCloseTarget({ title: "Pinned" }, tabs);
    expect("tabs" in r && r.tabs).toEqual([]);
    expect("tabs" in r && r.skippedPinned).toBe(1);
  });

  it("rejects when no open tab has that title", () => {
    expect(resolveCloseTarget({ title: "Nothing open" }, tabs)).toEqual({
      error: "no-match",
    });
  });

  it("rejects a missing or non-string title", () => {
    expect(resolveCloseTarget({}, tabs)).toEqual({ error: "missing-title" });
    expect(resolveCloseTarget({ title: "" }, tabs)).toEqual({ error: "missing-title" });
    expect(resolveCloseTarget({ title: 12 }, tabs)).toEqual({ error: "missing-title" });
  });

  it("rejects raw-string arguments (unparseable calls never pass)", () => {
    expect(resolveCloseTarget('{"title":"Inbox"}', tabs)).toEqual({
      error: "missing-title",
    });
  });
});

describe("closeResultText", () => {
  it("names the closed tabs", () => {
    const tabs = [
      makeTab({ id: 7, title: "Inbox", domain: "mail.google.com" }),
      makeTab({ id: 8, title: "Inbox", domain: "mail.google.com" }),
    ];
    expect(closeResultText({ tabs, skippedPinned: 0 }, "closeTab")).toBe(
      "closeTab: closed — Inbox · closed — Inbox",
    );
  });

  it("mentions skipped pinned tabs", () => {
    expect(closeResultText({ tabs: [], skippedPinned: 2 }, "closeTab")).toBe(
      "closeTab: nothing closed · 2 pinned tab(s) not closed",
    );
  });

  it("explains each refusal", () => {
    expect(closeResultText({ error: "no-match" }, "closeTab")).toBe(
      "closeTab: no open tab with that title — nothing closed",
    );
    expect(closeResultText({ error: "missing-title" }, "closeTab")).toBe(
      "closeTab: no title given — nothing closed",
    );
  });
});

// ─── text-claim fallback (weak models that narrate instead of calling) ───────

describe("extractCloseTitles", () => {
  it("extracts quoted titles", () => {
    expect(
      extractCloseTitles("Close the 'Outlook (outlook.cloud.microsoft)' tab."),
    ).toEqual(["Outlook (outlook.cloud.microsoft)"]);
    expect(extractCloseTitles('I\'ll close the "Inbox" tab.')).toEqual(["Inbox"]);
  });

  it("extracts unquoted titles", () => {
    expect(extractCloseTitles("I can close the Inbox tab.")).toEqual(["Inbox"]);
    expect(extractCloseTitles("closed the YouTube tab")).toEqual(["YouTube"]);
  });

  it("returns [] when nothing looks like a close claim", () => {
    expect(extractCloseTitles("Which tabs can I safely close?")).toEqual([]);
    expect(extractCloseTitles("")).toEqual([]);
  });
});

describe("detectCloseProposals", () => {
  const tabs = [
    makeTab({ id: 1, title: "Outlook", domain: "outlook.cloud.microsoft" }),
    makeTab({ id: 2, title: "Inbox", domain: "mail.google.com" }),
    makeTab({ id: 3, title: "Inbox", domain: "mail.google.com" }),
    makeTab({ id: 4, title: "Pinned", domain: "x.com", isPinned: true }),
  ];

  it("resolves a claim that echoes the list format 'Title (domain)'", () => {
    expect(
      detectCloseProposals("Close the 'Outlook (outlook.cloud.microsoft)' tab.", tabs),
    ).toEqual([{ title: "Outlook", tabIds: [1] }]);
  });

  it("resolves an exact quoted title and includes duplicates", () => {
    expect(detectCloseProposals('Close the "Inbox" tab.', tabs)).toEqual([
      { title: "Inbox", tabIds: [2, 3] },
    ]);
  });

  it("never proposes pinned tabs", () => {
    expect(detectCloseProposals('Close the "Pinned" tab.', tabs)).toEqual([]);
  });

  it("returns [] when nothing resolves", () => {
    expect(detectCloseProposals("Close the 'Mystery' tab.", tabs)).toEqual([]);
    expect(detectCloseProposals("Which tabs can I safely close?", tabs)).toEqual([]);
  });

  it("dedupes repeated mentions", () => {
    expect(
      detectCloseProposals('Close the "Inbox" tab. Also close the "Inbox" tab.', tabs),
    ).toEqual([{ title: "Inbox", tabIds: [2, 3] }]);
  });
});
import { describe, it, expect } from "vitest";
import {
  CLOSE_TAB_TOOL,
  CLOSE_OTHERS_TOOL,
  COPY_TABS_TOOL,
  DUPLICATE_TAB_TOOL,
  GROUP_TABS_TOOL,
  HIBERNATE_TAB_TOOL,
  JUMP_TAB_TOOL,
  MUTE_TAB_TOOL,
  OPEN_TAB_TOOL,
  PIN_TAB_TOOL,
  READ_PAGE_TOOL,
  REOPEN_TAB_TOOL,
  SAVE_SESSION_TOOL,
  UNMUTE_TAB_TOOL,
  UNPIN_TAB_TOOL,
  closeOthersResultText,
  closeResultText,
  copyResultText,
  detectCloseProposals,
  detectHibernateProposals,
  extractCloseTitles,
  extractHibernateTitles,
  groupResultText,
  jumpResultText,
  openResultText,
  readPageRefusalText,
  readPageSuccessText,
  resolveCloseOthersTarget,
  resolveCloseTarget,
  resolveCopyTitles,
  resolveGroupTarget,
  resolveOpenUrl,
  resolveTabTarget,
  saveSessionResultText,
} from "./chatTools";
import { makeTab } from "../../test/factory";

describe("CLOSE_TAB_TOOL", () => {
  it("is an Ollama-style function tool requiring a title", () => {
    expect(CLOSE_TAB_TOOL.type).toBe("function");
    expect(CLOSE_TAB_TOOL.function.name).toBe("closeTab");
    expect(CLOSE_TAB_TOOL.function.parameters.required).toEqual(["title"]);
  });
});

describe("HIBERNATE_TAB_TOOL", () => {
  it("is an Ollama-style function tool requiring a title, distinct from closeTab", () => {
    expect(HIBERNATE_TAB_TOOL.type).toBe("function");
    expect(HIBERNATE_TAB_TOOL.function.name).toBe("hibernateTab");
    expect(HIBERNATE_TAB_TOOL.function.parameters.required).toEqual(["title"]);
    expect(HIBERNATE_TAB_TOOL.function.name).not.toBe(CLOSE_TAB_TOOL.function.name);
  });
});

describe("OPEN_TAB_TOOL", () => {
  it("is an Ollama-style function tool requiring a url", () => {
    expect(OPEN_TAB_TOOL.type).toBe("function");
    expect(OPEN_TAB_TOOL.function.name).toBe("openTab");
    expect(OPEN_TAB_TOOL.function.parameters.required).toEqual(["url"]);
  });
});

describe("tab-control tools", () => {
  it("jump/group/save/pin/unpin are Ollama-style function tools", () => {
    expect(JUMP_TAB_TOOL.function.parameters.required).toEqual(["title"]);
    expect(GROUP_TABS_TOOL.function.parameters.required).toEqual(["titles"]);
    expect(SAVE_SESSION_TOOL.function.parameters.required).toEqual(["name"]);
    expect(PIN_TAB_TOOL.function.parameters.required).toEqual(["title"]);
    expect(UNPIN_TAB_TOOL.function.parameters.required).toEqual(["title"]);
    const names = [
      JUMP_TAB_TOOL,
      GROUP_TABS_TOOL,
      SAVE_SESSION_TOOL,
      PIN_TAB_TOOL,
      UNPIN_TAB_TOOL,
    ].map((t) => t.function.name);
    expect(new Set(names).size).toBe(5);
  });
});

describe("jumpResultText", () => {
  const tabs = [
    makeTab({ id: 1, title: "Inbox", domain: "mail.google.com" }),
    makeTab({ id: 2, title: "Inbox", domain: "mail.google.com" }),
    makeTab({ id: 3, title: "Pinned", domain: "x.com", isPinned: true }),
  ];

  it("names the activated tab and mentions skipped duplicates", () => {
    expect(jumpResultText({ tabs: [tabs[0]], skippedPinned: 0 })).toBe(
      "jumpTab: activated — Inbox",
    );
    expect(jumpResultText({ tabs: [tabs[0], tabs[1]], skippedPinned: 0 })).toBe(
      "jumpTab: activated — Inbox (1 duplicate(s) not activated)",
    );
  });

  it("mentions pinned matches when nothing else matched", () => {
    expect(jumpResultText({ tabs: [], skippedPinned: 1 })).toBe(
      "jumpTab: nothing activated · 1 pinned tab(s) not activated",
    );
  });

  it("explains each refusal", () => {
    expect(jumpResultText({ error: "no-match" })).toBe(
      "jumpTab: no open tab with that title — nothing activated",
    );
    expect(jumpResultText({ error: "missing-title" })).toBe(
      "jumpTab: no title given — nothing activated",
    );
  });
});

describe("resolveGroupTarget", () => {
  const tabs = [
    makeTab({ id: 1, title: "Inbox", domain: "mail.google.com" }),
    makeTab({ id: 2, title: "Inbox", domain: "mail.google.com" }),
    makeTab({ id: 3, title: "Pinned", domain: "x.com", isPinned: true }),
    makeTab({ id: 4, title: "Docs", domain: "docs.google.com" }),
  ];

  it("groups matched titles, dedupes, and skips pinned", () => {
    const r = resolveGroupTarget({ titles: ["Inbox", "Inbox", "Docs", "Pinned"] }, tabs);
    expect(r).toEqual({
      tabIds: [1, 2, 4],
      groupedTitles: ["Inbox", "Inbox", "Docs"],
      skippedPinned: 1,
    });
  });

  it("ignores non-string entries and unresolvable titles", () => {
    const r = resolveGroupTarget({ titles: ["Docs", "Mystery", 12] }, tabs);
    expect(r).toEqual({
      tabIds: [4],
      groupedTitles: ["Docs"],
      skippedPinned: 0,
    });
  });

  it("rejects when nothing matches", () => {
    expect(resolveGroupTarget({ titles: ["Mystery"] }, tabs)).toEqual({
      error: "no-match",
    });
    expect(resolveGroupTarget({ titles: ["Pinned"] }, tabs)).toEqual({
      error: "no-match",
    });
  });

  it("rejects a missing or non-array titles", () => {
    expect(resolveGroupTarget({}, tabs)).toEqual({ error: "missing-titles" });
    expect(resolveGroupTarget({ titles: [] }, tabs)).toEqual({
      error: "missing-titles",
    });
    expect(resolveGroupTarget({ titles: "Inbox" }, tabs)).toEqual({
      error: "missing-titles",
    });
  });
});

describe("groupResultText", () => {
  it("reports the grouped count and titles", () => {
    expect(
      groupResultText({
        tabIds: [1, 2],
        groupedTitles: ["Inbox", "Inbox"],
        skippedPinned: 1,
      }),
    ).toBe("groupTabs: grouped 2 tab(s) — Inbox · Inbox · 1 pinned tab(s) not grouped");
  });

  it("explains each refusal", () => {
    expect(groupResultText({ error: "missing-titles" })).toBe(
      "groupTabs: no titles given — nothing grouped",
    );
    expect(groupResultText({ error: "no-match" })).toBe(
      "groupTabs: no open tab matched any title — nothing grouped",
    );
  });
});

describe("saveSessionResultText", () => {
  it("reports the count and session name", () => {
    expect(saveSessionResultText(7, "Deep work")).toBe(
      'saveSession: saved 7 tab(s) as "Deep work"',
    );
  });
});

describe("READ_PAGE_TOOL", () => {
  it("is an Ollama-style function tool requiring a title", () => {
    expect(READ_PAGE_TOOL.type).toBe("function");
    expect(READ_PAGE_TOOL.function.name).toBe("readPage");
    expect(READ_PAGE_TOOL.function.parameters.required).toEqual(["title"]);
  });
});

describe("readPage result texts", () => {
  it("builds a success payload with the title and truncated text", () => {
    const long = "x".repeat(9000);
    const text = readPageSuccessText("Docs", long, 100);
    expect(text).toContain('readPage: content of "Docs" (truncated):');
    expect(text.length).toBeLessThan(300);
  });

  it("explains each refusal", () => {
    expect(readPageRefusalText("no-permission")).toBe(
      'readPage: page-reading is off — enable "Read Pages for AI" in Settings',
    );
    expect(readPageRefusalText("unreadable")).toBe(
      "readPage: couldn't read that page (restricted or unavailable) — nothing happened",
    );
  });
});

describe("resolveOpenUrl", () => {
  it("accepts a full https URL", () => {
    expect(resolveOpenUrl({ url: "https://google.com" })).toEqual({
      url: "https://google.com",
    });
    expect(resolveOpenUrl({ url: "http://localhost:11434/api" })).toEqual({
      url: "http://localhost:11434/api",
    });
  });

  it("prepends https:// to bare domains", () => {
    expect(resolveOpenUrl({ url: "google.com" })).toEqual({ url: "https://google.com" });
    expect(resolveOpenUrl({ url: "www.example.com/path?q=1" })).toEqual({
      url: "https://www.example.com/path?q=1",
    });
  });

  it("refuses non-http schemes", () => {
    expect(resolveOpenUrl({ url: "javascript:alert(1)" })).toEqual({
      error: "invalid-url",
    });
    expect(resolveOpenUrl({ url: "chrome://settings" })).toEqual({
      error: "invalid-url",
    });
    expect(resolveOpenUrl({ url: "file:///etc/passwd" })).toEqual({
      error: "invalid-url",
    });
    expect(resolveOpenUrl({ url: "data:text/html,<h1>x</h1>" })).toEqual({
      error: "invalid-url",
    });
  });

  it("refuses a missing or non-string url", () => {
    expect(resolveOpenUrl({})).toEqual({ error: "missing-url" });
    expect(resolveOpenUrl({ url: "" })).toEqual({ error: "missing-url" });
    expect(resolveOpenUrl({ url: 12 })).toEqual({ error: "missing-url" });
    expect(resolveOpenUrl("garbage")).toEqual({ error: "missing-url" });
  });

  it("refuses URLs that don't parse", () => {
    expect(resolveOpenUrl({ url: "https://" })).toEqual({ error: "invalid-url" });
    expect(resolveOpenUrl({ url: "https://google com" })).toEqual({
      error: "invalid-url",
    });
  });
});

describe("openResultText", () => {
  it("reports the opened URL", () => {
    expect(openResultText({ url: "https://google.com" })).toBe(
      "openTab: opened — https://google.com",
    );
  });

  it("explains each refusal", () => {
    expect(openResultText({ error: "missing-url" })).toBe(
      "openTab: no URL given — nothing opened",
    );
    expect(openResultText({ error: "invalid-url" })).toBe(
      "openTab: invalid URL — nothing opened",
    );
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

  it("closes via a truncated site-suffix title but still skips pinned", () => {
    const suffixed = [
      makeTab({ id: 30, title: "Inbox - Mail", domain: "mail.google.com" }),
      makeTab({ id: 31, title: "Inbox - Mail", domain: "mail.google.com" }),
      makeTab({ id: 32, title: "Pinned - Mail", domain: "mail.google.com", isPinned: true }),
    ];
    const r = resolveCloseTarget({ title: "Inbox" }, suffixed);
    expect("tabs" in r && r.tabs.map((t) => t.id)).toEqual([30, 31]);
    expect("tabs" in r && r.skippedPinned).toBe(0);
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

  it("uses the hibernate verb when asked", () => {
    const tabs = [makeTab({ id: 9, title: "Video", domain: "youtube.com" })];
    expect(closeResultText({ tabs, skippedPinned: 0 }, "hibernateTab", "hibernated")).toBe(
      "hibernateTab: hibernated — Video",
    );
    expect(closeResultText({ error: "no-match" }, "hibernateTab", "hibernated")).toBe(
      "hibernateTab: no open tab with that title — nothing hibernated",
    );
    expect(closeResultText({ tabs: [], skippedPinned: 1 }, "hibernateTab", "hibernated")).toBe(
      "hibernateTab: nothing hibernated · 1 pinned tab(s) not hibernated",
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

// ─── hibernate claims (parallel to close — same rules, different tool) ───────

describe("extractHibernateTitles", () => {
  it("extracts quoted titles after a hibernate verb", () => {
    expect(
      extractHibernateTitles("You can hibernate the 'Video (youtube.com)' tab."),
    ).toEqual(["Video (youtube.com)"]);
    expect(extractHibernateTitles('I\'ll discard the "Inbox" tab.')).toEqual(["Inbox"]);
  });

  it("extracts unquoted titles", () => {
    expect(extractHibernateTitles("I can hibernate the Video tab.")).toEqual(["Video"]);
    expect(extractHibernateTitles("discarded the YouTube tab")).toEqual(["YouTube"]);
  });

  it("ignores close claims (no cross-contamination)", () => {
    expect(extractHibernateTitles('Close the "Inbox" tab.')).toEqual([]);
    expect(extractHibernateTitles("I can close the Inbox tab.")).toEqual([]);
    expect(extractCloseTitles("hibernate the Video tab")).toEqual([]);
  });

  it("returns [] when nothing looks like a hibernate claim", () => {
    expect(extractHibernateTitles("Which tabs can I hibernate?")).toEqual([]);
    expect(extractHibernateTitles("")).toEqual([]);
  });
});

describe("detectHibernateProposals", () => {
  const tabs = [
    makeTab({ id: 1, title: "Video", domain: "youtube.com" }),
    makeTab({ id: 2, title: "Inbox", domain: "mail.google.com" }),
    makeTab({ id: 3, title: "Inbox", domain: "mail.google.com" }),
    makeTab({ id: 4, title: "Pinned", domain: "x.com", isPinned: true }),
  ];

  it("resolves a claim that echoes the list format 'Title (domain)'", () => {
    expect(
      detectHibernateProposals("You can hibernate the 'Video (youtube.com)' tab.", tabs),
    ).toEqual([{ title: "Video", tabIds: [1] }]);
  });

  it("resolves an exact quoted title and includes duplicates", () => {
    expect(detectHibernateProposals('Hibernate the "Inbox" tab.', tabs)).toEqual([
      { title: "Inbox", tabIds: [2, 3] },
    ]);
  });

  it("never proposes pinned tabs", () => {
    expect(detectHibernateProposals('Hibernate the "Pinned" tab.', tabs)).toEqual([]);
  });

  it("returns [] when nothing resolves", () => {
    expect(detectHibernateProposals("Hibernate the 'Mystery' tab.", tabs)).toEqual([]);
    expect(detectHibernateProposals("Any tabs I can hibernate?", tabs)).toEqual([]);
  });

  it("dedupes repeated mentions", () => {
    expect(
      detectHibernateProposals(
        'Hibernate the "Inbox" tab. Also hibernate the "Inbox" tab.',
        tabs,
      ),
    ).toEqual([{ title: "Inbox", tabIds: [2, 3] }]);
  });
});
describe("resolveTabTarget (non-destructive ops)", () => {
  const tabs = [
    makeTab({ id: 1, title: "Video", domain: "youtube.com" }),
    makeTab({ id: 2, title: "Inbox", domain: "mail.google.com" }),
    makeTab({ id: 3, title: "Pinned", domain: "x.com", isPinned: true }),
  ];

  it("matches by exact title including pinned tabs", () => {
    expect(resolveTabTarget({ title: "Pinned" }, tabs)).toEqual({
      tabs: [tabs[2]],
      skippedPinned: 0,
    });
  });

  it("rejects missing and unmatched titles like closeTab", () => {
    expect(resolveTabTarget({}, tabs)).toEqual({ error: "missing-title" });
    expect(resolveTabTarget({ title: "Mystery" }, tabs)).toEqual({ error: "no-match" });
  });

  it("matches a truncated site-suffix title (e.g. '… - YouTube') via an unambiguous prefix", () => {
    const ytTabs = [
      makeTab({
        id: 10,
        title: "World's Most Beautiful 4K Video - YouTube",
        domain: "youtube.com",
      }),
      makeTab({ id: 11, title: "Pinned - YouTube", domain: "youtube.com", isPinned: true }),
    ];
    expect(resolveTabTarget({ title: "World's Most Beautiful 4K Video" }, ytTabs)).toEqual({
      tabs: [ytTabs[0]],
      skippedPinned: 0,
    });
    expect(resolveTabTarget({ title: "Pinned" }, ytTabs)).toEqual({
      tabs: [ytTabs[1]],
      skippedPinned: 0,
    });
  });

  it("still batches duplicate tabs under a suffix match", () => {
    const dup = [
      makeTab({ id: 12, title: "Live - YouTube", domain: "youtube.com" }),
      makeTab({ id: 13, title: "Live - YouTube", domain: "youtube.com" }),
    ];
    expect(resolveTabTarget({ title: "Live" }, dup)).toEqual({ tabs: dup, skippedPinned: 0 });
  });

  it("resolves a '(domain)' suffix the model echoed from the tab list", () => {
    expect(resolveTabTarget({ title: "Video (youtube.com)" }, tabs)).toEqual({
      tabs: [tabs[0]],
      skippedPinned: 0,
    });
  });

  it("refuses when a prefix matches two different tabs", () => {
    const two = [
      makeTab({ id: 14, title: "Deep dive part 1", domain: "x.com" }),
      makeTab({ id: 15, title: "Deep dive part 2", domain: "x.com" }),
    ];
    expect(resolveTabTarget({ title: "Deep dive" }, two)).toEqual({ error: "no-match" });
  });
});

describe("MUTE_TAB_TOOL / UNMUTE_TAB_TOOL", () => {
  it("are Ollama-style function tools requiring a title", () => {
    expect(MUTE_TAB_TOOL.function.name).toBe("muteTab");
    expect(MUTE_TAB_TOOL.function.parameters.required).toEqual(["title"]);
    expect(UNMUTE_TAB_TOOL.function.name).toBe("unmuteTab");
    expect(UNMUTE_TAB_TOOL.function.parameters.required).toEqual(["title"]);
  });
});

describe("CLOSE_OTHERS_TOOL / resolveCloseOthersTarget", () => {
  const tabs = [
    makeTab({ id: 1, title: "Inbox", domain: "mail.google.com" }),
    makeTab({ id: 2, title: "Video", domain: "youtube.com" }),
    makeTab({ id: 3, title: "News", domain: "news.ycombinator.com" }),
    makeTab({ id: 4, title: "Pinned", domain: "x.com", isPinned: true }),
  ];

  it("is an Ollama-style function tool requiring a title", () => {
    expect(CLOSE_OTHERS_TOOL.function.name).toBe("closeOtherTabs");
    expect(CLOSE_OTHERS_TOOL.function.parameters.required).toEqual(["title"]);
  });

  it("closes every non-pinned tab except the keeper", () => {
    const r = resolveCloseOthersTarget({ title: "Inbox" }, tabs);
    expect(r).toEqual({
      closedTabs: [tabs[1], tabs[2]],
      keptTitle: "Inbox",
      keptPinned: 0,
      closedPinned: 1,
    });
  });

  it("refuses when the keeper does not exist — nothing may close", () => {
    expect(resolveCloseOthersTarget({ title: "Mystery" }, tabs)).toEqual({
      error: "no-match",
    });
    expect(resolveCloseOthersTarget({}, tabs)).toEqual({ error: "missing-title" });
  });

  it("keeps a keeper matched via a truncated site-suffix title", () => {
    const suffixed = [
      makeTab({ id: 1, title: "Inbox - Mail", domain: "mail.google.com" }),
      makeTab({ id: 2, title: "Video - YouTube", domain: "youtube.com" }),
      makeTab({ id: 3, title: "News", domain: "news.ycombinator.com" }),
    ];
    const r = resolveCloseOthersTarget({ title: "Inbox" }, suffixed);
    expect(r).toEqual({
      closedTabs: [suffixed[1], suffixed[2]],
      keptTitle: "Inbox - Mail",
      keptPinned: 0,
      closedPinned: 0,
    });
  });

  it("renders a human result text with the pinned note", () => {
    const r = resolveCloseOthersTarget({ title: "Inbox" }, tabs);
    expect(closeOthersResultText(r)).toBe(
      'closeOtherTabs: kept "Inbox" — closed — Video · closed — News · 1 pinned tab(s) kept',
    );
    expect(closeOthersResultText({ error: "no-match" })).toContain("nothing closed");
  });
});

describe("DUPLICATE_TAB_TOOL", () => {
  it("is an Ollama-style function tool requiring a title", () => {
    expect(DUPLICATE_TAB_TOOL.function.name).toBe("duplicateTab");
    expect(DUPLICATE_TAB_TOOL.function.parameters.required).toEqual(["title"]);
  });
});

describe("REOPEN_TAB_TOOL", () => {
  it("is an Ollama-style function tool with no arguments", () => {
    expect(REOPEN_TAB_TOOL.function.name).toBe("reopenClosedTab");
    expect(REOPEN_TAB_TOOL.function.parameters.required).toEqual([]);
  });
});

describe("COPY_TABS_TOOL / resolveCopyTitles", () => {
  const tabs = [
    makeTab({ id: 1, title: "Inbox", domain: "mail.google.com" }),
    makeTab({ id: 2, title: "Inbox", domain: "mail.google.com" }),
    makeTab({ id: 3, title: "Video", domain: "youtube.com" }),
    makeTab({ id: 4, title: "Pinned", domain: "x.com", isPinned: true }),
  ];

  it("is an Ollama-style function tool with an optional titles array", () => {
    expect(COPY_TABS_TOOL.function.name).toBe("copyTabUrls");
    expect(COPY_TABS_TOOL.function.parameters.required).toEqual([]);
  });

  it("copies ALL open tabs when titles are omitted", () => {
    expect(resolveCopyTitles({}, tabs)).toEqual({ tabs, skipped: 0 });
    expect(resolveCopyTitles({ titles: [] }, tabs)).toEqual({ tabs, skipped: 0 });
  });

  it("copies only the resolved titles, skipping unmatched ones", () => {
    expect(resolveCopyTitles({ titles: ["Inbox", "Mystery"] }, tabs)).toEqual({
      tabs: [tabs[0], tabs[1]],
      skipped: 1,
    });
  });

  it("errors when nothing resolves", () => {
    expect(resolveCopyTitles({ titles: ["Mystery"] }, tabs)).toEqual({
      error: "no-match",
    });
  });

  it("renders a human result text", () => {
    expect(copyResultText({ tabs: tabs.slice(0, 2), skipped: 1 })).toBe(
      "copyTabUrls: copied 2 link(s) to the clipboard (1 unmatched skipped)",
    );
    expect(copyResultText({ error: "no-match" })).toContain("nothing copied");
  });
});

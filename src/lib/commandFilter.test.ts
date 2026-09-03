import { describe, it, expect } from "vitest";
import {
  buildTabFuse,
  searchTabs,
  searchTabsSemantic,
  buildSessionFuse,
  searchSessions,
  filterCommands,
  type PaletteCommand,
} from "./commandFilter";
import { makeTab } from "../test/factory";
import type { SavedSession } from "../types/index";

describe("searchTabs", () => {
  const tabs = [
    makeTab({ id: 1, title: "GitHub Pull Requests", domain: "github.com", url: "https://github.com/pulls" }),
    makeTab({ id: 2, title: "Figma — Command Center", domain: "figma.com", url: "https://figma.com/x" }),
    makeTab({ id: 3, title: "Gmail Inbox", domain: "mail.google.com", url: "https://mail.google.com" }),
  ];
  const fuse = buildTabFuse(tabs);

  it("returns [] for empty query", () => {
    expect(searchTabs(fuse, "  ")).toEqual([]);
  });

  it("ranks a relevant tab first", () => {
    const r = searchTabs(fuse, "figma");
    expect(r[0].id).toBe(2);
  });

  it("respects the limit", () => {
    expect(searchTabs(fuse, "co", 1).length).toBeLessThanOrEqual(1);
  });
});

describe("filterCommands", () => {
  const cmds: PaletteCommand[] = [
    { id: "a", label: "Close duplicates", keywords: ["dupes"], run: () => {} },
    { id: "b", label: "Switch to Timeline", keywords: ["view"], run: () => {} },
  ];
  it("returns all for empty query", () => {
    expect(filterCommands(cmds, "")).toHaveLength(2);
  });
  it("matches label or keyword", () => {
    expect(filterCommands(cmds, "dupes").map((c) => c.id)).toEqual(["a"]);
    expect(filterCommands(cmds, "timeline").map((c) => c.id)).toEqual(["b"]);
  });
});

describe("buildSessionFuse / searchSessions (F4)", () => {
  const sessions: SavedSession[] = [
    {
      id: "s1",
      name: "Launch planning",
      savedAt: 1,
      tabs: [],
    },
    {
      id: "s2",
      name: "Trip research",
      savedAt: 2,
      tabs: [],
      summary: "This session covered flights and hotels in Lisbon.",
    },
    {
      id: "s3",
      name: "Old notes",
      savedAt: 3,
      tabs: [],
    },
  ];

  it("matches sessions by name", () => {
    const fuse = buildSessionFuse(sessions, {});
    expect(searchSessions(fuse, "trip").map((s) => s.id)).toEqual(["s2"]);
  });

  it("matches the AI summary (map wins over the backfill)", () => {
    const fuse = buildSessionFuse(sessions, {
      s2: { summary: "Lisbon itinerary — flights, hotels, food.", generatedAt: 1, model: "m" },
    });
    const results = searchSessions(fuse, "itinerary").map((s) => s.id);
    expect(results).toContain("s2");
    expect(results[0]).toBe("s2");
  });

  it("falls back to the SavedSession.summary backfill when the map has no entry", () => {
    const fuse = buildSessionFuse(sessions, {});
    expect(searchSessions(fuse, "lisbon").map((s) => s.id)).toEqual(["s2"]);
  });

  it("returns nothing for an empty query", () => {
    const fuse = buildSessionFuse(sessions, {});
    expect(searchSessions(fuse, "")).toEqual([]);
    expect(searchSessions(fuse, "   ")).toEqual([]);
  });
});

describe("searchTabsSemantic (F7)", () => {
  const tabs = [
    makeTab({ id: 1, title: "GitHub Pull Requests", domain: "github.com", url: "https://github.com/pulls" }),
    makeTab({ id: 2, title: "Figma — Command Center", domain: "figma.com", url: "https://figma.com/x" }),
    makeTab({ id: 3, title: "Gmail Inbox", domain: "mail.google.com", url: "https://mail.google.com" }),
    makeTab({ id: 4, title: "NPM package docs", domain: "npmjs.com", url: "https://npmjs.com/x" }),
  ];
  const fuse = buildTabFuse(tabs);

  it("ranks semantic hits first, then Fuse results, flagging only semantic rows", () => {
    const results = searchTabsSemantic(
      tabs,
      fuse,
      "figma",
      [{ id: 4, score: 0.9 }, { id: 2, score: 0.7 }],
    );
    expect(results.map((r) => r.tab.id)).toEqual([4, 2]);
    expect(results.map((r) => r.semantic)).toEqual([true, true]);
  });

  it("dedupes ids present in both lists (flagged semantic once)", () => {
    const results = searchTabsSemantic(
      tabs,
      fuse,
      "github",
      [{ id: 1, score: 0.8 }],
    );
    expect(results.map((r) => r.tab.id)).toEqual([1]);
    expect(results[0].semantic).toBe(true);
  });

  it("with no semantic hits behaves exactly like pure Fuse (all rows unmarked)", () => {
    const results = searchTabsSemantic(tabs, fuse, "figma", []);
    expect(results.map((r) => r.tab.id)).toEqual([2]);
    expect(results.every((r) => !r.semantic)).toBe(true);
  });

  it("returns [] for an empty query and ignores ids not in the tab set", () => {
    expect(searchTabsSemantic(tabs, fuse, "  ", [{ id: 1, score: 0.9 }])).toEqual([]);
    const results = searchTabsSemantic(tabs, fuse, "", [{ id: 1, score: 0.9 }]);
    expect(results).toEqual([]);
    expect(searchTabsSemantic(tabs, fuse, "figma", [{ id: 99, score: 0.9 }]).map((r) => r.tab.id)).toEqual([2]);
  });
});
import { describe, it, expect } from "vitest";
import { buildTabFuse, searchTabs, filterCommands, type PaletteCommand } from "./commandFilter";
import { makeTab } from "../test/factory";

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

import { describe, it, expect } from "vitest";
import { tabStatus, RECENT_MS, STALE_MS } from "./tabStatus";
import { makeTab } from "../test/factory";

const NOW = 1_000_000_000_000;

describe("tabStatus", () => {
  it("never-visited wins over everything (incl. hibernated)", () => {
    expect(
      tabStatus(makeTab({ visitCount: 0, isHibernated: true }), NOW),
    ).toBe("unvisited");
  });

  it("hibernated takes precedence over recency", () => {
    const tab = makeTab({
      visitCount: 3,
      isHibernated: true,
      lastActiveAt: NOW - 1000, // would be "recent"
    });
    expect(tabStatus(tab, NOW)).toBe("hibernated");
  });

  it("recent when lastActiveAt < 30m ago", () => {
    expect(
      tabStatus(makeTab({ lastActiveAt: NOW - (RECENT_MS - 1) }), NOW),
    ).toBe("recent");
  });

  it("stale when lastActiveAt > 2h ago", () => {
    expect(
      tabStatus(makeTab({ lastActiveAt: NOW - (STALE_MS + 1) }), NOW),
    ).toBe("stale");
  });

  it("normal between 30m and 2h", () => {
    expect(
      tabStatus(makeTab({ lastActiveAt: NOW - 60 * 60_000 }), NOW),
    ).toBe("normal");
  });

  it("normal when visited but never has lastActiveAt", () => {
    expect(tabStatus(makeTab({ visitCount: 2, lastActiveAt: null }), NOW)).toBe(
      "normal",
    );
  });
});

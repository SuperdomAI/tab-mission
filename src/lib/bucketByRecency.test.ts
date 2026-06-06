import { describe, it, expect } from "vitest";
import { bucketOf, bucketByRecency, clearableForgotten } from "./bucketByRecency";
import { makeTab } from "../test/factory";

const NOW = 1_000_000_000_000;
const min = (n: number) => n * 60_000;
const hr = (n: number) => n * 60 * 60_000;

describe("bucketOf", () => {
  it("uses lastActiveAt when present", () => {
    expect(bucketOf(makeTab({ lastActiveAt: NOW - min(5) }), NOW)).toBe("now");
    expect(bucketOf(makeTab({ lastActiveAt: NOW - hr(3) }), NOW)).toBe(
      "earlier",
    );
    expect(bucketOf(makeTab({ lastActiveAt: NOW - hr(12) }), NOW)).toBe(
      "gettingOld",
    );
    expect(bucketOf(makeTab({ lastActiveAt: NOW - hr(48) }), NOW)).toBe(
      "forgotten",
    );
  });

  it("falls back to openedAt when never active", () => {
    // never-visited but opened 2 minutes ago -> NOT forgotten
    const fresh = makeTab({
      visitCount: 0,
      lastActiveAt: null,
      openedAt: NOW - min(2),
    });
    expect(bucketOf(fresh, NOW)).toBe("now");
  });
});

describe("clearableForgotten — the data-loss guard", () => {
  it("does NOT sweep a freshly restored never-visited tab", () => {
    const restored = makeTab({
      visitCount: 0,
      lastActiveAt: null,
      openedAt: NOW - min(1), // just restored
    });
    expect(clearableForgotten([restored], NOW)).toEqual([]);
  });

  it("never clears pinned tabs even if forgotten", () => {
    const oldPinned = makeTab({
      isPinned: true,
      lastActiveAt: NOW - hr(72),
    });
    expect(clearableForgotten([oldPinned], NOW)).toEqual([]);
  });

  it("clears a genuinely forgotten, unpinned tab", () => {
    const dead = makeTab({ isPinned: false, lastActiveAt: NOW - hr(72) });
    expect(clearableForgotten([dead], NOW).map((t) => t.id)).toEqual([dead.id]);
  });

  it("clears a never-visited tab only once it is truly old", () => {
    const oldUnvisited = makeTab({
      visitCount: 0,
      lastActiveAt: null,
      openedAt: NOW - hr(48),
    });
    expect(clearableForgotten([oldUnvisited], NOW).map((t) => t.id)).toEqual([
      oldUnvisited.id,
    ]);
  });
});

describe("bucketByRecency", () => {
  it("returns ordered, non-empty buckets, newest-first within", () => {
    const tabs = [
      makeTab({ id: 1, lastActiveAt: NOW - min(1) }),
      makeTab({ id: 2, lastActiveAt: NOW - min(10) }),
      makeTab({ id: 3, lastActiveAt: NOW - hr(48) }),
    ];
    const buckets = bucketByRecency(tabs, NOW);
    expect(buckets.map((b) => b.key)).toEqual(["now", "forgotten"]);
    expect(buckets[0].tabs.map((t) => t.id)).toEqual([1, 2]); // newest first
  });
});

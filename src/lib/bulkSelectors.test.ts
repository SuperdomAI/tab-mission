import { describe, it, expect } from "vitest";
import { selectDuplicates, selectUnvisited, selectZombies } from "./bulkSelectors";
import { DEFAULT_SETTINGS } from "../types/index";
import { makeTab } from "../test/factory";

const NOW = 1_000_000_000_000;
const hr = (n: number) => n * 60 * 60_000;
const min = (n: number) => n * 60_000;

describe("selectDuplicates", () => {
  it("keeps the most-recently-active dupe, closes the rest, skips pinned", () => {
    const a = makeTab({ id: 1, url: "https://x.com", lastActiveAt: NOW - 1000 });
    const b = makeTab({ id: 2, url: "https://x.com", lastActiveAt: NOW - 5000 });
    const pinned = makeTab({ id: 3, url: "https://x.com", isPinned: true });
    const close = selectDuplicates([a, b, pinned]).map((t) => t.id);
    expect(close).toEqual([2]); // keeps #1 (most recent), never #3 (pinned)
  });
});

describe("selectUnvisited", () => {
  it("never-visited AND opened > 30m ago, excluding pinned", () => {
    const old = makeTab({ id: 1, visitCount: 0, openedAt: NOW - min(45) });
    const fresh = makeTab({ id: 2, visitCount: 0, openedAt: NOW - min(5) });
    const pinned = makeTab({ id: 3, visitCount: 0, openedAt: NOW - hr(2), isPinned: true });
    expect(selectUnvisited([old, fresh, pinned], NOW).map((t) => t.id)).toEqual([1]);
  });
});

describe("selectZombies", () => {
  it("null or older-than-threshold lastActiveAt, excluding pinned", () => {
    const settings = { ...DEFAULT_SETTINGS, zombieThresholdHours: 3 };
    const neverActive = makeTab({ id: 1, lastActiveAt: null });
    const old = makeTab({ id: 2, lastActiveAt: NOW - hr(5) });
    const recent = makeTab({ id: 3, lastActiveAt: NOW - hr(1) });
    const pinnedOld = makeTab({ id: 4, lastActiveAt: NOW - hr(9), isPinned: true });
    expect(selectZombies([neverActive, old, recent, pinnedOld], settings, NOW).map((t) => t.id))
      .toEqual([1, 2]);
  });
});

import { describe, it, expect } from "vitest";
import { buildSessionFuse, searchSessions } from "./commandFilter";
import type { SavedSession } from "../types/index";

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

describe("buildSessionFuse / searchSessions", () => {
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
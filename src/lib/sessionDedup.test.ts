import { describe, it, expect } from "vitest";
import {
  sessionTabSetSignature,
  findDuplicateSession,
} from "./sessionDedup";
import type { SavedSession } from "../types/index";

const session = (
  id: string,
  urls: string[],
): SavedSession => ({
  id,
  name: id,
  savedAt: 1_000_000_000_000,
  tabs: urls.map((url) => ({ title: url, url, favIconUrl: "" })),
});

describe("sessionTabSetSignature", () => {
  it("is order-insensitive (restore may reorder tabs)", () => {
    expect(
      sessionTabSetSignature([{ url: "/a" }, { url: "/b" }, { url: "/c" }]),
    ).toBe(sessionTabSetSignature([{ url: "/c" }, { url: "/a" }, { url: "/b" }]));
  });

  it("is multiplicity-aware (3x same URL != 1x)", () => {
    expect(
      sessionTabSetSignature([{ url: "/a" }, { url: "/a" }, { url: "/a" }]),
    ).not.toBe(sessionTabSetSignature([{ url: "/a" }]));
  });

  it("drops missing/empty urls", () => {
    expect(
      sessionTabSetSignature([{ url: "/a" }, {}, { url: "" }]),
    ).toBe(sessionTabSetSignature([{ url: "/a" }]));
  });

  it("collapses to an empty signature for no urls", () => {
    expect(sessionTabSetSignature([])).toBe("");
  });
});

describe("findDuplicateSession", () => {
  it("returns the matching session when the tab-set exists", () => {
    const existing = [session("s1", ["/x", "/y"]), session("s2", ["/p"])];
    const dup = findDuplicateSession(existing, { tabs: [{ url: "/y" }, { url: "/x" }] });
    expect(dup?.id).toBe("s1");
  });

  it("returns undefined when the tab-set differs", () => {
    const existing = [session("s1", ["/x", "/y"])];
    expect(
      findDuplicateSession(existing, { tabs: [{ url: "/x" }, { url: "/z" }] }),
    ).toBeUndefined();
  });

  it("ignores title/favIcon differences — only urls identify a session", () => {
    const existing = [session("s1", ["/a"])];
    existing[0].tabs[0].title = "changed";
    const dup = findDuplicateSession(existing, {
      tabs: [{ url: "/a", title: "other", favIconUrl: "x" }],
    });
    expect(dup?.id).toBe("s1");
  });

  it("never matches an empty candidate", () => {
    const existing = [session("empty", [])];
    expect(findDuplicateSession(existing, { tabs: [] })).toBeUndefined();
    expect(findDuplicateSession(existing, { tabs: [{ url: "" }] })).toBeUndefined();
  });

  it("handles a restore of a session with duplicate urls", () => {
    const existing = [session("s1", ["/a", "/a"])];
    const dup = findDuplicateSession(existing, { tabs: [{ url: "/a" }, { url: "/a" }] });
    expect(dup?.id).toBe("s1");
  });
});
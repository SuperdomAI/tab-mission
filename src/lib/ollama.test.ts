import { describe, it, expect } from "vitest";
import { buildClassifyPrompt, parseRelevantIds } from "./ollama";

describe("buildClassifyPrompt", () => {
  it("includes the goal and every tab id/title/domain", () => {
    const p = buildClassifyPrompt("japan trip", [
      { id: 1, title: "Tokyo flights", domain: "google.com" },
      { id: 2, title: "AWS", domain: "aws.amazon.com" },
    ]);
    expect(p).toContain('Goal: "japan trip"');
    expect(p).toContain("1: Tokyo flights (google.com)");
    expect(p).toContain("2: AWS (aws.amazon.com)");
    expect(p).toMatch(/ONLY JSON/);
  });
});

describe("parseRelevantIds", () => {
  const valid = [1, 2, 3];
  it("parses {keep:[...]} JSON", () => {
    expect(parseRelevantIds('{"keep":[1,3]}', valid)).toEqual([1, 3]);
  });
  it("parses a bare array", () => {
    expect(parseRelevantIds("[2,3]", valid)).toEqual([2, 3]);
  });
  it("drops ids not in the valid set", () => {
    expect(parseRelevantIds('{"keep":[1,99]}', valid)).toEqual([1]);
  });
  it("falls back to extracting numbers from messy output", () => {
    expect(parseRelevantIds("keep tabs 2 and 3 please", valid)).toEqual([2, 3]);
  });
  it("returns [] on garbage", () => {
    expect(parseRelevantIds("no numbers here", valid)).toEqual([]);
  });
});

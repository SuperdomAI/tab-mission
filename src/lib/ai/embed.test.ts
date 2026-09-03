import { describe, it, expect } from "vitest";
import {
  cosineSimilarity,
  l2Normalize,
  topKSimilar,
  mergeSemanticFuse,
  COSINE_THRESHOLD,
} from "./embed";

describe("cosineSimilarity", () => {
  it("is 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 10);
  });

  it("is 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0, 10);
  });

  it("is -1 for opposite vectors", () => {
    expect(cosineSimilarity([1, 1], [-1, -1])).toBeCloseTo(-1, 10);
  });

  it("ignores magnitude (compares direction only)", () => {
    expect(cosineSimilarity([1, 0], [10, 0])).toBeCloseTo(1, 10);
  });

  it("returns 0 on empty or mismatched vectors", () => {
    expect(cosineSimilarity([], [])).toBe(0);
    expect(cosineSimilarity([1, 2], [1])).toBe(0);
  });
});

describe("l2Normalize", () => {
  it("returns unit vectors and does not mutate input", () => {
    const v = [3, 4];
    const out = l2Normalize(v);
    expect(out).toEqual([0.6, 0.8]);
    expect(v).toEqual([3, 4]);
  });

  it("returns a copy for zero vectors", () => {
    expect(l2Normalize([0, 0])).toEqual([0, 0]);
  });
});

describe("topKSimilar", () => {
  const vectors = new Map<number, number[]>([
    [1, [1, 0]],   // ~1.0
    [2, [0.5, 0.5]], // ~0.7
    [3, [0, 1]],   // 0
    [4, [-1, 0]],  // -1
  ]);

  it("returns matches above the threshold, best first", () => {
    const hits = topKSimilar([1, 0], vectors, 5);
    expect(hits.map((h) => h.id)).toEqual([1, 2]);
    expect(hits[0].score).toBeGreaterThan(hits[1].score);
  });

  it("respects the k limit", () => {
    const hits = topKSimilar([1, 0], vectors, 1);
    expect(hits).toHaveLength(1);
    expect(hits[0].id).toBe(1);
  });

  it("gates on an explicit threshold", () => {
    const hits = topKSimilar([1, 0], vectors, 5, 0.9);
    expect(hits.map((h) => h.id)).toEqual([1]);
  });

  it("exports the default threshold used by F7", () => {
    expect(COSINE_THRESHOLD).toBeCloseTo(0.32, 2);
  });

  it("returns [] when nothing clears the threshold", () => {
    expect(topKSimilar([0, -1], vectors, 5, 0.99)).toEqual([]);
  });
});

describe("mergeSemanticFuse", () => {
  it("ranks semantic hits first, then Fuse results", () => {
    const merged = mergeSemanticFuse(
      [{ id: 3, score: 0.9 }, { id: 1, score: 0.5 }],
      [5, 2],
    );
    expect(merged).toEqual([3, 1, 5, 2]);
  });

  it("dedupes ids present in both lists", () => {
    const merged = mergeSemanticFuse([{ id: 1, score: 0.8 }], [1, 2]);
    expect(merged).toEqual([1, 2]);
  });

  it("caps at the limit", () => {
    const merged = mergeSemanticFuse(
      [{ id: 1, score: 0.9 }, { id: 2, score: 0.8 }],
      [3, 4],
      2,
    );
    expect(merged).toEqual([1, 2]);
  });
});
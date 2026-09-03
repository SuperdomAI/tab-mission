import { describe, it, expect } from "vitest";
import { AiCache, MemoryCacheStore, TASK_TTL_MS } from "./cache";

const NOW = 1_000_000_000_000;
const SIGNATURE = "sig-v1";

describe("AiCache", () => {
  it("stores and returns a fresh entry", () => {
    const cache = new AiCache<string>();
    cache.set("debrief", SIGNATURE, "hello", "qwen2.5:7b", NOW);
    const entry = cache.get("debrief", SIGNATURE, "qwen2.5:7b", NOW);
    expect(entry?.result).toBe("hello");
    expect(entry?.model).toBe("qwen2.5:7b");
    expect(entry?.generatedAt).toBe(NOW);
  });

  it("keys are content-addressed: same task+signature → same key", () => {
    const cache = new AiCache<string>();
    expect(cache.key("debrief", SIGNATURE)).toBe(cache.key("debrief", SIGNATURE));
    expect(cache.key("debrief", SIGNATURE)).not.toBe(cache.key("debrief", "other"));
    expect(cache.key("debrief", SIGNATURE)).not.toBe(cache.key("triage", SIGNATURE));
  });

  it("misses when the signature changes", () => {
    const cache = new AiCache<string>();
    cache.set("triage", "sigA", "x", "model", NOW);
    expect(cache.get("triage", "sigB", "model", NOW)).toBeUndefined();
  });

  it("expires after the task TTL and drops the entry", () => {
    const cache = new AiCache<string>();
    const ttl = TASK_TTL_MS.triage;
    cache.set("triage", SIGNATURE, "x", "model", NOW);
    expect(cache.get("triage", SIGNATURE, "model", NOW + ttl)).toBeDefined();
    expect(cache.get("triage", SIGNATURE, "model", NOW + ttl + 1)).toBeUndefined();
    // expired entries are dropped, not just hidden
    const store = new MemoryCacheStore();
    const probe = new AiCache<string>(store);
    probe.set("triage", SIGNATURE, "x", "model", NOW);
    probe.get("triage", SIGNATURE, "model", NOW + ttl + 1);
    expect(store.get(probe.key("triage", SIGNATURE))).toBeUndefined();
  });

  it("rejects and drops entries produced by a different model", () => {
    const store = new MemoryCacheStore();
    const cache = new AiCache<string>(store);
    cache.set("embed", SIGNATURE, "x", "nomic-embed-text", NOW);
    expect(cache.get("embed", SIGNATURE, "other-model", NOW)).toBeUndefined();
    expect(store.get(cache.key("embed", SIGNATURE))).toBeUndefined();
  });

  it("applies the fallback TTL for unknown tasks", () => {
    const cache = new AiCache<string>();
    cache.set("mystery-task", SIGNATURE, "x", "m", NOW);
    expect(cache.get("mystery-task", SIGNATURE, "m", NOW + 60 * 60 * 1000)).toBeDefined();
    expect(cache.get("mystery-task", SIGNATURE, "m", NOW + 60 * 60 * 1000 + 1)).toBeUndefined();
  });

  it("honors a per-cache TTL override", () => {
    const cache = new AiCache<string>(undefined, { triage: 1000 });
    cache.set("triage", SIGNATURE, "x", "m", NOW);
    expect(cache.get("triage", SIGNATURE, "m", NOW + 1000)).toBeDefined();
    expect(cache.get("triage", SIGNATURE, "m", NOW + 1001)).toBeUndefined();
  });

  it("invalidates and clears", () => {
    const cache = new AiCache<string>();
    cache.set("triage", SIGNATURE, "x", "m", NOW);
    cache.set("triage", "other", "y", "m", NOW);
    cache.invalidate("triage", SIGNATURE);
    expect(cache.get("triage", SIGNATURE, "m", NOW)).toBeUndefined();
    expect(cache.get("triage", "other", "m", NOW)).toBeDefined();
    cache.clear();
    expect(cache.get("triage", "other", "m", NOW)).toBeUndefined();
  });

  it("round-trips non-string results through a shared backing store", () => {
    const shared = new MemoryCacheStore();
    const a = new AiCache<number[]>(shared);
    const b = new AiCache<number[]>(shared);
    a.set("embed", SIGNATURE, [0.1, 0.2], "nomic", NOW);
    expect(b.get("embed", SIGNATURE, "nomic", NOW)?.result).toEqual([0.1, 0.2]);
  });
});
/**
 * Content-addressed AI result cache.
 *
 * Key = `sha1(task + inputSignature)` — a signature comes from
 * `signatures.ts` and only changes when the inputs that produced a result
 * actually changed. The cache stores the raw result alongside when it was
 * generated and the model that produced it, so a result is rejected (and
 * dropped) when its TTL expires or the model is no longer the one in use
 * (e.g. the user switched embeddings).
 *
 * Synchronous by design: backing stores are injected, so the default is an
 * in-memory Map and storage-backed caches (the `aiReports` / `aiTriagePlan` /
 * `aiTabEmbeddings` keys in `chrome.storage.local`) can wrap the same
 * interface in later PRs.
 */

import { sha1Hex } from "./signatures";

export interface CacheEntry<T> {
  result: T;
  generatedAt: number;
  model: string;
}

/** Minimal KV surface a backing store must satisfy. */
export interface CacheStore {
  get(key: string): CacheEntry<unknown> | undefined;
  set(key: string, entry: CacheEntry<unknown>): void;
  delete(key: string): void;
  clear(): void;
}

/** In-memory default. */
export class MemoryCacheStore implements CacheStore {
  private entries = new Map<string, CacheEntry<unknown>>();

  get(key: string): CacheEntry<unknown> | undefined {
    return this.entries.get(key);
  }
  set(key: string, entry: CacheEntry<unknown>): void {
    this.entries.set(key, entry);
  }
  delete(key: string): void {
    this.entries.delete(key);
  }
  clear(): void {
    this.entries.clear();
  }
}

export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;

/** Fallback when a task has no explicit TTL. */
export const DEFAULT_TTL_MS = HOUR;

/**
 * Per-task TTLs. Every feature names its task so its cache shelf-life is
 * explicit; later PRs can tighten a single task without touching callers.
 */
export const TASK_TTL_MS: Record<string, number> = {
  debrief: 6 * HOUR,
  coach: 6 * HOUR,
  triage: HOUR,
  suggestions: 30 * 60 * 1000,
  sessionSummary: 30 * DAY,
  summarizePage: 7 * DAY,
  embed: DAY,
};

export class AiCache<T> {
  private store: CacheStore;
  private ttl: Record<string, number>;

  constructor(store: CacheStore = new MemoryCacheStore(), ttl: Record<string, number> = TASK_TTL_MS) {
    this.store = store;
    this.ttl = ttl;
  }

  /** Content-addressed key for a task + input signature. */
  key(task: string, signature: string): string {
    return sha1Hex(`${task}\n${signature}`);
  }

  /**
   * Fresh entry for this task/signature/model, or `undefined` when missing,
   * expired, or produced by a different model. Expired entries are dropped so
   * the store never accumulates dead weight.
   */
  get(
    task: string,
    signature: string,
    model: string,
    now: number = Date.now(),
  ): CacheEntry<T> | undefined {
    const key = this.key(task, signature);
    const entry = this.store.get(key) as CacheEntry<T> | undefined;
    if (!entry) return undefined;
    if (entry.model !== model) return undefined;
    if (now - entry.generatedAt > this.ttlFor(task)) {
      this.store.delete(key);
      return undefined;
    }
    return entry;
  }

  set(
    task: string,
    signature: string,
    result: T,
    model: string,
    now: number = Date.now(),
  ): CacheEntry<T> {
    const entry: CacheEntry<T> = { result, generatedAt: now, model };
    this.store.set(this.key(task, signature), entry as CacheEntry<unknown>);
    return entry;
  }

  invalidate(task: string, signature: string): void {
    this.store.delete(this.key(task, signature));
  }

  clear(): void {
    this.store.clear();
  }

  private ttlFor(task: string): number {
    return this.ttl[task] ?? DEFAULT_TTL_MS;
  }
}
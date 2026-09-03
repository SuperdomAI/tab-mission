/**
 * Embedding math for F7 semantic search: cosine similarity, top-k retrieval,
 * and the semantic+Fuse merge. All pure and tested; the network call itself
 * lives in `src/lib/ollama.ts` (`embed()` transport).
 */

export interface ScoredMatch {
  id: number;
  score: number;
}

/** Similarity threshold below which a semantic match is ignored. */
export const COSINE_THRESHOLD = 0.32;

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const mag = Math.sqrt(na) * Math.sqrt(nb);
  return mag === 0 ? 0 : dot / mag;
}

/** Normalize a vector to unit length (in place-free). */
export function l2Normalize(v: number[]): number[] {
  let sum = 0;
  for (const x of v) sum += x * x;
  const mag = Math.sqrt(sum);
  if (mag === 0) return v.slice();
  return v.map((x) => x / mag);
}

/**
 * The `k` vectors most similar to `query`, scored, sorted best-first. Only
 * matches at or above `threshold` are returned.
 */
export function topKSimilar(
  query: number[],
  vectors: Map<number, number[]>,
  k: number = 5,
  threshold: number = COSINE_THRESHOLD,
): ScoredMatch[] {
  const scored: ScoredMatch[] = [];
  for (const [id, vec] of vectors) {
    const score = cosineSimilarity(query, vec);
    if (score >= threshold) scored.push({ id, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

/**
 * Merge semantic hits (best-first) with Fuse results so semantic matches rank
 * first when they pass the threshold and Fuse fills the rest — deduped, then
 * capped at `limit`.
 */
export function mergeSemanticFuse(
  semantic: ScoredMatch[],
  fuse: number[],
  limit: number = 8,
): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const m of semantic) {
    if (!seen.has(m.id)) {
      seen.add(m.id);
      out.push(m.id);
    }
  }
  for (const id of fuse) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out.slice(0, limit);
}
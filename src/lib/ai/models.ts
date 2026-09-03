/**
 * Model registry + per-task resolution.
 *
 * Two text tiers (fast / chat) and one embedding tier, per
 * `docs/AI-FEATURES-PLAN.md` §2. Recommendations target 16 GB machines
 * (qwen2.5 7B + 3B + nomic-embed, ~6-7 GB resident) with an 8 GB fallback
 * tier. Resolution never blocks: an installed model that is not in the
 * registry is accepted as-is for every text tier, and an empty model set
 * resolves to the default recommendation (the Settings UI surfaces `ollama
 * pull` hints for those).
 */

export type AITask = "fast" | "chat" | "embed";
export type TextTask = Exclude<AITask, "embed">;

export interface ModelProfile {
  /** Classification / triage / suggestions. */
  fast: string;
  /** Summaries, reports, coach. */
  chat: string;
  /** Semantic search embeddings. */
  embed: string;
}

export interface ModelRecommendation {
  ram: 16 | 8;
  profile: ModelProfile;
  hint: string;
}

export const RECOMMENDATIONS: ModelRecommendation[] = [
  {
    ram: 16,
    profile: {
      fast: "qwen2.5:3b-instruct-q4_K_M",
      chat: "qwen2.5:7b-instruct-q4_K_M",
      embed: "nomic-embed-text",
    },
    hint: "qwen2.5 7B (chat) + 3B (fast) + nomic-embed-text — fits comfortably on 16 GB.",
  },
  {
    ram: 8,
    profile: {
      fast: "qwen2.5:1.5b",
      chat: "gemma3:4b-instruct-q4_K_M",
      embed: "nomic-embed-text",
    },
    hint: "gemma3 4B (chat) + qwen2.5 1.5B (fast) — the 8 GB fallback tier.",
  },
];

/** The 16 GB stack is the default when nothing is installed yet. */
export const DEFAULT_PROFILE: ModelProfile = RECOMMENDATIONS[0].profile;

/** Suggested context windows: small for fast tasks, larger for prose. */
export const NUM_CTX: Record<TextTask, number> = {
  fast: 4096,
  chat: 8192,
};

/** The single acceptable embed model (a fixed dimension contract). */
export const DEFAULT_EMBED_MODEL = DEFAULT_PROFILE.embed;

function allModelsFor(task: AITask): string[] {
  const set = new Set<string>();
  for (const rec of RECOMMENDATIONS) {
    set.add(rec.profile[task]);
  }
  return Array.from(set);
}

/** The recommended profile for a machine's RAM, defaulting to 16 GB. */
export function recommendedProfile(ramGb?: number): ModelProfile {
  const tier = ramGb && ramGb < 16 ? 8 : 16;
  return RECOMMENDATIONS.find((r) => r.ram === tier)!.profile;
}

/**
 * Resolve the model for a text tier.
 *
 * Order of preference:
 *  1. the RAM-tier recommended model, if installed;
 *  2. any registry model for this tier that is installed;
 *  3. the first installed model (unknown models are used as-is for every
 *     text tier — never block, never log);
 *  4. the default recommendation (nothing installed → Settings prompts for
 *     `ollama pull`).
 */
export function resolveModel(
  task: TextTask,
  installed: string[],
  ramGb?: number,
): string {
  if (installed.length === 0) return recommendedProfile(ramGb)[task];
  const rec = recommendedProfile(ramGb);
  if (installed.includes(rec[task])) return rec[task];
  const tierModels = allModelsFor(task);
  const match = installed.find((m) => tierModels.includes(m));
  return match ?? installed[0];
}

/** Resolve the embedding model — prefer the registry's embed, else anything. */
export function resolveEmbedModel(installed: string[]): string {
  if (installed.length === 0) return DEFAULT_EMBED_MODEL;
  if (installed.includes(DEFAULT_EMBED_MODEL)) return DEFAULT_EMBED_MODEL;
  return installed[0];
}

/** True when a model is one of the recommended tags (used for settings hints). */
export function isRecommendedModel(model: string): boolean {
  const all = new Set(allModelsFor("fast").concat(allModelsFor("chat"), allModelsFor("embed")));
  return all.has(model);
}
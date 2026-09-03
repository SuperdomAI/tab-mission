import { describe, it, expect } from "vitest";
import {
  RECOMMENDATIONS,
  DEFAULT_PROFILE,
  DEFAULT_EMBED_MODEL,
  NUM_CTX,
  recommendedProfile,
  resolveModel,
  resolveEmbedModel,
  isRecommendedModel,
  pickMissingModels,
} from "./models";
import { DEFAULT_SETTINGS } from "../../types/index";

describe("recommendedProfile", () => {
  it("defaults to the 16 GB tier", () => {
    expect(recommendedProfile()).toEqual(RECOMMENDATIONS[0].profile);
    expect(recommendedProfile(32)).toEqual(RECOMMENDATIONS[0].profile);
  });

  it("picks the 8 GB tier below 16 GB", () => {
    expect(recommendedProfile(8)).toEqual(RECOMMENDATIONS[1].profile);
    expect(recommendedProfile(4)).toEqual(RECOMMENDATIONS[1].profile);
  });

  it("matches the settings defaults (single source of truth)", () => {
    expect(DEFAULT_PROFILE.chat).toBe(DEFAULT_SETTINGS.aiChatModel);
    expect(DEFAULT_PROFILE.fast).toBe(DEFAULT_SETTINGS.aiFastModel);
    expect(DEFAULT_PROFILE.embed).toBe(DEFAULT_SETTINGS.aiEmbedModel);
    // legacy single-model setting preserved for existing AskAI/Focus flows
    expect(DEFAULT_SETTINGS.ollamaModel).toBe("llama3.2");
  });
});

describe("resolveModel", () => {
  const installed = ["qwen3:8b", "qwen2.5:3b-instruct-q4_K_M"];

  it("prefers the RAM-tier recommended model when installed", () => {
    expect(resolveModel("chat", installed, 16)).toBe("qwen3:8b");
    expect(resolveModel("fast", installed, 16)).toBe("qwen2.5:3b-instruct-q4_K_M");
  });

  it("falls back to the 8 GB tier when the 16 GB chat model is absent", () => {
    const onlyFast = ["qwen2.5:3b-instruct-q4_K_M"];
    expect(resolveModel("chat", onlyFast, 16)).toBe("qwen2.5:3b-instruct-q4_K_M");
    const gemmaOnly = ["gemma3:4b-instruct-q4_K_M"];
    expect(resolveModel("chat", gemmaOnly, 8)).toBe("gemma3:4b-instruct-q4_K_M");
  });

  it("uses an unknown installed model as-is for every tier (never blocks)", () => {
    expect(resolveModel("chat", ["mistral"])).toBe("mistral");
    expect(resolveModel("fast", ["mistral"])).toBe("mistral");
  });

  it("returns the default recommendation when nothing is installed", () => {
    expect(resolveModel("chat", [])).toBe(recommendedProfile(16).chat);
    expect(resolveModel("fast", [], 8)).toBe(recommendedProfile(8).fast);
  });
});

describe("resolveEmbedModel", () => {
  it("prefers nomic-embed-text when installed", () => {
    expect(resolveEmbedModel(["nomic-embed-text", "mistral"])).toBe("nomic-embed-text");
  });

  it("falls back to any installed model", () => {
    expect(resolveEmbedModel(["mistral"])).toBe("mistral");
  });

  it("defaults to the registry embed when nothing is installed", () => {
    expect(resolveEmbedModel([])).toBe(DEFAULT_EMBED_MODEL);
  });
});

describe("isRecommendedModel / NUM_CTX", () => {
  it("recognizes every recommended tag", () => {
    for (const rec of RECOMMENDATIONS) {
      expect(isRecommendedModel(rec.profile.chat)).toBe(true);
      expect(isRecommendedModel(rec.profile.fast)).toBe(true);
      expect(isRecommendedModel(rec.profile.embed)).toBe(true);
    }
    expect(isRecommendedModel("mistral")).toBe(false);
  });

  it("keeps fast contexts small and chat contexts larger", () => {
    expect(NUM_CTX.fast).toBeLessThan(NUM_CTX.chat);
  });

  it("locks the plan's suggested context windows", () => {
    expect(NUM_CTX.fast).toBe(4096);
    expect(NUM_CTX.chat).toBe(8192);
  });
});

describe("pickMissingModels", () => {
  const defaults = { ...DEFAULT_PROFILE };

  it("keeps a profile when nothing is installed", () => {
    expect(pickMissingModels(defaults, [])).toEqual(defaults);
  });

  it("keeps tiers the user already chose when installed", () => {
    const current = {
      fast: "mistral",
      chat: "qwen2.5:7b-instruct-q4_K_M",
      embed: "nomic-embed-text",
    };
    expect(pickMissingModels(current, ["mistral", "qwen2.5:7b-instruct-q4_K_M", "nomic-embed-text"])).toEqual(current);
  });

  it("fills only the tiers that are not installed", () => {
    const installed = ["gemma3:4b-instruct-q4_K_M"];
    const picked = pickMissingModels(defaults, installed);
    expect(picked.fast).toBe("gemma3:4b-instruct-q4_K_M"); // no fast model installed → first installed
    expect(picked.chat).toBe("gemma3:4b-instruct-q4_K_M"); // the 8 GB chat recommendation
    expect(picked.embed).toBe("gemma3:4b-instruct-q4_K_M"); // embed falls back to any installed
  });

  it("never picks an uninstalled model", () => {
    const picked = pickMissingModels(defaults, ["mistral"]);
    expect(["mistral"]).toContain(picked.fast);
    expect(["mistral"]).toContain(picked.chat);
    expect(["mistral"]).toContain(picked.embed);
  });
});
import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS, mergeSettings } from "./index";

describe("mergeSettings", () => {
  it("returns full defaults for undefined stored settings", () => {
    expect(mergeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it("fills AI fields for settings saved by older versions", () => {
    const legacy = {
      theme: "light",
      ollamaEnabled: true,
      ollamaModel: "mistral",
    } as const;
    const merged = mergeSettings(legacy);
    expect(merged.theme).toBe("light");
    expect(merged.ollamaModel).toBe("mistral");
    expect(merged.aiDebrief).toBe(true);
    expect(merged.aiPageReadingEnabled).toBe(false);
  });

  it("carries a user-chosen legacy ollamaModel into aiChatModel once", () => {
    const merged = mergeSettings({ ollamaModel: "mistral" });
    expect(merged.aiChatModel).toBe("mistral");
  });

  it("does not carry the legacy default model over", () => {
    const merged = mergeSettings({ ollamaModel: "llama3.2" });
    expect(merged.aiChatModel).toBe(DEFAULT_SETTINGS.aiChatModel);
  });

  it("never overwrites an explicitly set aiChatModel", () => {
    const merged = mergeSettings({ ollamaModel: "mistral", aiChatModel: "custom" });
    expect(merged.aiChatModel).toBe("custom");
  });

  it("lets stored values override defaults", () => {
    const merged = mergeSettings({ aiChatModel: "custom", aiIdleDrafts: false });
    expect(merged.aiChatModel).toBe("custom");
    expect(merged.aiIdleDrafts).toBe(false);
    expect(merged.aiFastModel).toBe(DEFAULT_SETTINGS.aiFastModel);
  });
});
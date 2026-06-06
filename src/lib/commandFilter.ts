import Fuse from "fuse.js";
import type { EnrichedTab } from "../types/index";

/** Single Fuse config for tab search — used only here (no duplicate configs). */
export function buildTabFuse(tabs: EnrichedTab[]): Fuse<EnrichedTab> {
  return new Fuse(tabs, {
    keys: [
      { name: "title", weight: 0.6 },
      { name: "url", weight: 0.2 },
      { name: "domain", weight: 0.2 },
    ],
    threshold: 0.35,
    ignoreLocation: true,
  });
}

export function searchTabs(
  fuse: Fuse<EnrichedTab>,
  query: string,
  limit = 8,
): EnrichedTab[] {
  if (!query.trim()) return [];
  return fuse.search(query).slice(0, limit).map((r) => r.item);
}

export interface PaletteCommand {
  id: string;
  label: string;
  hint?: string;
  keywords?: string[];
  run: () => void;
}

export function filterCommands(
  commands: PaletteCommand[],
  query: string,
): PaletteCommand[] {
  if (!query.trim()) return commands;
  const q = query.toLowerCase();
  return commands.filter(
    (c) =>
      c.label.toLowerCase().includes(q) ||
      c.keywords?.some((k) => k.toLowerCase().includes(q)),
  );
}

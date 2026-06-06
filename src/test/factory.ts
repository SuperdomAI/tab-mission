import type { EnrichedTab } from "../types/index";

let nextId = 1;

/** Build an EnrichedTab with sensible defaults; override any field per test. */
export function makeTab(overrides: Partial<EnrichedTab> = {}): EnrichedTab {
  const id = overrides.id ?? nextId++;
  return {
    id,
    windowId: 1,
    url: `https://example.com/${id}`,
    title: `Tab ${id}`,
    favIconUrl: "",
    domain: "example.com",
    openedAt: 0,
    lastActiveAt: null,
    totalActiveTime: 0,
    visitCount: 1,
    isVisited: true,
    isPinned: false,
    groupId: null,
    groupName: null,
    groupColor: null,
    isHibernated: false,
    tags: [],
    ...overrides,
  };
}

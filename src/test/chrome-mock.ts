import { vi } from "vitest";

/**
 * Minimal in-memory `chrome.*` test double. Enough for the UI layer:
 * tabs (remove/discard/update/query), windows (update/create), storage
 * (local/sync get/set + onChanged), tabGroups constant, runtime.getURL.
 *
 * Each method is a vi.fn so tests can assert call args (e.g. that
 * `tabs.remove` was called once with an ARRAY of ids, not N times).
 */
export interface ChromeMock {
  tabs: {
    remove: ReturnType<typeof vi.fn>;
    discard: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    query: ReturnType<typeof vi.fn>;
  };
  windows: {
    update: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    WINDOW_ID_NONE: number;
  };
  storage: {
    local: { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> };
    sync: { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> };
    onChanged: {
      addListener: ReturnType<typeof vi.fn>;
      removeListener: ReturnType<typeof vi.fn>;
    };
  };
  tabGroups: { TAB_GROUP_ID_NONE: number };
  runtime: { getURL: (p: string) => string; id: string };
}

export function makeChromeMock(): ChromeMock {
  return {
    tabs: {
      remove: vi.fn().mockResolvedValue(undefined),
      // chrome.tabs.discard resolves with the discarded Tab (or rejects).
      discard: vi.fn().mockImplementation((id: number) =>
        Promise.resolve({ id, discarded: true }),
      ),
      update: vi.fn().mockResolvedValue({}),
      query: vi.fn().mockResolvedValue([]),
    },
    windows: {
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({ id: 1 }),
      WINDOW_ID_NONE: -1,
    },
    storage: {
      local: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn().mockResolvedValue(undefined),
      },
      sync: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn().mockResolvedValue(undefined),
      },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    tabGroups: { TAB_GROUP_ID_NONE: -1 },
    runtime: {
      getURL: (p: string) => `chrome-extension://test-ext-id${p}`,
      id: "test-ext-id",
    },
  };
}

export function installChromeMock(): ChromeMock {
  const mock = makeChromeMock();
  (globalThis as unknown as { chrome: ChromeMock }).chrome = mock;
  return mock;
}

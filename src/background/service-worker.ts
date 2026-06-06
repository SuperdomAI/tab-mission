import type { EnrichedTab, DailyAnalytics, SavedSession } from "../types/index";

// ─── Ollama proxy (optional local AI) ────────────────────────────────────────
// Calls from the new-tab PAGE send `Origin: chrome-extension://…`, which
// Ollama's CORS gate rejects with 403. Proxying through the background (no web
// origin attached) makes the request succeed. Requires the optional localhost
// host permission, granted when the user enables AI in Settings.
chrome.runtime.onMessage.addListener(
  (msg: { type?: string; path?: string; init?: { method?: string; body?: string } }, _sender, sendResponse) => {
    if (msg?.type !== "ollama-fetch") return;
    (async () => {
      try {
        const r = await fetch(`http://localhost:11434${msg.path ?? ""}`, {
          method: msg.init?.method ?? "GET",
          headers: msg.init?.body ? { "Content-Type": "application/json" } : undefined,
          body: msg.init?.body,
        });
        sendResponse({ ok: r.ok, status: r.status, body: await r.text() });
      } catch (e) {
        sendResponse({ ok: false, status: 0, body: String(e) });
      }
    })();
    return true; // keep the message channel open for the async response
  },
);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractDomain(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    return hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function isValidTab(url: string | undefined): boolean {
  if (!url) return false;
  return (
    !url.startsWith("chrome://") &&
    !url.startsWith("chrome-extension://") &&
    !url.startsWith("about:") &&
    !url.startsWith("edge://") &&
    !url.startsWith("devtools://")
  );
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

// ─── Storage helpers ──────────────────────────────────────────────────────────

async function getTabs(): Promise<EnrichedTab[]> {
  try {
    const result = await chrome.storage.local.get("tabs");
    return (result.tabs as EnrichedTab[]) || [];
  } catch {
    return [];
  }
}

async function setTabs(tabs: EnrichedTab[]): Promise<void> {
  try {
    await chrome.storage.local.set({ tabs });
  } catch (e) {
    console.error("[TMC] setTabs error:", e);
  }
}

async function getAnalytics(): Promise<DailyAnalytics[]> {
  try {
    const result = await chrome.storage.local.get("analytics");
    return (result.analytics as DailyAnalytics[]) || [];
  } catch {
    return [];
  }
}

async function updateToday(
  updater: (day: DailyAnalytics) => DailyAnalytics,
): Promise<void> {
  try {
    const analytics = await getAnalytics();
    const key = todayKey();
    const idx = analytics.findIndex((d) => d.date === key);
    const today: DailyAnalytics =
      idx >= 0
        ? analytics[idx]
        : {
            date: key,
            totalTabsOpened: 0,
            totalTabsClosed: 0,
            peakTabCount: 0,
            domainTime: {},
            distractionDomains: [],
            tabDebtScore: 0,
          };
    const updated = updater(today);
    if (idx >= 0) {
      analytics[idx] = updated;
    } else {
      analytics.push(updated);
    }
    // keep last 30 days
    const trimmed = analytics.slice(-30);
    await chrome.storage.local.set({ analytics: trimmed });
  } catch (e) {
    console.error("[TMC] updateToday error:", e);
  }
}

// ─── Active timing state ──────────────────────────────────────────────────────

let activeTabId: number | null = null;
let activeWindowId: number | null = null;
let activationTime: number | null = null;
let windowFocused = true;
let userIdle = false;

async function flushActiveTime(): Promise<void> {
  if (activeTabId === null || activationTime === null) return;
  if (!windowFocused || userIdle) return;

  const elapsed = Date.now() - activationTime;
  if (elapsed <= 0) return;

  activationTime = Date.now();

  const tabs = await getTabs();
  const idx = tabs.findIndex((t) => t.id === activeTabId);
  if (idx < 0) return;

  const tab = tabs[idx];
  tab.totalActiveTime += elapsed;

  // accumulate domain time in analytics
  await updateToday((day) => {
    const domainTime = { ...day.domainTime };
    domainTime[tab.domain] = (domainTime[tab.domain] || 0) + elapsed;
    return { ...day, domainTime };
  });

  tabs[idx] = tab;
  await setTabs(tabs);
}

// ─── Tab events ───────────────────────────────────────────────────────────────

chrome.tabs.onCreated.addListener(async (tab) => {
  if (!isValidTab(tab.url)) return;

  const tabs = await getTabs();
  const newTab: EnrichedTab = {
    id: tab.id!,
    windowId: tab.windowId,
    url: tab.url || "",
    title: tab.title || "Loading...",
    favIconUrl: tab.favIconUrl || "",
    domain: extractDomain(tab.url || ""),
    openedAt: Date.now(),
    lastActiveAt: null,
    totalActiveTime: 0,
    visitCount: 0,
    isVisited: false,
    isPinned: tab.pinned,
    groupId:
      tab.groupId && tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE
        ? tab.groupId
        : null,
    groupName: null,
    groupColor: null,
    isHibernated: false,
    tags: [],
  };

  tabs.push(newTab);
  await setTabs(tabs);

  await updateToday((day) => ({
    ...day,
    totalTabsOpened: day.totalTabsOpened + 1,
  }));
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  if (tabId === activeTabId) {
    await flushActiveTime();
    activeTabId = null;
    activationTime = null;
  }

  const tabs = await getTabs();
  const filtered = tabs.filter((t) => t.id !== tabId);
  await setTabs(filtered);

  await updateToday((day) => ({
    ...day,
    totalTabsClosed: day.totalTabsClosed + 1,
    tabDebtScore: filtered.length,
  }));
});

chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  // flush time for previously active tab
  await flushActiveTime();

  activeTabId = tabId;
  activeWindowId = windowId;
  activationTime = windowFocused && !userIdle ? Date.now() : null;

  const tabs = await getTabs();
  const idx = tabs.findIndex((t) => t.id === tabId);
  if (idx < 0) return;

  tabs[idx] = {
    ...tabs[idx],
    lastActiveAt: Date.now(),
    visitCount: tabs[idx].visitCount + 1,
    isVisited: true,
  };
  await setTabs(tabs);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!changeInfo.url && !changeInfo.title && !changeInfo.favIconUrl) return;

  const tabs = await getTabs();
  const idx = tabs.findIndex((t) => t.id === tabId);
  if (idx < 0) {
    // Tab might not be tracked yet — add it if valid
    if (isValidTab(tab.url)) {
      const newTab: EnrichedTab = {
        id: tab.id!,
        windowId: tab.windowId,
        url: tab.url || "",
        title: tab.title || "",
        favIconUrl: tab.favIconUrl || "",
        domain: extractDomain(tab.url || ""),
        openedAt: Date.now(),
        lastActiveAt: null,
        totalActiveTime: 0,
        visitCount: 0,
        isVisited: false,
        isPinned: tab.pinned,
        groupId:
          tab.groupId && tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE
            ? tab.groupId
            : null,
        groupName: null,
        groupColor: null,
        isHibernated: false,
        tags: [],
      };
      tabs.push(newTab);
      await setTabs(tabs);
    }
    return;
  }

  const updated = { ...tabs[idx] };
  if (changeInfo.url && isValidTab(changeInfo.url)) {
    updated.url = changeInfo.url;
    updated.domain = extractDomain(changeInfo.url);
  } else if (changeInfo.url && !isValidTab(changeInfo.url)) {
    // navigated to invalid URL — remove tab
    const filtered = tabs.filter((t) => t.id !== tabId);
    await setTabs(filtered);
    return;
  }
  if (changeInfo.title) updated.title = changeInfo.title;
  if (changeInfo.favIconUrl) updated.favIconUrl = changeInfo.favIconUrl;

  tabs[idx] = updated;
  await setTabs(tabs);
});

// ─── Window focus ─────────────────────────────────────────────────────────────

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    // window lost focus
    await flushActiveTime();
    windowFocused = false;
    activationTime = null;
  } else {
    windowFocused = true;
    activeWindowId = windowId;
    if (activeTabId !== null && !userIdle) {
      activationTime = Date.now();
    }
  }
});

// ─── Window removed → auto-save session ──────────────────────────────────────

chrome.windows.onRemoved.addListener(async (windowId) => {
  try {
    const tabs = await getTabs();
    const windowTabs = tabs.filter((t) => t.windowId === windowId);
    if (windowTabs.length === 0) return;

    const result = (await chrome.storage.local.get("sessions")) as {
      sessions?: SavedSession[];
    };
    const sessions: SavedSession[] = result.sessions ?? [];
    const newSession: SavedSession = {
      id: `auto-${Date.now()}`,
      name: `Auto-save: ${new Date().toLocaleString()}`,
      savedAt: Date.now(),
      tabs: windowTabs.map((t) => ({
        title: t.title,
        url: t.url,
        favIconUrl: t.favIconUrl,
      })),
    };
    sessions.push(newSession);
    await chrome.storage.local.set({ sessions: sessions.slice(-50) });
  } catch (e) {
    console.error("[TMC] auto-save session error:", e);
  }
});

// ─── Idle detection ───────────────────────────────────────────────────────────

chrome.idle.setDetectionInterval(60);

chrome.idle.onStateChanged.addListener(async (state) => {
  if (state === "idle" || state === "locked") {
    await flushActiveTime();
    userIdle = true;
    activationTime = null;
  } else {
    userIdle = false;
    if (activeTabId !== null && windowFocused) {
      activationTime = Date.now();
    }
  }
});

// ─── Periodic snapshot alarm ──────────────────────────────────────────────────

chrome.alarms.create("peakTabSnapshot", { periodInMinutes: 1 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "peakTabSnapshot") {
    await flushActiveTime();
    try {
      const allTabs = await chrome.tabs.query({});
      const validCount = allTabs.filter((t) => isValidTab(t.url)).length;
      await updateToday((day) => ({
        ...day,
        peakTabCount: Math.max(day.peakTabCount, validCount),
        tabDebtScore: validCount,
      }));
    } catch (e) {
      console.error("[TMC] peak snapshot error:", e);
    }
  }
});

// ─── Sync existing tabs on startup ───────────────────────────────────────────

async function syncExistingTabs(): Promise<void> {
  try {
    const chromeTabs = await chrome.tabs.query({});
    const stored = await getTabs();
    const storedIds = new Set(stored.map((t) => t.id));

    const toAdd: EnrichedTab[] = [];
    for (const tab of chromeTabs) {
      if (!isValidTab(tab.url)) continue;
      if (storedIds.has(tab.id!)) continue;

      toAdd.push({
        id: tab.id!,
        windowId: tab.windowId,
        url: tab.url || "",
        title: tab.title || "",
        favIconUrl: tab.favIconUrl || "",
        domain: extractDomain(tab.url || ""),
        openedAt: Date.now(),
        lastActiveAt: null,
        totalActiveTime: 0,
        visitCount: 0,
        isVisited: false,
        isPinned: tab.pinned,
        groupId:
          tab.groupId && tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE
            ? tab.groupId
            : null,
        groupName: null,
        groupColor: null,
        isHibernated: !!tab.discarded,
        tags: [],
      });
    }

    // Remove stale tab entries
    const liveIds = new Set(chromeTabs.map((t) => t.id!));
    const cleaned = stored.filter((t) => liveIds.has(t.id));

    const merged = [...cleaned, ...toAdd];
    await setTabs(merged);
  } catch (e) {
    console.error("[TMC] syncExistingTabs error:", e);
  }
}

syncExistingTabs();

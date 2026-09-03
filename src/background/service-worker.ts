import type {
  AppSettings,
  EnrichedTab,
  DailyAnalytics,
  SavedSession,
} from "../types/index";
import { mergeSettings } from "../types/index";
import { withTabsLock } from "./tabsLock";
import { generate } from "../lib/ollama";
import { streamOllamaFetch } from "../lib/ollama";
import { buildTriagePrompt } from "../lib/ai/prompts";
import { tabSetSignature } from "../lib/ai/signatures";
import {
  AI_TRIAGE_KEY,
  coerceTriagePlan,
  parseTriagePlan,
  triageCandidates,
} from "../lib/ai/triage";
import { summarizeSession } from "../lib/ai/sessionMemory";
import { findDuplicateSession } from "../lib/sessionDedup";

// ─── Ollama CORS: strip the Origin header for localhost:11434 ────────────────
// Chrome attaches `Origin: chrome-extension://<id>` to extension requests, and
// Ollama's CORS gate 403s any origin not in OLLAMA_ORIGINS. Removing the Origin
// header makes Ollama treat it as a normal (non-browser) request — so it works
// regardless of which Ollama instance / origins config is running. Scoped to
// localhost; only active where we hold the optional host permission.
const OLLAMA_DNR_RULE_ID = 4711;
async function setupOllamaCors() {
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [OLLAMA_DNR_RULE_ID],
      addRules: [
        {
          id: OLLAMA_DNR_RULE_ID,
          priority: 1,
          action: {
            type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
            requestHeaders: [
              {
                header: "Origin",
                operation: chrome.declarativeNetRequest.HeaderOperation.REMOVE,
              },
            ],
          },
          condition: {
            requestDomains: ["localhost", "127.0.0.1"],
            resourceTypes: [
              chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST,
            ],
          },
        },
      ],
    });
  } catch (e) {
    console.error("[TMC] Ollama CORS rule setup error:", e);
  }
}
setupOllamaCors();

// ─── Ollama proxy (optional local AI) ────────────────────────────────────────
// The page client proxies fetches through here so the response is readable
// without page-context CORS; combined with the Origin-strip rule above, calls
// to a local Ollama succeed. Requires the optional localhost host permission.
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

// ─── Ollama streaming proxy (Ask AI sidebar) ─────────────────────────────────
// The page opens a port named "ollama-stream" and posts one `stream-request`;
// we forward each NDJSON line of the streamed `/api/chat` response back to
// the port. An open port keeps the MV3 worker alive for the duration of the
// stream, so the incremental response is never cut short.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "ollama-stream") return;
  port.onMessage.addListener(
    (msg: { type?: string; path?: string; init?: { method?: string; body?: string } }) => {
      if (msg?.type !== "stream-request") return;
      void streamOllamaFetch(port, msg.path ?? "/api/chat", msg.init);
    },
  );
});

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

// ─── Tab storage mutex ────────────────────────────────────────────────────────
// Every handler below does an async read-modify-write of the whole `tabs`
// array. Chrome fires several tab events near-simultaneously (closing a tab
// fires onRemoved + onActivated together), and without serialization two
// in-flight handlers interleave on the awaits — a stale full-array write can
// resurrect a just-closed tab in storage (UI shows ghosts) until the next
// worker wake runs syncExistingTabs(). Chain all tab mutations through this
// lock so each handler sees the latest committed array.
// (Implementation lives in ./tabsLock.ts so it can be unit-tested.)

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

chrome.tabs.onCreated.addListener((tab) =>
  withTabsLock(async () => {
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
  }),
);

chrome.tabs.onRemoved.addListener((tabId) =>
  withTabsLock(async () => {
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
  }),
);

chrome.tabs.onActivated.addListener(({ tabId, windowId }) =>
  withTabsLock(async () => {
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
  }),
);

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) =>
  withTabsLock(async () => {
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
  }),
);

// ─── Window focus ─────────────────────────────────────────────────────────────

chrome.windows.onFocusChanged.addListener((windowId) =>
  withTabsLock(async () => {
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
  }),
);

// ─── Window removed → auto-save session ──────────────────────────────────────

chrome.windows.onRemoved.addListener((windowId) =>
  withTabsLock(async () => {
    try {
      const tabs = await getTabs();
      const windowTabs = tabs.filter((t) => t.windowId === windowId);
      if (windowTabs.length === 0) return;

      const result = (await chrome.storage.local.get("sessions")) as {
        sessions?: SavedSession[];
      };
      const sessions: SavedSession[] = result.sessions ?? [];
      // Restore-then-autosave dedup: a window opened by `restoreSession` is
      // re-created from a session snapshot, so closing it later would auto-
      // save a near-identical session. Skip when the exact tab-set exists.
      const dup = findDuplicateSession(sessions, { tabs: windowTabs });
      if (dup) {
        console.log(
          `[TMC] auto-save skipped — duplicate of session ${dup.id}`,
        );
        return;
      }
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
      // F4 — fire-and-forget AI summary for the auto-saved session
      // (best-effort, never awaited — MV3 may kill the SW mid-generation;
      // the UI's on-demand summaries always work). The SW fetch direct-
      // fetches Ollama, so no CORS/proxy concern.
      void summarizeSession(newSession);
    } catch (e) {
      console.error("[TMC] auto-save session error:", e);
    }
  }),
);

// ─── Idle detection ───────────────────────────────────────────────────────────

chrome.idle.setDetectionInterval(60);

chrome.idle.onStateChanged.addListener((state) =>
  withTabsLock(async () => {
    if (state === "idle" || state === "locked") {
      await flushActiveTime();
      userIdle = true;
      activationTime = null;
      // F12 — best-effort triage draft while the machine is idle (below).
      const tabs = await getTabs();
      void draftIdleTriage(tabs);
    } else {
      userIdle = false;
      if (activeTabId !== null && windowFocused) {
        activationTime = Date.now();
      }
    }
  }),
);

// ─── F12 idle-time triage drafts ─────────────────────────────────────────────
// On idle, if AI is on and the open tab set changed since the last draft,
// generate a triage plan in the background and store it under `aiTriagePlan`
// with source "idle". Fire-and-forget — never awaited, never wakes the worker
// deliberately (MV3 may kill it mid-generation; the on-demand triage path in
// the UI always works). The signature check is the retry-storm guard.
async function draftIdleTriage(tabs: EnrichedTab[]): Promise<void> {
  try {
    const [settingsRes, planRes] = await Promise.all([
      chrome.storage.sync.get("settings"),
      chrome.storage.local.get(AI_TRIAGE_KEY),
    ]);
    const settings = mergeSettings(settingsRes.settings as AppSettings | undefined);
    if (!settings.ollamaEnabled || !settings.aiTriage || !settings.aiIdleDrafts) {
      return;
    }
    if (tabs.length < 8) return;
    const candidates = triageCandidates(tabs, settings);
    if (candidates.length === 0) return;
    const signature = tabSetSignature(candidates);
    const existing = coerceTriagePlan(planRes[AI_TRIAGE_KEY]);
    if (existing?.signature === signature) return; // same tab set — no draft
    const model = settings.aiFastModel;
    const text = await generate(buildTriagePrompt(candidates), model, "fast");
    const items = parseTriagePlan(text, candidates.map((t) => t.id));
    if (!items) return;
    await chrome.storage.local.set({
      [AI_TRIAGE_KEY]: {
        signature,
        items,
        generatedAt: Date.now(),
        source: "idle",
        model,
      },
    });
  } catch (e) {
    console.error("[TMC] idle triage draft error:", e);
  }
}

// ─── Periodic snapshot alarm ──────────────────────────────────────────────────

chrome.alarms.create("peakTabSnapshot", { periodInMinutes: 1 });

chrome.alarms.onAlarm.addListener((alarm) =>
  withTabsLock(async () => {
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
  }),
);

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

withTabsLock(syncExistingTabs);

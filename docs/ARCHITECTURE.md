# Architecture & Technical Reference

A deep-dive into how Tab Mission is built — data model, data flow, component responsibilities, storage schema, and key implementation decisions.

> **Source of truth:** when this document and the code disagree, the code wins. `src/types/index.ts` is authoritative for the data model.

---

## 1. High-Level Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Chrome Browser                        │
│                                                         │
│  ┌──────────────────────┐   ┌───────────────────────┐  │
│  │  Background           │   │  New Tab Page (React) │  │
│  │  Service Worker       │   │                       │  │
│  │                       │   │  ┌─────────────────┐  │  │
│  │  chrome.tabs.*   ────────────▶  Zustand Stores  │  │  │
│  │  chrome.windows.* ◀──────────  (tabStore /      │  │  │
│  │  chrome.idle.*        │   │  │  analyticsStore) │  │  │
│  │  chrome.alarms.*      │   │  └────────┬────────┘  │  │
│  │                       │   │           │            │  │
│  │  chrome.storage.local │   │     React Components  │  │
│  │  (single source of    │◀──────────────────────────│  │
│  │   truth)              │   │                       │  │
│  └──────────────────────┘   └───────────────────────┘  │
│                                                         │
│              chrome.storage.onChanged                   │
│          (real-time sync: background → UI)              │
└─────────────────────────────────────────────────────────┘
```

**Rule:** The background service worker **writes** to `chrome.storage.local`. The UI **reads** from it and listens for changes via `chrome.storage.onChanged`. The stores are a reflection of storage — not the primary truth. UI mutations happen by calling Chrome APIs (`chrome.tabs.*`, `chrome.windows.*`); the service worker's event listeners then persist the result back to storage, which flows to the UI.

---

## 2. Data Model

All interfaces live in `src/types/index.ts`.

### `EnrichedTab`

```typescript
interface EnrichedTab {
  id: number;
  windowId: number;
  url: string;
  title: string;
  favIconUrl: string;
  domain: string; // hostname stripped of www.
  openedAt: number; // Date.now() when tab was created
  lastActiveAt: number | null; // last time tab was focused
  totalActiveTime: number; // ms spent in foreground (cumulative)
  visitCount: number; // times tab was focused (activated)
  isVisited: boolean; // visitCount > 0
  isPinned: boolean;
  groupId: number | null; // Chrome tab group id
  groupName: string | null;
  groupColor: string | null;
  isHibernated: boolean; // tab.discarded === true
  tags: string[]; // rendered as chips in TabCard; no add/edit UI yet (always [])
}
```

Stored under `chrome.storage.local` key: `"tabs"` as `EnrichedTab[]`.

### `DailyAnalytics`

```typescript
interface DailyAnalytics {
  date: string; // "YYYY-MM-DD"
  totalTabsOpened: number;
  totalTabsClosed: number;
  peakTabCount: number; // highest observed that day
  domainTime: Record<string, number>; // domain → cumulative ms
  distractionDomains: string[]; // reserved; not currently populated (always [])
  tabDebtScore: number; // tab count at last snapshot
}
```

Stored under `chrome.storage.local` key: `"analytics"` as `DailyAnalytics[]` (last 30 days).

### `SavedSession`

```typescript
interface SavedSession {
  id: string; // "session-{timestamp}" (manual) or "auto-{timestamp}" (auto-save)
  name: string;
  savedAt: number;
  tabs: { title: string; url: string; favIconUrl: string }[];
}
```

Stored under `chrome.storage.local` key: `"sessions"` as `SavedSession[]` (last 50).

### `AppSettings`

```typescript
interface AppSettings {
  workDomains: string[]; // kept for storage backward compat, not shown in UI
  zombieThresholdHours: number; // default 3
  unvisitedAutoCloseEnabled: boolean; // stored but background auto-close not yet wired
  unvisitedAutoCloseMinutes: number; // default 30
  tabLimitWarning: number; // default 30
  theme: "dark" | "light"; // default "dark"
  ollamaEnabled: boolean; // default false — AI Assist master toggle
  ollamaModel: string; // legacy single-model choice (AskAI/Focus)
  aiFastModel: string; // classification/triage tier — default qwen2.5:3b-instruct-q4_K_M
  aiChatModel: string; // summaries/reports tier — default qwen3:8b
  aiEmbedModel: string; // semantic search tier — default nomic-embed-text
  aiPageReadingEnabled: boolean; // default false — gates F6/F7 page reading (optional perms)
  aiClipboardEnabled: boolean; // default false — gates the Ask AI copyTabUrls tool (optional clipboardWrite perm)
  aiReopenEnabled: boolean; // default false — gates the Ask AI reopenClosedTab tool (optional sessions perm)
  aiDebrief: boolean; // default true (all per-feature toggles default ON with the master)
  aiTriage: boolean;
  aiSuggestions: boolean;
  aiSessionMemory: boolean;
  aiSemanticSearch: boolean;
  aiCoach: boolean;
  aiIdleDrafts: boolean;
}
```

Defaults live in `DEFAULT_SETTINGS` (same file). Stored under `chrome.storage.sync` key: `"settings"` (syncs across Chrome profiles).

---

## 3. Background Service Worker

**File:** `src/background/service-worker.ts`

Re-registers all event listeners at top level on every startup (MV3 service workers are ephemeral and can be killed at any time). On each wake, `syncExistingTabs()` reconciles `chrome.tabs.query()` against stored tabs — adding untracked valid tabs and dropping entries for tabs that no longer exist.

`isValidTab()` filters out `chrome://`, `chrome-extension://`, `about:`, `edge://`, and `devtools://` URLs — these are never tracked.

### Event handlers

| Chrome Event                              | Action                                                                   |
| ----------------------------------------- | ------------------------------------------------------------------------ |
| `chrome.tabs.onCreated`                   | Add `EnrichedTab` to storage, increment `totalTabsOpened` in analytics   |
| `chrome.tabs.onRemoved`                   | Remove tab, increment `totalTabsClosed`, update `tabDebtScore`           |
| `chrome.tabs.onActivated`                 | Flush active time for previous tab, update `visitCount` + `lastActiveAt` |
| `chrome.tabs.onUpdated`                   | Sync `title`, `url`, `favIconUrl`, `domain` changes; remove tab if URL becomes invalid |
| `chrome.windows.onFocusChanged`           | Pause/resume time tracking on window blur/focus                          |
| `chrome.windows.onRemoved`                | Auto-save that window's tabs as a `SavedSession` (`"Auto-save: [date]"`) |
| `chrome.idle.onStateChanged`              | Pause time accumulation when idle/locked (60s detection interval); on `"idle"`, fire-and-forget an F12 triage draft (Ollama on + `aiTriage`/`aiIdleDrafts` on + ≥ 8 tabs + tab-set signature changed since the last draft) |
| `chrome.alarms.onAlarm` (peakTabSnapshot) | Fires every 60s — queries live tab count, updates `peakTabCount` + `tabDebtScore` |
| `chrome.runtime.onMessage` (`ollama-fetch`) | Ollama CORS proxy: page-originated `bgFetch` calls are re-fetched here (no web origin → Ollama's CORS gate passes); returns the full text body |
| `chrome.runtime.onConnect` (`ollama-stream`) | Ask AI sidebar streaming proxy: forwards each NDJSON line of a streamed `/api/chat` response back to the port (via `streamOllamaFetch`); an open port keeps the MV3 worker alive for the duration of the stream |

### Time tracking state machine

Active-timing state is held in **in-memory module variables** (`activeTabId`, `activeWindowId`, `activationTime`, `windowFocused`, `userIdle`) — not storage — and flushed to storage by `flushActiveTime()`.

```
Tab activated
    │
    ▼
activationTime = Date.now()   ◀─────────────────────┐
    │                                                 │
    │  (window unfocused OR user idle)                │
    ▼                                                 │
flushActiveTime()                          window focused + active
  ├─ elapsed = now - activationTime               again
  ├─ tab.totalActiveTime += elapsed
  ├─ analytics.domainTime[domain] += elapsed
  └─ activationTime = null ─────────────────────────┘
```

Active time is flushed when a different tab is activated, when the window loses focus, when the user goes idle, and every 60 seconds (the periodic alarm).

---

## 4. State Management (Zustand v5)

### `tabStore.ts`

```
useTabStore {
  tabs: EnrichedTab[]
  settings: AppSettings
  sessions: SavedSession[]
  isLoading: boolean

  setTabs / setSettings / setSessions / setLoading
}
```

**Exported selectors** (pure functions, no store subscription):

- `selectTabsByDomain(tabs)` → `Map<string, EnrichedTab[]>` — groups + sorts tabs within each domain by `lastActiveAt` desc
- `selectDomainsSorted(map)` → `string[]` — domains sorted by tab count desc

### `analyticsStore.ts`

```
useAnalyticsStore {
  analytics: DailyAnalytics[]
  setAnalytics
}
```

**Exported helpers:**

- `todayAnalytics(analytics)` — today's `DailyAnalytics` or null
- `last7Days(analytics)` — 7-item array, gaps filled with zero entries
- `topDomains(domainTime, n)` — top N `{ domain, ms }` pairs

### Zustand v5 — critical pattern

In Zustand v5 the second `equalityFn` argument of `useStore(selector, equalityFn)` was removed. Object selectors now **require** `useShallow` or you get an infinite re-render loop (React error #185). `useShallow` is re-exported from `tabStore.ts`.

```typescript
// ❌ Zustand v4 — broken in v5 (infinite re-render)
const { tabs, settings } = useTabStore((s) => ({ tabs: s.tabs, settings: s.settings }), shallow);

// ✅ Zustand v5 correct pattern
import { useShallow } from "zustand/react/shallow";
const { tabs, settings } = useTabStore(
  useShallow((s) => ({ tabs: s.tabs, settings: s.settings })),
);
```

---

## 5. UI Data Flow

```
chrome.storage.local
        │
        │  (initial load + chrome.storage.onChanged)
        ▼
    useTabs hook (src/newtab/hooks/useTabs.ts)
        │
        │  startTransition(() => setTabs / setAnalytics / ...)
        ▼
    Zustand Stores (tabStore / analyticsStore)
        │
        ▼
    App.tsx
      ├── selectTabsByDomain() → DomainGroup[] → TabCard[]
      ├── SearchBar (Fuse.js fuzzy search)
      ├── BulkActions (reads tabs + settings, calls chrome.tabs API)
      ├── SessionManager drawer (useSession hook)
      ├── AnalyticsDashboard drawer → WeeklyReport (nested)
      └── Settings drawer (reads/writes chrome.storage.sync)
```

### `useTransition` usage

Store updates that flow from `chrome.storage.onChanged` are wrapped in `startTransition`, marking them non-urgent so React can interrupt re-renders during user interaction — preventing jank on large tab lists.

---

## 6. Component Map

| Component            | Props              | Reads from store            | Calls Chrome API                                               |
| -------------------- | ------------------ | --------------------------- | -------------------------------------------------------------- |
| `App.tsx`            | —                  | `tabs, isLoading, settings` | —                                                              |
| `TabCard`            | `tab: EnrichedTab` | —                           | `tabs.update`, `tabs.remove`, `tabs.discard`, `windows.update` |
| `DomainGroup`        | `domain, tabs`     | —                           | `tabs.remove` (close all in group)                            |
| `SearchBar`          | `inputRef?`        | `tabs`                      | `tabs.update`, `windows.update`                                |
| `BulkActions`        | —                  | `tabs, settings`            | `tabs.remove`, `tabs.discard`                                  |
| `SessionManager`     | `open, onClose`    | `sessions` (useSession), `useSessionSummaries`, `useReadingList` | `windows.create`, `storage.local.set/get`      |
| `AnalyticsDashboard` | `open, onClose`    | `analytics, tabs`           | —                                                              |
| `DebriefCard`       | `open`             | `analytics, settings` + `useAIReports` | `storage.local` write (`aiReports`), Ollama via `bgFetch` |
| `WeeklyReport`      | `open, onClose`    | `analytics`                 | —                                                              |
| `CoachCard`         | `open`             | `analytics, settings` + `useAIReports` | `storage.local` write (`aiReports`), Ollama via `bgFetch` |
| `Settings`          | `open, onClose`    | `settings`                  | `storage.sync.set`; `permissions.request/remove` (page-reading on "Read Pages for AI", `sessions` on "Reopen Closed Tabs for AI", `clipboardWrite` on "Copy Tab Links for AI" — all F6-style, requested only at the explicit opt-in) |
| `TimelineView`      | `onSummarizeClose` | `tabs, settings` + `useTriagePlan` | `saveAndClose` via `useTabActions` (Clear forgotten, AI triage approve) |
| `TriageProposal`    | `open, onClose`    | `tabs, settings` + `useTriagePlan` | `storage.local` write (`aiTriagePlan`, `aiIdleDraftDismissedAt`), Ollama via `bgFetch`, `saveAndClose` |
| `StacksView`        | `onFocus, onSummarizeClose` | `tabs`                  | —                                                              |
| `DeckPopover`       | `open, onClose, onSummarizeClose?` | —                    | `tabs.remove`, `tabs.discard`, `storage.local.set` (sessions)  |
| `TabRow`            | `tab, onJump, onClose, onSummarizeClose?` | `settings`   | — (summarize-close goes through `useReadingList`)              |
| `SuggestionsStrip`  | `onFocus`          | `tabs, settings` + `useSuggestions` | `storage.local` write (`aiSuggestions`), Ollama via `bgFetch` |
| `CommandPalette`    | `onFocus, onOpenWorkspaces, onAskAI` | `tabs, settings, sessions` + `useSessionSummaries` + `useTabEmbeddings` | `windows.create` (session restore), `tabs.update`, `windows.update`, `tabs.remove`, `tabs.discard`; `storage.local` write (`aiTabEmbeddings`), Ollama via `bgFetch` (embeddings) |
| `AskAI` (sidebar)   | `open, onClose, onOpenSettings, onClosed` | `tabs, settings` + `useTabActions` | Ollama via the `ollama-stream` port (`streamChat`); 15 validated tools (`closeTab`, `hibernateTab`, `openTab`, `jumpTab`, `groupTabs`, `saveSession`, `pinTab`, `unpinTab`, `readPage`, `muteTab`, `unmuteTab`, `closeOtherTabs`, `duplicateTab`, `reopenClosedTab`, `copyTabUrls`) — `tabs.remove`/`discard`/`update`/`group`/`create`/`duplicate`, `sessions.restore`, `navigator.clipboard.writeText` ONLY through them (`resolveCloseTarget`/`resolveOpenUrl`/`resolveGroupTarget`/`resolveTabTarget`/`resolveCloseOthersTarget`/`resolveReopenTarget`/`resolveCopyTitles`; pinned/unknown tabs never closed or hibernated, but MAY be muted/duplicated/copied — non-destructive; `readPage` gates on the F6 page-reading grant, `reopenClosedTab` on the optional `sessions` grant (Settings "Reopen Closed Tabs for AI", restores TAB-level closes only), `copyTabUrls` on the optional `clipboardWrite` grant (Settings "Copy Tab Links for AI")); "New chat" aborts + clears the thread; auto-compaction drops oldest turns past a 3000-token budget (`compactMessages`); reopen on Undo via `tabs.create` (App toast) |
| `Tooltip`            | `text, position?, align?` | —                    | —                                                              |

---

## 7. Storage Schema

| Key         | Area    | Type               | Retention        |
| ----------- | ------- | ------------------ | ---------------- |
| `tabs`      | `local` | `EnrichedTab[]`    | All open tabs    |
| `analytics` | `local` | `DailyAnalytics[]` | Last 30 days     |
| `sessions`  | `local` | `SavedSession[]`   | Last 50 sessions |
| `settings`  | `sync`  | `AppSettings`      | Single object    |
| `aiReports` | `local` | `AIReportsMap` (see below) | Entries pruned after 30 days |
| `aiTriagePlan` | `local` | `TriagePlan` (see below) | Single plan, per-source TTL (1 h on-demand / 2 h idle) |
| `aiIdleDraftDismissedAt` | `local` | `number` (timestamp) | UI-owned notice flag |
| `aiSuggestions` | `local` | `Suggestions` (see below) | Single plan, TTL 30 min, regen on ≥ 5-tab change |
| `aiSessionSummaries` | `local` | `SessionSummariesMap` (see below) | Entries pruned after 30 days |
| `aiTabEmbeddings` | `local` | `TabEmbeddings` (see below) | Per-tab vectors, TTL 24 h, re-embedded on model/title change |
| `aiReadingList` | `local` | `ReadingEntry[]` (see below) | Capped at 100, entries reused ≤ 7 days |

### `aiReports` (UI-owned, landed in PR B)

Daily debrief (F1) + weekly coach (F11) reports. Keyed by human-readable report id so the storage stays debuggable; values are `CacheEntry` (`{ result, generatedAt, model }`) with the same freshness contract as `AiCache` — a report is rejected (and regenerated) when its task TTL (6 h for both `debrief` and `coach`) expires or the model changed. Written by the React layer only (`useAIReports` → `AIReportCache` in `src/lib/ai/reports.ts`); the service worker never touches it — derived, regenerable cache (same precedent as `workspaces`).

```
aiReports: {
  "debrief:2026-09-03": { result: { summary, sections: [{ heading, text }] }, generatedAt, model },
  "coach:2026-W36":     { result: { insights: [{ text, severity }] },        generatedAt, model }
}
```

### `aiTriagePlan` (dual-owned, landed in PR C)

F2 tab-debt triage + F12 idle drafts. A single plan object (latest wins, not a map) written by BOTH the React layer (on-demand, source `"on-demand"`) and the service worker (idle drafts, source `"idle"`); both sides coerce through `TriageCache` in `src/lib/ai/triage.ts`. `signature` is the `tabSetSignature` of the candidate list that produced the plan, so a plan is reused only while the candidate set is unchanged; freshness is per source — 1 h on-demand (`TASK_TTL_MS.triage`), 2 h idle (a "while you were away" notice must outlive a short idle) — plus model-mismatch rejection.

```
aiTriagePlan: {
  signature,                                  // tabSetSignature of the candidates
  items: [{ tabId, reason, action: "close"|"keep", category: "duplicate"|"same-thread"|"stale"|"unvisited"|"junk" }],
  generatedAt, source: "on-demand"|"idle", model
}
```

`aiIdleDraftDismissedAt` (UI-owned, `number`) is the notice flag: the Timeline chip ("AI drafted a cleanup plan while you were away → Review") shows while a fresh idle plan exists with `generatedAt` after the flag; dismissing writes the flag, so the chip reappears only for a genuinely new draft.

### `aiSuggestions` (UI-owned, landed in PR D)

F3 proactive workspace suggestions. A single object (latest generation wins, not a map) written ONLY by the React layer (`useSuggestions` → `SuggestionsCache` in `src/lib/ai/suggestions.ts`) — the same UI-owned precedent as `aiReports`. `signature` is the `tabSetSignature` of the open tab set that produced the plan; `tabCount` is the open-tab count at generation time. The Stacks strip reuses the plan while the signature matches OR the tab set churned by < 5 tabs, and regenerates when it changed by ≥ 5. Freshness = the `suggestions` task TTL (30 min) + model-mismatch rejection. `dismissed` is the per-plan "hide for this session" flag: ✕ writes it, and only a NEW generation (≥ 5-tab change) resets it.

```
aiSuggestions: {
  signature,                                  // tabSetSignature of the open tab set
  items: [{ goal, tabIds: number[], reason }], // ≤ 2 suggestions, tabIds ⊆ open ids
  generatedAt, model, tabCount, dismissed
}
```

### `aiSessionSummaries` (dual-owned, landed in PR D)

F4 session memory. A map `sessionId → { summary, generatedAt, model }` written by BOTH the React layer (`persistSession` → `summarizeSession`, fire-and-forget) and the service worker (window auto-save, `windows.onRemoved` → the same shared helper) — the `aiTriagePlan` dual-owner precedent, cohered through `SessionSummaryCache` in `src/lib/ai/sessionMemory.ts`. Both paths gate on `ollamaEnabled && aiSessionMemory`, generate with the chat tier, and read-modify-write the map so parallel summaries don't clobber each other (entries pruned after 30 days; TTL = `TASK_TTL_MS.sessionSummary`). `SavedSession.summary` is backfilled as an in-session cache (best-effort — a lost backfill is fine, the map is authoritative and the UI reads map-first). Sessions drawer shows the summary under each session name; ⌘K "Sessions" group Fuse-searches names + summaries (the Fuse.js fallback when AI is off).

```
aiSessionSummaries: {
  "session-…": { summary, generatedAt, model }
}
```

### `aiTabEmbeddings` (UI-owned, landed in PR E)

F7 semantic ⌘K search. A single embeddings object for one embed model written ONLY by the React layer (`useTabEmbeddings` → `TabEmbeddingCache` in `src/lib/ai/tabEmbeddings.ts`) — the same UI-owned precedent as `aiReports` / `aiSuggestions`; the service worker never touches it. Each per-tab vector is keyed by the triple `{ model, tabId, title }` (the per-entry `title`/`embeddedAt` fields are additive beyond the plan doc's `{ model, dims, vectors: { [tabId]: number[] } }` sketch): a model change invalidates the whole envelope (different vector space — the first write under the new model starts a fresh map), a title change invalidates just that tab, and `embeddedAt` enforces the `embed` task TTL (24 h). While the palette is open, `ensureTabEmbeddings` batch-embeds only the stale entries (missing / expired / wrong model / title changed) and prunes vectors for closed tabs; the query is embedded after a 250 ms debounce and scored with `searchSemanticTabs` (cosine ≥ `COSINE_THRESHOLD` 0.32 over fresh vectors only), then `searchTabsSemantic` in `src/lib/commandFilter.ts` merges semantic-first with the Fuse tab search (deduped; embedding-matched rows are flagged for the subtle accent dot). Failure anywhere degrades silently to pure Fuse.

```
aiTabEmbeddings: {
  model,                                  // embed model (e.g. nomic-embed-text)
  dims,                                   // vector dimensionality (consistency enforced)
  vectors: {
    [tabId]: { title,                    // the embedded text ("<title> <domain>")
               vector: number[],         // length === dims
               embeddedAt }              // embed task TTL 24 h
  }
}
```

### `aiReadingList` (UI-owned, landed in PR F)

F6 summarize-then-close. A capped list of page summaries written ONLY by the React layer (`useReadingList` in `src/newtab/hooks/useReadingList.ts` — the same UI-owned precedent as `aiSuggestions`; the service worker never touches it). Each entry's `id` is content-addressed — `sha1("summarizePage\n" + pageSignature(title, text))`, the same formula as `AiCache.key` — so closing the same page again within the `summarizePage` task TTL (7 days) reuses the stored summary without a second model call, and a re-summarized page never duplicates a row (`ReadingList.add` replaces in place, then caps at 100, oldest dropped). The pipeline is order-guaranteed like `saveAndClose`: extract the page text via `chrome.scripting.executeScript` (`extractPageText` in `src/lib/pageExtract.ts`, text truncated to `PAGE_TEXT_CAP`), summarize with the chat tier (`generatePageSummary`), PERSIST the entry, THEN close the tab (`useTabActions.close`). Undo (bottom toast, App-owned) reopens the tab and removes the entry. Restricted pages / revoked grants / Ollama down → null, nothing closes. The reading list renders in the Sessions drawer (newest first) with per-entry remove. The `scripting` + `<all_urls>` grants are requested at the explicit "Read Pages for AI" opt-in (`src/lib/pageReading.ts`) and revoked on opt-out — the ONLY optional permissions in the extension.

```
aiReadingList: [
  { id,                                    // sha1("summarizePage\n" + pageSignature)
    url, title,
    summary,                               // bullets + why-it-mattered line
    savedAt }                              // summarizePage TTL 7 d (reuse window)
]                                          // cap 100, newest last
```

---

## 8. Build Pipeline

```
src/ (TypeScript + TSX)
        │
        ▼
   @tailwindcss/vite     ← scans JSX for class names, generates CSS
   @vitejs/plugin-react  ← JSX transform
   @crxjs/vite-plugin    ← rewrites manifest, handles service worker
        │
        ▼
      dist/
       ├── manifest.json
       ├── service-worker-loader.js
       ├── src/newtab/index.html
       ├── icons/
       └── assets/
           ├── index.html-*.js   (React app)
           └── index-*.css       (Tailwind utilities)
```

Entry points come from `manifest.json` (`chrome_url_overrides.newtab` → `src/newtab/index.html`, `background.service_worker` → `src/background/service-worker.ts`), not from `vite.config.ts`.

**Tailwind v4 note:** Uses the CSS-first approach (`@import "tailwindcss"` in `src/newtab/index.css`, theme vars in an `@theme` block). The `@tailwindcss/vite` plugin is **required** — without it the CSS output contains only theme variables and no utility classes are emitted. There is no `tailwind.config.js`.

---

## 9. Tab Status Color Logic

Left-border color, evaluated in this precedence order (`getStatusBorderColor` in `TabCard.tsx`):

```
visitCount === 0                      → border-l red-500     "Never visited"
isHibernated                          → border-l blue-500    "Hibernated / asleep"
lastActiveAt < 30 min ago             → border-l emerald-500 "Recently active"
lastActiveAt > 2 hours ago            → border-l amber-500   "Stale"
otherwise                             → border-l gray-700    "Normal"
```

> Note the order: a hibernated tab that *was* visited shows the blue border, because the hibernation check precedes the time-based checks.

---

## 10. Bulk Action Logic

Implemented in `BulkActions.tsx`. Button counts and the zombie threshold both read live from `settings`.

| Action           | Condition                                            | Note                                           |
| ---------------- | ---------------------------------------------------- | ---------------------------------------------- |
| Close Duplicates | Same URL                                             | Keeps the most recently active tab             |
| Close Unvisited  | `visitCount === 0` AND `openedAt < now - 30min`      | —                                              |
| Close Zombies    | `lastActiveAt === null` OR older than threshold      | Threshold = `settings.zombieThresholdHours` (default 3h) |
| Hibernate All    | Any non-hibernated tab (`!isHibernated`)             | Calls `chrome.tabs.discard`                    |

---

## 11. Keyboard Shortcuts

| Shortcut    | Action                      |
| ----------- | --------------------------- |
| ⌘K / Ctrl+K | Focus the search bar        |
| ↑ / ↓       | Navigate search results     |
| ↵ Enter     | Jump to selected tab        |
| Esc         | Close search / close drawer |

---

## 12. Known Gaps / Future Work

- **Icon artwork** — current icons are placeholder squares; replace before store submission
- **`unvisitedAutoCloseEnabled`** — setting exists, background auto-close wiring not yet implemented
- **WindowGroup view** — alternative grouping by window (not domain) not yet built
- **Tab tagging** — `EnrichedTab.tags` renders as chips but has no add/edit UI
- **Ask AI chat** — conversation history is in-memory (lost when the new-tab page reloads; "New chat" clears it, auto-compaction trims past 3000 tokens), the tool set is the 15 validated tools (a web-search tool would break the no-network privacy model); token-level streaming works through the SW port, but there is no AI-Elements-style part rendering yet

# Architecture & Technical Reference

A deep-dive into how Tab Mission Control is built — data model, data flow, component responsibilities, storage schema, and key implementation decisions.

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
| `chrome.idle.onStateChanged`              | Pause time accumulation when idle/locked (60s detection interval)        |
| `chrome.alarms.onAlarm` (peakTabSnapshot) | Fires every 60s — queries live tab count, updates `peakTabCount` + `tabDebtScore` |

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
| `SessionManager`     | `open, onClose`    | `sessions` (useSession)     | `windows.create`, `storage.local.set/get`                     |
| `AnalyticsDashboard` | `open, onClose`    | `analytics, tabs`           | —                                                              |
| `WeeklyReport`       | `open, onClose`    | `analytics`                 | —                                                              |
| `Settings`           | `open, onClose`    | `settings`                  | `storage.sync.set`                                             |
| `Tooltip`            | `text, position?, align?` | —                    | —                                                              |

---

## 7. Storage Schema

| Key         | Area    | Type               | Retention        |
| ----------- | ------- | ------------------ | ---------------- |
| `tabs`      | `local` | `EnrichedTab[]`    | All open tabs    |
| `analytics` | `local` | `DailyAnalytics[]` | Last 30 days     |
| `sessions`  | `local` | `SavedSession[]`   | Last 50 sessions |
| `settings`  | `sync`  | `AppSettings`      | Single object    |

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
- **No tests** — no Vitest or `@testing-library/react` setup yet
- **WindowGroup view** — alternative grouping by window (not domain) not yet built
- **Tab tagging** — `EnrichedTab.tags` renders as chips but has no add/edit UI

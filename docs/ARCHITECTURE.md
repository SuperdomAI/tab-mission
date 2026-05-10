# Architecture & Technical Reference

A deep-dive into how Tab Mission Control is built — data model, data flow, component responsibilities, storage schema, and key implementation decisions.

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

**Rule:** The background service worker **writes** to `chrome.storage.local`. The UI **reads** from it and listens for changes via `chrome.storage.onChanged`. The stores are a reflection of storage — not the primary truth.

---

## 2. Data Model

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
  groupId: number | null;
  groupName: string | null;
  groupColor: string | null;
  isHibernated: boolean; // tab.discarded === true
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
  tabDebtScore: number; // tab count at last snapshot
}
```

Stored under `chrome.storage.local` key: `"analytics"` as `DailyAnalytics[]` (last 30 days).

### `SavedSession`

```typescript
interface SavedSession {
  id: string; // "session-{timestamp}"
  name: string;
  savedAt: number;
  tabs: { title: string; url: string; favIconUrl: string }[];
}
```

Stored under `chrome.storage.local` key: `"sessions"` as `SavedSession[]` (last 50).

### `AppSettings`

```typescript
interface AppSettings {
  zombieThresholdHours: number; // default 3
  unvisitedAutoCloseEnabled: boolean;
  unvisitedAutoCloseMinutes: number;
  tabLimitWarning: number; // default 30
  theme: "dark" | "light";
  workDomains: string[]; // kept for storage backward compat, not shown in UI
}
```

Stored under `chrome.storage.sync` key: `"settings"` (syncs across Chrome profiles).

---

## 3. Background Service Worker

**File:** `src/background/service-worker.ts`

Re-registers all event listeners on every startup (MV3 service workers are ephemeral).

### Event handlers

| Chrome Event                              | Action                                                                   |
| ----------------------------------------- | ------------------------------------------------------------------------ |
| `chrome.tabs.onCreated`                   | Add `EnrichedTab` to storage, increment `totalTabsOpened` in analytics   |
| `chrome.tabs.onRemoved`                   | Remove tab, increment `totalTabsClosed`, update `tabDebtScore`           |
| `chrome.tabs.onActivated`                 | Flush active time for previous tab, update `visitCount` + `lastActiveAt` |
| `chrome.tabs.onUpdated`                   | Sync `title`, `url`, `favIconUrl`, `domain` changes                      |
| `chrome.windows.onFocusChanged`           | Pause/resume time tracking on window blur/focus                          |
| `chrome.windows.onRemoved`                | Auto-save that window's tabs as a `SavedSession`                         |
| `chrome.idle.onStateChanged`              | Pause time accumulation when idle/locked                                 |
| `chrome.alarms.onAlarm` (peakTabSnapshot) | Fires every 60s — queries live tab count, updates `peakTabCount`         |

### Time tracking state machine

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

**Exported selectors:**

- `selectTabsByDomain(tabs)` → `Map<string, EnrichedTab[]>` — groups + sorts by lastActiveAt desc
- `selectDomainsSorted(map)` → `string[]` — sorted by tab count desc

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

```typescript
// ✅ Zustand v5 — use useShallow for object selectors
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
    useTabs hook
        │
        │  startTransition(() => setTabs / setAnalytics / ...)
        ▼
    Zustand Stores (tabStore / analyticsStore)
        │
        ▼
    App.tsx
      ├── selectTabsByDomain() → DomainGroup[] → TabCard[]
      ├── SearchBar (Fuse.js fuzzy search)
      ├── BulkActions (reads tabs, calls chrome.tabs API)
      ├── SessionManager drawer (useSession hook)
      ├── AnalyticsDashboard drawer → WeeklyReport (nested)
      └── Settings drawer (reads/writes chrome.storage.sync)
```

### `useTransition` usage

Store updates from `chrome.storage.onChanged` are wrapped in `startTransition`, marking them non-urgent so React can interrupt re-renders during user interaction.

---

## 6. Component Map

| Component            | Props              | Reads from store            | Calls Chrome API                                               |
| -------------------- | ------------------ | --------------------------- | -------------------------------------------------------------- |
| `App.tsx`            | —                  | `tabs, isLoading, settings` | —                                                              |
| `TabCard`            | `tab: EnrichedTab` | —                           | `tabs.update`, `tabs.remove`, `tabs.discard`, `windows.update` |
| `DomainGroup`        | `domain, tabs`     | —                           | `tabs.remove` (close all in group)                             |
| `SearchBar`          | `inputRef?`        | `tabs`                      | `tabs.update`, `windows.update`                                |
| `BulkActions`        | —                  | `tabs, settings`            | `tabs.remove`, `tabs.discard`                                  |
| `SessionManager`     | `open, onClose`    | `sessions` (useSession)     | `windows.create`, `storage.local.set/get`                      |
| `AnalyticsDashboard` | `open, onClose`    | `analytics, tabs`           | —                                                              |
| `WeeklyReport`       | `open, onClose`    | `analytics`                 | —                                                              |
| `Settings`           | `open, onClose`    | `settings`                  | `storage.sync.set`                                             |
| `Tooltip`            | `content, ...`     | —                           | —                                                              |

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
           ├── index.html-*.js   (React app, ~288KB / 86KB gzip)
           └── index-*.css       (Tailwind utilities, ~47KB / 8KB gzip)
```

**Tailwind v4 note:** Uses CSS-first approach (`@import "tailwindcss"`). The `@tailwindcss/vite` plugin is required — without it no utility classes are emitted.

---

## 9. Tab Status Color Logic

```
visitCount === 0                      → border-l red-500    "Never visited"
lastActiveAt < 30 min ago             → border-l emerald-500 "Recently active"
lastActiveAt > 2 hours ago            → border-l amber-500   "Stale"
isHibernated                          → border-l blue-500    "Hibernated"
otherwise                             → border-l gray-700    "Normal"
```

---

## 10. Bulk Action Logic

| Action           | Condition                                   | Note                                           |
| ---------------- | ------------------------------------------- | ---------------------------------------------- |
| Close Duplicates | Same URL, keep most recently active         | —                                              |
| Close Unvisited  | `visitCount === 0` AND opened > 30 min ago  | —                                              |
| Close Zombies    | `lastActiveAt` null OR older than threshold | Threshold from `settings.zombieThresholdHours` |
| Hibernate All    | Any non-active, non-hibernated tab          | Calls `chrome.tabs.discard`                    |

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
- **unvisitedAutoCloseEnabled** — setting exists, background wiring not yet implemented
- **No tests** — no Vitest or `@testing-library/react` setup yet
- **WindowGroup view** — alternative grouping by window (not domain) not yet built

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

**Rule:** The background service worker **writes** to `chrome.storage.local`. The UI **reads** from it and listens for changes via `chrome.storage.onChanged`. The stores are a reflection of storage — not the primary truth.

---

## 2. Data Model

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
  tags: string[]; // user-defined project tags (future)
}
```

Stored under `chrome.storage.local` key: `"tabs"` as `EnrichedTab[]`.

### `DailyAnalytics`

```typescript
interface DailyAnalytics {
  date: string; // "YYYY-MM-DD"
  totalTabsOpened: number;
  totalTabsClosed: number;
  peakTabCount: number; // highest tab count observed that day
  domainTime: Record<string, number>; // domain → cumulative ms
  distractionDomains: string[];
  tabDebtScore: number; // open tab count at last snapshot
}
```

Stored under `chrome.storage.local` key: `"analytics"` as `DailyAnalytics[]` (last 30 days).

### `SavedSession`

```typescript
interface SavedSession {
  id: string; // "session-{timestamp}" or "auto-{timestamp}"
  name: string;
  savedAt: number;
  tabs: { title: string; url: string; favIconUrl: string }[];
}
```

Stored under `chrome.storage.local` key: `"sessions"` as `SavedSession[]` (last 50 sessions).

### `AppSettings`

```typescript
interface AppSettings {
  workDomains: string[]; // for distraction scoring
  zombieThresholdHours: number; // default 3
  unvisitedAutoCloseEnabled: boolean;
  unvisitedAutoCloseMinutes: number;
  focusDurationMinutes: number; // default 25
  breakDurationMinutes: number; // default 5
  tabLimitWarning: number; // default 30
  theme: "dark" | "light";
  focusDomains: string[]; // shown during focus mode
}
```

Stored under `chrome.storage.sync` key: `"settings"` (syncs across Chrome profiles).

### `FocusState`

```typescript
interface FocusState {
  isActive: boolean;
  phase: "work" | "break";
  startedAt: number | null;
  durationMinutes: number;
  alarmName: string; // "focusPhaseEnd"
}
```

Stored under `chrome.storage.local` key: `"focusState"`.

---

## 3. Background Service Worker

**File:** `src/background/service-worker.ts`

Re-registers all event listeners on every service worker startup (Manifest V3 service workers are ephemeral and can be killed at any time).

### Event handlers

| Chrome Event                              | Action                                                                                                                               |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `chrome.tabs.onCreated`                   | Add new `EnrichedTab` to storage, increment `totalTabsOpened` in today's analytics. Skips `chrome://`, `about:`, `devtools://` URLs. |
| `chrome.tabs.onRemoved`                   | Remove tab from storage, increment `totalTabsClosed`, update `tabDebtScore`.                                                         |
| `chrome.tabs.onActivated`                 | Flush active time for previously active tab → increment `visitCount` + set `lastActiveAt` on new active tab.                         |
| `chrome.tabs.onUpdated`                   | Sync `title`, `url`, `favIconUrl`, `domain` changes. Removes tab if URL becomes invalid.                                             |
| `chrome.windows.onFocusChanged`           | Pauses/resumes time tracking when window loses/gains focus.                                                                          |
| `chrome.windows.onRemoved`                | Auto-saves all that window's tabs as a `SavedSession` named `"Auto-save: [date]"`.                                                   |
| `chrome.idle.onStateChanged`              | Pauses time accumulation when state is `"idle"` or `"locked"`. Uses 60s detection interval.                                          |
| `chrome.alarms.onAlarm` (peakTabSnapshot) | Fires every 60s. Queries live tab count, updates `peakTabCount`.                                                                     |
| `chrome.alarms.onAlarm` (focusPhaseEnd)   | Fires when Pomodoro phase ends. Toggles work↔break phase, sets next alarm.                                                           |

### Time tracking state machine

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

Active time is flushed:

- When a different tab is activated
- When the window loses focus
- When the user goes idle
- Every 60 seconds (periodic alarm)

---

## 4. State Management (Zustand v5)

### `tabStore.ts`

```
useTabStore {
  tabs: EnrichedTab[]
  settings: AppSettings
  focusState: FocusState
  sessions: SavedSession[]
  isLoading: boolean

  setTabs / setSettings / setFocusState / setSessions / setLoading
}
```

**Exported selectors** (pure functions, no store subscription):

- `selectTabsByDomain(tabs)` → `Map<string, EnrichedTab[]>` — groups + sorts by lastActiveAt desc
- `selectDomainsSorted(map)` → `string[]` — domains sorted by tab count desc

### `analyticsStore.ts`

```
useAnalyticsStore {
  analytics: DailyAnalytics[]
  setAnalytics
}
```

**Exported helpers:**

- `todayAnalytics(analytics)` — returns today's `DailyAnalytics` or null
- `last7Days(analytics)` — returns 7-item array filling gaps with zero-value entries
- `topDomains(domainTime, n)` — returns top N `{ domain, ms }` pairs

### Zustand v5 — critical pattern

In Zustand v5 the second argument of `useStore(selector, equalityFn)` was removed. Object selectors now require `useShallow`:

```typescript
// ❌ Zustand v4 — broken in v5 (infinite re-render / React error #185)
const { tabs, settings } = useTabStore(
  (s) => ({ tabs: s.tabs, settings: s.settings }),
  shallow,
);

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
        │  component subscriptions
        ▼
    App.tsx  ──→  selectTabsByDomain()  ──→  DomainGroup[]  ──→  TabCard[]
             │
             ├──→  SearchBar (Fuse.js on tabs[])
             ├──→  BulkActions (reads tabs, calls chrome.tabs API)
             ├──→  FocusTimer (reads focusState, shows countdown)
             ├──→  SessionManager drawer (useSession hook)
             ├──→  AnalyticsDashboard drawer (reads analyticsStore)
             │      └──→  WeeklyReport (nested drawer)
             └──→  Settings drawer (reads/writes chrome.storage.sync)
```

### `useTransition` usage

Zustand store updates that flow from `chrome.storage.onChanged` are wrapped in `startTransition`. This marks them as non-urgent — React can interrupt the re-render if the user is interacting, preventing jank on large tab lists.

---

## 6. Component Map

| Component            | Props                  | Reads from store                        | Calls Chrome API                                               |
| -------------------- | ---------------------- | --------------------------------------- | -------------------------------------------------------------- |
| `App.tsx`            | —                      | `tabs, isLoading, settings, focusState` | —                                                              |
| `TabCard`            | `tab: EnrichedTab`     | —                                       | `tabs.update`, `tabs.remove`, `tabs.discard`, `windows.update` |
| `DomainGroup`        | `domain, tabs, dimmed` | —                                       | `tabs.remove` (close all)                                      |
| `SearchBar`          | —                      | `tabs`                                  | `tabs.update`, `windows.update`                                |
| `BulkActions`        | —                      | `tabs`                                  | `tabs.remove`, `tabs.discard`                                  |
| `FocusTimer`         | —                      | `focusState` (via `useTimeTracker`)     | `alarms.create/clear`, `storage.local.set`                     |
| `SessionManager`     | `open, onClose`        | `sessions` (via `useSession`)           | `windows.create`, `storage.local.set/get`                      |
| `AnalyticsDashboard` | `open, onClose`        | `analytics, tabs, settings`             | —                                                              |
| `WeeklyReport`       | `open, onClose`        | `analytics`                             | —                                                              |
| `Settings`           | `open, onClose`        | `settings`                              | `storage.sync.set`                                             |

---

## 7. Storage Schema Summary

| Key          | Area    | Type               | Max size         |
| ------------ | ------- | ------------------ | ---------------- |
| `tabs`       | `local` | `EnrichedTab[]`    | All open tabs    |
| `analytics`  | `local` | `DailyAnalytics[]` | Last 30 days     |
| `sessions`   | `local` | `SavedSession[]`   | Last 50 sessions |
| `focusState` | `local` | `FocusState`       | Single object    |
| `settings`   | `sync`  | `AppSettings`      | Single object    |

---

## 8. Build Pipeline

```
src/
 └── TypeScript + TSX
        │
        ▼
   @tailwindcss/vite          ← scans JSX for class names, generates CSS
   @vitejs/plugin-react        ← JSX transform
   @crxjs/vite-plugin          ← rewrites manifest, handles service worker entry
        │
        ▼
      dist/
       ├── manifest.json           (rewritten by CRXJS)
       ├── service-worker-loader.js
       ├── src/newtab/index.html
       ├── icons/
       └── assets/
           ├── index.html-*.js     (React app bundle)
           └── index-*.css         (Tailwind utilities)
```

### Why `@tailwindcss/vite` is required for v4

Tailwind v4 uses a CSS-first approach (`@import "tailwindcss"`) instead of a config file. It needs the Vite plugin to:

1. Scan all `.tsx`/`.ts` files for class names at build time
2. Generate only used utility classes into the CSS output

Without it, the CSS output contains only theme variables — no `.flex`, `.bg-gray-950`, etc.

---

## 9. Tab Status Color Logic

```
visitCount === 0
  → border-l-4 border-l-red-500     "Never visited"

lastActiveAt < 30 minutes ago
  → border-l-4 border-l-green-500   Recently active

lastActiveAt > 2 hours ago
  → border-l-4 border-l-yellow-500  Stale

otherwise
  → border-l-4 border-l-gray-700    Normal
```

---

## 10. Bulk Action Logic

| Action           | Condition                                            | Keep                            |
| ---------------- | ---------------------------------------------------- | ------------------------------- |
| Close Duplicates | Same URL                                             | Most recently active tab        |
| Close Unvisited  | `visitCount === 0` AND `openedAt < now - 30min`      | —                               |
| Close Zombies    | `lastActiveAt === null` OR `lastActiveAt < now - 3h` | —                               |
| Hibernate All    | Any non-active tab                                   | — (calls `chrome.tabs.discard`) |

> Zombie threshold (default 3h) is configurable in Settings → `zombieThresholdHours`.
> BulkActions currently hardcodes 3h — future: read from settings store.

---

## 11. Focus Mode Flow

```
User clicks "🎯 Focus"
        │
        ▼
useTimeTracker.startFocus()
  ├─ writes FocusState to chrome.storage.local
  └─ chrome.alarms.create("focusPhaseEnd", { delayInMinutes: 25 })

        │  (alarm fires in background — survives tab navigations)
        ▼
service-worker: alarms.onAlarm("focusPhaseEnd")
  ├─ if phase === 'work' → switch to 'break', set 5min alarm
  └─ if phase === 'break' → switch to 'work', set 25min alarm

        │  chrome.storage.onChanged('focusState')
        ▼
useTabs hook → setFocusState → App.tsx re-renders
  ├─ FocusTimer shows countdown (local setInterval ticking against startedAt)
  └─ DomainGroup receives dimmed={true} for non-focus domains
```

---

## 12. Continuation Notes (for next chat)

This section captures current state for easy handoff:

**What's done:**

- Full build pipeline working (`npm run build` → `dist/`)
- Background service worker: all 8 Chrome events, time tracking, alarms
- All 9 UI components implemented
- Zustand v5 fixed (`useShallow` for object selectors)
- Tailwind v4 fixed (`@tailwindcss/vite` plugin added)
- ErrorBoundary in main.tsx for visible crash messages

**Pending / To improve:**

- `WindowGroup.tsx` component (group by window, not domain) — stub not created yet
- React Compiler (`babel-plugin-react-compiler`) integration in `vite.config.ts`
- Zombie threshold in `BulkActions.tsx` should read from `settings.zombieThresholdHours`
- `unvisitedAutoCloseEnabled` logic not yet wired (auto-close in background)
- Icon PNGs are placeholder purple squares — replace with real artwork
- No test setup — add Vitest + `@testing-library/react`
- Tab tagging UI (tags field exists on `EnrichedTab` but no UI to add/remove them)

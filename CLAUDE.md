# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Manifest V3 Chrome extension that **replaces the new tab page** with a tab management dashboard (domain grouping, fuzzy search, session save/restore, usage analytics). React 19 + TypeScript + Vite + Tailwind v4 + Zustand. No backend, no network calls — all data lives in `chrome.storage.*`.

## Commands

```bash
npm install
npm run dev      # vite build --watch — rebuilds dist/ on save
npm run build    # production build → dist/
npx tsc --noEmit # typecheck (no script for it; tsconfig is noEmit)
```

There is **no test runner and no lint script** — `dev` and `build` are the only npm scripts. Typecheck manually with `tsc --noEmit`.

**Loading/reloading the extension:** Build, then in `chrome://extensions/` (Developer mode on) → **Load unpacked** → select `dist/`. After any rebuild you must click **↺ Reload** on the extension card — Vite watch rebuilds files but does not reload the extension. `dist/` is gitignored.

## Architecture — the one rule that matters

There are two execution contexts and a strict one-way data flow between them:

```
background service worker  ──writes──▶  chrome.storage.local  ──reads──▶  React new tab page
   (the only writer)                    (single source of truth)         (read-only mirror)
```

- **`src/background/service-worker.ts` is the only writer of tab/analytics/session data.** It listens to Chrome events (`tabs`, `windows`, `idle`, `alarms`) and persists `EnrichedTab[]`, `DailyAnalytics[]`, `SavedSession[]` to `chrome.storage.local`.
- **The UI never owns state.** `src/newtab/hooks/useTabs.ts` loads storage on mount and subscribes to `chrome.storage.onChanged`, pushing values into Zustand stores. The Zustand stores are a *reflection* of storage, not the source of truth. UI mutations happen by calling Chrome APIs (`chrome.tabs.remove/discard/update`, `windows.update`) — the service worker's event listeners then update storage, which flows back to the UI. Do not write tab data directly from a component.
- **Settings are the exception:** stored in `chrome.storage.sync` (syncs across profiles), written directly by the Settings drawer. Everything else is `chrome.storage.local`.

Because MV3 service workers are ephemeral (killed anytime), `service-worker.ts` re-registers all listeners at top level on every startup, and `syncExistingTabs()` reconciles `chrome.tabs.query()` against stored tabs on each wake. Time-tracking lives in **in-memory module variables** (`activeTabId`, `activationTime`, `windowFocused`, `userIdle`) and is flushed to storage via `flushActiveTime()` on tab switch / window blur / idle / the 1-minute `peakTabSnapshot` alarm.

## State management (Zustand v5)

Two stores, both in `src/store/`:
- `tabStore.ts` — `tabs`, `settings`, `sessions`, `isLoading`. Also exports pure, non-subscribing selector functions: `selectTabsByDomain()`, `selectDomainsSorted()`.
- `analyticsStore.ts` — `analytics`, plus helpers `todayAnalytics()`, `last7Days()`, `topDomains()`.

**Zustand v5 gotcha:** object/multi-field selectors MUST be wrapped in `useShallow` or you get an infinite re-render loop (React error #185). `useShallow` is re-exported from `tabStore.ts`. Pattern:

```ts
import { useTabStore, useShallow } from "../store/tabStore";
const { tabs, settings } = useTabStore(useShallow((s) => ({ tabs: s.tabs, settings: s.settings })));
```

Store updates fed from `chrome.storage.onChanged` are wrapped in `startTransition` (in `useTabs`) to keep large tab lists from janking active interaction.

## Build specifics

`vite.config.ts` chains three plugins; entry points come from `manifest.json` (not Vite config): `chrome_url_overrides.newtab` → `src/newtab/index.html`, and `background.service_worker` → `src/background/service-worker.ts`.

- **`@crxjs/vite-plugin`** rewrites the manifest and bundles the MV3 service worker.
- **`@tailwindcss/vite`** is **required** — Tailwind v4 is CSS-first (`@import "tailwindcss"` in `src/newtab/index.css`, custom theme vars in an `@theme` block). Without the plugin, the CSS output contains only theme variables and **no utility classes** are emitted. There is no `tailwind.config.js`.

## Conventions

- TypeScript strict; avoid `any`. Functional components only, in `src/newtab/components/`.
- Styling is Tailwind utilities only; custom CSS/animations go in `src/newtab/index.css`.
- Wrap interactive elements with `<Tooltip text="...">` — it's portal-based and space-aware; `position`/`align` are optional (auto-detected) so only set them when you must.
- **No new manifest permissions** and **no external network calls / telemetry** without strong reason — the privacy model is "all data stays in `chrome.storage`."
- Conventional commit prefixes (`fix:`, `feat:`, `refactor:`, `docs:`, `chore:`).

## Docs & data model

`docs/ARCHITECTURE.md` is the technical deep-dive (data flow, storage schema, time-tracking state machine, component map). It was previously duplicated with a stale second half describing a removed Focus/Pomodoro feature — that has been removed; the doc now matches the code.

**Still treat `src/types/index.ts` as the authoritative data model.** Two fields exist but carry no behavior: `EnrichedTab.tags` renders as chips in `TabCard` but has no add/edit UI (always `[]`), and `DailyAnalytics.distractionDomains` is never populated. There is no focus-mode/Pomodoro feature — the README says "No focus timers."

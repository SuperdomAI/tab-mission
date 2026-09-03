# Tab Mission

> A Manifest V3 Chrome extension that replaces your new tab page with a tab management dashboard — spatial site decks, a Timeline of your attention, a ⌘K command palette, goal-driven Workspaces, and usage analytics. Local-first: all data stays in `chrome.storage.*`. No focus timers. No noise.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Chrome Extension](https://img.shields.io/badge/Chrome-Manifest%20V3-green.svg)](https://developer.chrome.com/docs/extensions/mv3/)
[![CI](https://img.shields.io/github/actions/workflow/status/SuperdomAI/tab-mission/ci.yml?branch=main)](https://github.com/SuperdomAI/tab-mission/actions)

---

## Why Tab Mission

Tabs are **objects, not records**. Every site you have open is a physical deck you can glance at — the favicon is the hero, metadata recedes. Color is information, never decoration: hue means identity, status means life.

- **Stacks view** — every open site is a deck, sorted by tab count. Click a deck to open a popover of that site's tabs with per-tab close, jump, and hibernate.
- **Timeline view** — your tabs ordered by attention over time, with a safe "clear forgotten" cleanup for tabs you opened and never touched.
- **Command palette (⌘K)** — search tabs, run actions, and trigger Workspaces from anywhere.
- **Workspaces** — type a goal; Tab Mission proposes which tabs to keep and which to set aside, then snapshots them into a reversible workspace. One-click Undo.
- **Session manager** — save, restore, and delete tab sets; windows are auto-saved when they close.
- **Usage analytics** — today's stats, top domains by time, 30-day trend, and a weekly report.
- **Hibernate** — discard idle tabs to reclaim memory without closing them.
- **Optional local AI** — "Refine with AI" and a tab chat powered by your **local Ollama** (`localhost:11434`). Off by default; core works fully without it.

## Privacy

Tab Mission has **no backend, no telemetry, and no cloud**. Every byte of tab, session, and analytics data lives in `chrome.storage.*` on your machine.

The **only** optional outbound connection is to a local Ollama instance, and it is never made until you opt in:

- The `http://localhost/*` / `http://127.0.0.1/*` host permissions are **optional** (`optional_host_permissions`) — requested at opt-in time, revocable in chrome://extensions.
- The manifest CSP restricts network access to `localhost:11434` only.
- Nothing is ever sent over the network by default.

## Install

### From source (development)

```bash
npm install
npm run build
```

1. Open **`chrome://extensions/`** in Chrome
2. Enable **Developer mode** (toggle, top-right corner)
3. Click **Load unpacked** → select the **`dist/`** folder inside this project
4. Open any **new tab** — Tab Mission takes over

For live development (auto-rebuild on save):

```bash
npm run dev
```

Then click the **↺ Reload** icon on the extension card at `chrome://extensions/` after each rebuild — Vite rebuilds the files, but does not reload the extension.

### Chrome Web Store

Zip `dist/` and upload to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole):

```bash
npm run build
cd dist && zip -r ../tab-mission.zip . && cd ..
```

---

## Commands

```bash
npm run dev       # vite build --watch — rebuilds dist/ on save
npm run build     # production build → dist/
npm run test      # vitest (watch)
npm run test:run  # vitest run
npm run typecheck # tsc --noEmit
```

## Tech Stack

| Layer             | Technology         | Notes                                        |
| ----------------- | ------------------ | -------------------------------------------- |
| Extension API     | Manifest V3        | Service worker, `chrome_url_overrides`       |
| UI Framework      | React 19           | `useTransition` for large tab lists          |
| Language          | TypeScript         | Strict mode                                  |
| Build             | Vite 6 + @crxjs/vite-plugin | MV3 service worker + manifest rewriting |
| Styling           | Tailwind CSS v4    | CSS-first config, `@tailwindcss/vite`        |
| State             | Zustand 5          | Two stores; mirror of `chrome.storage`, not the source of truth |
| Search            | Fuse.js            | Heuristic tab relevance for Workspaces       |
| Motion            | framer-motion      | Spring motion                                |
| Tests             | Vitest + Testing Library | Unit tests for hooks and components     |

## Project Structure

```
├── manifest.json                    # MV3 manifest (entry points)
├── src/
│   ├── background/
│   │   └── service-worker.ts        # The ONLY writer of tab/analytics/session data
│   ├── types/index.ts               # EnrichedTab, DailyAnalytics, SavedSession, Workspace
│   ├── store/                       # Zustand: tabStore + analyticsStore (read-only mirrors)
│   └── newtab/
│       ├── App.tsx                  # Header, views, drawers, undo toast
│       ├── index.css                # Tailwind v4 + custom animations
│       ├── hooks/                   # useTabs (storage → store), useTabActions, useWorkspaces
│       └── components/              # Stacks, Timeline, CommandPalette, Workspaces, …
└── docs/
    └── ARCHITECTURE.md              # Data flow, storage schema, time-tracking state machine
```

The one rule that matters: **the background service worker is the only writer** of tab/analytics/session data. The UI loads `chrome.storage.local` on mount and subscribes to `chrome.storage.onChanged` — it never owns tab state. Settings are the exception (`chrome.storage.sync`).

## Permissions

```json
["tabs", "windows", "storage", "idle", "alarms", "tabGroups", "favicon", "declarativeNetRequestWithHostAccess"]
```

| Permission | Used for |
| ---------- | -------- |
| `tabs` | Query, update, remove, discard tabs |
| `windows` | Focus windows, auto-save on window close |
| `storage` | `chrome.storage.local` (tabs, analytics, sessions) + `chrome.storage.sync` (settings) |
| `idle` | Pause time tracking when the user goes idle (60s threshold) |
| `alarms` | Peak tab count snapshot every 60s (survives service worker restarts) |
| `tabGroups` | Read group name + color for display |
| `favicon` | Serve tab favicons to the new tab page |
| `declarativeNetRequestWithHostAccess` | Strip the `Origin` header on localhost-only requests so a local Ollama accepts them |

**Optional** host permissions (requested at opt-in, revocable): `http://localhost/*`, `http://127.0.0.1/*`.

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Report bugs via [issues](https://github.com/SuperdomAI/tab-mission/issues), security concerns via [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © Tab Mission Contributors
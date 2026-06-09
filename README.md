# Tab Mission

> A Chrome Extension that replaces your new tab page with a clean, powerful tab management dashboard — domain grouping, fuzzy search, session saving, and usage analytics. No focus timers. No noise. Just your tabs, under control.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Chrome Extension](https://img.shields.io/badge/Chrome-Manifest%20V3-green.svg)](https://developer.chrome.com/docs/extensions/mv3/)
[![Built with React](https://img.shields.io/badge/React-19-61dafb.svg)](https://react.dev/)
[![Built with Vite](https://img.shields.io/badge/Vite-6-646cff.svg)](https://vite.dev/)

---

## Load in Chrome (Developer Mode)

> Use this during development or before publishing to the Chrome Web Store.

1. Run the build:
   ```bash
   npm install
   npm run build
   ```
2. Open **`chrome://extensions/`** in Chrome
3. Enable **Developer mode** (toggle, top-right corner)
4. Click **Load unpacked** → select the **`dist/`** folder inside this project
5. Open any **new tab** — Tab Mission takes over

To update after code changes: run `npm run build` again, then click the **↺ refresh** icon on the extension card at `chrome://extensions/`.

For live development (auto-rebuild on save):

```bash
npm run dev
```

Then reload the extension manually after each rebuild.

---

## Publish to Chrome Web Store

1. Run a clean production build:
   ```bash
   npm run build
   ```
2. Zip the `dist/` folder:
   ```bash
   cd dist && zip -r ../tab-mission.zip . && cd ..
   ```
3. Go to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
4. Click **New Item** → upload `tab-mission.zip`
5. Fill in store listing details (description, screenshots, category: **Productivity**)
6. Submit for review (typically 1–3 business days)

---

## Features

| Feature               | Description                                                                   |
| --------------------- | ----------------------------------------------------------------------------- |
| **Domain Grouping**   | Tabs auto-grouped by domain, sorted by count, collapsible                     |
| **Fuzzy Search**      | Fuse.js search across title, URL, domain — keyboard nav (⌘K / ↑↓/↵)           |
| **Tab Cards**         | Color-coded by activity: green = recent · amber = stale · red = never visited |
| **Bulk Actions**      | Close duplicates, unvisited, and zombie tabs with one click                   |
| **Session Manager**   | Save/restore/delete tab sets — accessible from the footer                     |
| **Analytics**         | Today's stats, top domains by time, tab trend vs. 30-day average              |
| **Weekly Report**     | 7-day bar chart, busiest day, most-visited domain, per-day breakdown          |
| **Settings**          | Zombie threshold, unvisited auto-close, tab limit warning, theme              |
| **Keyboard Shortcut** | ⌘K (Mac) / Ctrl+K (Windows) to focus search from anywhere                     |

---

## Project Structure

```
tab-mission/
├── manifest.json               # MV3 manifest (version 1.0.0)
├── vite.config.ts              # Vite + @tailwindcss/vite + @crxjs/vite-plugin
├── tsconfig.json
├── package.json
├── LICENSE
├── CONTRIBUTING.md
├── public/
│   └── icons/                  # icon16/48/128.png
├── docs/
│   └── ARCHITECTURE.md         # Data model, data flow, component map
└── src/
    ├── types/
    │   └── index.ts            # EnrichedTab, DailyAnalytics, SavedSession, AppSettings
    ├── background/
    │   └── service-worker.ts   # Chrome event listeners, time tracking
    ├── store/
    │   ├── tabStore.ts         # Zustand: tabs, settings, sessions
    │   └── analyticsStore.ts   # Zustand: analytics[] + selectors
    └── newtab/
        ├── index.html
        ├── main.tsx
        ├── App.tsx             # Root layout: header / stats bar / domain grid / footer
        ├── index.css           # Tailwind v4 + custom animations
        ├── hooks/
        │   ├── useTabs.ts      # Bootstrap storage → store + live sync
        │   └── useSession.ts   # Save / restore / delete sessions
        └── components/
            ├── TabCard.tsx             # Individual tab card
            ├── DomainGroup.tsx         # Collapsible domain group
            ├── SearchBar.tsx           # Fuzzy search with keyboard nav
            ├── BulkActions.tsx         # Footer action buttons with live counts
            ├── SessionManager.tsx      # Sessions drawer
            ├── AnalyticsDashboard.tsx  # Analytics drawer
            ├── WeeklyReport.tsx        # 7-day report drawer
            ├── Settings.tsx            # Settings drawer
            └── Tooltip.tsx             # Space-aware tooltip (portal-based)
```

---

## Tech Stack

| Layer             | Technology         | Version | Notes                                         |
| ----------------- | ------------------ | ------- | --------------------------------------------- |
| Extension API     | Manifest V3        | —       | Service worker, `chrome_url_overrides`        |
| UI Framework      | React              | 19      | `useTransition`, `useMemo`, `useRef`          |
| Language          | TypeScript         | 5.7     | Strict mode, bundler module resolution        |
| Build             | Vite               | 6       | `npm run dev` = watch, `npm run build` = prod |
| Extension bundler | @crxjs/vite-plugin | 2.x     | MV3 service worker + manifest rewriting       |
| Styling           | TailwindCSS        | v4      | CSS-first config via `@tailwindcss/vite`      |
| State             | Zustand            | 5       | Two stores; `useShallow` for object selectors |
| Search            | Fuse.js            | 7       | Fuzzy search, threshold 0.35                  |
| Dates             | date-fns           | 4       | `formatDistanceToNow`, `format`               |

---

## npm Scripts

```bash
npm run dev      # vite build --watch  (auto-rebuilds on save)
npm run build    # vite build          (production output → dist/)
```

After every rebuild, go to `chrome://extensions/` and click **⟳ Reload** to pick up changes.

---

## Permissions

```json
["tabs", "windows", "storage", "idle", "alarms", "tabGroups"]
```

| Permission  | Used for                                                                              |
| ----------- | ------------------------------------------------------------------------------------- |
| `tabs`      | Query, update, remove, discard tabs                                                   |
| `windows`   | Focus windows, auto-save on window close                                              |
| `storage`   | `chrome.storage.local` (tabs, analytics, sessions) + `chrome.storage.sync` (settings) |
| `idle`      | Pause time tracking when user goes idle (60s threshold)                               |
| `alarms`    | Peak tab count snapshot every 60s (survives service worker restarts)                  |
| `tabGroups` | Read group name + color for display                                                   |

---

## Known Issues / Next Steps

- Icons are placeholder solid-color PNGs — replace with real artwork before store submission
- `unvisitedAutoCloseEnabled` setting is stored but background auto-close is not yet wired
- No unit tests yet — recommend Vitest + React Testing Library
- No WindowGroup view (grouping by window instead of domain)

---

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## License

[MIT](LICENSE) © Tab Mission Contributors

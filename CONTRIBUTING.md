# Contributing to Tab Mission Control

Thanks for taking the time to contribute! This is a focused Chrome extension — contributions that improve tab management UX, performance, or accessibility are most welcome.

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v18+
- Chrome (for testing the extension)
- Git

### Local setup

```bash
git clone https://github.com/YOUR_USERNAME/tab-mission-control.git
cd tab-mission-control
npm install
npm run dev   # auto-rebuilds on every save
```

Then load the extension in Chrome:

1. Go to `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** → select the `dist/` folder
4. Open a new tab

After code changes, click the **↺ Reload** icon on the extension card.

---

## How to Contribute

### Reporting a bug

Open an [issue](https://github.com/YOUR_USERNAME/tab-mission-control/issues) with:

- Chrome version and OS
- Steps to reproduce
- What you expected vs. what happened
- Screenshot or screen recording if possible

### Suggesting a feature

Open an issue with the `enhancement` label. Describe the use case — what tab management problem does it solve?

### Submitting a pull request

1. **Fork** the repository and create a branch from `main`:
   ```bash
   git checkout -b feat/your-feature-name
   ```
2. Make your changes (see code conventions below)
3. Run a build to make sure nothing is broken:
   ```bash
   npm run build
   ```
4. Test the built extension manually in Chrome
5. Open a pull request against `main`

---

## Code Conventions

- **TypeScript** — strict mode. No `any` unless genuinely unavoidable.
- **Components** — functional, in `src/newtab/components/`. Use existing Zustand stores; don't add new state unless necessary.
- **Styling** — Tailwind utility classes only. Custom CSS lives in `src/newtab/index.css`.
- **Tooltips** — wrap interactive elements with `<Tooltip text="...">`. No hardcoded `position` / `align` — it's auto-detected.
- **No new permissions** — avoid adding manifest permissions without a very strong reason.
- **No external network calls** — all data stays in `chrome.storage.*`. No analytics SDKs, no telemetry.
- **Commit style** — conventional commits preferred: `fix:`, `feat:`, `refactor:`, `docs:`, `chore:`.

---

## Project Structure (quick reference)

```
src/
├── background/service-worker.ts   # Chrome event listeners, time tracking
├── store/                         # Zustand: tabStore + analyticsStore
├── types/index.ts                 # Shared TypeScript interfaces
└── newtab/
    ├── App.tsx                    # Root layout
    ├── components/                # UI components
    └── hooks/                     # useTabs, useSession
docs/
└── ARCHITECTURE.md               # Deep-dive: data model, data flow, component map
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full technical reference.

---

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).

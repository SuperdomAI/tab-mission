# Changelog

All notable changes to Tab Mission are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Shared AI infrastructure** (`src/lib/ai/`, stage A of `docs/AI-FEATURES-PLAN.md`): a model registry with per-RAM recommendations (`models.ts`), a content-addressed result cache keyed by `sha1(task + input signature)` with per-task TTLs (`cache.ts`), tab-set/analytics fingerprints so cached results invalidate only on real change (`signatures.ts`), strict JSON extraction with fallbacks (`parse.ts`), prompt builders for all eight planned AI features (`prompts.ts`), and embedding math — cosine similarity, top-k, semantic+Fuse merge (`embed.ts`).
- **`AppSettings` AI fields:** per-tier model choices (`aiFastModel` / `aiChatModel` / `aiEmbedModel`, defaulting to the 16 GB recommended stack), a page-reading gate (`aiPageReadingEnabled`, off by default), and per-feature toggles (`aiDebrief`, `aiTriage`, `aiSuggestions`, `aiSessionMemory`, `aiSemanticSearch`, `aiCoach`, `aiIdleDrafts`), all default ON when the existing AI master toggle is on. No new required permissions.
- **Ollama transport:** `bgFetch` is now exported for service-worker reuse and a `/api/embed` batch-embedding call was added (`src/lib/ollama.ts`).
- **Daily debrief (F1)** — a "Today's Debrief" card at the top of the Analytics drawer (`DebriefCard`): a short, honest evening report from the local chat model, generated on demand with a Regenerate button and auto-generated when the drawer opens and today's report is missing or stale (TTL 6 h). Cached per day under `aiReports` in `chrome.storage.local`; hidden entirely when Ollama is off or the `aiDebrief` toggle is off.
- **Habits coach (F11)** — a "Coach · 30 Days" section in the Weekly Report (`CoachCard`): 2-3 honest patterns plus one actionable suggestion over the last 30 days of analytics, cached per ISO week in `aiReports` (TTL 6 h). Drawer-only, never interrupts; gated by `aiCoach`.
- **Report cache + hook** — `AIReportCache` (`src/lib/ai/reports.ts`) with the same freshness contract as `AiCache` (per-task TTL, model mismatch rejection, 30-day prune) and a `useAIReports` hook mirroring the `aiReports` storage key; report parsers (`parseDebriefReport` / `parseCoachReport`) shape-validate model output through the `parse.ts` funnel.
- **JSON-mode `generate()` transport** (`src/lib/ollama.ts`) — `/api/generate` with `format: "json"` and the tier's suggested context window (`num_ctx` 4096 fast / 8192 chat).
- **Settings — AI tiers & feature toggles:** per-tier model fields (`aiFastModel` / `aiChatModel` / `aiEmbedModel`) with auto-pick on Ollama connect via `resolveModel` (`pickMissingModels`), `ollama pull` hints for the recommended stack, a "Read pages for AI" gate, and the seven per-feature toggles.
- **Legacy model carry-over:** `mergeSettings` migrates a user-chosen `ollamaModel` into `aiChatModel` once (AskAI and Focus "Refine with AI" now read the chat tier; the legacy field stays as an aligned alias).
- **AI tab triage (F2)** — an "AI triage" button on the Timeline next to Clear forgotten: candidate tabs (forgotten + zombies + never-visited, deduped, pinned excluded, capped at 40) are classified close/keep by the fast model into a two-column review overlay (`TriageProposal`, same grammar as FocusProposal) with reasons grouped by category and a per-item keep/close override. Approve snapshots the closes into a session (`AI triage — <date>`) FIRST via `saveAndClose`, so the action is reversible; nothing closes until confirmed. Cached by tab-set signature (TTL 1 h on-demand).
- **Idle-time draft plans (F12)** — the service worker now drafts a triage plan while the machine is idle (Ollama on + `aiTriage`/`aiIdleDrafts` on + ≥ 8 tabs + the tab set changed since the last draft; fire-and-forget, best-effort, never awaited). Drafts are stored under `aiTriagePlan` with `source: "idle"` (TTL 2 h); on return, a quiet chip on the Timeline reads "AI drafted a cleanup plan while you were away → Review", and dismissing it clears the notice until a new draft arrives. The on-demand triage path always works — the SW draft is a convenience, never a dependency.
- **Triage module** (`src/lib/ai/triage.ts`) — candidate selection (`triageCandidates`), strict plan parser with per-item shape validation through the `parse.ts` funnel, storage coercion + per-source TTL freshness (`TriageCache`, shared by the UI hook and the service worker), and the fast-tier `generateTriage` wrapper. `bgFetch` now direct-fetches inside the service worker (no `window` → no pointless message round-trip).

### Fixed

- **New AI settings no longer come back `undefined` for existing users.** Stored settings are now merged over `DEFAULT_SETTINGS` (`mergeSettings` in `src/types/index.ts`, applied at load and on change in `useTabs.ts`) so the new `ai*` fields resolve to their defaults until saved.

## [1.2.0] - 2026-09-03

### Fixed

- **Closed tabs no longer linger in the new-tab dashboard.** All background tab mutations are now serialized through a mutex (`src/background/tabsLock.ts`) — previously, `onRemoved` and `onActivated` fired together on close and a stale write could resurrect a just-closed tab in storage until the service worker next woke. The window auto-save path is covered by the same lock so saved sessions never miss the last closed tab.

### Added

- **Open-source launch kit:** README rewritten around the current product (spatial decks, Timeline, ⌘K palette, Workspaces, local-first privacy), `SECURITY.md` with the responsible-disclosure path and security model, and a CI workflow (typecheck + tests + build on every push/PR to `main`).
- **Unit tests for the storage mutex** (`src/background/tabsLock.test.ts`) covering serialization order, chain survival after a rejected op, and sequential pass-through.

### Changed

- README, CONTRIBUTING, and `package.json` now point at the real repository (`SuperdomAI/tab-mission`) instead of placeholders.
- `AGENTS.md` documents the test/typecheck commands and CI; the stale duplicate `CLAUDE.md` and local agent config are no longer tracked.
- `manifest.json` version bumped to match `package.json` (1.2.0).
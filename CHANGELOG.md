# Changelog

All notable changes to Tab Mission are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Shared AI infrastructure** (`src/lib/ai/`, stage A of `docs/AI-FEATURES-PLAN.md`): a model registry with per-RAM recommendations (`models.ts`), a content-addressed result cache keyed by `sha1(task + input signature)` with per-task TTLs (`cache.ts`), tab-set/analytics fingerprints so cached results invalidate only on real change (`signatures.ts`), strict JSON extraction with fallbacks (`parse.ts`), prompt builders for all eight planned AI features (`prompts.ts`), and embedding math — cosine similarity, top-k, semantic+Fuse merge (`embed.ts`).
- **`AppSettings` AI fields:** per-tier model choices (`aiFastModel` / `aiChatModel` / `aiEmbedModel`, defaulting to the 16 GB recommended stack), a page-reading gate (`aiPageReadingEnabled`, off by default), and per-feature toggles (`aiDebrief`, `aiTriage`, `aiSuggestions`, `aiSessionMemory`, `aiSemanticSearch`, `aiCoach`, `aiIdleDrafts`), all default ON when the existing AI master toggle is on. No new required permissions.
- **Ollama transport:** `bgFetch` is now exported for service-worker reuse and a `/api/embed` batch-embedding call was added (`src/lib/ollama.ts`).

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
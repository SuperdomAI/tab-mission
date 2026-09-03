# Changelog

All notable changes to Tab Mission are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

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
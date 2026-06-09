# TODOS

Deferred work for Tab Mission. Captured during the Phase 1 eng review (2026-06-06).

## E2E smoke for destructive flows
- **What:** Playwright + load-unpacked extension smoke covering close-one, close-all, hibernate-all, save+restore, clear-forgotten.
- **Why:** Phase 1 ships destructive tab actions with unit tests against a mocked `chrome` only. Only a real-extension E2E proves tabs actually close and restore. Trust-critical for a store-bound tool.
- **Pros:** Real coverage of the flows that can destroy a user's tabs.
- **Cons:** Playwright-with-extension setup cost (persistent context, `--load-extension=dist`).
- **Context:** User chose unit-only for the ship gate (T2). This captures E2E as future work, not a blocker.
- **Depends on:** Phase 1 UI built; a `dist/` build to load.

## Restore-then-autosave duplicate sessions
- **What:** Suppress or dedup the `windows.onRemoved` auto-save when the closed window was created by a session restore.
- **Why:** `useSession.restoreSession` opens a window with all URLs; closing it later triggers the auto-save listener (`service-worker.ts:274`), creating a near-duplicate session. The new "Save as session" surfaces worsen it.
- **Pros:** Keeps the session list clean as save surfaces multiply.
- **Cons:** Small service-worker change outside the Phase 1 UI scope.
- **Context:** Tag restore-created windows (track the new windowId) or dedup sessions by tab-set hash. Found by the outside-voice review.
- **Depends on:** none; self-contained.

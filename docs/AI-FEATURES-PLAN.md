# AI Features Implementation Plan (v1.3.0 — "Tab Mission Intelligence")

Scope: features 1, 2, 3, 4, 6, 7, 11, 12 from the AI brainstorm. All run on a **local Ollama** instance; nothing leaves the machine. Status: **stages A–D landed** (PR A: shared infra + settings fields; PR B: F1 daily debrief + F11 habits coach + settings model tiers; PR C: F2 AI triage overlay + F12 idle drafts; PR D: F3 proactive suggestions + F4 session memory). Remaining: F7 (PR E), F6 (PR F).

---

## 0. Non-negotiables

1. **AI proposes, the UI executes.** Every destructive action (close, set-aside, hibernate) goes through the existing `useTabActions` / `useWorkspaces` paths — reversible, session-first. AI output is *data*, never a side effect.
2. **One-way data flow preserved.** The service worker remains the only writer of `tabs`/`analytics`/`sessions`. AI artifacts are *derived, regenerable caches* — they live under new UI/`chrome.storage.local` keys, same precedent as `workspaces` (which is deliberately UI-owned).
3. **No new required permissions.** Features 1-4, 11, 12 need **zero** manifest changes. Only feature 6 (and optionally 7) asks for page content — via `optional_permissions` + on-demand host grants, mirroring the existing Ollama opt-in pattern (revocable in `chrome://extensions`).
4. **Graceful degradation is a feature.** Every AI surface hides when Ollama is off, unreachable, or permission is denied. The product must remain complete without AI (existing principle, enforced in every UI mount).
5. **No telemetry.** No new outbound calls beyond `localhost:11434`. CSP unchanged (`connect-src` already scoped to localhost).
6. **Tests for every pure function** (prompt builders, JSON parsers, cache, cosine similarity, merge logic). Model-dependent code stays thin wrappers over tested primitives — the `tabsLock` pattern.

---

## 1. Shared infrastructure (`src/lib/ai/`)

New module, keeps `src/lib/ollama.ts` as the transport layer (extend it, don't fork it).

| File | Contents |
|---|---|
| `src/lib/ai/models.ts` | Model registry + per-task model resolution (see §2). `AI_TASK` = `"fast"` \| `"chat"` \| `"embed"` |
| `src/lib/ai/cache.ts` | Content-addressed result cache: key = `sha1(task + inputSignature)`, value = `{ result, generatedAt, model }`. TTL per task. Pure + tested |
| `src/lib/ai/prompts.ts` | Prompt builders for all 8 features. Pure + tested |
| `src/lib/ai/parse.ts` | Strict JSON extraction with fallback regexes (pattern: `parseRelevantIds` in ollama.ts:91). Pure + tested |
| `src/lib/ai/signatures.ts` | Tab-set / analytics fingerprints so cached results invalidate only on real change. Pure + tested |
| `src/lib/ai/embed.ts` | Embedding calls (`/api/embed`) + cosine similarity + top-k merge. Pure parts tested |

Transport additions to `src/lib/ollama.ts`:
- `embed(texts: string[], model): Promise<number[][]>` → `bgFetch("/api/embed", { body: { model, input } })`
- Export `bgFetch` for SW-side reuse.

Storage additions (all `chrome.storage.local`, all regenerable):

| Key | Owner | Contents |
|---|---|---|
| `aiReports` | UI (via `useAIReports`) | `{ [date]: { summary, sections, generatedAt, model } }` — daily debrief + weekly coach |
| `aiTriagePlan` | UI + SW (idle drafts) | `{ signature, items: { tabId, reason, action }[], generatedAt, source: "on-demand" \| "idle" }` |
| `aiSessionSummaries` | UI + SW | `{ [sessionId]: { summary, generatedAt, model } }` |
| `aiSuggestions` | UI | `{ signature, items: { goal, tabIds, reason }[], dismissed: boolean }` |
| `aiReadingList` | UI | `{ id, url, title, summary, savedAt }[]` (cap 100) |
| `aiTabEmbeddings` | UI + SW | `{ model, dims, vectors: { [tabId]: number[] } }` — re-embed when `model` changes |

Settings additions (`AppSettings`, `chrome.storage.sync`): a single **AI Assist** master toggle (reuses `ollamaEnabled`) plus:
- `aiFastModel` (classification/triage default), `aiChatModel` (summaries/reports default), `aiEmbedModel` (default `nomic-embed-text`)
- `aiPageReadingEnabled` (gates F6/F7-content; requests `scripting` + host grants on first enable)
- Per-feature toggles, all default ON when master is on: `aiDebrief`, `aiTriage`, `aiSuggestions`, `aiSessionMemory`, `aiSemanticSearch`, `aiCoach`, `aiIdleDrafts`

Defaults resolve against installed models (extend `toggleOllama` auto-pick in Settings.tsx:42): prefer the recommended stack, else first installed model, else prompt user with `ollama pull` hints.

---

## 2. Model recommendations (16 GB machines)

| Tier | Task | Model (Ollama tag) | Size | Why |
|---|---|---|---|---|
| **Chat** | F1 debrief, F4 session summaries, F6 summarize, F11 coach | `qwen2.5:7b-instruct-q4_K_M` | ~4.7 GB | Most reliable JSON + instruction following at 7B; fast on Apple Silicon |
| **Chat alt** | prose-heavy output | `llama3.1:8b-instruct-q4_K_M` | ~4.9 GB | Slightly better natural prose; pick if prose reads stilted |
| **Fast** | F2 triage, F3 suggestions, F12 drafts, F7 query intent | `qwen2.5:3b-instruct-q4_K_M` | ~2.0 GB | Sub-second classifications; JSON format support |
| **Embed** | F7 semantic search | `nomic-embed-text` | ~274 MB | Standard local embedding (768-dim) |

Total resident with KV cache ≈ 6-7 GB — comfortable on 16 GB alongside Chrome/OS. Recommendation logic in `models.ts`:

- 16 GB RAM → chat: 7B/8B, fast: 3B
- 8 GB RAM → chat: `gemma3:4b-instruct-q4_K_M` (~2.5 GB), fast: `qwen2.5:1.5b` (~1 GB)
- Suggest `num_ctx` 4096 for fast tasks (speed), 8192 for chat/summarize (context).
- If user's installed model is not in the registry → use it as both tiers, log nothing, never block.

---

## 3. Feature specs

### F1 — Daily debrief ("Evening report")
- **Inputs:** today's `DailyAnalytics` (domainTime, opened/closed, peak, debtScore) + today-visited tab titles/domains (from `tabs`, `lastActiveAt` >= start of day).
- **Prompt:** prose instructions → structured JSON `{ summary, sections: [{ heading, text }] }`. Chat model.
- **Generation:** on-demand, top of Analytics drawer ("Today's debrief" card, `Regenerate` button) + auto-generate when the drawer opens and today's report is missing/stale (cache TTL 6 h). No alarm cron in v1 (SW lifetime risk — see §6).
- **Storage:** `aiReports[date]`. **UI:** new `DebriefCard` component inside `AnalyticsDashboard.tsx` (keeps design system: label-mono heading, muted body, no emoji).
- **Tests:** prompt builder, parser, cache invalidation on new data.

### F2 — Tab-debt triage plan ("AI triage") — landed in PR C
- **Inputs:** candidate tabs from existing selectors — `clearableForgotten` (bucketByRecency.ts), `selectZombies`, `selectUnvisited` (bulkSelectors.ts) — with `{ id, title, domain, openedAt, lastActiveAt, visitCount }`. Cap list at 40 tabs (prompt size).
- **Prompt:** fast model, JSON: `{ items: [{ tabId, action: "close"|"keep", reason, category: "duplicate"|"same-thread"|"stale"|"unvisited"|"junk" }] }`. `format: "json"` + `parse.ts` fallback.
- **UI:** "AI triage" button in `TimelineView.tsx` next to ⌫ Clear forgotten. Opens `TriageProposal` overlay (same two-column visual grammar as `FocusProposal.tsx`): plan list with reasons grouped by category, per-item keep/close override, `Approve` → `saveAndClose("AI triage — <date>", items)` (session-first, reversible, pins excluded). Cache by tab-set signature, TTL 1 h.
- **Tests:** prompt builder, parser (incl. garbage output), signature invalidation, category grouping.

### F3 — Proactive workspace suggestions — landed in PR D
- **Inputs:** open tabs (title/domain/windowId), ≥ 8 tabs and Ollama on and suggestion not dismissed this session.
- **Prompt:** fast model, JSON `{ suggestions: [{ goal, tabIds, reason }] }`, max 2, tabIds subset of open ids.
- **Generation:** on new-tab load, debounced 3 s, cached by signature; regenerate when tab set changed by ≥ 5 tabs.
- **UI:** quiet strip on `StacksView.tsx` — one line, mono label `AI suggests`, goal chips ("Launch planning · 12 tabs"). Click → opens existing `FocusProposal` pre-filled with that goal (zero new destructive machinery). Dismiss (×) hides until the next generation.
- **Storage:** `aiSuggestions = { signature, items: { goal, tabIds, reason }[], generatedAt, model, tabCount, dismissed }` (UI-owned; TTL 30 min; `tabCount` + `dismissed` are additive to the plan doc's shape — the ≥ 5-tab regen rule and the per-plan dismiss flag).
- **Tests:** prompt builder, output validation (ids ⊆ open), debounce/cache logic.

### F4 — Session memory — landed in PR D
- **Inputs:** a session's tab snapshot (title/url/domain-list). Chat model.
- **Prompt:** "5-line summary of what this tab set was about, in the past tense." JSON `{ summary }`.
- **Generation hook points:**
  - UI saves (`persistSession` in useTabActions.ts:6) → fire-and-forget summarization, write `aiSessionSummaries[id]`.
  - SW auto-save (`windows.onRemoved` in service-worker.ts:372) → SW calls the same shared helper (`summarizeSession`) directly (SW fetch has no Origin header; no CORS issue), writes `aiSessionSummaries`.
- **UI:** `SessionManager.tsx` shows summary line under session name; `CommandPalette` gains "Search sessions" — Fuse.js over names + summaries (the no-AI fallback IS the Fuse search; semantic embedding lands with F7 in PR E).
- **Storage:** `SavedSession` gains optional `summary?: string` (in-session cache, backfilled; the authoritative `aiSessionSummaries` map stays separate to avoid touching SW's session writes).
- **Tests:** summary prompt, cache/coercion, summarizeSession orchestration (gating, map write, backfill), fallback path.

### F6 — Summarize-then-close (needs new optional permissions — the only one)
- **Permissions:** add `"scripting"` to `optional_permissions`; request `<all_urls>`-style host grants (`http://*/*`, `https://*/*`) **at first use** via `chrome.permissions.request`, behind `aiPageReadingEnabled` in Settings ("Allow reading pages for AI"). Revocable. Store-review note in §6.
- **Mechanics:**
  1. `chrome.scripting.executeScript` → inline function returning `{ title, metaDescription, text }` (visible text, truncate ~6k chars).
  2. `bgFetch("/api/generate")` — chat model, "3-5 bullet summary, ≤ 120 words, keep the why-it-mattered." JSON.
  3. Persist to `aiReadingList` **before** closing (order guaranteed, same as `saveAndClose`).
  4. Close the tab via `useTabActions.close`; undo toast reuses the pattern (reopen + remove entry).
- **UI:** "Summarize & close" action on `TabRow` / `DeckPopover` rows (small ghost button, hover-revealed — design system: metadata recedes); "Reading list" section in the Sessions drawer (or own drawer if it outgrows).
- **Tests:** content truncation, prompt, parse, list cap, close-order guarantee.

### F7 — Semantic ⌘K search
- **Inputs:** tab title + domain (+ summary/content if F6 content available). Embed model.
- **Mechanics:** lazy embed on palette open (each tab once), cache in `aiTabEmbeddings` keyed by `{ model, tabId, title }`; query embed debounced 250 ms; cosine threshold ≈ 0.32; merge with Fuse results (semantic group first when above threshold, Fuse after). AI off → pure Fuse (today's behavior).
- **UI:** `CommandPalette.tsx` — no visual change beyond a subtle "semantic" hint on AI-matched rows (hue = information rule: use a faint accent dot, not decoration).
- **Tests:** cosine, top-k merge, threshold gating, cache invalidation.

### F11 — Habits coach (weekly insight)
- **Inputs:** last 30 days of `analytics` (domainTime per day, opened/closed, debtScore). Chat model.
- **Prompt:** "Find 2-3 honest patterns + one actionable suggestion. No guilt-tripping." JSON `{ insights: [{ text, severity }] }`.
- **UI:** "Coach" section in `WeeklyReport.tsx`, cached per ISO week in `aiReports`. Regenerate button. Never interrupts (drawer-only, by design).
- **Tests:** prompt, parser, week-key cache.

### F12 — Idle-time draft plans — landed in PR C
- **Mechanics:** `chrome.idle.onStateChanged` → on transition to `"idle"`, if Ollama on + ≥ 8 tabs + triage signature differs from last draft → fire-and-forget F2 generation in the **SW** (async; do not await; never wake-lock). Write `aiTriagePlan` with `source: "idle"`. TTL 2 h.
- **UI:** on return to `active`, a quiet chip on the Timeline: "AI drafted a cleanup plan while you were away → Review". Click → `TriageProposal`. Dismiss clears the flag.
- **Risk note:** SW may die mid-generation (MV3). Draft is best-effort; on-demand triage (§F2) always works. Do not retry storms.
- **Tests:** signature comparison, TTL, source tagging, SW-write guard (ollama off → no-op).

---

## 4. Manifest & settings changes (summary)

```jsonc
// manifest.json — additive, optional-only
"optional_permissions": ["scripting"],
"optional_host_permissions": [ "http://localhost/*", "http://127.0.0.1/*", "http://*/*", "https://*/*" ]
```
CSP unchanged. `tabs` permission already grants title/url for F1-F4/F7-title embeddings — page *reading* is the only new capability, and it's optional + on-demand.

Settings drawer: extend the Local AI section — model fields per tier, "Read pages for AI" toggle, per-feature toggles, `ollama pull` hints for the recommended stack.

---

## 5. Implementation order (one PR per stage, each lands green)

| PR | Contents | Risk |
|---|---|---|
| **A** | `src/lib/ai/` infra: models, cache, prompts, parse, signatures + tests; settings fields | none (no UI) |
| **B** | F1 debrief + F11 coach (read-only reports, cached) | none |
| ✅ **C** | F2 triage overlay + F12 idle drafts (session-first close path) | low |
| ✅ **D** | F3 suggestions + F4 session memory (additive storage, SW hook) | low |
| **E** | F7 semantic ⌘K search (fallback preserved) | low |
| **F** | F6 summarize-then-close (optional permissions, store-review note) | medium (perms) |

Every PR: `npm run typecheck` + `npm run test:run` + `npm run build`, new tests alongside, CHANGELOG entry, `docs/ARCHITECTURE.md` storage-schema section update. Version bumps at the end of each stage (next: 1.3.0).

---

## 6. Risks & gotchas

- **MV3 SW ephemerality:** SW-initiated generation (F12, F4-auto-save) is fire-and-forget; an in-flight `fetch` keeps the worker alive, but never depend on completion. On-demand paths (UI-triggered) are the reliable ones — prefer them for v1.
- **Generation latency:** 7B summarization can take 10-60 s. Cache aggressively (signatures + TTL), show existing "Thinking…" affordances, never block render.
- **Prompt size:** cap tab lists at ~40 entries; truncate page text to ~6k chars; keep `num_ctx` small for fast tasks.
- **JSON reliability:** always `format: "json"` + tested fallback parsing (`parse.ts`), never trust raw output.
- **Storage quota:** `chrome.storage.local` ~10 MB — embeddings for 100 tabs ≈ 300 KB, reports/summaries are KBs. Cap `aiReadingList` at 100. No `unlimitedStorage` permission.
- **Embedding-model drift:** key `aiTabEmbeddings` by model name; re-embed when it changes.
- **Store review:** F6's optional `<all_urls>` grant must be justified in the listing ("optional, off by default, only reads the page you click Summarize on, revocable"). SECURITY.md + README updated in PR F.
- **Design system:** all new surfaces follow DESIGN.md — mono labels, muted body text, no emoji, no decorative color, real depth on overlays. AI status is never a colored badge unless it's a status.
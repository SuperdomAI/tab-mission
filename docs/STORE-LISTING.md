# Tab Mission — Chrome Web Store Publish Kit (v1.1.0)

Artifact to upload: `tab-mission-v1.1.0.zip` (repo root, gitignored — rebuild as needed).
Category: **Productivity** · Language: **English**

---

## 1. Store name
```
Tab Mission
```

## 2. Short description (max 132 chars)
```
Your new tab, under control: spatial decks, ⌘K command palette, a timeline, and goal-driven Workspaces. Private. Optional local AI.
```

## 3. Detailed description
```
Take command of your browser tabs — right from your new tab page.

Tab Mission turns a wall of open tabs into something calm and fast. No accounts, no servers, no tracking. Everything stays on your machine.

VIEWS
• Stacks — every site becomes a tidy, recognizable card "deck." Click a deck to see that site's tabs and close them individually, or in bulk.
• Timeline — see your tabs by when you last used them (Now → Forgotten), and clear the forgotten ones safely (they're saved to a session first).

⌘K COMMAND PALETTE
Press ⌘K (Ctrl+K) to search every tab, jump to one, switch views, or run a bulk action — keyboard-first, instant.

WORKSPACES (focus on a goal)
Type what you're working on and Tab Mission proposes which tabs to keep and which to set aside. Confirm, and the rest are tucked into a named Workspace — closed, but one click to undo and easy to restore later. Nothing is ever deleted without a safety net, and pinned tabs are never touched.

CLEAN UP THE CHAOS
• Close duplicates, never-visited, and stale "zombie" tabs in one move.
• Hibernate background tabs to free memory (they stay in your tab bar).
• Save and restore whole sessions.
• A quiet usage dashboard and weekly report.

PRIVATE BY DESIGN
All your data lives in your browser's local storage. No external servers, no analytics, no telemetry.

OPTIONAL LOCAL AI (off by default)
If you run Ollama on your own machine, you can turn on "Refine with AI" and chat about your tabs — entirely local, no cloud, no API keys. The core features work fully without it.

Free and open. Built by the Superdom AI team.
```

## 4. Single purpose (review form)
```
Replace the browser's new tab page with a dashboard for organizing, searching, and cleaning up open tabs.
```

## 5. Permission justifications (paste each into its field)
```
tabs — Read the user's open tabs to display, group by site, search, and act on them (jump, close, hibernate). This is the core function.

windows — Focus the correct window when the user jumps to a tab, and auto-save a window's tabs as a restorable session when it is closed.

storage — Save the user's tabs, sessions, workspaces, settings, and usage stats locally via chrome.storage. No data leaves the device.

idle — Pause time-tracking when the user is idle so the usage statistics stay accurate.

alarms — Take a periodic peak-tab-count snapshot that survives the service worker being suspended.

tabGroups — Read Chrome tab group names and colors so existing groups display correctly.

favicon — Show reliable site icons via Chrome's built-in _favicon API. The favicon is the primary visual of every tab and deck, so a reliable icon is essential to the UI.

declarativeNetRequestWithHostAccess — Used ONLY for the optional local-AI feature: it removes the Origin header on requests to the user's own local Ollama server (localhost) so the server accepts them. It does not read, block, or modify any normal web browsing.

Optional host permission (http://localhost, http://127.0.0.1) — Requested at runtime ONLY if the user enables the optional local-AI feature, to talk to their own local Ollama server. Never requested otherwise.
```

## 6. Data usage / privacy disclosures (review form)
```
• Does NOT collect or transmit any user data.
• All data is stored locally in the browser (chrome.storage). No external servers, analytics, or tracking.
• The only optional outbound connection is to the user's OWN local Ollama server (localhost), and only if they explicitly enable the AI feature.
```

---

## 7. Steps to publish

1. Build a clean production bundle (only needed if you change code):
   ```bash
   npm run build
   ```
2. Package the zip (rebuild if you changed code):
   ```bash
   cd dist && zip -rq ../tab-mission-v1.1.0.zip . && cd ..
   ```
3. Go to the Chrome Web Store Developer Dashboard:
   https://chrome.google.com/webstore/devconsole
   (one-time: pay the $5 developer registration if you haven't.)
4. **New Item** → upload `tab-mission-v1.1.0.zip`. (Future updates: open the item → **Package** → **Upload new package**.)
5. Fill the listing using sections 1–4 above. Category: **Productivity**.
6. Add store assets (images — see section 9 for generation prompts):
   • Icon 128×128 (already in the package).
   • At least one screenshot, 1280×800 or 640×400 (PNG/JPEG). 3–5 recommended.
   • Optional small promo tile 440×280; optional marquee 1400×560.
7. Paste the **permission justifications** (5) and **privacy disclosures** (6) in the Privacy tab. Certify the data-usage statements.
8. Set visibility (Public / Unlisted) and **Submit for review** (~1–3 business days).

## 8. Pre-submit checklist
- [ ] Load-tested in real Chrome (`chrome://extensions` → Load unpacked → `dist/`).
- [ ] Manually clicked through close-all / clear-forgotten / restore / undo (destructive flows; unit-tested, no E2E yet).
- [ ] At least one 1280×800 screenshot prepared.
- [ ] Version is 1.1.0 in the uploaded package.
- [ ] Permission justifications + privacy disclosures filled in.

---

## 9. AI image-generation prompts (promo art & mockups)

> **Note:** Chrome prefers the **screenshots** field to show the *real* product — the fastest path is to load the extension and capture actual screenshots at 1280×800. Use the prompts below for the **promo tile, marquee, and marketing/hero art**, or as stylized "mockup" screenshots if you accept AI-rendered UI. Append your tool's quality flags (Midjourney `--ar 16:10 --v 6`, or DALL·E/Ideogram aspect settings). For crisp UI text, Ideogram or GPT-Image tend to beat Midjourney.

**Shared style block (prepend to any prompt):**
```
A high-fidelity product UI screenshot of a Chrome new-tab extension called "Tab Mission". Aesthetic: quiet, premium, calm "control room" like Linear and Raycast. Near-black background #0A0B0D with a very subtle radial depth glow. Achromatic, monochrome surfaces; a single iris-violet accent #7C7AF2 used sparingly. Tabbed cards in dark surface #1A1C21 with hairline borders and soft shadows, rounded 12–16px corners. Monospace labels (uppercase, letter-spaced) for metadata; clean system sans (SF Pro) for titles. Real-looking website favicons. Generous spacing, no clutter, no gradients except a faint background vignette. Crisp legible text. Flat, modern, designer-grade.
```

**A) Stacks view (hero screenshot, 1280×800):**
```
[STYLE BLOCK] The main screen: a small monospace wordmark "MISSION·CONTROL" top-left, a "34 tabs · 3 windows" counter, and a Stacks/Timeline segmented toggle top-right. Below, a grid of "decks" — each deck is a stack of 2–3 rounded cards offset like Apple Wallet passes, showing a site favicon (GitHub, Figma, Gmail, YouTube), the domain name, a faint preview of tab titles, a small "4 tabs" monospace count, and tiny colored status dots (green, amber, red). One deck is highlighted with a thin iris ring. Calm, spacious, dark.
```

**B) ⌘K command palette (1280×800):**
```
[STYLE BLOCK] A centered floating command palette over the dimmed, blurred Stacks grid. The palette is a rounded dark panel with a search field reading "Search tabs, run a command, or set a goal…", a "⌘K" key hint, and a list grouped into "Focus", "Commands" (Close duplicates, Hibernate background tabs, Open Workspaces), and "Tabs" with favicons. The selected row has a subtle iris highlight bar on its left edge. Keyboard-first, premium.
```

**C) Deck popover (1280×800):**
```
[STYLE BLOCK] A centered popover titled with a site favicon and "github.com — 4 tabs · 1 never visited". Below, a list of individual tab rows: favicon, title, small monospace meta (×6 · 12m), a colored status dot, and a subtle close ✕ on hover. A footer with buttons "Hibernate all", "Save as session", and a filled iris "Close 4 tabs" button. The deck grid is dimmed and blurred behind.
```

**D) Timeline view (1280×800):**
```
[STYLE BLOCK] A single-column timeline with a faint vertical spine on the left. Time buckets labeled in uppercase monospace: "NOW", "EARLIER TODAY", "GETTING OLD", "FORGOTTEN". Each bucket has compact tab rows (favicon, title, faint domain). The "FORGOTTEN" group is dimmed, with a small iris-red button "⌫ Clear 11 forgotten tabs · saved to a session first". The "NOW" node on the spine glows green. Calm, editorial.
```

**E) Workspace focus proposal (1280×800):**
```
[STYLE BLOCK] A centered modal titled "FOCUS" with a goal in quotes: "ship the Q3 board deck". Two side-by-side columns: "Keep 5" (relevant tabs with favicons) and "Set aside 22" (the rest, slightly dimmed). A "Loose ——●—— Strict" slider, a "Refine with AI" button, and a filled iris "Set aside 22 tabs" button. Premium, focused, dark.
```

**F) Small promo tile (440×280):**
```
[STYLE BLOCK] A minimal promo tile. Centered: the app icon (a dark rounded square with two offset rounded cards, the front one iris-violet — a "deck" mark), the wordmark "Tab Mission" in clean white sans, and a one-line tagline "Your tabs, under control." in muted gray. Lots of negative space, near-black background, one subtle iris glow. No UI screenshot, just brand. 440×280.
```

**G) Marquee promo (1400×560):**
```
[STYLE BLOCK] A wide hero banner. Left third: the wordmark "Tab Mission" and tagline "Spatial decks. ⌘K palette. Goal-driven workspaces." Right two-thirds: a slightly angled, glossy depiction of the Stacks view with favicon decks and a floating ⌘K palette. Dark, premium, lots of depth and soft shadow, one iris accent. 1400×560.
```

**Negative prompt (if your tool supports it):**
```
no purple gradient background, no rainbow, no neon, no clutter, no lorem ipsum, no watermark, no stock-photo people, no skeuomorphism, no busy 3-column icon grids, not bright/light theme, no distorted text.
```

**Brand reference values (keep consistent across all images):**
- Background `#0A0B0D` · surface `#1A1C21` · popover `#15171C` · text `#F3F4F6` · muted `#9096A1`
- Accent (iris) `#7C7AF2`
- Status dots: recent `#46C97E` · stale `#E0A93B` · never-visited `#E0605E` · asleep `#5B92D6`
- Icon mark: dark rounded square + two offset cards, front card iris.

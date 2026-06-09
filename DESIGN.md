# Design System — Tab Mission

> The one thing someone should remember after first opening this: **calm command of the chaos.** A surface seen dozens of times a day must be quiet, recognizable, and physical — not a wall of data rows. Every decision below serves that.

## Product Context
- **What this is:** A Chrome (Manifest V3) extension that replaces the new tab page with a calm, spatial tab manager — sites as physical card stacks, a ⌘K command surface, sessions, and (Phase 2) goal-driven Workspaces.
- **Who it's for:** Anyone drowning in open tabs. A free tool from the Superdom AI team, headed to the Chrome Web Store.
- **Space/industry:** Productivity / browser tooling. Not competing with marketplace tab managers — a brand tool that must feel premium.
- **Project type:** Dark-default, spatial dashboard / command-center web app (React 19 + TypeScript + Tailwind v4 + Zustand).

## Design Thesis
Two rules drive everything:
1. **Tabs are objects, not records.** The old UI showed tabs as text rows (title + `2h ago ×29 3m` + a status chip) — an engineer's log. Apple-thinking flips this: the **favicon is the hero**, the title is secondary, the metadata recedes to a faint sub-line or hover. You scan by *sight*, not by reading.
2. **Color is information, never decoration.** The canvas is achromatic near-black with depth. The only color on screen comes from (a) real site favicons (which encode identity) and (b) status (one dot/ring per tab). No decorative gradients, no candy chips, no emoji.

References studied: Apple Wallet (stacks), Stage Manager (spatial focus), iOS Home Screen (favicon objects), Photos Memories / Time Machine (the Timeline view), Linear & Raycast (calm dark + command palette). Counter-reference: Arc (too warm/gradient).

## Core Layout — two views, one switcher
A segmented control (top-right) toggles two views; remember the last used. ⌘1 / ⌘2.

### View 1 — Stacks (default)
- Each **site is a physical card deck** (Wallet-style): a top card with 2 cards peeking behind, offset and rotating slightly on hover (a gentle fan). Deck depth communicates "many tabs" without listing them.
- Deck face: large favicon, site name, a faint one-line preview of tab titles, a mono tab count, and a small row of status dots summarizing the stack.
- **Click a deck → a centered popover** over the dimmed/blurred grid, listing that site's individual tabs. Each tab row: favicon, title, mono meta (`×29 · 3m`), a status dot, and a **✕ close button** (hover turns it red). Popover footer: `Hibernate all` · `Save as session` · primary `Close N tabs`. Esc or scrim-click dismisses.
- The active site's deck gets the iris accent ring + glow.
- Scales calmly from 10 to 150 tabs (34 tabs → ~7 decks).

### View 2 — Timeline
- Organize by **attention over time**, not by site: buckets `Now` · `This morning` · `Getting old` · `Forgotten`. The recency metadata becomes the *structure*.
- Compact rows (favicon + title + faint domain), position encodes recency, no chips.
- The `Forgotten` bucket (zombies/never-visited) is gently desaturated with a single calm action: **"Clear N forgotten tabs · saved to a session first."** Makes cleanup obvious and safe.

### Always present
- **⌘K command surface** at the top (search tabs, jump, run bulk actions, switch view, Phase 2: set a goal). Glassy, blurred, the focal element when open.
- A quiet greeting + tab/window count header.

## Typography
The "what would Apple do" answer is **the system font** — it renders real SF Pro on the user's Mac with zero payload, and degrades to native UI fonts elsewhere.
- **Display / UI / body:** system stack — `-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, "Segoe UI", Roboto, sans-serif`. Tight tracking on large headings (`-0.02em`).
- **Data / counts / labels:** monospace stack — `ui-monospace, "SF Mono", "Geist Mono", Menlo, monospace`, always `font-variant-numeric: tabular-nums`. Used for counts, durations, time buckets, and uppercase tracked section labels (the "console" signal).
- **Cross-platform note:** the system stack gives an authentic Apple feel on macOS but varies by OS. If pixel-identical cross-platform type is wanted later, self-host one grotesk (e.g. General Sans) as the sans — keep it self-hosted woff2 (no CDN; MV3 CSP + offline). Geist Mono can be self-hosted as the mono for consistency.
- **Scale (rem @16px):** hero/greeting 1.7–1.9 (27–30px) · section 1.25 · deck name 0.94 · body 0.875 · meta 0.75 · mono-label 0.6875 (uppercase, +0.1em).

## Color
"Color = information." Achromatic canvas + depth; hue means identity (favicon) or status only.
- **Canvas (dark, with depth):** base `#0A0B0D` with a subtle radial lift toward `#1B1D23` top-right so surfaces aren't flat. Decks `#1A1C21`; popover `#15171C`.
- **Borders/hairlines:** `rgba(255,255,255,.07–.10)` (depth comes from shadow + subtle inner highlight, not hard borders).
- **Text:** primary `#F3F4F6` · muted `#9096A1` · faint `#5B616C`.
- **Brand accent (one, flat, rare — active deck, focus, primary action):** iris `#7C7AF2`. Never a gradient. Quiet fill `rgba(124,122,242,.14)`.
- **Status (dots/rings only):** recent `#46C97E` · stale `#E0A93B` · unvisited/never `#E0605E` · hibernated `#5B92D6` (also dims the object to ~50%).
- **Favicons carry their own brand color** — this is intentional, it's identity information. Provide a neutral fallback tile (first letter on `#1A1C21`) when a favicon is missing.
- **Light theme (secondary):** a frosted-glass light variant ("Atrium") is possible later — redesign surfaces with translucency/vibrancy, keep the achromatic+depth rule, reduce accent/status saturation ~10–15%. Dark is the default and primary.

## Spacing
- **Base unit:** 4px. **Density:** comfortable — decks and popover rows breathe.
- **Scale:** 2xs(2) xs(4) sm(8) md(12) lg(16) xl(24) 2xl(32) 3xl(48) 4xl(64).
- Deck grid: `repeat(auto-fill, minmax(240px, 1fr))`, gap 22–26px. Max content width ~1180px.

## Depth, Radius & Elevation
This aesthetic *uses* depth (unlike a flat control room).
- **Radius:** favicon/icon tiles 9–10px · deck cards 16px · popover 20px · pills/buttons 9px · dots 9999px.
- **Elevation:** decks rest with a soft drop shadow (`0 18px 40px -20px rgba(0,0,0,.7)`) + 1px top inner highlight. Popover floats high (`0 40px 100px -30px #000`) over a blurred scrim (`rgba(5,6,8,.55)` + `backdrop-filter: blur(3px)`). ⌘K bar uses `backdrop-filter: blur(20px)`.

## Motion
Physical and quick — depth and spring, never sluggish or bouncy-cartoonish.
- **Deck hover:** top card lifts + rotates ~1°, cards behind fan slightly (`cubic-bezier(.2,.7,.2,1)`, ~180ms).
- **Popover:** spring scale+fade in from the deck (~200–250ms); scrim fades.
- **View switch (Stacks↔Timeline):** crossfade + slight slide (~250ms).
- **Tab close:** row collapses, deck count ticks down (FLIP).
- **Easing:** enter ease-out / exit ease-in / move `cubic-bezier(.2,.7,.2,1)`. **Duration:** micro 100–150 · short 150–250 · medium 250–400.
- Respect `prefers-reduced-motion`: drop fan/spring/crossfade, keep instant state changes.

## Component Direction (what changes from today)
- **Retire the data-row card** (title + `2h ago ×29 3m` + chip) and all emoji (🗂 🧟 👻 💤) and candy chips.
- **Deck** = the new primary object. **Tab popover** = the detail + close surface (per-tab ✕, plus Hibernate all / Save as session / Close all).
- **Status** = a 6–7px dot (and a ring on deck/active); meaning shown on hover/legend, not as a colored word.
- **Counts, durations, time buckets** = mono tabular.
- **Wordmark/header** = quiet; the product's character comes from the spatial decks + real favicons, not a logo tile or gradient.
- **Bulk actions** (Dupes/Unvisited/Zombies/Hibernate) live in ⌘K and in the Timeline "Forgotten" action; logic unchanged from the existing `BulkActions`.

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-06-06 | Initial system: "Quiet control room" (dark monochrome card rows) | First proposal from /design-consultation. |
| 2026-06-06 | **Superseded → "Spatial decks + Timeline"** | User feedback: the control-room version was still data-rows like today's UI ("not visually appealing or intuitive — what would Apple do?"). Reframed to favicon-forward objects. Chosen direction: **Stacks (Wallet-style decks) as default + Timeline (attention-over-time) as a view mode**, with click-a-deck → popover of that site's tabs with per-tab close. System font (SF on Mac) for the Apple feel; color = information (favicons + status only). Pairs with the approved office-hours doc (command-center Phase 1, Workspaces Phase 2). |

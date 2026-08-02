# Handoff: Shopping List PWA

## Overview

An offline-first shopping list app. Two screen types:

1. **Home** — a grid of list tiles, each a preview of the list itself (Google Keep–like), ordered most-recently-modified first.
2. **List** — two equal, independently scrolling columns. Left = the shopping list the user is building (manual order). Right = the catalog of items available to add (always alphabetical).

The only editing verb on the list screen is **drag**. Right→left adds; left→right removes; left→left reorders. The catalog never loses an item by being dragged from.

No server. All state lives on the device. The app is a PWA only in the delivery sense: static hosting, installable, works offline.

## About the design files

The files in this bundle are **design references created in HTML** — prototypes showing intended look and behaviour, not production code to copy. The task is to **recreate these designs in the target codebase's environment** using its established patterns. If no environment exists yet, pick the framework and implement there. In particular:

- `Shopping List Prototype.dc.html` is a working single-file prototype. Its drag implementation, state shape, and undo model are a **reference for behaviour**, not an architecture to lift. Read "Architecture notes" below before reusing any of it.
- The prototype is authored in a proprietary streaming-component format; the wrapper syntax is irrelevant to you. The markup structure, inline styles, and the JavaScript class body are the parts worth reading.

## Fidelity

**High fidelity.** Colours, type sizes, spacing, and row geometry below are final. Recreate them precisely. Copy strings are final too.

The one deliberately unfinished area is **PWA plumbing** — manifest, service worker, install prompt, and offline indicator are not designed. See "Out of scope".

---

## Design tokens

Both themes are defined as CSS custom properties on `:root` / `[data-theme="oled"]`. Every component reads tokens; no component hardcodes a colour.

| Token | Light | OLED black | Used for |
|---|---|---|---|
| `--bg` | `#f4f5f7` | `#000000` | app background |
| `--surface` | `#ffffff` | `#0b0c0e` | cards, columns, rows, sheets |
| `--surface2` | `#fafbfc` | `#0d0f11` | sub-headers, foreign catalog rows |
| `--line` | `rgba(0,0,0,.09)` | `#1c1f24` | container borders, top bar rule |
| `--line2` | `rgba(0,0,0,.055)` | `#131619` | row separators, menu dividers |
| `--text` | `#14161a` | `#e8eaed` | primary text |
| `--text2` | `#5c6068` | `#9aa0a8` | secondary text, icon strokes |
| `--text3` | `#9aa0a8` | `#6b7078` | meta text, column headers |
| `--fade` | `#a6abb2` | `#54595f` | catalog items already on the list |
| `--accent` | `#2563eb` | `#4d8dff` | primary actions, drop targets, qty badge |
| `--accent-bg` | `#e8effd` | `#0d1b33` | accent fills behind accent text |
| `--chip` | `#eef0f3` | `#17191d` | count badge, off toggle track |
| `--grip` | `#c3c8ce` | `#3d4147` | drag grip bars |
| `--grip2` | `#e2e5e9` | `#22262b` | grip bars on faded rows |
| `--danger` | `#d23b3b` | `#f36b6b` | destructive menu item |
| `--topbar` | `#ffffff` | `#000000` | top bar background |
| `--scrim` | `rgba(20,22,26,.4)` | `rgba(0,0,0,.66)` | modal/drawer backdrop |
| `--shadow` | `0 12px 32px rgba(0,0,0,.22)` | `0 12px 32px rgba(0,0,0,.6)` | dialogs, drag chip |

**OLED requirement:** in dark mode `--bg` and `--topbar` are true `#000000`. Rows and cards sit one step up (`#0b0c0e`) so scrolling content still reads as separated. Do not introduce a lighter dark-grey ground.

**Typography.** System sans throughout: `-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif`. Monospace (`ui-monospace, Menlo, monospace`) only for numbers, version strings, and counts.

| Role | Spec |
|---|---|
| Top bar title | 600 17px / 1.15 |
| Version under title | 400 10.5px mono, `--text3` |
| List row text | 400 14.5px / 1.32 |
| Tile title | 600 13.5px / 1.25 |
| Tile preview line | 400 11.5px / 1.35, `--text2` |
| Tile meta line | 400 10.5px, `--text3` |
| Column header | 600 10px, `letter-spacing .09em`, uppercase, `--text3` |
| Section sub-header | 600 9.5px, `.09em`, uppercase, `--text3` |
| Menu row | 400 14.5px |
| Dialog title | 600 15px / 1.3 |
| Dialog body | 400 12.5px / 1.45, `--text2` |
| Qty badge / counts | 600 11px mono (badge), 600 9.5px mono (tile count) |
| Toast | 500 12.5px |

**Spacing / geometry.** Radii: 4px (badges), 7px (buttons, grip targets), 8px (tiles, inputs, dialogs' inner controls), 9px (columns), 12px (dialogs), 26px (FAB). Screen padding 12px; column gutter 8px; column inner padding 8–12px. Top bar height **52px**; icon hit targets **44×44**. FAB 52×52, inset 14–16px.

---

## Screen 1 — Home

**Purpose:** pick a list, create a list, reach app-level settings.

**Layout.** Column flex: top bar (52px, fixed) then a scrolling grid. Grid is `repeat(auto-fill, minmax(158px, 1fr))`, `gap: 10px`, `padding: 12px`, `align-content: start`. On a 360px-wide phone this yields two columns; it widens gracefully with no breakpoints. FAB pinned bottom-right (16px inset).

**Tile.** Horizontal flex: a **4px accent spine** then a content block padded `10px 11px 11px`.

Content block, top to bottom:
- Row: tile title (600 13.5px, wraps, `overflow-wrap: anywhere`, flexes) + **catalog-count badge** (600 9.5px mono, `--text2` on `--chip`, `padding 2px 5px`, radius 4px). The badge is the **size of that list's catalog**, not the number of items on the list.
- If the left list has items: up to **6 item names** as separate lines (400 11.5px, `--text2`, each `text-overflow: ellipsis` single-line). Items with quantity > 1 render as `Name ×N`.
- If the left list is empty: italic `Empty list` in `--text3`. This is shown **even when the catalog has items**.
- Meta line: `+N more · ` (only when >6 items) followed by relative modified time.

**Ordering.** Tiles are sorted by `modified` descending. Any mutation to a list — add, remove, reorder, quantity change, catalog edit, rename — sets `modified = now`, which moves the tile to position 1.

**Spine decay.** The spine encodes recency a second time, by colour. Interpolate linearly in RGB between these stops by age in days; at ≥180 days the spine is `transparent`.

| Age | Light | OLED |
|---|---|---|
| 0 d | `#2563eb` | `#4d8dff` |
| 7 d | `#4f78cf` | `#3f6bb8` |
| 30 d | `#7c8794` | `#5c636c` |
| 60 d | `#a8aeb6` | `#3c4149` |
| 120 d | `#d9dce0` | `#212429` |
| 180 d | `#f4f5f7` (= `--bg`) | `#000000` (= `--bg`) |

Chroma is gone by 60 days (grayscale); the remaining 120 days walk the grey toward the background so the spine has vanished by 6 months. There is **no setting** to disable this — the spine has no purpose if it doesn't fade.

**Relative time strings** (exact): `Just now` (<90s) · `Nm ago` (<1h) · `Nh ago` (<24h) · `Yesterday` (1d) · `N days ago` (<30d) · `N months ago` (<365d) · `Over a year ago`.

**Empty state.** No lists: centred `No lists yet — tap + to make one` in `--text3`. Search with no hits: `No lists match “<query>”`.

---

## Screen 2 — Shopping list

**Purpose:** build the list by dragging.

**Layout.** Top bar (52px) then a flex row with `padding: 8px; gap: 8px`. Two children, each `flex: 1; min-width: 0` — **always two columns, at every width**. Each column is a card: `background --surface`, `1px solid --line`, radius 9px, `overflow: hidden`, containing one scroll container (`overflow: auto; overscroll-behavior: contain`).

**Column headers scroll away.** The header (`My list` / `This list's catalog`) is the first child *inside* the scroll container, not a sticky element — it must scroll out of view with the content. Left header right-aligns the item count; right header right-aligns `A–Z`.

**Row.** Horizontal flex, `min-height` = the user's row-height setting (default **44px**), `border-bottom: 1px solid --line2`, `background --surface`.

- **Grip column** — fixed **44px** wide, `display: grid; place-items: center`, containing three 12×1.5px bars in `--grip`, 2.5px apart. `touch-action: none`, `cursor: grab`. **No background fill and no divider** — the grip glyph alone is the affordance.
- **Text region** — `flex: 1; min-width: 0`, padding `7px 10px`, 400 14.5px/1.32, `overflow-wrap: anywhere`. `touch-action: pan-y` — this region is **reserved for vertical scrolling**, it does not initiate a drag.
- **Quantity badge** (left column only, when qty > 1) — `×N`, 600 11px mono, `--accent` on `--accent-bg`, `padding 3px 6px`, radius 4px. Tapping it opens the quantity dialog.
- **Source label** (foreign catalog rows only) — the owning list's name, 400 9.5px mono, `--text3`, right-aligned.

Row height is a **floor, not a fixed height**: long names wrap and the row grows. The grip column stretches to the full row height, so a two-line row is a larger drag target, not a harder one.

**Faded rows.** A catalog item already present on the left list renders its text in `--fade` and its grip bars in `--grip2`. It stays draggable — dragging it again is how you set a quantity.

**Right column composition.**
1. This list's own catalog, sorted `localeCompare` ascending.
2. If the per-list setting *Show catalog items from other lists* is on and there are any: a sub-header row `From other lists` (uppercase 9.5px on `--surface2`, hairline above and below), then every item from **other lists' catalogs** whose name isn't already in this list's catalog, deduped case-insensitively across lists, sorted alphabetically, each on a `--surface2` row with its source list name.

**Left column empty state:** `Drag items across from the catalog`. **Right column empty:** `Tap + to add your first catalog item`. Under search: `No matches in this list` / `No matches in the catalog`.

**FAB.** 52px circle, `--accent`, `+` glyph, bottom-right 14px. Opens the *Add to catalog* dialog. Hidden while in catalog-delete mode.

---

## Drag and drop

The core interaction. Implement with Pointer Events (a single code path covers mouse, touch, and pen); do not use HTML5 drag-and-drop, which is unusable on Android.

**Starting a drag**
- Default (grips visible): `pointerdown` on the grip starts the drag immediately. `preventDefault()` so the browser doesn't begin a text selection or a scroll.
- Grips hidden, or narrow viewport: **long-press 340ms** anywhere on the row starts the drag; moving more than 9px before it fires cancels it and lets the native scroll proceed. Fire `navigator.vibrate(12)` on start.

**During a drag**
- A **drag chip** follows the pointer: `position: fixed`, offset `+14px / −22px` from the pointer, `pointer-events: none`, `--surface` with `--line` border, radius 8px, `--shadow`, 500 14.5px text, `min-width: 96px`, `max-width: 230px`. Position it by writing `transform: translate3d(...)` directly on the node on every `pointermove` — do **not** re-render the tree per move.
- The **source row** drops to `opacity: .32` in place.
- The **hovered column** switches to `background: --accent-bg` with a `1.5px solid --accent` border, and its header text turns `--accent` and changes copy:
  - dragging from the right, over the left → `DROP TO ADD`
  - dragging from the left, over the left → `DROP TO REORDER`
  - dragging from the left, over the right → `DROP TO REMOVE`
  - dragging from the right, over the right → header unchanged (no-op drop)
- When the left column is the target, an **insertion bar** appears at the computed index: 5px tall, `--accent`, radius 3px, `margin: 4px 10px`. Index = the number of rows whose vertical midpoint is above the pointer.
- **Edge auto-scroll:** within 54px of the hovered column's top or bottom edge, scroll it on a `requestAnimationFrame` loop at `max(3, distance/3)` px per frame.
- While dragging, a **document-level non-passive `touchmove` listener calls `preventDefault()`** — this is what stops Android from scrolling mid-drag once a long-press has begun. Also set `body { user-select: none }`.
- The column hit test accepts a 30px overshoot beyond each column's top and bottom edge, so a slightly-off drop still lands.

**Drop rules**
| From | To | Result |
|---|---|---|
| right | left | Item is **added** at the insertion index, qty 1. The catalog **keeps** the item. |
| right | left, item already present | If *Ask quantity on duplicate drag* is on → quantity dialog, prefilled at `current + 1`. If off → increment silently. |
| right (foreign) | left | The item is **copied into this list's catalog** (new id) and then added to the list. |
| left | right | Item is **removed** from the list. |
| left | left | Reorder to the insertion index (`to--` if `to > from`). |
| right | right | No-op. |
| anywhere | outside both columns | Cancel, no change. |

**Drag is disabled while a search query is active** — reordering a filtered view is ambiguous. Grips stay visible but inert.

---

## Top bar

52px, `--topbar` background, `1px solid --line` bottom rule. Three states:

**Resting.** Optional back chevron (`‹`, 300 26px, 38×44 target, list screen only) · title block (flex, ellipsised single line; on home the title is `Shopping List` with `v0.1.0` in 10.5px mono beneath) · search icon (44×44) · hamburger (44×44, three 16×2px bars in `--text2`, 3.5px apart).

The search icon is a magnifier in `--text2`: a 13×13 ring with a 2px stroke and a 7px handle at −45° off its lower-right, the handle's axis passing through the centre of the ring.

**Search expanded.** The title is replaced by the input, which **fills the bar and receives focus immediately** on expand. Layout: search glyph · `<input>` (400 16px — 16px minimum, or Android zooms on focus) · `×` clear button (38×44) that closes search and clears the query. The hamburger remains. Filtering is **in place**, not a dropdown: on home it filters tiles by list name or any catalog item name; on a list screen it filters both columns simultaneously.

**Catalog-delete mode.** The whole bar turns `--accent` with white content: `×` exit (36×44) · `N selected` (600 15px) · `Delete` button (600 13px, `1px solid rgba(255,255,255,.45)`, radius 7px, padding `8px 13px`). While in this mode, right-column rows show a 20px checkbox in a 44px column and tapping a row toggles selection instead of dragging. This is **the only place checkboxes appear in the app**.

---

## Menus, settings, dialogs

**Hamburger drawer.** Right-side sheet, `min(320px, 86vw)`, `--surface`, `1px solid --line` on the left edge, over a `--scrim` backdrop. Header row (52px) repeats the screen title. Footer row (38px) shows `Shopping List · v0.1.0` in 11px mono.

Top of the drawer is the **undo/redo pair**: two equal boxes (`1px solid --line`, radius 8px, padding `9px 10px`, `gap: 8px`) each showing a 600 12.5px verb and, beneath it, a 400 10.5px `--text2` description of the *exact action* — `Added “Olive oil”`, `Removed “Milk”`, `Moved “Eggs”`, `Set “Eggs” to ×3`, `Sorted left column A–Z`, `Deleted 3 catalog items`, `Renamed to “Pantry”`, `Created “Party Saturday”`. When a stack is empty the box drops to `opacity: .45` and reads `Nothing to undo` / `Nothing to redo`.

Menu rows are `min-height: 44px`, padding `9px 16px`, 400 14.5px, labels **wrap rather than truncate**.

*Home menu:* New list · — · Import / export data · Settings · About.

*List menu:* Sort left column A–Z · Show catalog items from other lists *(toggle, per-list)* · Remove items from catalog… · — · Rename list · Copy list as text · Import / export data · Settings · — · **Delete this list** *(in `--danger`)*.

Theme lives in Settings, not here. There is no "Manage catalog" entry — adding is the FAB, removing is *Remove items from catalog…*.

**Settings** is a full-screen sheet with a back chevron, containing three cards (`--surface`, `1px solid --line`, radius 9px) each headed by an uppercase 9.5px label:

- **Appearance** — three segmented buttons: `Light` · `OLED black` · `System`. Selected = `1.5px solid --accent`, `--accent-bg` fill, `--accent` 600 text. System follows `prefers-color-scheme` live.
- **Item height** — `Minimum row height`, value shown as `NN px` in 600 12px mono, a range input **32–60 step 2**, default 44, `accent-color: --accent`, with `32` / `60` end labels in 9.5px mono.
- **Behaviour** — two toggle rows (46px min, label 14px + 11px `--text3` hint): *Show drag grips* ("Off, or on narrow screens: long-press a row to drag") and *Ask quantity on duplicate drag* ("Otherwise a repeat drag just increments"). Toggle: 38×22 track, radius 11, `--accent` when on / `--chip` + `--line` border when off; 18px knob, `left` transitions over 120ms.
- Footer note: `Undo history keeps the last 50 actions. All data is stored on this device only.`

**Dialogs.** Centred card over `--scrim`: `min(320px, 100%)`, `--surface`, `1px solid --line`, radius 12px, padding `18px 18px 14px`, `--shadow`. Title 600 15px, optional body 12.5px `--text2`. Buttons bottom-right: secondary is text-only in `--text2`, primary is `--accent` with white 600 13.5px text, radius 8px, 38px min height. Backdrop click and `Escape` cancel; `Enter` submits text dialogs.

| Dialog | Trigger | Content | Primary |
|---|---|---|---|
| New list | home FAB / menu | text input, placeholder `List name` | `Add` — creates and opens it |
| Add to catalog | list FAB | text input `Item name` + checkbox `Also add to my list now` (default **on**) | `Add` |
| Quantity | duplicate drag, or tapping a `×N` badge | `−` / value / `+` (46px controls, value 600 19px mono, clamp 1–99) | `Set` |
| Rename list | menu | text input prefilled with current name | `Rename` |
| Delete list | menu | body: *The list and its catalog are removed. You can undo this.* | `Delete` |
| Import / export | menu | 150px monospace textarea holding pretty-printed JSON | `Import`, plus a `Copy` secondary |
| About | home menu | version + one line of body | `Close` |

Text inputs: 46px tall, `1.5px solid --accent`, radius 8px, 15px text. Duplicate catalog names are rejected with a toast (`“X” is already in the catalog`) rather than an inline error.

**Toast.** Centred, 22px from the bottom, pill (radius 20px), background `--text` / text `--bg`, 500 12.5px, `opacity .94`, `pointer-events: none`, auto-dismiss after **2200ms**. Fired on every committed mutation with the same label the undo stack records, and on undo/redo as `Undid: <label>` / `Redid: <label>`.

**Animations.** Only two, both short: `slp-fade` (opacity, 120–180ms ease) for backdrops and tiles, and `slp-pop` (opacity + 6px rise + `scale(.985)`, 160ms ease) for drawers and dialogs. Nothing else animates; the drag chip is driven by transform, not transition.

---

## Responsive behaviour

There is **one layout at every width** — two columns, side by side, always. No tabs, no bottom sheet, no stacking.

- Landscape phone (~700×340) is the optimal shape and should be treated as the primary target: the top bar may compress to 48px, but rows and columns are unchanged.
- Portrait phone (~360×640) is equally supported.
- Below roughly **340px of app width**, drop the grip columns (`Show drag grips` behaves as off) and give the full row width to text; drag switches to long-press. Reduce screen padding toward 0 before you ever consider reducing the number of columns.
- Wide screens: the home grid gains columns via `auto-fill`; the list screen's two columns simply get wider. Consider capping the list screen's content width on very wide displays — undesigned, your call.

---

## State

```ts
type List = {
  id: string;
  name: string;
  modified: number;          // epoch ms; any mutation sets this
  catalog: { id: string; name: string }[];
  items:   { cid: string; qty: number }[];   // cid -> catalog.id; order is user order
  showOthers: boolean;       // per-list: append other lists' catalog items
};
```

Persisted app state: `{ lists: List[], theme: 'light'|'oled'|'system', rowHeight: number, showGrips: boolean, askQty: boolean }`.

Ephemeral (not persisted): current view and list id, search open/query, menu/settings/dialog open, catalog-delete selection, drag state (`{from, cid, name, foreign}`, hovered column, insertion index), toast, undo and redo stacks.

**Invariants**
- `items[].cid` must resolve within the same list's `catalog`. Deleting a catalog item also deletes its list entries in the same transaction.
- Catalog names are unique per list, case-insensitively.
- The right column's order is derived, never stored. The left column's order **is** the stored order of `items`.
- Quantity is 1–99; a quantity of 1 renders no badge.

**Undo/redo.** Every mutation goes through one funnel that records a labelled entry, caps the stack at **50**, and clears the redo stack. The prototype snapshots the whole `lists` array before and after each mutation, which is trivially correct and fine at this data size; a command/inverse-command model is the alternative if you expect large catalogs. Whichever you choose, the requirement is that **every accidental action is undoable and the button names it** — including quantity changes, catalog deletions, list deletion, and import.

---

## Architecture notes for the coding agent

Things the prototype does *not* settle, and that are worth deciding before building:

1. **Storage.** The prototype uses `localStorage` with a single JSON blob under `slp.state.v1`. That will not scale and it's synchronous. Prefer **IndexedDB** (idb-keyval or similar) with the same single-document shape, or per-list records if you expect many lists. Keep a schema version key from day one — import/export makes migrations user-visible.
2. **Undo granularity.** Snapshot vs. command. If you go command-based, note that "add a foreign catalog item" is two effects (catalog insert + list insert) that must undo as one.
3. **Cross-list catalog lookup.** "Show catalog items from other lists" is a query across all lists, deduped by lowercased name. If lists are stored separately, this read touches everything — either keep a derived global name index or accept the scan.
4. **Drag library vs. hand-rolled.** The prototype is hand-rolled in ~90 lines of pointer handling, which is here mainly so you can see the exact feel intended. A library (dnd-kit and similar) will handle keyboard accessibility and virtualised lists better; if you adopt one, keep the specific behaviours above — the 44px grip region, `pan-y` on the text region, the 340ms long-press fallback, the 54px auto-scroll band, and the non-passive `touchmove` guard.
5. **Virtualisation.** A catalog of a few hundred items is fine as plain DOM. Beyond that, virtualising conflicts with measuring row midpoints for the insertion index — plan for it if large catalogs are expected.
6. **Accessibility.** Currently unaddressed. Drag-only editing needs a keyboard and screen-reader path: at minimum, focusable rows with `Space` to pick up / arrows to move / `Space` to drop, plus live-region announcements matching the toast text. Worth designing before it becomes retrofit work.
7. **PWA shell.** Needs a manifest (`display: standalone`, theme colour matching the active theme's `--topbar`, maskable icons), a service worker precaching the shell, and an install affordance. Note the theme-colour meta must update when the user switches themes, or the Android status bar will mismatch.
8. **Sanitising import.** The import dialog currently `JSON.parse`s and replaces state wholesale. Validate structure and ids before committing, and route it through undo (it already is in the prototype).

---

## Assets

No raster images and no icon fonts. Every icon in the prototype is composed from divs: the search glyph (circle + rotated bar), the hamburger (three bars), the grip (three bars), chevrons and `×` and `+` as text glyphs, and the checkbox tick as a `✓` character.

Avoid bitmaps and icon fonts for UI chrome — the divs are theme-aware for free and a bitmap is not. **SVG is a good fit here** and is the better tool wherever the geometry is more than a few boxes; use it as you see fit.

## Files in this bundle

| File | What it is |
|---|---|
| `Shopping List Prototype.dc.html` | Working prototype: both screens, real drag, undo/redo, themes, settings, search, dialogs, persistence. The behavioural reference. |
| `shopping-list-prototype-standalone.html` | The same prototype bundled into one self-contained file. Open it directly in a browser, including on a phone, with no server. |
| `screenshots/` | Reference captures of the prototype, listed below. Grabbed from a 924×540 viewport (roughly a landscape phone — the primary target). Note: they are DOM re-renders, so a few text runs wrap where the live app does not; trust the specs above over the pixels where they disagree. |
| `Shopping List Directions.dc.html` | The design exploration that led here. Turn 4 is the accepted direction; turns 3, 2, 1 are earlier options, kept for context on what was rejected and why. Turn 0 states the assumptions and the row-height reasoning. |

To view the exploration or prototype, open the HTML files in any modern browser.

## Screenshot index

| File | Shows |
|---|---|
| `01-home-light.png` | Home grid, light. Spine colour decaying across tiles (fresh blue → invisible on Camping Trip). |
| `02-list-light.png` | List screen, light. Two columns, grip glyphs, `×2` badge, faded catalog rows for items already on the list. |
| `03-drag-in-progress.png` | Mid-drag, catalog → list. Drag chip on the pointer, source row at .32 opacity, left column in drop state with accent border and `DROP TO ADD` header, insertion bar at the target index. |
| `04-search-filtering.png` | Search expanded and filtering both columns in place on the query `ch`. |
| `05-menu-light.png` | Hamburger drawer, light, with the undo/redo pair naming the last action. |
| `06-settings-light.png` | Settings sheet: theme segmented control, row-height slider, behaviour toggles. |
| `07-menu-dark.png` | Same drawer on OLED black, over the list screen. |
| `08-quantity-dialog-dark.png` | Quantity prompt raised by dragging an item that is already on the list. |
| `09-home-dark.png` | Home grid on true black; the spine carries the only colour on screen. |
| `10-home-narrow-dark.png` | Home at 330px wide — grid falls to a single column. |
| `11-list-narrow-dark.png` | List at 330px wide — still two columns; grips are dropped and the whole row becomes the drag target via long-press. |

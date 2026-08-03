# Developing Shopping List

Technical documentation for the app described in [README.md](README.md).

**Contents**

- [Requirements](#requirements)
- [Quick start](#quick-start)
- [Commands](#commands)
- [Architecture](#architecture)
- [The update model](#the-update-model)
- [The rescue layer](#the-rescue-layer)
- [Build pipeline](#build-pipeline)
- [Publishing a release](#publishing-a-release)
- [Staging](#staging)
- [Testing](#testing)
- [Project layout](#project-layout)
- [Things that will bite you](#things-that-will-bite-you)
- [Data model and schema changes](#data-model-and-schema-changes)
- [Storage reference](#storage-reference)

---

## Requirements

- **Node 20 or newer.** Developed and tested on 24.14 with npm 11; 20 is the floor because
  the build scripts use `readdirSync({ recursive: true })`, alongside `fs.cpSync` and
  top-level `await`.
- Nothing else. No Docker, no global tooling, no CI.

Stack: **Vue 3 (Options API) + vue-router 4 + Vite**, no Babel, targeting `es2022` because
the app is for modern smartphones only. TypeScript is used selectively — see
[Language split](#language-split). Runtime dependencies are Vue, vue-router and
`idb-keyval`, and that list is meant to stay short.

## Quick start

```bash
npm install
npm run dev
```

`npm run dev` serves `src/app/index.html` with hot reload. **The bootloader and service
worker are not involved**, so this is the fast loop for UI work but it cannot exercise
offline behaviour, updates, or rescue. For those, build and serve the real thing:

```bash
npm run build
node scripts/serve.mjs dist --mount /ShoppingList/
```

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server. App only — no shell, no service worker. |
| `npm run check` | `tsc --noEmit`. Type-checks `src/app/**/*.ts`. |
| `npm test` | Vitest, single run. |
| `npm run test:watch` | Vitest in watch mode. |
| `npm run build` | Produces `dist/` — the complete, portable site. Publishes nothing. |
| `npm run release` | Copies `dist/` into `docs/`. **Still publishes nothing until you commit.** |
| `npm run stage -- <dir>` | Copies `dist/` into any other directory (a staging server root). |

Two helpers that are not npm scripts:

```bash
node scripts/serve.mjs <dir> [--port 8080] [--mount /path/]   # static server
node scripts/icons.mjs <outDir>                               # regenerate launcher icons
```

## Architecture

The project is **two independent layers**, and keeping them independent is the whole
design.

### 1. The shell (`src/shell/`)

A bootloader, a rescue screen, and a service worker. It is what the browser actually
loads. It decides which version of the app to run, keeps updates staged, and recovers when
a version is broken.

**It is intended to be near-frozen.** It knows nothing about shopping lists.

### 2. The app (`src/app/`)

The Vue application. It is published as an immutable, content-hashed directory under
`releases/<buildId>/` and injected by the bootloader. It knows nothing about the
bootloader beyond three optional globals (`src/app/core/bootBridge.ts`).

### Why the split

A conventional precaching service worker (Workbox `generateSW`, for example) bakes the
list of hashed asset URLs into itself, so **the service worker is a different file on
every release** — meaning every buggy release also ships a brand new copy of the layer
you are relying on to rescue you.

Here the service worker never learns about app versions. It precaches a tiny fixed shell
and serves `releases/<buildId>/*` cache-first, because those paths are content-hashed and
immutable. Its stability is a feature, and there is a test for it: see
[Things that will bite you](#things-that-will-bite-you).

### Language split

`tsconfig.json` uses `allowJs: true, checkJs: false` and only *includes*
`src/app/**/*.ts`:

- **`src/app/core/**` is TypeScript and is type-checked.** This is where the data model,
  the undo funnel, the migrations, and the drag geometry live — the invariants.
- **`src/app/components/**` are plain-JS Vue SFCs and are not type-checked.** They still
  get editor inference from the TS modules they import. Any `.js` file can opt into
  checking by adding `// @ts-check` at the top.
- **`src/shell/**` is excluded entirely.** It is classic-script code that runs before any
  module system exists.

`.vue` files are not type-checked at all. `vue-tsc` cannot drive TypeScript 7 (the native
compiler dropped the entry point it reaches for), and since components are deliberately
plain JS there is nothing for it to check. `npm run check` runs plain `tsc`.

### Routing

Two screens are routes; every overlay is a query flag on whichever screen is showing.

| URL | State |
| --- | --- |
| `#/` | Home |
| `#/list/<id>` | That list |
| `…?menu` | Drawer open |
| `…?settings` | Settings sheet open |
| `…?search` | Search expanded (the text itself is never in the URL) |
| `…?select` | Catalog-delete mode (the selection itself is never in the URL) |
| `…?dialog=<kind>` | That dialog; `quantity` also carries `cid` and `qty` |

Overlays are query flags rather than nested routes because they are drawn *over* the
screen — routing them would unmount the list underneath and lose its scroll position.
They stack in the URL exactly as they stack on screen, so `?search&menu` closes back to
`?search`.

**Search is the one layer that survives a screen change.** Opening a list while searching
carries `?search` onto the list route, because a home-screen match is usually a catalog
match — the tile answers *which* list has the item, and the list screen answers *where* in
it — and dropping the query in between made the user type it again to find out. Everything
else is closed by the time a tile can be tapped, so nothing else is carried.

That is also the one case where closing a layer is not `back()`: the entry behind a
carried layer is the *home* screen, so stepping back would leave the list as well as the
search. `closeLayer()` steps back only when the previous entry is this entry minus the
layer being closed, and rewrites the current entry when it is not — which covers a cold
deep link into `#/list/<id>?search` for the same reason.

**A search layer that arrives on a different screen with nothing typed is dropped.** The
text is not in the URL, so an entry left while searching comes back blank: a search field
open over unfiltered results, asking a question the user already answered somewhere else.
`syncUi` closes it and rewrites the entry. The test is the *screen*, because opening search
never changes it — tapping the magnifier adds the flag to whatever is already showing, so
an empty box there is one the user is about to type into. This is also why reloading
`?search` lands on a plain screen rather than an empty search box.

Dialog kinds are an allow-list in `ui/navigation.js`, and the ones that act on the open
list (`add-catalog`, `quantity`, `rename`, `delete-list`, `import-text`) are dropped when
the URL names them on the home screen — a deep link cannot mount a dialog against a null
list. `export` and `import` are not in that set: they are opened from Settings and are
reached from either screen.

**Hash history, not path history.** The published site is static, is served from an
arbitrary mount path, and its service worker deliberately knows nothing about app URLs.
Path routing would need every deep link to fall back to `index.html` on the server, which
GitHub Pages branch deployment cannot do. A hash never reaches a server, so `#/list/<id>`
works identically at the Pages subpath, on a staging box, on localhost, and offline. The
bootloader's `#rescue` hatch is unaffected — it matches before any app code loads, and only
at the very start of the hash.

**vue-router 4, not 5.** v5 is the file-based/typed-routes package: it needs a Vite plugin
and peers on Pinia, for two routes that fit in a twenty-line table. v4 is runtime-only with
a single dependency.

### Interaction styling

`.tap` / `.tap-inv` in `styles/tokens.css` give any element hover, press and focus
feedback. The wash is an inset box-shadow so it composes with whatever background and
radius the element already has.

Hover is gated on `html[data-input='mouse']`, which `ui/inputMode.js` maintains from the
last pointer event's `pointerType`. This is a touchscreen app: an ungated `:hover` leaves
the last button you tapped lit as though a pointer were resting on it, and
`@media (hover: hover)` does not save you because a touchscreen laptop reports hover
support and still does it. Press feedback is deliberately *not* gated — it is the only
feedback a finger gets before it lifts. Focus rings are `:focus-visible`, which the browser
already limits to keyboard focus.

The gate is written `:where(html[data-input='mouse'])` so it adds no specificity; without
that, the hover rule outranks the press rule and a mouse press shows nothing.

The rescue screen cannot use any of this — it deletes every stylesheet in the document
before it renders — so `shell/rescue.js` carries a small inline-style equivalent.

### Icons and graphics

**SVG is the format for icons and simple graphics here.** It is crisp at any pixel ratio,
it takes its colours from CSS, and the geometry is written as coordinates instead of as
nudges — compare the checkbox tick, a three-point path that is centred because it says so,
against the CSS version it replaced, two borders of an empty box rotated 45° and pulled
back onto centre with a hand-tuned `translateY`.

**Avoid raster images and icon fonts for anything that is part of the interface.** A bitmap
cannot follow the theme: it needs one asset per theme and it flashes on the switch. Icon
fonts drag in a whole font file, and a missing glyph fails as a visible tofu box. Neither
buys anything an SVG does not. Photographs are a different question, and the launcher icons
are PNG because the web manifest requires it — `scripts/icons.mjs` generates those.

Inline in a template or loaded from a `.svg` file is a case-by-case call, with one
consequence worth knowing: an SVG referenced through `<img src="…">` is a separate
document, so page CSS cannot reach inside it and it cannot inherit `currentColor`. A themed
icon therefore wants to be inline (or inlined by the build). A decorative graphic that
never changes colour is fine as a file — though note it has to ride the release pipeline to
be content-hashed into `releases/<buildId>/` and precached before it works offline.

Several icons predate this and are composed from `div`s and borders — the hamburger, the
grips, the FAB's plus. They render correctly and cost nothing, so they are **not a defect
and do not need rewriting**; replace one when SVG makes it clearer or the box version is
fighting you, as the search magnifier's did.

## The update model

```
docs/                             ← the published site
  index.html                      ← bootloader + rescue UI, fully inlined
  sw.js                           ← service worker
  reset.html                      ← last-resort escape hatch
  manifest.webmanifest, icons/
  releases/
    latest.json                   ← pointer to the current build (never cached)
    2026-08-02-ab39a5cb/          ← immutable, content-hashed
      manifest.json               ← this build's own manifest
      assets/…
    2026-08-02-8bbec575/          ← previous build, retained for rollback
```

The sequence on a device:

1. The service worker serves the cached `index.html` for every navigation. **The network
   is never touched to start the app.**
2. The bootloader reads `slp.boot.active` from `localStorage` and injects that build's
   CSS and entry script from Cache Storage.
3. Two watchdogs arm. **T1 (30s)** requires the assets to load; **T2 (5s)**, armed only
   once they have, requires the app to be healthy. Measuring the mount clock from *after*
   the bytes land is what stops a slow first install from looking like a crash.
4. Healthy means `window.__APP_READY__ === true` **and** the element carrying
   `data-app-topbar` has a non-zero `offsetHeight`. Both, because a flag set by an app
   that rendered nothing looks identical to success.
5. Once healthy and idle, the bootloader fetches `releases/latest.json`. If it names a new
   build, **every** asset is downloaded into `slp.release.<buildId>` and verified present
   before `slp.boot.pending` is written. Any failure deletes the partial cache and leaves
   the user's current build untouched.
6. On the next cold start, `pending` is promoted to `active` and the old build becomes
   `previous`. **This cutover makes zero network requests.**

### When a release is broken

| Attempt | What happens |
| --- | --- |
| 1st failure | Rescue screen. `slp.boot.attempts` = 1. |
| 2nd failure | Rescue screen. `attempts` = 2. |
| 3rd launch | Auto-rollback to `previous`, and the failing build is added to `slp.boot.bad`. |

A build in `bad` is **never re-staged**. Without that, rolling back frees the bad build's
cache, the next update check sees it is still newest on the server, stages it again, and
the following launch promotes straight back into it — a permanent ping-pong instead of
settling on the last good version.

Publishing a *different* build id clears the device automatically, because the new build
is not in `bad`. The rescue screen's **Download a fresh copy** clears the list explicitly,
as a user override.

## The rescue layer

Four ways in, in order of how much has to be working:

1. **Automatic** — script `error` events, uncaught exceptions before mount, either
   watchdog expiring, or a failure inside a `criticalSection()` wrapper after boot.
2. **About → Troubleshooting…** for when the app runs but misbehaves.
3. **`#rescue`** appended to the URL — intercepted before any app code loads.
4. **`reset.html`** — a standalone page the service worker explicitly never intercepts,
   for when even `index.html` is corrupt. Needs the network.

The rescue screen is **inlined into `index.html`**, not fetched. Fetching it would fail in
exactly the situations it exists for. On trigger it empties `<body>` and removes every
stylesheet in the document, then renders with inline styles only — so nothing can restyle
it, cover it, or lay out on top of it. Every action is individually try/caught and reports
its own outcome, and every optional API is feature-detected, so one broken capability
cannot take the screen down.

**Export my lists** reads the data with raw IndexedDB rather than the app's wrapper,
specifically so it works when the bundle does not.

## Build pipeline

`npm run build` runs `scripts/build.mjs`, which:

1. Wipes `dist/` and `.build/`.
2. Runs `vite build` → `.build/app/` (content-hashed assets plus a Vite manifest).
3. `scripts/build-shell.mjs` — inlines `bootloader.js` and `rescue.js` into
   `index.template.html` → `dist/index.html`; copies `sw.js`, `reset.html`, the web
   manifest; generates icons; writes `.nojekyll`. Stamps `SHELL_VERSION` from a hash of
   the shell *sources*.
4. `scripts/build-release.mjs` — moves the app output to `dist/releases/<buildId>/`,
   derives the precache list, and writes `latest.json` plus a per-release `manifest.json`.

**Build ids are content-derived**, `YYYY-MM-DD-<hash8>`, hashed over the emitted files.
Two consequences, both intentional:

- Rebuilding unchanged source produces the **same id**, so it is not seen as an update and
  devices do not re-download it.
- Building uncommitted work still produces a **distinct id**, so the update flow can be
  exercised locally without committing.

Source maps are generated into `.build/` but **not shipped** — at roughly ten times the
bundle size they would dominate the committed `docs/` tree forever. Because builds are
deterministic, rebuilding the same commit regenerates the exact map when you need one.

Nothing in `dist/` encodes a deployment URL. The bootloader derives its root from
`document.baseURI`, Vite builds with `base: './'`, and the web manifest uses relative
paths. The identical artifact runs at the GitHub Pages subpath, at a staging root or
subfolder, and on `localhost`.

## Publishing a release

GitHub Pages is configured as **Deploy from a branch → `main` / `docs`**. Publishing is
deliberately a separate, explicit act from pushing source.

```bash
npm run check && npm test        # 1. gates
npm run build                    # 2. produce dist/
npm run release                  # 3. merge dist/ into docs/
git status                       # 4. review — this is the diff that goes live
git add -A && git commit         # 5. this is what publishes
git push
```

A commit that does not touch `docs/` publishes nothing. Editing the README does not ship
an app update.

`scripts/deploy.mjs` **merges, and never mirrors.** Old release directories in the
destination survive, because rollback depends on them still being served. It prunes to the
newest **3** releases and refuses to delete the one named by `latest.json`.

> **Do not switch to the "GitHub Actions" Pages source.** `actions/deploy-pages` replaces
> the entire published site on every run, which would delete exactly the release
> directories rollback depends on. Classic branch deployment serves whatever the branch
> contains.

### Shipping a fix for a bad release

1. Fix the bug and bump `version` in `package.json` if it is user-visible.
2. `npm run build` — a changed bundle means a new build id.
3. `npm run release`, commit, push.

Devices that rolled back pick the new build up on their own, because a new id is not in
their `bad` list. Devices that never broke update normally. You do not need to do anything
about the bad release still sitting in `docs/releases/` — it will be pruned after two more
releases, and no device will stage it.

## Staging

`dist/` is path-independent, so staging needs no separate build:

```bash
npm run build
npm run stage -- /path/to/staging/root
```

Two things to know:

- **Service workers require HTTPS** (or `localhost`). A plain-`http://` staging box would
  silently test everything *except* the part being staged.
- Much of it needs no staging server at all. `scripts/serve.mjs` on `localhost` is a
  secure context, and `--mount` lets you verify the same bytes work at more than one path.

## Testing

### Unit tests

```bash
npm test
```

Covers `src/app/core/**` only — the drag geometry, the undo funnel, the migrations and
input coercion, the derived column ordering, the exact formatted strings, the import and
export rules, and the drag controller's teardown. No component tests; the value here is the
invariants.

Most run in Node. `dragController.test.ts` opts into a DOM with a
`// @vitest-environment happy-dom` docblock.

### Recovery drills

`scripts/drills.js` is not imported by the app. Paste it into the devtools console of a
built site (or save it as a devtools Snippet), then:

```js
drills.help()             // list everything
await drills.state()      // current build pointers, caches, error log
await drills.seedData()   // sample list, so export has something to export
await drills.breakActiveBuild()   // then reload three times
```

The drills corrupt real cache entries rather than going through a dev-only `?__fail=`
flag. That is deliberate: a query-string flag would put test-only branches inside the most
safety-critical file in the project, and it would exercise the branch instead of the
failure. Everything they break is app files — none of them touch your lists.

### On a real device

Drag constants are tuned by feel and cannot be judged from a desktop browser.

```bash
adb reverse tcp:8080 tcp:8080
node scripts/serve.mjs dist --mount /
```

Then open `http://localhost:8080` on the phone. `adb reverse` makes the phone treat your
machine's server as `localhost`, which is a secure context — so service workers and
installation work with no certificate.

Worth checking there: the 340 ms long-press, the auto-scroll ramp near a column edge, and
whether a drag survives a notification shade pull (it must leave scrolling working).

## Project layout

```
src/shell/            The bootloader layer. Near-frozen. Knows nothing about lists.
  index.template.html   Page skeleton; the error-capturing prelude is the first script.
  bootloader.js         Build selection, watchdogs, staging, rollback.
  rescue.js             Recovery screen. No dependencies, inline styles only.
  sw.js                 Service worker. Must not change when app code changes.
  reset.html            Tier-3 escape hatch.

src/app/
  main.js               Loads data, builds the router, mounts, signals the bootloader.
  App.vue               Top bar, routed screen, overlays, the drawer's action table.
  core/                 TypeScript. Type-checked. Where the invariants live.
    types.ts              Data model + constants.
    store.ts              Reactive state and the commit() undo funnel.
    persist.ts            IndexedDB. Contract shared with rescue.js.
    migrations.ts         Schema versioning and input coercion.
    selectors.ts          Derived column composition.
    format.ts             Exact user-visible strings and spine colours.
    transfer.ts           Import / export as pure functions over text.
    dragMath.ts           Pure drag geometry.
    dragController.ts     Pointer wiring and teardown.
    bootBridge.ts         The three bootloader globals.
    cloud/                Optional Dropbox backup. Inert unless key + address match.
      index.ts              Orchestration; the only part the UI touches.
      config.ts             Registered redirect URIs and the address gate.
      dropbox.ts            Six endpoints, raw fetch, no SDK.
      pkce.ts               Verifier/challenge. Pure.
      backup.ts             Cadence, naming, retention. Pure.
      state.ts              Connection state; its own IndexedDB key.
  components/           Plain-JS Vue SFCs.
    DialogShell.vue       The scrim/card every modal is drawn in.
  ui/                   Ephemeral state, theme, routing, input modality.
    router.js             Route table. Hash history. Screens only.
    navigation.js         Navigation intents + the URL → ui projection.
    state.js              Ephemeral UI state. Not persisted.
    theme.js              Theme application and the theme-color meta.
    viewport.js           The visual viewport, as --vv-height / --vv-top.
    inputMode.js          Last input device, published as html[data-input].
  styles/tokens.css     Design tokens + interaction utilities. No component
                        hardcodes a colour.

scripts/                Build, deploy, icons, static server, drills.
docs/                   THE PUBLISHED SITE. Generated, but committed.
plans/                  Original design handoff. Reference, not code.
```

## Things that will bite you

Hard-won. Each of these was an actual bug.

**The service worker must not change when app code changes.** If `sw.js` or the shell hash
differs between two releases where only `src/app/**` changed, the design has regressed —
you have reintroduced the problem the split exists to avoid. Check the `shell` line in the
build output.

**Do not put class instances with private fields into Vue's `data()`.** Anything returned
from `data()` is wrapped in a reactive Proxy, and `#private` fields are unreachable through
a Proxy — every method throws *"Cannot read private member"*. `DragController` is assigned
in `mounted()` with `markRaw` for this reason.

**The URL owns the UI. Nothing opens or closes a layer by writing `ui` directly.** Screens
are routes, overlays are query flags, and `syncUi()` in `ui/navigation.js` — the single
`afterEach` subscriber — projects the route back onto `ui`. In-app buttons, hardware Back,
Forward and Reload therefore all travel the identical path and cannot disagree about what
is open. Writing `ui.drawerOpen = true` somewhere reintroduces exactly the class of bug
this replaced: the earlier hand-rolled layer counter drifted from the real history stack,
had no answer for Forward, and left a reload showing the home screen while the stack still
claimed layers were open.

**Never close and open a layer in the same tick.** `router.back()` is asynchronous, so the
navigation that lands afterwards tears down whatever was pushed in between. Anything that
swaps one layer for another — every drawer item that opens something — uses
`replaceLayer()`, which is a single `replace()` and cannot race with itself.

**Navigation is asynchronous.** The DOM for a layer does not exist when the call that
opened it returns. Code that has to touch it (focusing the search field is the only case
today) waits on the promise the navigation helpers return, then `$nextTick`.

**Drag teardown must be unconditional.** One `AbortController` per drag; every listener
takes `{ signal }`; teardown is idempotent and runs from `pointerup`, `pointercancel`,
`lostpointercapture`, `visibilitychange`, `blur`, **and a `finally` around the drop
commit**. A drag installs a non-passive `touchmove` handler that calls `preventDefault`; if
it survives the drag, native scrolling is dead for the rest of the session while
drag-auto-scroll keeps working, because that scrolls programmatically. This exact symptom
was observed in the design prototype.

**`touch-action` is static CSS and must never be set from JavaScript.** `.grip` is `none`,
`.row-text` is `pan-y`, the app root is `pan-x pan-y`, always. What is never dynamic cannot
get stuck. The root value is also half of "no pinch zoom" — note that `manipulation`, which
it replaced, *enables* pinch zoom; the other half is `user-scalable=no` in the shell's
viewport meta, which Safari ignores and this does not.

**Never judge a hidden document.** `requestAnimationFrame` does not fire while
`document.hidden`, so a PWA launched and immediately backgrounded never signals readiness.
`signalReady()` races rAF against a timeout, and the bootloader defers any health verdict
until the document is visible. Without both, a healthy build gets rolled back because the
user switched apps during startup.

**A dialog centred on the layout viewport ends up behind the keyboard.** The on-screen
keyboard shrinks the *visual* viewport and leaves the layout viewport — and therefore every
`position: fixed` box, including the app root — exactly where it was, so nothing in CSS
notices. `ui/viewport.js` publishes `--vv-height` / `--vv-top` from `window.visualViewport`
and `DialogShell.vue` sizes the scrim from them. Two things that look like details are not:
the scrim needs `box-sizing: border-box`, because its height *is* the usable area and its
padding has to come out of that; and the card centres with `margin: auto` rather than the
flex alignment properties, so that a card taller than the usable area lands at the top and
scrolls instead of putting its own heading above the scroll origin.

**Escape is handled in `DialogShell.vue` and nowhere else.** Closing is a router `back()`,
so a second handler for the same key emits a second close and walks two entries out of
history. `Dialogs.vue` keeps its own `keydown` listener only for Enter.

**The IndexedDB contract is shared.** `slp-data` / `kv` / `doc` appears in
`core/persist.ts`, `shell/rescue.js`, and `shell/reset.html`. Changing it in one place
breaks the ability to export lists from a broken app, which is the single most important
safety property in the project.

**`docs/` must stay tracked.** It is the published site. Do not add it to `.gitignore`.

**`.nojekyll` is required.** GitHub Pages runs Jekyll on branch deployments, which silently
drops files beginning with an underscore. `build-shell.mjs` writes it; leave it there.

**A behavioural test can pass vacuously.** The drag teardown tests originally passed with
`abort()` deleted entirely, because the `touchmove` handler is *also* gated on drag state.
There is now a listener-leak detector alongside them — and it needed its own sanity check,
because patching `EventTarget.prototype` does not intercept `document.addEventListener`.
If you touch teardown, verify the tests still fail when you break it on purpose.

## Data model and schema changes

```ts
interface List {
  id: string
  name: string
  modified: number        // epoch ms; commit() owns this, actions must not set it
  catalog: { id: string; name: string }[]
  items: { cid: string; qty: number }[]   // cid → catalog.id in the SAME list
  showOthers: boolean
}
```

Invariants, enforced in `store.ts` and covered by `store.test.ts`:

- `items[].cid` always resolves within the same list's catalog. Deleting a catalog item
  deletes its rows **in the same commit**.
- Catalog names are unique per list, case-insensitively.
- Quantities are clamped 1–99.
- The left column's order **is** the stored order of `items`. The right column's order is
  derived alphabetically and never stored.

Every mutation goes through `commit(label, fn)`, which snapshots before and after, stamps
`modified` on exactly the lists that changed, records one undo entry, clears redo,
persists, and toasts. A mutation that changes nothing is discarded silently — no undo
entry, no toast, no timestamp bump.

### Import and export

`core/transfer.ts` is the text half — building the export payload, parsing one back, and
parsing a pasted plain-text checklist — and holds no store references, so all of it is
testable without a DOM. `store.applyImport` / `store.importTextItems` are the store half,
because they have to go through `commit()`.

Pasted JSON is run through the same `coerceLists` as stored data: an import is not more
trusted than a file we wrote ourselves. A payload whose `schemaVersion` is ahead of this
build is refused rather than coerced, for the same reason startup refuses it.

Three rules the tests pin down, and which the UI wording promises:

- **An import never deletes anything except under `overwrite`.** Merge adds missing catalog
  names and missing rows and stops there.
- **An import never duplicates a row and never edits a quantity.** A quantity crosses over
  only on a row that did not exist locally at all.
- **A plain-text import is always a merge.** There is no overwrite path for it and no
  prompt offering one. A ticked box means the user already has that item, so it joins the
  catalog without joining the list; no checkbox at all is treated as wanted, because a bare
  list of names is a shopping list.

The whole of one import is a single `commit()`, so a mis-aimed overwrite is one undo away.

### Changing the schema

1. Increment `MAX_SCHEMA` in `core/migrations.ts`.
2. Add an explicit `if (version < N) { …; version = N }` step in `migrate()`.
3. Extend `coerceLists` if the shape changed.

`initialize()` snapshots the pre-migration document to `backup:preMigration` before any
forward migration, and a build that encounters `schemaVersion > MAX_SCHEMA` **refuses to
touch the data** — it renders an explanation and offers to update. That is what makes
rolling back across a schema change non-destructive; never migrate downward, and never
overwrite.

## Cloud backup (Dropbox)

Optional, opt-in, and **entirely absent from a build with no app key** — `isConfigured()`
is false and the Settings card does not render. That is the default, so a fork ships with
it dormant instead of linking its users against this project's Dropbox app.

### Why Dropbox, and not Google

Dropbox is the only mainstream provider that issues a **long-lived refresh token to a
browser-only PKCE client**. Google issues none at all to browser clients and documents that
you re-request a token "from a user-driven event such as a button press"; Microsoft caps
SPA refresh tokens at 24 hours. For an app opened once a week, both mean an interactive
sign-in almost every session, which is not a backup system. This choice is the whole reason
the feature can be automatic without a backend, so do not "simplify" it by swapping
providers.

### Setup

One app at <https://www.dropbox.com/developers/apps>, on any free account:

| Field | Value |
| --- | --- |
| API | Scoped access |
| Access type | **App folder** — confines the app to `Apps/<name>/` |
| App name | `Shopping List by bp2008` |
| Permissions | `files.content.write`, `files.content.read`, `account_info.read` |
| Redirect URIs | `https://bp2008.github.io/ShoppingList/`, `http://localhost:5173/` |

The name is global across Dropbox and the console has no rename — it is both the consent
screen's wording and the folder name in the user's Dropbox, so treat it as permanent.

Put the app key in the `DROPBOX_APP_KEY` constant at the top of `vite.config.js`, **and
commit it**. It is a public client id, not a credential:

- There is no app secret anywhere in this project. PKCE replaces it, which is the whole
  reason a static host can do OAuth at all.
- The key ships in readable JavaScript inside `docs/releases/<buildId>/assets/*.js`, and
  `docs/` is tracked. It is in git either way.

Keeping it in an ignored file would hide it from nobody while guaranteeing that a fresh
clone or a second machine silently builds a bundle with cloud backup missing — no error, no
card in Settings, and nothing to explain why.

**What actually protects the key is the registered redirect URI list**, not its secrecy: an
authorisation code can only be returned to a URI registered in the console. Guard that
list.

### The address gate

`core/cloud/config.ts` holds `REDIRECT_URIS`, which **must match the console list exactly**.
`availability()` returns one of three values, and the Settings card renders in all three:

| Value | When | What the user sees |
| --- | --- | --- |
| `ready` | Key present, address registered | The working card |
| `no-key` | Built with an empty key | Greyed card: "not configured in this release" |
| `wrong-address` | Key present, address not registered | Greyed card naming the address |

Anything other than `ready` makes the feature completely inert — `init()` restores nothing
and uploads nothing, and `beginConnect()` returns without navigating.

The point is the `wrong-address` case. Someone who forks this repo, or serves a build from
anywhere else, inherits a working app key but *not* the registered addresses — so a sign-in
would bounce them out to Dropbox and strand them on somebody else's error page. Checking up
front turns that into a sentence they can act on. **Greyed out, never hidden**: an absent
card reads as a missing feature, a greyed one reads as a feature that needs configuring.

`matchRedirectUri` ignores the query and hash (the app is a hash router and is rarely at the
bare directory), trims `index.html`, and enforces a trailing slash. It returns the string
*from the list* rather than one rebuilt from `location`, because Dropbox compares
`redirect_uri` byte for byte.

Note that this also disables cloud backup on the staging server and on any dev server that
did not get port 5173 — correctly, since neither could complete a sign-in.

An empty constant compiles the feature out, which is the right default for a fork. A
`DROPBOX_APP_KEY` in the environment or in a `.env` at the repo root overrides the
constant, for testing against a throwaway app; the build prints a warning when it does, so
a stray `.env` cannot quietly end up in a release.

Development status is fine until the app links 50 users; production approval is a form
after that.

### What it does

A snapshot is `buildExport(state.lists)` — byte-identical to a manual export — uploaded as
`backup-YYYY-MM-DD-HHmmss-mmm.json`, newest **60** kept. It runs on start and whenever the
app becomes visible, when the lists have changed AND six hours have passed. Restore
downloads a file and hands it to `ImportDialog` through `ui.pendingImportText`, so
merge/overwrite, the single `commit()`, and one-press undo are all the existing code.

The name is padded and biggest-unit-first so that sorting it lexicographically sorts it
chronologically, which is what `prunable` relies on. **The seconds and milliseconds are for
uniqueness, not for reading**: uploads are `mode: 'add'`, so a repeated name is a 409 and a
lost backup, and minute resolution collided in practice — two devices on one account, a
"Back up now" straight after an edit, or a retry after an upload that succeeded while the
local record of it did not. Names written before the seconds existed are still matched by
`prunable`, or a folder of them could never shrink again.

### Connecting, and disconnecting

`disconnect()` revokes the token at Dropbox before forgetting it locally. A refresh token
that has been thrown away but not revoked is a live key to the account that nobody is
holding any more. `/2/auth/token/revoke` takes the access token and, per Dropbox, revokes
"the corresponding refresh token, if any" with it.

The local half happens even when the revoke fails, and the failure is then **reported** —
there is no way for the user to discover it otherwise, since the app has vanished from the
card and a live token is invisible from inside the app. An `auth` failure is the exception
and counts as success: a credential that cannot be refreshed has already been revoked at
the other end.

> **Revoking does not unlink the app, and no API can.** Dropbox separates revoking *tokens*,
> which an app may do for itself, from revoking an *authorisation*, which only the account
> holder can do from Connected apps in their account settings. So after a perfectly
> successful disconnect the app is still listed there, and the App Console still counts the
> user. This is not a bug in `disconnect()` and it is not worth another attempt at fixing —
> the disconnect dialog says so plainly instead, and links to the page, because that page is
> where anyone checking a disconnect will go. (The App Console count does track live
> authorisations: it drops when the user unlinks there. What it does *not* do is un-freeze
> an app that has hit the 50-user threshold.)

`authorizeUrl` therefore cannot lean on revocation to make the round trip visible, and sends
`force_reapprove=true` instead. The approval screen is where the user sees which account
they are about to link, and it is the only opportunity to pick a different one; without it,
an account that has approved this app once — which is now *permanent* — is redirected
straight back with a fresh code and connecting looks like it did nothing at all.

The sign-in returns to a registered redirect URI, which is the bare directory and carries no
hash, so `captureRedirect` rewrites the hash to `#/?settings` on the way in. The app then
simply starts on the Settings sheet, with no home screen painted first and no extra history
entry. `beginConnect` leaves via `location.replace` rather than `assign` for the same
reason — the entry it leaves is a dead end, and keeping it buries a second Settings entry
behind the Dropbox pages.

### Things that will bite you here

**Hash `JSON.stringify(state.lists)`, never the export payload.** `buildExport` stamps
`exportedAt`, so its hash differs on every call and the "nothing changed" check would never
once be true — turning a six-hourly backup into one per visibility change, forever.

**Nothing in `core/cloud/` may reject.** The shell's prelude captures `unhandledrejection`
and reports it to the bootloader, so a cloud failure that escapes is capable of getting a
healthy build rolled back. Every exported entry point resolves; failures land in
`cloud.error`. Nothing here goes through `criticalSection()`.

**`captureRedirect()` runs above `signalReady()`.** It is synchronous, does nothing that
can fail, and swallows its own errors, because an exception there is inside the watchdog
window. The network half deliberately waits until after mount.

**`withToken()` waits on `ready`, and `init()` releases it before backing up.** The URL
owns the UI, so a reload with the restore dialog open re-opens it long before IndexedDB has
been read; without the gate it reports the user as signed out. Releasing `ready` after the
first backup instead of before would deadlock that backup.

**`prunable()` only ever deletes files matching our own naming pattern.** The app folder is
visible to the user and they may put things in it. This is the one path in the feature that
destroys data rather than merely failing to save it.

### Untested on iOS

The sign-in is a full-page redirect off-origin and back. An installed iOS web app may not
survive that, and there is no iPhone available to test on. Mitigated by construction — no
popup, no `window.opener`, verifier in localStorage — and the flow detects its own failure
via `slp.cloud.started` and tells the user to use export instead. Do not reword that message
to suggest retrying in Safari: on iOS a Home Screen web app has storage separate from
Safari, so a connection made there would not carry over.

## Storage reference

**localStorage** (bootloader only; synchronous by design, with an in-memory fallback):

| Key | Meaning |
| --- | --- |
| `slp.boot.active` | Build id currently running |
| `slp.boot.previous` | Last known-good build, for rollback |
| `slp.boot.pending` | Fully staged build, applied on next cold start |
| `slp.boot.attempts` | Consecutive failed starts of `active` |
| `slp.boot.rolledBack` | Set after an automatic rollback |
| `slp.boot.good` | Recently healthy build ids |
| `slp.boot.bad` | Builds that failed here and must not be re-staged |
| `slp.boot.errors` | Ring buffer of the last 20 errors |
| `slp.boot.mf.<buildId>` | That build's manifest, so it can boot offline |

**Cache Storage**

| Name | Owner | Contents |
| --- | --- | --- |
| `slp.shell.<hash>` | service worker | `index.html`, web manifest, icons |
| `slp.release.<buildId>` | bootloader | One build's assets |

The service worker deletes only `slp.shell.*`. Release caches belong to the bootloader —
deleting one from the worker would destroy the ability to roll back.

**IndexedDB** — database `slp-data`, store `kv`:

| Key | Contents |
| --- | --- |
| `doc` | `{ schemaVersion, lists, settings }` — the user's data |
| `backup:preMigration` | Last document written before a schema migration |
| `cloud` | Dropbox connection: refresh token, account email, last backup time and hash |

`cloud` is deliberately NOT inside `doc`. It is device-local rather than user data, it
holds a credential that must never travel inside an export, and folding it into the
document would change the shape `rescue.js` and `reset.html` read — for a field no list
depends on. It carries no schema version and is simply ignored when unreadable.

**localStorage** (cloud backup; only between starting a sign-in and returning from it):

| Key | Meaning |
| --- | --- |
| `slp.cloud.verifier` | PKCE code verifier awaiting the redirect |
| `slp.cloud.state` | Value the redirect must echo back |
| `slp.cloud.started` | When the redirect began; detects a round trip that never returned |

localStorage rather than sessionStorage on purpose — the flow leaves the origin entirely
and comes back through a fresh page load, which sessionStorage is the more fragile of the
two across, particularly in an installed PWA.

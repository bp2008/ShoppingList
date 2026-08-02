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

Stack: **Vue 3 (Options API) + Vite**, no Babel, targeting `es2022` because the app is
for modern smartphones only. TypeScript is used selectively — see
[Language split](#language-split).

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
input coercion, the derived column ordering, the exact formatted strings, and the drag
controller's teardown. No component tests; the value here is the invariants.

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
  main.js               Loads data, mounts, then signals the bootloader.
  App.vue               Screen switching, overlays, the drawer's action table.
  core/                 TypeScript. Type-checked. Where the invariants live.
    types.ts              Data model + constants.
    store.ts              Reactive state and the commit() undo funnel.
    persist.ts            IndexedDB. Contract shared with rescue.js.
    migrations.ts         Schema versioning and input coercion.
    selectors.ts          Derived column composition.
    format.ts             Exact user-visible strings and spine colours.
    dragMath.ts           Pure drag geometry.
    dragController.ts     Pointer wiring and teardown.
    bootBridge.ts         The three bootloader globals.
  components/           Plain-JS Vue SFCs.
  ui/                   Ephemeral state, theme, history/back-button.
  styles/tokens.css     Design tokens. No component hardcodes a colour.

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

**`popstate` is the only place a UI layer is closed.** `popLayer()` asks the browser to go
back and does *not* touch state. The obvious alternative — close the layer directly *and*
call `history.back()`, suppressing the resulting `popstate` — desyncs as soon as two closes
overlap, and the user gets thrown out of their list. Related: **never `popLayer()` and
`pushLayer()` in the same tick.** `history.back()` is asynchronous, so the late `popstate`
tears down the layer you just pushed. Use `reuseLayer()` to inherit the current entry
instead (see the drawer's action table).

**Drag teardown must be unconditional.** One `AbortController` per drag; every listener
takes `{ signal }`; teardown is idempotent and runs from `pointerup`, `pointercancel`,
`lostpointercapture`, `visibilitychange`, `blur`, **and a `finally` around the drop
commit**. A drag installs a non-passive `touchmove` handler that calls `preventDefault`; if
it survives the drag, native scrolling is dead for the rest of the session while
drag-auto-scroll keeps working, because that scrolls programmatically. This exact symptom
was observed in the design prototype.

**`touch-action` is static CSS and must never be set from JavaScript.** `.grip` is `none`,
`.row-text` is `pan-y`, always. What is never dynamic cannot get stuck.

**Never judge a hidden document.** `requestAnimationFrame` does not fire while
`document.hidden`, so a PWA launched and immediately backgrounded never signals readiness.
`signalReady()` races rAF against a timeout, and the bootloader defers any health verdict
until the document is visible. Without both, a healthy build gets rolled back because the
user switched apps during startup.

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

### Changing the schema

1. Increment `MAX_SCHEMA` in `core/migrations.ts`.
2. Add an explicit `if (version < N) { …; version = N }` step in `migrate()`.
3. Extend `coerceLists` if the shape changed.

`initialize()` snapshots the pre-migration document to `backup:preMigration` before any
forward migration, and a build that encounters `schemaVersion > MAX_SCHEMA` **refuses to
touch the data** — it renders an explanation and offers to update. That is what makes
rolling back across a schema change non-destructive; never migrate downward, and never
overwrite.

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

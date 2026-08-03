import { clampQty } from '../core/types'
import { ui, closeSearch, exitSelection } from './state'

/**
 * Navigation intents, and the projection of the URL back onto `ui`.
 *
 * THE URL IS THE SOURCE OF TRUTH. Nothing in the app opens or closes a layer by writing
 * `ui` directly: it navigates, and `syncUi()` — the single afterEach subscriber — makes
 * `ui` match wherever the router ended up. In-app buttons, the Android/browser Back
 * button, Forward and Reload therefore all travel the identical path, so none of them can
 * disagree about what is open. This replaces the hand-rolled layer counter in the old
 * ui/history.js; the counter could drift from the real history stack and it had no answer
 * for Forward at all.
 *
 * The router is injected rather than imported so that components can import these helpers
 * without a cycle back through ui/router.js, which imports the components.
 */

let router = null

/** Dialog kinds accepted from the URL. Anything else is ignored rather than trusted. */
const DIALOGS = new Set([
  'new-list',
  'add-catalog',
  'quantity',
  'rename',
  'delete-list',
  'export',
  'import',
  'import-text',
  'cloud-restore',
  'cloud-disconnect',
  'about',
])

/** Kinds that act on the open list and are meaningless without one. */
const LIST_DIALOGS = new Set(['add-catalog', 'quantity', 'rename', 'delete-list', 'import-text'])

/**
 * Layer query keys, topmost first.
 *
 * Order matters in exactly one place: closing a layer when there is no history entry to
 * go back to (a cold deep link), where it decides which one is on top.
 */
const LAYER_KEYS = ['dialog', 'settings', 'menu', 'select', 'search']

/** Extra keys that belong to the dialog layer and must be dropped along with it. */
const DIALOG_ARGS = ['cid', 'qty']

export function installNavigation(instance) {
  router = instance
  router.afterEach((to, from) => syncUi(to, from))
}

/* --------------------------------------------------------------------- reading */

/**
 * Make `ui` match the route.
 *
 * Ephemeral detail that would be noise in a URL — the search text, the checkbox
 * selection — is deliberately not restored; only the fact that the layer is open is.
 * Each is cleared here when its layer closes, so no path can leave it stranded.
 *
 * The one place this projection also WRITES to the URL is a search layer that has outlived
 * its text (see `staleSearch`), where the honest reading of the URL is that it is out of
 * date rather than that the box should be empty.
 */
function syncUi(route, from) {
  const q = route.query
  const onList = route.name === 'list'

  ui.view = onList ? 'list' : 'home'
  ui.listId = onList ? String(route.params.id) : null

  ui.drawerOpen = 'menu' in q
  ui.settingsOpen = 'settings' in q

  // A list dialog reached on the home screen has no subject, so it is dropped exactly
  // like an unknown kind rather than mounted against a null list.
  const named = DIALOGS.has(q.dialog) ? q.dialog : null
  const dialog = named && LIST_DIALOGS.has(named) && !onList ? null : named
  ui.dialog = dialog
  ui.dialogArg =
    dialog === 'quantity' ? { cid: String(q.cid ?? ''), value: clampQty(Number(q.qty)) } : null

  const searching = 'search' in q && !staleSearch(route, from)
  if (!searching) closeSearch()
  ui.searchOpen = searching
  // The URL still says the layer is open, so bring it into line. Doing this from here
  // rather than leaving it is what keeps the projection honest; the replacement carries no
  // `search`, so the navigation it triggers cannot come back through this branch.
  if ('search' in q && !searching) dropLayer('search')

  const selecting = 'select' in q
  if (!selecting) exitSelection()
  ui.selecting = selecting
}

/**
 * A search layer that arrived on a different screen with nothing typed has outlived its
 * text, and is dropped rather than reopened as an empty box.
 *
 * The text is not in the URL, so an entry that was left while searching comes back blank —
 * a search field open over unfiltered results, asking a question the user already answered
 * and left. It happens on the way back from a list opened out of a search whose text was
 * then cleared there, and on any reload of `?search`.
 *
 * The test is the SCREEN, because opening search never changes it: tapping the magnifier
 * adds the flag to the screen already showing, so an empty box there is one the user is
 * about to type into. Arriving on a different screen with the flag and no text is the only
 * way to get one nobody asked for. A search carried into a list by `openList` still has
 * its text, and so is not stale.
 */
function staleSearch(to, from) {
  if (ui.query !== '') return false
  return to.name !== from.name || String(to.params.id ?? '') !== String(from.params.id ?? '')
}

/** Rewrite the current entry without `key`. Never a new entry: the layer is not history. */
function dropLayer(key) {
  const query = { ...router.currentRoute.value.query }
  delete query[key]
  return router.replace({ query })
}

/* ------------------------------------------------------------------- navigating */

/*
 * These all return the router's promise. Navigation is asynchronous, so anything that has
 * to touch the DOM it produces -- focusing the search field is the one case -- has to wait
 * for it rather than for the current tick.
 */

/**
 * Open a list. A new entry, so Back returns to the home screen.
 *
 * AN ACTIVE SEARCH TRAVELS WITH IT. Home search matches a list's name or anything in its
 * catalog, so a tile shown while searching is usually the answer to "which list has this
 * item in it" — and dropping the query on the way in made the user type it a second time
 * to find out where in the list it was. Carrying the layer keeps the text too, because
 * `syncUi` only clears that when the search layer closes.
 *
 * Only `search` is carried. The other layers cover the screen, so no tile can be tapped
 * while one of them is open.
 */
export function openList(id) {
  const searching = 'search' in router.currentRoute.value.query
  return router.push({ name: 'list', params: { id }, query: searching ? { search: null } : {} })
}

/** Replace the current entry with a list screen, e.g. the dialog that just created it. */
export function replaceWithList(id) {
  return router.replace({ name: 'list', params: { id } })
}

export function goHome() {
  return router.replace({ name: 'home' })
}

/**
 * Open a layer on top of whatever is showing: a new history entry, so Back closes it.
 *
 * Merging into the existing query rather than replacing it is what lets layers stack —
 * opening the menu while search is open gives `?search&menu`, and one Back leaves search
 * open, matching what is on screen.
 */
export function openLayer(patch) {
  return router.push({ query: { ...router.currentRoute.value.query, ...patch } })
}

/**
 * Swap the top layer for a different one, inheriting its history entry.
 *
 * Used by every menu item that opens something: the drawer closes and the thing it opened
 * takes its place, so one Back returns to the screen rather than reopening the menu.
 * Doing this as back() followed by push() is the bug the old implementation warned
 * about — history.back() is asynchronous, so the late popstate would tear down the layer
 * just pushed. One replace() cannot race with itself.
 */
export function replaceLayer(patch) {
  const current = router.currentRoute.value
  return router.replace({ query: { ...(stripTopLayer(current.query) ?? current.query), ...patch } })
}

/**
 * Close the topmost layer, or leave the list screen when none is open.
 *
 * Normally this is just Back, so that in-app close and hardware Back are the same action
 * and the forward entry stays available. That equivalence holds only while the entry
 * behind us IS this entry minus the layer being closed, which is true of every layer
 * opened with `openLayer` and false in two cases: a cold launch straight into a deep link,
 * where Back would leave the site entirely, and a layer carried across a screen change by
 * `openList`, where Back would leave the list as well as the search. Both rewrite the
 * entry instead.
 */
export function closeLayer() {
  const query = stripTopLayer(router.currentRoute.value.query)

  // No layer open: this is "leave the list screen", which is the whole of what Back does.
  if (query === null) {
    if (canGoBack()) router.back()
    else goHome()
    return
  }

  if (backIs(query)) router.back()
  else router.replace({ query })
}

/**
 * True when the previous history entry is one this app wrote.
 *
 * `history.state.back` is vue-router's own record of the entry it came from, and it is
 * null on the first entry of a session. It survives a reload, which is what allows Back
 * to keep working across a refresh now that entries carry their state in the URL.
 */
function canGoBack() {
  return typeof window.history.state?.back === 'string'
}

/**
 * True when the previous entry is this screen with exactly `query` on it.
 *
 * The router resolves the comparison string, so both sides come out of the same
 * serializer and a raw string comparison is safe. A false answer only ever costs the
 * forward entry — the close itself still happens, by rewriting instead of stepping back.
 */
function backIs(query) {
  return canGoBack() && window.history.state.back === router.resolve({ query }).fullPath
}

/** The query with the topmost layer removed, or null when no layer is open. */
function stripTopLayer(query) {
  const q = { ...query }
  for (const key of LAYER_KEYS) {
    if (!(key in q)) continue
    delete q[key]
    if (key === 'dialog') for (const arg of DIALOG_ARGS) delete q[arg]
    return q
  }
  return null
}

import { ui, closeOverlays, closeSearch, exitSelection } from './state'

/**
 * Android back button support, without a router.
 *
 * Two screens and a few overlays do not justify vue-router, but Back absolutely must
 * work: in an installed PWA there is no browser chrome, so Back is the only way out of a
 * dialog, and if it exits the app instead the app feels broken.
 *
 * DESIGN NOTE — why there is no "suppress the next popstate" flag:
 *
 * The obvious implementation closes the layer directly AND calls history.back(), then
 * suppresses the popstate that results. That desyncs the moment two closes overlap: one
 * suppression is consumed by the wrong event, the surviving popstate closes a layer
 * nobody asked to close, and the user is thrown out of their list.
 *
 * Instead, popstate is the ONLY place a layer is ever closed, and the number of open
 * layers is reconciled against the history entry's own counter. In-app close and hardware
 * Back therefore travel the identical path, and any drift is corrected on the next event
 * rather than accumulating.
 */

let openLayers = 0

/** Call when opening a dismissible layer. */
export function pushLayer() {
  openLayers++
  history.pushState({ slp: openLayers }, '')
}

/**
 * Close the topmost layer.
 *
 * Deliberately does not touch UI state — it asks the browser to go back, and the popstate
 * handler does the closing. Callers must not also clear the state themselves.
 */
export function popLayer() {
  if (openLayers === 0) return
  history.back()
}

/**
 * Keep the current history entry but change what it represents.
 *
 * Used when creating a list: the dialog closes and the list screen opens in its place, so
 * one Back should return to the home screen rather than reopening the dialog.
 */
export function reuseLayer() {
  // Intentionally empty of history calls; the count is already correct.
}

function closeTopLayer() {
  if (ui.dialog) {
    ui.dialog = null
    ui.dialogArg = null
    return true
  }
  if (ui.settingsOpen) {
    ui.settingsOpen = false
    return true
  }
  if (ui.drawerOpen) {
    ui.drawerOpen = false
    return true
  }
  if (ui.selecting) {
    exitSelection()
    return true
  }
  if (ui.searchOpen) {
    closeSearch()
    return true
  }
  if (ui.view === 'list') {
    ui.view = 'home'
    ui.listId = null
    closeSearch()
    return true
  }
  return false
}

export function installHistory() {
  // A cold launch must never restore into a half-open state from a previous session.
  history.replaceState({ slp: 0 }, '')
  openLayers = 0
  closeOverlays()

  window.addEventListener('popstate', (event) => {
    const target =
      event.state && typeof event.state.slp === 'number' ? event.state.slp : 0

    // Reconcile down to whatever the history entry says. Self-correcting: if the counts
    // ever drift, this closes the difference instead of compounding it.
    while (openLayers > target) {
      openLayers--
      if (!closeTopLayer()) break
    }
  })
}

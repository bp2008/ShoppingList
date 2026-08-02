import { reactive } from 'vue'

/**
 * Ephemeral UI state — deliberately NOT persisted. Only `lists` and `settings` survive a
 * relaunch, and those live in core/store.ts.
 *
 * MOST OF THIS IS A PROJECTION, NOT A SOURCE. Which screen you are on and which layer is
 * open belong to the URL; `syncUi()` in ui/navigation.js is the only writer of those
 * fields, and nothing else may set them directly. What remains genuinely owned here is the
 * detail that would be noise in a URL: the search text, the checkbox selection, the
 * in-flight drag, the toast.
 *
 * A reload therefore lands back on the screen and layer the URL names — that is the point
 * of routing them — while the search text, the selection and any drag still reset. A cold
 * launch has no hash and so still starts on the home screen.
 */
export const ui = reactive({
  /** 'home' | 'list' */
  view: 'home',
  listId: null,

  searchOpen: false,
  query: '',

  drawerOpen: false,
  settingsOpen: false,

  /**
   * null | 'new-list' | 'add-catalog' | 'quantity' | 'rename' | 'delete-list' | 'export' |
   * 'import' | 'import-text' | 'about'
   */
  dialog: null,
  /** Payload for the open dialog (e.g. the cid whose quantity is being set). */
  dialogArg: null,

  /** Catalog-delete mode: the only place checkboxes appear in the app. */
  selecting: false,
  selected: [],

  /** Mirrors DragController state for rendering; null when no drag is in flight. */
  drag: null,

  toast: '',

  /** Set once the bootloader reports a staged update is ready to apply. */
  updateReady: false,

  /** App width, observed; drives the narrow-viewport grip rule. */
  width: 0,
})

let toastTimer = null

/** Centred pill, 2200ms, never interactive. */
export function showToast(message) {
  ui.toast = message
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    ui.toast = ''
    toastTimer = null
  }, 2200)
}

export function closeOverlays() {
  ui.drawerOpen = false
  ui.settingsOpen = false
  ui.dialog = null
  ui.dialogArg = null
}

export function exitSelection() {
  ui.selecting = false
  ui.selected = []
}

export function closeSearch() {
  ui.searchOpen = false
  ui.query = ''
}

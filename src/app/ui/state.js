import { reactive } from 'vue'

/**
 * Ephemeral UI state — deliberately NOT persisted.
 *
 * The handoff draws this line explicitly: which screen you are on, what you typed in
 * search, which menu is open, and everything about an in-flight drag all reset on
 * relaunch. Only `lists` and `settings` survive, and those live in core/store.ts.
 */
export const ui = reactive({
  /** 'home' | 'list' */
  view: 'home',
  listId: null,

  searchOpen: false,
  query: '',

  drawerOpen: false,
  settingsOpen: false,

  /** null | 'new-list' | 'add-catalog' | 'quantity' | 'rename' | 'delete-list' | 'data' | 'about' */
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

/**
 * The data model, lifted from the design handoff.
 *
 * The invariants below are enforced in store.ts and covered by store.test.ts. They are
 * not decorative -- `items[].cid` dangling is the difference between a rendered row and
 * a crash, and case-insensitive catalog uniqueness is what makes drag-to-add idempotent.
 */

export interface CatalogItem {
  id: string
  name: string
}

export interface ListItem {
  /** References CatalogItem.id within the SAME list. Never another list's. */
  cid: string
  qty: number
}

export interface List {
  id: string
  name: string
  /** Epoch ms. Any mutation sets this; the home screen sorts and colours by it. */
  modified: number
  catalog: CatalogItem[]
  /**
   * The user's own ordering. This IS the stored order of the left column.
   * The right column's order is derived (alphabetical) and never stored.
   */
  items: ListItem[]
  /** Per-list: append other lists' catalog items to the right column. */
  showOthers: boolean
}

export type Theme = 'light' | 'oled' | 'system'

export interface Settings {
  theme: Theme
  rowHeight: number
  showGrips: boolean
  askQty: boolean
}

export interface PersistedDoc {
  schemaVersion: number
  lists: List[]
  settings: Settings
}

export const QTY_MIN = 1
export const QTY_MAX = 99

/** The handoff states this in the Settings footer, so it is user-visible copy. */
export const UNDO_LIMIT = 50

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  rowHeight: 44,
  showGrips: true,
  askQty: true,
}

export function clampQty(n: number): number {
  if (!Number.isFinite(n)) return QTY_MIN
  return Math.min(QTY_MAX, Math.max(QTY_MIN, Math.round(n)))
}

/** Catalog names are unique per list, case-insensitively. */
export function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

import { reactive } from 'vue'
import { newId } from './ids'
import { DataTooNewError, MAX_SCHEMA, emptyDoc, migrate } from './migrations'
import * as persist from './persist'
import type { TextItem } from './transfer'
import {
  DEFAULT_SETTINGS,
  UNDO_LIMIT,
  clampQty,
  sameName,
  type CatalogItem,
  type List,
  type PersistedDoc,
  type Settings,
  type Theme,
} from './types'

/* ------------------------------------------------------------------------ state */

export const state = reactive<PersistedDoc>(emptyDoc())

export interface UndoEntry {
  /** User-facing verb phrase. The drawer renders it, and the toast repeats it. */
  label: string
  before: string
  after: string
}

export const undoStack = reactive<UndoEntry[]>([])
export const redoStack = reactive<UndoEntry[]>([])

let toastHandler: (message: string) => void = () => {}

/** The UI installs the real toast here; core stays free of view concerns. */
export function onToast(fn: (message: string) => void): void {
  toastHandler = fn
}

export function toast(message: string): void {
  toastHandler(message)
}

/* ------------------------------------------------------------------- the funnel */

/**
 * Everything about a list EXCEPT its id and its `modified` stamp.
 *
 * Excluding `modified` is what lets commit() distinguish a real change from a no-op.
 * If actions stamped the time themselves, every attempted mutation would look like a
 * change and the undo stack would fill with entries that did nothing.
 */
function structural(list: List): string {
  return JSON.stringify([list.name, list.catalog, list.items, list.showOthers])
}

function structuralMap(lists: List[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const l of lists) map.set(l.id, structural(l))
  return map
}

/**
 * The single funnel every data mutation passes through.
 *
 * Snapshots before and after, stamps `modified` on exactly the lists that changed,
 * records one undo entry, clears the redo stack, persists, and toasts. A mutation that
 * changed nothing is silently discarded -- no undo entry, no toast, no timestamp bump.
 *
 * Actions must NOT set `modified` themselves; this owns it.
 *
 * @returns true if anything actually changed.
 */
export function commit(label: string, mutate: () => void): boolean {
  const before = JSON.stringify(state.lists)
  const beforeMap = structuralMap(state.lists)

  mutate()

  const afterMap = structuralMap(state.lists)
  const now = Date.now()
  let changed = beforeMap.size !== afterMap.size

  for (const list of state.lists) {
    if (beforeMap.get(list.id) !== afterMap.get(list.id)) {
      changed = true
      list.modified = now
    }
  }

  if (!changed) return false

  undoStack.push({ label, before, after: JSON.stringify(state.lists) })
  while (undoStack.length > UNDO_LIMIT) undoStack.shift()
  redoStack.length = 0

  persist.schedule(state)
  toastHandler(label)
  return true
}

function applySnapshot(json: string): void {
  state.lists.splice(0, state.lists.length, ...(JSON.parse(json) as List[]))
}

export function undo(): boolean {
  const entry = undoStack.pop()
  if (!entry) return false
  applySnapshot(entry.before)
  redoStack.push(entry)
  persist.schedule(state)
  toastHandler(`Undid: ${entry.label}`)
  return true
}

export function redo(): boolean {
  const entry = redoStack.pop()
  if (!entry) return false
  applySnapshot(entry.after)
  undoStack.push(entry)
  persist.schedule(state)
  toastHandler(`Redid: ${entry.label}`)
  return true
}

/* ----------------------------------------------------------------------- lookup */

export function getList(id: string): List | undefined {
  return state.lists.find((l) => l.id === id)
}

export function catalogItem(list: List, cid: string): CatalogItem | undefined {
  return list.catalog.find((c) => c.id === cid)
}

export function catalogName(list: List, cid: string): string {
  return catalogItem(list, cid)?.name ?? ''
}

/* ---------------------------------------------------------------------- actions */
/*
 * Labels are the handoff's exact strings. They appear in three places -- the toast, the
 * undo button, and the redo button -- so they read as verb phrases describing what was
 * done, not what the button will do.
 */

export function createList(name: string): string | null {
  const trimmed = name.trim()
  if (!trimmed) return null
  const id = newId()
  commit(`Created “${trimmed}”`, () => {
    state.lists.push({
      id,
      name: trimmed,
      modified: Date.now(),
      catalog: [],
      items: [],
      showOthers: false,
    })
  })
  return id
}

export function renameList(listId: string, name: string): boolean {
  const trimmed = name.trim()
  if (!trimmed) return false
  return commit(`Renamed to “${trimmed}”`, () => {
    const list = getList(listId)
    if (list) list.name = trimmed
  })
}

export function deleteList(listId: string): boolean {
  const list = getList(listId)
  if (!list) return false
  return commit(`Deleted “${list.name}”`, () => {
    const i = state.lists.findIndex((l) => l.id === listId)
    if (i !== -1) state.lists.splice(i, 1)
  })
}

export function toggleShowOthers(listId: string): boolean {
  const list = getList(listId)
  if (!list) return false
  const label = list.showOthers ? 'Hid other lists’ items' : 'Showed other lists’ items'
  return commit(label, () => {
    const l = getList(listId)
    if (l) l.showOthers = !l.showOthers
  })
}

/** Returns false when the name already exists, so the caller can toast the rejection. */
export function addCatalogItem(listId: string, name: string, alsoAddToList: boolean): boolean {
  const trimmed = name.trim()
  const list = getList(listId)
  if (!trimmed || !list) return false
  if (list.catalog.some((c) => sameName(c.name, trimmed))) return false

  const cid = newId()
  commit(`Added “${trimmed}”`, () => {
    const l = getList(listId)
    if (!l) return
    l.catalog.push({ id: cid, name: trimmed })
    if (alsoAddToList) l.items.push({ cid, qty: 1 })
  })
  return true
}

/**
 * Delete catalog entries and every list row that referenced them, as one action.
 *
 * The cascade is the invariant: a surviving `items` entry whose `cid` no longer resolves
 * renders as a nameless row. Doing it in one commit also means one undo restores both.
 */
export function deleteCatalogItems(listId: string, ids: string[]): boolean {
  const list = getList(listId)
  if (!list || ids.length === 0) return false
  const doomed = new Set(ids)
  const count = list.catalog.filter((c) => doomed.has(c.id)).length
  if (count === 0) return false

  const label = count === 1 ? 'Deleted 1 catalog item' : `Deleted ${count} catalog items`
  return commit(label, () => {
    const l = getList(listId)
    if (!l) return
    l.catalog = l.catalog.filter((c) => !doomed.has(c.id))
    l.items = l.items.filter((it) => !doomed.has(it.cid))
  })
}

/** Drag right -> left. The catalog keeps the item; this only adds a row. */
export function addToList(listId: string, cid: string, index: number): boolean {
  const list = getList(listId)
  if (!list) return false
  const item = catalogItem(list, cid)
  if (!item) return false
  if (list.items.some((it) => it.cid === cid)) return false

  return commit(`Added “${item.name}”`, () => {
    const l = getList(listId)
    if (!l) return
    const at = Math.min(Math.max(index, 0), l.items.length)
    l.items.splice(at, 0, { cid, qty: 1 })
  })
}

/** Drag left -> right. Removes the row; the catalog entry survives. */
export function removeFromList(listId: string, cid: string): boolean {
  const list = getList(listId)
  if (!list) return false
  const name = catalogName(list, cid)
  return commit(`Removed “${name}”`, () => {
    const l = getList(listId)
    if (!l) return
    const i = l.items.findIndex((it) => it.cid === cid)
    if (i !== -1) l.items.splice(i, 1)
  })
}

/** Drag left -> left. `to` is an insertion index measured against the pre-move array. */
export function moveItem(listId: string, from: number, to: number): boolean {
  const list = getList(listId)
  if (!list) return false
  const moving = list.items[from]
  if (!moving) return false

  const name = catalogName(list, moving.cid)
  return commit(`Moved “${name}”`, () => {
    const l = getList(listId)
    if (!l) return
    const [entry] = l.items.splice(from, 1)
    if (!entry) return
    // Removing the row first shifts every later index down by one.
    l.items.splice(to > from ? to - 1 : to, 0, entry)
  })
}

export function setQty(listId: string, cid: string, qty: number): boolean {
  const list = getList(listId)
  if (!list) return false
  const name = catalogName(list, cid)
  const next = clampQty(qty)
  return commit(`Set “${name}” to ×${next}`, () => {
    const l = getList(listId)
    const entry = l?.items.find((it) => it.cid === cid)
    if (entry) entry.qty = next
  })
}

export function incrementQty(listId: string, cid: string): boolean {
  const list = getList(listId)
  const entry = list?.items.find((it) => it.cid === cid)
  if (!list || !entry) return false
  return setQty(listId, cid, entry.qty + 1)
}

export function sortLeftAZ(listId: string): boolean {
  const list = getList(listId)
  if (!list) return false
  return commit('Sorted left column A–Z', () => {
    const l = getList(listId)
    if (!l) return
    l.items = [...l.items].sort((a, b) =>
      catalogName(l, a.cid).localeCompare(catalogName(l, b.cid)),
    )
  })
}

/**
 * Drag from another list's catalog into this list.
 *
 * Two effects -- copy the name into this list's catalog under a NEW id, then add a row --
 * committed together, because undoing half of it would leave an orphan catalog entry the
 * user never asked for.
 */
export function adoptForeignItem(listId: string, name: string, index: number): boolean {
  const trimmed = name.trim()
  const list = getList(listId)
  if (!trimmed || !list) return false

  const existing = list.catalog.find((c) => sameName(c.name, trimmed))
  if (existing) return addToList(listId, existing.id, index)

  const cid = newId()
  return commit(`Added “${trimmed}”`, () => {
    const l = getList(listId)
    if (!l) return
    l.catalog.push({ id: cid, name: trimmed })
    const at = Math.min(Math.max(index, 0), l.items.length)
    l.items.splice(at, 0, { cid, qty: 1 })
  })
}

/* ---------------------------------------------------------------------- import */

/** What to do with one incoming list. */
export type ImportMode = 'create' | 'merge' | 'overwrite'

export interface ImportPlan {
  /** An incoming list, already coerced by core/transfer. */
  list: List
  mode: ImportMode
  /** The local list this targets. Required for 'merge' and 'overwrite', ignored for 'create'. */
  targetId?: string
}

/** The local list an incoming one would collide with, matched by name as the user sees it. */
export function findListByName(name: string): List | undefined {
  return state.lists.find((l) => sameName(l.name, name))
}

/**
 * Copy an incoming list in beside the ones already here.
 *
 * The incoming id is reused when it is free, so re-importing a backup onto a device that
 * has since deleted the list restores the same identity; a collision takes a fresh id
 * instead, because two lists sharing one id would make every lookup ambiguous.
 */
function createFromImport(incoming: List): void {
  const id = state.lists.some((l) => l.id === incoming.id) ? newId() : incoming.id
  state.lists.push({ ...incoming, id })
}

/**
 * Replace a list's contents wholesale.
 *
 * The LOCAL id survives, not the incoming one: the list may be the screen behind the
 * dialog, and swapping its id under the router would bounce the user home mid-import.
 */
function overwriteFromImport(targetId: string, incoming: List): void {
  const at = state.lists.findIndex((l) => l.id === targetId)
  if (at === -1) return
  state.lists.splice(at, 1, { ...incoming, id: targetId })
}

/**
 * Fold an incoming list into an existing one. ADDITIVE ONLY.
 *
 * Nothing is removed and no quantity is touched: an import must never be able to delete
 * what the user already had, and a row that is already on the list is left exactly as they
 * left it. A quantity only comes across on a row that did not exist here at all.
 *
 * Catalog entries are matched by name, case-insensitively, and new ones are minted with a
 * fresh cid rather than the incoming one, which could collide with a cid this list is
 * already using.
 */
function mergeFromImport(targetId: string, incoming: List): void {
  const target = getList(targetId)
  if (!target) return

  const localCid = new Map<string, string>()
  for (const entry of incoming.catalog) {
    const existing = target.catalog.find((c) => sameName(c.name, entry.name))
    if (existing) {
      localCid.set(entry.id, existing.id)
      continue
    }
    const cid = newId()
    target.catalog.push({ id: cid, name: entry.name })
    localCid.set(entry.id, cid)
  }

  for (const row of incoming.items) {
    const cid = localCid.get(row.cid)
    if (!cid) continue
    if (target.items.some((it) => it.cid === cid)) continue
    target.items.push({ cid, qty: clampQty(row.qty) })
  }
}

/**
 * Apply a set of import decisions as ONE action.
 *
 * One commit for the whole import, so a mis-aimed overwrite is a single undo away -- the
 * handoff calls that out specifically, and it matters far more here than anywhere else in
 * the app because overwrite is the only destructive path an import has.
 *
 * @returns the number of lists imported, or 0 if nothing actually changed.
 */
export function applyImport(plans: ImportPlan[]): number {
  if (plans.length === 0) return 0

  const label = plans.length === 1 ? 'Imported 1 list' : `Imported ${plans.length} lists`
  const changed = commit(label, () => {
    for (const plan of plans) {
      // A merge or overwrite whose target has gone is imported as a new list rather than
      // dropped: the user asked for that list, and losing it silently is the worse answer.
      const targetId = plan.mode === 'create' ? null : (plan.targetId ?? null)
      if (targetId === null || !getList(targetId)) createFromImport(plan.list)
      else if (plan.mode === 'overwrite') overwriteFromImport(targetId, plan.list)
      else mergeFromImport(targetId, plan.list)
    }
  })
  return changed ? plans.length : 0
}

/**
 * Merge a pasted plain-text checklist into one list. Always additive, never a replace.
 *
 * A ticked box means the user already has that item, so it joins the catalog and stops
 * there; anything unticked -- or carrying no checkbox at all, which is what a bare list of
 * names is -- also lands in the left column. Names already in the catalog are reused, rows
 * already on the list are left alone, and nothing is ever removed.
 *
 * The whole thing is resolved against the current list BEFORE commit() runs, because the
 * label has to name how many items actually land and commit() needs that label up front.
 *
 * @returns the number of items that changed something.
 */
export function importTextItems(listId: string, entries: TextItem[]): number {
  const list = getList(listId)
  if (!list) return 0

  const plan = entries
    .map((entry) => {
      const existing = list.catalog.find((c) => sameName(c.name, entry.name))
      const alreadyOnList = existing != null && list.items.some((it) => it.cid === existing.id)
      return {
        name: entry.name,
        cid: existing?.id ?? null,
        addRow: entry.checked !== true && !alreadyOnList,
      }
    })
    // Everything reaches the catalog, so a name that is new is worth importing even when
    // it is ticked. A ticked name already in the catalog changes nothing at all.
    .filter((p) => p.cid === null || p.addRow)

  if (plan.length === 0) return 0

  const label = plan.length === 1 ? 'Imported 1 item' : `Imported ${plan.length} items`
  commit(label, () => {
    const l = getList(listId)
    if (!l) return
    for (const p of plan) {
      let cid = p.cid
      if (cid === null) {
        cid = newId()
        l.catalog.push({ id: cid, name: p.name })
      }
      if (p.addRow && !l.items.some((it) => it.cid === cid)) l.items.push({ cid, qty: 1 })
    }
  })
  return plan.length
}

/* --------------------------------------------------------------------- settings */
/*
 * Settings are persisted but deliberately NOT undoable: the handoff's undo vocabulary
 * covers list data only, and threading theme changes through the same stack would push
 * real edits out of a 50-entry history.
 */

function updateSettings(patch: Partial<Settings>): void {
  Object.assign(state.settings, patch)
  persist.schedule(state)
}

export function setTheme(theme: Theme): void {
  updateSettings({ theme })
}

export function setRowHeight(px: number): void {
  updateSettings({ rowHeight: Math.min(60, Math.max(32, Math.round(px))) })
}

export function setShowGrips(on: boolean): void {
  updateSettings({ showGrips: on })
}

export function setAskQty(on: boolean): void {
  updateSettings({ askQty: on })
}

/* ------------------------------------------------------------------------- init */

export type InitResult = { ok: true } | { ok: false; reason: 'too-new'; found: number }

/**
 * Load persisted data into the store.
 *
 * On encountering data from a newer build this refuses outright rather than migrating
 * downward or overwriting. That is the guard that makes rolling back across a schema
 * change safe: the older build renders an explanation and offers to update, and the
 * user's lists stay exactly as the newer build left them.
 */
export async function initialize(): Promise<InitResult> {
  let raw: unknown
  try {
    raw = await persist.load()
  } catch {
    raw = null
  }

  let doc: PersistedDoc
  try {
    doc = migrate(raw)
  } catch (err) {
    if (err instanceof DataTooNewError) return { ok: false, reason: 'too-new', found: err.found }
    doc = emptyDoc()
  }

  const storedVersion =
    raw && typeof raw === 'object' ? (raw as { schemaVersion?: number }).schemaVersion : undefined
  if (raw != null && typeof storedVersion === 'number' && storedVersion < MAX_SCHEMA) {
    // Keep the pre-migration shape so a rollback has something it can read.
    try {
      await persist.writeBackup(raw)
    } catch {
      /* best effort; never block startup on it */
    }
  }

  state.schemaVersion = doc.schemaVersion
  state.settings = doc.settings
  state.lists.splice(0, state.lists.length, ...doc.lists)
  undoStack.length = 0
  redoStack.length = 0

  persist.installFlushHandlers()
  return { ok: true }
}

/** Test seam: reset to a known empty state without touching IndexedDB. */
export function resetForTests(doc: PersistedDoc = emptyDoc()): void {
  state.schemaVersion = doc.schemaVersion
  state.settings = { ...DEFAULT_SETTINGS, ...doc.settings }
  state.lists.splice(0, state.lists.length, ...doc.lists)
  undoStack.length = 0
  redoStack.length = 0
  toastHandler = () => {}
}

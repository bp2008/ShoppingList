import { createStore, get, set, type UseStore } from 'idb-keyval'
import type { PersistedDoc } from './types'

/**
 * Persistence.
 *
 * The database name, store name and key are a CONTRACT shared with src/shell/rescue.js
 * and src/shell/reset.html, which read this document with raw IndexedDB so that a user
 * can export their lists even when the app bundle is too broken to run. Changing any of
 * these three strings without changing them there breaks the single most important
 * safety property in the project.
 */
const DB_NAME = 'slp-data'
const STORE_NAME = 'kv'
const DOC_KEY = 'doc'
const BACKUP_KEY = 'backup:preMigration'

/**
 * Cloud connection state, deliberately OUTSIDE the document.
 *
 * It is not user data: it holds a device-local credential, it must never end up inside an
 * export, and putting it in `doc` would change the shape the rescue path reads and force a
 * schema migration for something no list depends on. A separate key costs nothing and
 * keeps the contract above untouched.
 */
const CLOUD_KEY = 'cloud'

/**
 * Opened on first use, not at import.
 *
 * `createStore` calls `indexedDB.open` immediately, so binding it at module scope would
 * mean merely importing anything that reaches this file opens a database -- including in
 * unit tests, where there is no IndexedDB at all and the import would simply throw.
 */
let store: UseStore | null = null
function db(): UseStore {
  if (!store) store = createStore(DB_NAME, STORE_NAME)
  return store
}

/** Long enough to coalesce a burst of drags, short enough to survive a hard kill. */
const DEBOUNCE_MS = 250

let timer: ReturnType<typeof setTimeout> | null = null
let queued: PersistedDoc | null = null
let inFlight: Promise<void> | null = null

/**
 * Strip Vue's reactive proxies.
 *
 * IndexedDB serialises with the structured clone algorithm, which throws on a Proxy.
 * A JSON round-trip is both the simplest way to get a plain object and a guarantee that
 * whatever we store is representable in the export format.
 */
function plain(doc: PersistedDoc): PersistedDoc {
  return JSON.parse(JSON.stringify(doc)) as PersistedDoc
}

export async function load(): Promise<unknown> {
  return get(DOC_KEY, db())
}

async function write(doc: PersistedDoc): Promise<void> {
  await set(DOC_KEY, plain(doc), db())
}

/** Debounced save. Safe to call on every mutation. */
export function schedule(doc: PersistedDoc): void {
  queued = doc
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    void flush()
  }, DEBOUNCE_MS)
}

/** Write immediately. Coalesces with any write already running. */
export function flush(): Promise<void> {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  const doc = queued
  queued = null
  if (!doc) return inFlight ?? Promise.resolve()

  const run = (inFlight ?? Promise.resolve())
    .catch(() => {})
    .then(() => write(doc))
    .finally(() => {
      if (inFlight === run) inFlight = null
    })
  inFlight = run
  return run
}

/**
 * Keep the last document written before a schema migration.
 *
 * This is the safety net for rolling back across a schema change: the older build cannot
 * read the migrated document, but this copy is still in the shape it understood.
 */
export async function writeBackup(raw: unknown): Promise<void> {
  await set(BACKUP_KEY, raw, db())
}

export async function readBackup(): Promise<unknown> {
  return get(BACKUP_KEY, db())
}

/* ------------------------------------------------------------------------- cloud */
/*
 * Written rarely -- on connect, on disconnect, and once per successful backup -- so these
 * bypass the debounce entirely and just write.
 */

export async function loadCloud(): Promise<unknown> {
  return get(CLOUD_KEY, db())
}

export async function saveCloud(value: unknown): Promise<void> {
  await set(CLOUD_KEY, value, db())
}

/**
 * Flush on the two events that actually precede a phone killing the tab.
 *
 * `visibilitychange` is the reliable one on mobile -- `beforeunload` frequently never
 * fires there. Neither handler can await, so this is best effort by nature: the point is
 * to have the transaction already open when the page is frozen.
 */
export function installFlushHandlers(): void {
  const onHide = () => {
    if (document.visibilityState === 'hidden') void flush()
  }
  document.addEventListener('visibilitychange', onHide)
  window.addEventListener('pagehide', () => void flush())
}


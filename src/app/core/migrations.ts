import {
  DEFAULT_SETTINGS,
  clampQty,
  sameName,
  type List,
  type PersistedDoc,
  type Settings,
  type Theme,
} from './types'
import { newId } from './ids'

/**
 * Highest schema this build understands.
 *
 * Bump ONLY together with a migration step in `migrate()`. The reason this constant
 * exists separately from the stored value is rollback: a device that rolled back to an
 * older build must not let that build reinterpret newer data. See `isTooNew`.
 */
export const MAX_SCHEMA = 1

/**
 * Raised when stored data was written by a build newer than this one.
 *
 * The correct response is to refuse to touch the data and offer to update -- never to
 * migrate downward, and never to overwrite. Rolling back across a schema change is the
 * one remaining way this design could lose a user's lists, so it is a hard stop.
 */
export class DataTooNewError extends Error {
  readonly found: number
  constructor(found: number) {
    super(`Data schema ${found} is newer than this version understands (${MAX_SCHEMA}).`)
    this.name = 'DataTooNewError'
    this.found = found
  }
}

function asString(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.trim() !== '' ? v : fallback
}

function asNumber(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function asBoolean(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}

/**
 * Coerce arbitrary parsed JSON into lists that satisfy every model invariant.
 *
 * Used for both stored data and the Import dialog, deliberately: pasted JSON gets exactly
 * the same scrutiny as data we wrote ourselves, because the handoff's original import was
 * a wholesale replace with no validation at all, and a dangling `cid` renders as a row
 * with no name.
 *
 * Repairs rather than rejects wherever it reasonably can -- a user pasting a slightly
 * malformed backup wants their lists back, not a parse error.
 */
export function coerceLists(raw: unknown): List[] {
  const source = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { lists?: unknown }).lists)
      ? ((raw as { lists: unknown[] }).lists as unknown[])
      : []

  const out: List[] = []
  const seenListIds = new Set<string>()

  for (const entry of source) {
    if (!entry || typeof entry !== 'object') continue
    const l = entry as Record<string, unknown>

    let id = asString(l.id, '')
    if (id === '' || seenListIds.has(id)) id = newId()
    seenListIds.add(id)

    // Catalog first: names unique per list, case-insensitively.
    const catalog: List['catalog'] = []
    const seenItemIds = new Set<string>()
    if (Array.isArray(l.catalog)) {
      for (const c of l.catalog) {
        if (!c || typeof c !== 'object') continue
        const rec = c as Record<string, unknown>
        const name = asString(rec.name, '').trim()
        if (name === '') continue
        if (catalog.some((existing) => sameName(existing.name, name))) continue
        let cid = asString(rec.id, '')
        if (cid === '' || seenItemIds.has(cid)) cid = newId()
        seenItemIds.add(cid)
        catalog.push({ id: cid, name })
      }
    }

    // Then items, dropping any whose cid does not resolve in THIS list's catalog.
    const items: List['items'] = []
    const seenCids = new Set<string>()
    if (Array.isArray(l.items)) {
      for (const it of l.items) {
        if (!it || typeof it !== 'object') continue
        const rec = it as Record<string, unknown>
        const cid = asString(rec.cid, '')
        if (!cid || seenCids.has(cid)) continue
        if (!catalog.some((c) => c.id === cid)) continue
        seenCids.add(cid)
        items.push({ cid, qty: clampQty(asNumber(rec.qty, 1)) })
      }
    }

    out.push({
      id,
      name: asString(l.name, 'Untitled'),
      modified: asNumber(l.modified, Date.now()),
      catalog,
      items,
      showOthers: asBoolean(l.showOthers, false),
    })
  }

  return out
}

export function coerceSettings(raw: unknown): Settings {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const theme = s.theme
  return {
    theme: theme === 'light' || theme === 'oled' || theme === 'system' ? (theme as Theme) : DEFAULT_SETTINGS.theme,
    // The Settings slider is min 32, max 60, step 2.
    rowHeight: Math.min(60, Math.max(32, Math.round(asNumber(s.rowHeight, DEFAULT_SETTINGS.rowHeight)))),
    showGrips: asBoolean(s.showGrips, DEFAULT_SETTINGS.showGrips),
    askQty: asBoolean(s.askQty, DEFAULT_SETTINGS.askQty),
  }
}

export function emptyDoc(): PersistedDoc {
  return { schemaVersion: MAX_SCHEMA, lists: [], settings: { ...DEFAULT_SETTINGS } }
}

/**
 * Bring a stored document up to the current schema.
 *
 * @throws DataTooNewError when the stored schema is ahead of this build.
 */
export function migrate(raw: unknown): PersistedDoc {
  if (raw == null) return emptyDoc()

  const doc = (typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const found = asNumber(doc.schemaVersion, 1)

  if (found > MAX_SCHEMA) throw new DataTooNewError(found)

  // No migration steps yet. When the first one lands, it goes here as an explicit
  // `if (version < N) { ...; version = N }` chain so each step stays independently
  // readable, and store.ts snapshots the pre-migration document first.

  return {
    schemaVersion: MAX_SCHEMA,
    lists: coerceLists(doc.lists),
    settings: coerceSettings(doc.settings),
  }
}

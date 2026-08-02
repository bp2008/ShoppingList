import { MAX_SCHEMA, coerceLists } from './migrations'
import type { List } from './types'

/**
 * Import / export, as pure functions over text.
 *
 * Nothing here touches the store, the clipboard or the filesystem -- the dialogs own those
 * -- so every rule about what an export contains and what a paste means is testable
 * without a DOM. The store side of an import (create / merge / overwrite) lives in
 * store.ts, because it has to go through commit().
 */

/** Stamped into every export so a file can be recognised before it is parsed. */
export const TRANSFER_FORMAT = 'shopping-list-export'

export interface TransferPayload {
  format: string
  schemaVersion: number
  exportedAt: string
  lists: List[]
}

/* ---------------------------------------------------------------------- exports */

/**
 * The JSON that goes on the clipboard or into a file.
 *
 * Pretty-printed because the user can see it in a file and paste it back by hand.
 * `schemaVersion` is what lets a future build know how to read it; `format` is only a
 * hint, and import never requires it -- a plain `{ lists: [...] }` or even a bare array
 * still imports, so an export from an older build, or a hand-edited file, is not refused.
 */
export function buildExport(lists: List[], now: Date = new Date()): string {
  const payload: TransferPayload = {
    format: TRANSFER_FORMAT,
    schemaVersion: MAX_SCHEMA,
    exportedAt: now.toISOString(),
    lists,
  }
  return JSON.stringify(payload, null, 1)
}

/** `shopping-list-2026-08-02.json`. Local date, because that is the date the user sees. */
export function exportFileName(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  return `shopping-list-${stamp}.json`
}

/* ---------------------------------------------------------------------- imports */

export type ParseResult = { ok: true; lists: List[] } | { ok: false; reason: string }

/**
 * Turn pasted or loaded text into lists that satisfy every model invariant.
 *
 * Coercion is `coerceLists`, the same one stored data goes through -- pasted JSON gets no
 * more trust than a file we wrote ourselves. The failure `reason` is user-facing copy.
 *
 * Data from a NEWER schema is refused rather than coerced, for the same reason startup
 * refuses it: silently dropping fields this build does not understand would turn a backup
 * into a lossy one, and the user would have no way to tell.
 */
export function parseTransfer(text: string): ParseResult {
  if (text.trim() === '') return { ok: false, reason: 'Nothing to import' }

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'That is not valid JSON' }
  }

  const version =
    raw && typeof raw === 'object' ? (raw as { schemaVersion?: unknown }).schemaVersion : undefined
  if (typeof version === 'number' && version > MAX_SCHEMA) {
    return { ok: false, reason: 'That export came from a newer version of the app' }
  }

  const lists = coerceLists(raw)
  if (lists.length === 0) return { ok: false, reason: 'No lists found in that data' }
  return { ok: true, lists }
}

/* ------------------------------------------------------------------ plain text */

export interface TextItem {
  name: string
  /** true = ticked, false = unticked, null = the text carried no checkbox at all. */
  checked: boolean | null
}

/** `- `, `* `, `• ` — including the form this app's own "Copy list as text" produces. */
const BULLET = /^[-*•]\s+/
/** `[ ]`, `[]`, `☐`, `▢` */
const UNCHECKED = /^(?:\[\s*\]|[☐▢])\s*/
/** `[x]`, `[X]`, `[✓]`, `☑`, `☒`, `✔` */
const CHECKED = /^(?:\[\s*[xX✓✔]\s*\]|[☑☒✔])\s*/

/**
 * Parse a pasted checklist into items.
 *
 * Built for a Google Keep checklist export, which looks like:
 *
 *     [ ] 2032 batteries
 *     [X] Sponge Duster
 *
 * A ticked box means "already got it", so those items are catalog-only; see
 * store.importTextItems. A line with NO box is `checked: null` rather than false, because
 * "unknown" and "explicitly unticked" are different facts even though both land on the
 * list -- a plain list of names with no markup at all is a shopping list.
 *
 * Blank lines are dropped, padding is stripped from both ends, and repeats within the
 * pasted text are collapsed case-insensitively so one paste cannot ask for the same item
 * twice.
 */
export function parseTextItems(text: string): TextItem[] {
  const out: TextItem[] = []
  const seen = new Set<string>()

  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim().replace(BULLET, '').trimStart()

    let checked: boolean | null = null
    if (CHECKED.test(line)) {
      checked = true
      line = line.replace(CHECKED, '')
    } else if (UNCHECKED.test(line)) {
      checked = false
      line = line.replace(UNCHECKED, '')
    }

    const name = line.trim()
    if (name === '') continue

    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)

    out.push({ name, checked })
  }

  return out
}

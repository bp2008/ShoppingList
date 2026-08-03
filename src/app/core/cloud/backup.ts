/**
 * When to back up, what to call it, and what to delete. Policy only.
 *
 * Nothing here performs a network call or touches the store, so every rule about cadence
 * and retention is testable as a pure function -- which matters more than usual, because
 * the alternative way to find out that pruning is wrong is a user losing snapshots.
 */

/**
 * Snapshots kept in the app folder. Older ones are deleted after a successful upload.
 *
 * A few KB each, so the ceiling is about how much history is worth having rather than
 * about space: at the six-hour floor below, 60 files is a fortnight of edits, and a list
 * touched once a week is covered for over a year. It is a ceiling, not a target — nothing
 * uploads to fill it.
 */
export const KEEP = 60

/**
 * Floor on how often an unattended backup runs.
 *
 * Not a bandwidth concern -- the payload is a few KB -- but a version-history one. A
 * snapshot per edit would push a week of real history out of a 10-file window in one
 * shopping trip.
 */
export const MIN_INTERVAL_MS = 6 * 60 * 60 * 1000

/**
 * `backup-2026-08-02-143159-123.json` — date, then `HHmmss`, then milliseconds.
 *
 * Zero-padded and biggest-unit-first, so a plain lexicographic sort of the file names IS
 * chronological order. `prunable` depends on that; do not reorder the fields.
 *
 * THE SECONDS AND MILLISECONDS ARE THERE TO MAKE THE NAME UNIQUE, not to be read. Uploads
 * use `mode: 'add'` with `autorename: false`, so a name that already exists comes back as
 * an HTTP 409 and the backup fails; at minute resolution that happened for real, because
 * two devices on one account, a "Back up now" after a quick edit, and a retry after the
 * upload succeeded but the local record of it did not, all land inside the same minute.
 *
 * Local time, not UTC, because it is the user's own folder and 14:31 should be the time
 * they were holding the phone.
 */
export function backupFileName(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  return `backup-${date}-${time}-${String(now.getMilliseconds()).padStart(3, '0')}.json`
}

/**
 * What `backupFileName` produces, and nothing else. See `prunable`.
 *
 * The trailing group is optional so that names written before the seconds were added
 * (`backup-2026-08-02-1431.json`) are still recognised as ours. Without that they would be
 * neither counted nor pruned, and a folder full of them would never shrink again. They
 * still sort into the right place: a minute-only name is identical up to the minute and
 * `.` sorts below any digit, so it lands with the second-resolution names from that minute.
 */
const OURS = /^backup-\d{4}-\d{2}-\d{2}-\d{4}(\d{2}-\d{3})?\.json$/

export interface DueInput {
  /** Hash of the CURRENT lists. */
  hash: string
  /** Hash at the last successful upload, or null if there has never been one. */
  lastHash: string | null
  /** Epoch ms of the last successful upload, or null. */
  lastAt: number | null
  now: number
  minIntervalMs?: number
}

/**
 * Three rules, in order: back up if we never have; skip if nothing changed; otherwise
 * wait out the interval.
 *
 * The unchanged check comes before the clock so that an app opened daily and never edited
 * does not upload an identical file every six hours.
 */
export function isDue({
  hash,
  lastHash,
  lastAt,
  now,
  minIntervalMs = MIN_INTERVAL_MS,
}: DueInput): boolean {
  if (lastHash === null || lastAt === null) return true
  if (hash === lastHash) return false
  return now - lastAt >= minIntervalMs
}

/**
 * The names to delete, oldest first, leaving the newest `keep`.
 *
 * ONLY files matching our own naming pattern are candidates. The app folder is visible to
 * the user in their Dropbox and they may well drop something in it; deleting a file this
 * app did not write would be indefensible, and an over-broad filter here is the one bug in
 * this feature that destroys data instead of merely failing to save it.
 */
export function prunable(names: string[], keep: number = KEEP): string[] {
  const ours = names.filter((name) => OURS.test(name)).sort()
  return ours.slice(0, Math.max(0, ours.length - keep))
}

/**
 * Content hash used to decide whether anything actually changed.
 *
 * MUST be given `JSON.stringify(lists)`, never the output of `buildExport` -- that stamps
 * `exportedAt`, so its hash differs on every call and the change check would never once
 * report "unchanged".
 */
export async function hashLists(listsJson: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(listsJson))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

import { describe, expect, it } from 'vitest'
import { KEEP, MIN_INTERVAL_MS, backupFileName, hashLists, isDue, prunable } from './backup'

const HOUR = 60 * 60 * 1000

function names(count: number, from = 1): string[] {
  return Array.from({ length: count }, (_, i) => `backup-2026-08-${String(from + i).padStart(2, '0')}-1200.json`)
}

describe('backupFileName', () => {
  it('zero-pads every field, in local time', () => {
    expect(backupFileName(new Date(2026, 7, 2, 9, 5))).toBe('backup-2026-08-02-0905.json')
  })

  /*
   * `prunable` sorts lexicographically and calls the result chronological. That is only
   * true while the fields stay biggest-first and padded, so it is pinned here rather than
   * left as a comment.
   */
  it('sorts lexicographically in chronological order', () => {
    const early = backupFileName(new Date(2026, 7, 2, 9, 5))
    const later = backupFileName(new Date(2026, 7, 2, 10, 0))
    const nextYear = backupFileName(new Date(2027, 0, 1, 0, 0))
    expect([nextYear, later, early].sort()).toEqual([early, later, nextYear])
  })
})

describe('isDue', () => {
  const base = { hash: 'aaa', lastHash: 'bbb', lastAt: 0, now: 10 * HOUR }

  it('backs up when there has never been one', () => {
    expect(isDue({ ...base, lastHash: null, lastAt: null })).toBe(true)
  })

  it('skips when nothing changed, however long it has been', () => {
    expect(isDue({ ...base, lastHash: 'aaa', now: 1000 * HOUR })).toBe(false)
  })

  it('waits out the interval when something changed', () => {
    expect(isDue({ ...base, now: MIN_INTERVAL_MS - 1 })).toBe(false)
    expect(isDue({ ...base, now: MIN_INTERVAL_MS })).toBe(true)
  })

  it('checks the content before the clock', () => {
    // Unchanged and long overdue: an app opened daily and never edited must not upload an
    // identical file every six hours.
    expect(isDue({ hash: 'x', lastHash: 'x', lastAt: 0, now: 99 * HOUR })).toBe(false)
  })
})

describe('prunable', () => {
  it('keeps the newest KEEP and returns the rest oldest-first', () => {
    const all = names(KEEP + 3)
    const doomed = prunable(all)
    expect(doomed).toEqual(all.slice(0, 3))
  })

  it('returns nothing while at or under the limit', () => {
    expect(prunable(names(KEEP))).toEqual([])
    expect(prunable(names(3))).toEqual([])
  })

  /*
   * The app folder is visible to the user in their own Dropbox and they may well put
   * something in it. Deleting a file this app did not write is the one bug in this feature
   * that destroys data rather than merely failing to save it.
   */
  it('never touches a file it did not write', () => {
    const foreign = ['notes.txt', 'backup.json', 'backup-2026-08-02.json', 'Backup-2026-08-02-1200.json']
    const doomed = prunable([...foreign, ...names(KEEP + 2)])
    for (const name of foreign) expect(doomed).not.toContain(name)
    expect(doomed).toHaveLength(2)
  })

  it('counts only its own files towards the limit', () => {
    // Twenty foreign files must not push our three over the retention edge.
    const foreign = Array.from({ length: 20 }, (_, i) => `other-${i}.json`)
    expect(prunable([...foreign, ...names(3)])).toEqual([])
  })
})

describe('hashLists', () => {
  it('is stable for identical input and different for changed input', async () => {
    const a = JSON.stringify([{ id: 'l1', name: 'Groceries' }])
    const b = JSON.stringify([{ id: 'l1', name: 'Hardware' }])
    expect(await hashLists(a)).toBe(await hashLists(a))
    expect(await hashLists(a)).not.toBe(await hashLists(b))
  })

  it('is hex of a fixed width, so it can be compared as a plain string', async () => {
    expect(await hashLists('[]')).toMatch(/^[0-9a-f]{64}$/)
  })
})

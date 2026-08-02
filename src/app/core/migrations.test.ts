import { describe, expect, it } from 'vitest'
import { DataTooNewError, MAX_SCHEMA, coerceLists, coerceSettings, migrate } from './migrations'

describe('coerceLists', () => {
  it('drops items whose cid does not resolve in the same list', () => {
    const [list] = coerceLists([
      {
        id: 'l1',
        name: 'X',
        catalog: [{ id: 'c1', name: 'Milk' }],
        items: [{ cid: 'c1', qty: 1 }, { cid: 'ghost', qty: 2 }],
        showOthers: false,
      },
    ])
    expect(list!.items).toHaveLength(1)
    expect(list!.items[0]!.cid).toBe('c1')
  })

  it('does not let one list reference another list catalog', () => {
    const lists = coerceLists([
      { id: 'a', name: 'A', catalog: [{ id: 'shared', name: 'Milk' }], items: [], showOthers: false },
      { id: 'b', name: 'B', catalog: [], items: [{ cid: 'shared', qty: 1 }], showOthers: false },
    ])
    expect(lists[1]!.items).toHaveLength(0)
  })

  it('dedupes catalog names case-insensitively, keeping the first', () => {
    const [list] = coerceLists([
      {
        id: 'l1',
        name: 'X',
        catalog: [
          { id: 'c1', name: 'Milk' },
          { id: 'c2', name: 'MILK' },
          { id: 'c3', name: '  milk ' },
        ],
        items: [],
        showOthers: false,
      },
    ])
    expect(list!.catalog).toHaveLength(1)
    expect(list!.catalog[0]!.name).toBe('Milk')
  })

  it('repairs duplicate and missing ids instead of rejecting the list', () => {
    const lists = coerceLists([
      { id: 'dup', name: 'A', catalog: [], items: [], showOthers: false },
      { id: 'dup', name: 'B', catalog: [], items: [], showOthers: false },
      { name: 'C', catalog: [], items: [], showOthers: false },
    ])
    const ids = lists.map((l) => l.id)
    expect(new Set(ids).size).toBe(3)
    expect(lists.map((l) => l.name)).toEqual(['A', 'B', 'C'])
  })

  it('clamps imported quantities', () => {
    const [list] = coerceLists([
      {
        id: 'l1',
        name: 'X',
        catalog: [{ id: 'c1', name: 'Milk' }],
        items: [{ cid: 'c1', qty: 1e9 }],
        showOthers: false,
      },
    ])
    expect(list!.items[0]!.qty).toBe(99)
  })

  it('accepts both a bare array and a wrapped { lists } document', () => {
    const bare = coerceLists([{ id: 'a', name: 'A', catalog: [], items: [], showOthers: false }])
    const wrapped = coerceLists({ lists: [{ id: 'a', name: 'A', catalog: [], items: [], showOthers: false }] })
    expect(bare).toHaveLength(1)
    expect(wrapped).toHaveLength(1)
  })

  it('survives arbitrary junk', () => {
    expect(coerceLists(null)).toEqual([])
    expect(coerceLists('nonsense')).toEqual([])
    expect(coerceLists([null, 42, 'x', {}])).toHaveLength(1) // only the object becomes a list
  })
})

describe('coerceSettings', () => {
  it('constrains row height to the slider range', () => {
    expect(coerceSettings({ rowHeight: 200 }).rowHeight).toBe(60)
    expect(coerceSettings({ rowHeight: 2 }).rowHeight).toBe(32)
  })

  it('falls back on an unknown theme', () => {
    expect(coerceSettings({ theme: 'neon' }).theme).toBe('system')
    expect(coerceSettings({ theme: 'oled' }).theme).toBe('oled')
  })
})

describe('migrate', () => {
  it('returns an empty document for missing data', () => {
    const doc = migrate(null)
    expect(doc.schemaVersion).toBe(MAX_SCHEMA)
    expect(doc.lists).toEqual([])
  })

  it('refuses data written by a newer build', () => {
    // The rollback guard: an older build must never reinterpret or overwrite newer data.
    expect(() => migrate({ schemaVersion: MAX_SCHEMA + 1, lists: [] })).toThrow(DataTooNewError)
    try {
      migrate({ schemaVersion: 99, lists: [] })
    } catch (err) {
      expect((err as DataTooNewError).found).toBe(99)
    }
  })
})

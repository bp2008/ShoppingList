import { describe, expect, it } from 'vitest'
import { filterLists, foreignCatalog, listPreview, listsByRecency, sortedCatalog } from './selectors'
import type { List } from './types'

function list(partial: Partial<List> & { id: string; name: string }): List {
  return {
    modified: 0,
    catalog: [],
    items: [],
    showOthers: false,
    ...partial,
  }
}

describe('foreignCatalog', () => {
  const groceries = list({
    id: 'a',
    name: 'Groceries',
    catalog: [
      { id: 'a1', name: 'Milk' },
      { id: 'a2', name: 'Eggs' },
    ],
  })
  const pantry = list({
    id: 'b',
    name: 'Pantry',
    catalog: [
      { id: 'b1', name: 'Olive oil' },
      { id: 'b2', name: 'milk' },
    ],
  })
  const party = list({
    id: 'c',
    name: 'Party',
    catalog: [
      { id: 'c1', name: 'Olive oil' },
      { id: 'c2', name: 'Ice' },
    ],
  })

  it('excludes names already in this list, case-insensitively', () => {
    const names = foreignCatalog(groceries, [groceries, pantry, party]).map((e) => e.name)
    expect(names).not.toContain('milk')
    expect(names).toContain('Olive oil')
  })

  it('dedupes across source lists and attributes the first contributor', () => {
    const entries = foreignCatalog(groceries, [groceries, pantry, party])
    const oil = entries.filter((e) => e.name === 'Olive oil')
    expect(oil).toHaveLength(1)
    expect(oil[0]!.source).toBe('Pantry')
  })

  it('sorts alphabetically', () => {
    const names = foreignCatalog(groceries, [groceries, pantry, party]).map((e) => e.name)
    expect(names).toEqual(['Ice', 'Olive oil'])
  })

  it('never includes the list own entries', () => {
    expect(foreignCatalog(groceries, [groceries])).toEqual([])
  })
})

describe('sortedCatalog', () => {
  it('sorts without mutating the stored order', () => {
    const l = list({
      id: 'a',
      name: 'A',
      catalog: [
        { id: '1', name: 'Zucchini' },
        { id: '2', name: 'Apples' },
      ],
    })
    expect(sortedCatalog(l).map((c) => c.name)).toEqual(['Apples', 'Zucchini'])
    // The right column's order is derived; the stored array must be untouched.
    expect(l.catalog.map((c) => c.name)).toEqual(['Zucchini', 'Apples'])
  })
})

describe('filterLists', () => {
  const lists = [
    list({ id: 'a', name: 'Groceries', catalog: [{ id: '1', name: 'Olive oil' }] }),
    list({ id: 'b', name: 'Hardware', catalog: [{ id: '2', name: 'Screws' }] }),
  ]

  it('matches on list name', () => {
    expect(filterLists(lists, 'hard').map((l) => l.id)).toEqual(['b'])
  })

  it('also matches on any catalog item name', () => {
    expect(filterLists(lists, 'olive').map((l) => l.id)).toEqual(['a'])
  })

  it('returns everything for an empty query', () => {
    expect(filterLists(lists, '   ')).toHaveLength(2)
  })
})

describe('tiles', () => {
  it('previews at most six rows in list order', () => {
    const l = list({
      id: 'a',
      name: 'A',
      catalog: Array.from({ length: 8 }, (_, i) => ({ id: `c${i}`, name: `Item ${i}` })),
      items: Array.from({ length: 8 }, (_, i) => ({ cid: `c${i}`, qty: 1 })),
    })
    const preview = listPreview(l)
    expect(preview).toHaveLength(6)
    expect(preview[0]!.name).toBe('Item 0')
  })

  it('orders tiles most recently modified first', () => {
    const ordered = listsByRecency([
      list({ id: 'old', name: 'Old', modified: 1 }),
      list({ id: 'new', name: 'New', modified: 99 }),
    ])
    expect(ordered.map((l) => l.id)).toEqual(['new', 'old'])
  })
})

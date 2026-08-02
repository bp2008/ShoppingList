import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as store from './store'
import { UNDO_LIMIT, type List } from './types'

// Persistence is a side effect of every mutation and is not what these tests are about.
vi.mock('./persist', () => ({
  load: async () => null,
  schedule: () => {},
  flush: async () => {},
  writeBackup: async () => {},
  readBackup: async () => null,
  installFlushHandlers: () => {},
}))

beforeEach(() => {
  store.resetForTests()
})

function seedList(name = 'Groceries'): string {
  const id = store.createList(name)
  if (!id) throw new Error('createList failed')
  return id
}

/** A list as core/transfer would hand it over: already coerced, ids of its own. */
function incoming(name: string, catalog: string[] = [], onList: string[] = []): List {
  const entries = catalog.map((n, i) => ({ id: `${name}-c${i}`, name: n }))
  return {
    id: `in-${name}`,
    name,
    modified: 1_700_000_000_000,
    catalog: entries,
    items: entries.filter((c) => onList.includes(c.name)).map((c) => ({ cid: c.id, qty: 1 })),
    showOthers: false,
  }
}

describe('model invariants', () => {
  it('cascades catalog deletion to list rows in one action', () => {
    const id = seedList()
    store.addCatalogItem(id, 'Milk', true)
    store.addCatalogItem(id, 'Eggs', true)
    const list = store.getList(id)!
    expect(list.items).toHaveLength(2)

    const milk = list.catalog.find((c) => c.name === 'Milk')!
    store.deleteCatalogItems(id, [milk.id])

    // The row must go with the catalog entry, or it renders as a nameless row.
    expect(store.getList(id)!.catalog.map((c) => c.name)).toEqual(['Eggs'])
    expect(store.getList(id)!.items).toHaveLength(1)
    expect(store.getList(id)!.items[0]!.cid).not.toBe(milk.id)
  })

  it('undoes a cascading delete as a single step', () => {
    const id = seedList()
    store.addCatalogItem(id, 'Milk', true)
    const milk = store.getList(id)!.catalog[0]!
    store.deleteCatalogItems(id, [milk.id])

    store.undo()

    expect(store.getList(id)!.catalog).toHaveLength(1)
    expect(store.getList(id)!.items).toHaveLength(1)
  })

  it('rejects catalog names that differ only by case or padding', () => {
    const id = seedList()
    expect(store.addCatalogItem(id, 'Milk', false)).toBe(true)
    expect(store.addCatalogItem(id, 'milk', false)).toBe(false)
    expect(store.addCatalogItem(id, '  MILK  ', false)).toBe(false)
    expect(store.getList(id)!.catalog).toHaveLength(1)
  })

  it('never lets the same catalog item appear twice on one list', () => {
    const id = seedList()
    store.addCatalogItem(id, 'Milk', true)
    const cid = store.getList(id)!.catalog[0]!.id
    expect(store.addToList(id, cid, 0)).toBe(false)
    expect(store.getList(id)!.items).toHaveLength(1)
  })

  it('clamps quantity to 1..99', () => {
    const id = seedList()
    store.addCatalogItem(id, 'Milk', true)
    const cid = store.getList(id)!.catalog[0]!.id

    store.setQty(id, cid, 500)
    expect(store.getList(id)!.items[0]!.qty).toBe(99)
    store.setQty(id, cid, 0)
    expect(store.getList(id)!.items[0]!.qty).toBe(1)
    store.setQty(id, cid, -7)
    expect(store.getList(id)!.items[0]!.qty).toBe(1)
  })

  it('adopts a foreign item under a new id rather than sharing one', () => {
    const a = seedList('A')
    store.addCatalogItem(a, 'Olive oil', false)
    const foreignCid = store.getList(a)!.catalog[0]!.id

    const b = seedList('B')
    store.adoptForeignItem(b, 'Olive oil', 0)

    const copied = store.getList(b)!.catalog[0]!
    expect(copied.name).toBe('Olive oil')
    expect(copied.id).not.toBe(foreignCid)
    // And it resolves within its OWN list.
    expect(store.getList(b)!.items[0]!.cid).toBe(copied.id)
  })

  it('adopting a name already in the catalog adds a row without duplicating it', () => {
    const id = seedList()
    store.addCatalogItem(id, 'Olive oil', false)
    store.adoptForeignItem(id, 'olive oil', 0)
    expect(store.getList(id)!.catalog).toHaveLength(1)
    expect(store.getList(id)!.items).toHaveLength(1)
  })
})

describe('move semantics', () => {
  it('reorders using an insertion index measured against the pre-move array', () => {
    const id = seedList()
    for (const n of ['A', 'B', 'C']) store.addCatalogItem(id, n, true)
    const names = () => store.getList(id)!.items.map((it) => store.catalogName(store.getList(id)!, it.cid))
    expect(names()).toEqual(['A', 'B', 'C'])

    // Drop A below C: insertion index 3 in the original array.
    store.moveItem(id, 0, 3)
    expect(names()).toEqual(['B', 'C', 'A'])

    // Drop it back to the top.
    store.moveItem(id, 2, 0)
    expect(names()).toEqual(['A', 'B', 'C'])
  })

  it('treats a move onto its own position as a no-op', () => {
    const id = seedList()
    for (const n of ['A', 'B']) store.addCatalogItem(id, n, true)
    const depth = store.undoStack.length
    expect(store.moveItem(id, 0, 0)).toBe(false)
    expect(store.undoStack.length).toBe(depth)
  })
})

describe('the commit funnel', () => {
  it('records nothing for a mutation that changed nothing', () => {
    const id = seedList()
    const depth = store.undoStack.length
    const before = store.getList(id)!.modified

    expect(store.commit('No-op', () => {})).toBe(false)

    expect(store.undoStack.length).toBe(depth)
    expect(store.getList(id)!.modified).toBe(before)
  })

  it('stamps modified only on the lists that actually changed', () => {
    const a = seedList('A')
    const b = seedList('B')
    const untouched = store.getList(a)!.modified
    vi.setSystemTime(new Date(Date.now() + 60_000))

    store.renameList(b, 'B2')

    expect(store.getList(a)!.modified).toBe(untouched)
    expect(store.getList(b)!.modified).toBeGreaterThan(untouched)
    vi.useRealTimers()
  })

  it('does not record sorting a column that is already sorted', () => {
    const id = seedList()
    for (const n of ['Anchovies', 'Olive oil']) store.addCatalogItem(id, n, true)
    const depth = store.undoStack.length

    expect(store.sortLeftAZ(id)).toBe(false)
    expect(store.undoStack.length).toBe(depth)
  })

  it('caps history at the documented limit', () => {
    const id = seedList()
    for (let i = 0; i < UNDO_LIMIT + 20; i++) store.addCatalogItem(id, `Item ${i}`, false)
    expect(store.undoStack.length).toBe(UNDO_LIMIT)
  })

  it('clears the redo stack when a new action is committed', () => {
    const id = seedList()
    store.addCatalogItem(id, 'Milk', false)
    store.undo()
    expect(store.redoStack.length).toBe(1)

    store.addCatalogItem(id, 'Eggs', false)
    expect(store.redoStack.length).toBe(0)
  })

  it('round-trips through undo and redo', () => {
    const id = seedList()
    store.addCatalogItem(id, 'Milk', true)
    const after = JSON.stringify(store.state.lists)

    store.undo()
    expect(store.getList(id)!.catalog).toHaveLength(0)
    store.redo()
    expect(JSON.stringify(store.state.lists)).toBe(after)
  })

  it('uses the handoff wording for every label', () => {
    const labels: string[] = []
    store.onToast((m) => labels.push(m))

    const id = store.createList('Party Saturday')!
    store.addCatalogItem(id, 'Olive oil', true)
    // A second, alphabetically-earlier item, so the sort below is not a no-op.
    store.addCatalogItem(id, 'Anchovies', true)
    const cid = store.getList(id)!.catalog[0]!.id
    store.setQty(id, cid, 3)
    store.sortLeftAZ(id)
    store.removeFromList(id, cid)
    store.renameList(id, 'Pantry')

    expect(labels).toEqual([
      'Created “Party Saturday”',
      'Added “Olive oil”',
      'Added “Anchovies”',
      'Set “Olive oil” to ×3',
      'Sorted left column A–Z',
      'Removed “Olive oil”',
      'Renamed to “Pantry”',
    ])

    store.undo()
    expect(labels.at(-1)).toBe('Undid: Renamed to “Pantry”')
    store.redo()
    expect(labels.at(-1)).toBe('Redid: Renamed to “Pantry”')
  })

  it('pluralises catalog deletion', () => {
    const id = seedList()
    for (const n of ['A', 'B', 'C']) store.addCatalogItem(id, n, false)
    const ids = store.getList(id)!.catalog.map((c) => c.id)

    const labels: string[] = []
    store.onToast((m) => labels.push(m))

    store.deleteCatalogItems(id, [ids[0]!])
    expect(labels.at(-1)).toBe('Deleted 1 catalog item')
    store.deleteCatalogItems(id, [ids[1]!, ids[2]!])
    expect(labels.at(-1)).toBe('Deleted 2 catalog items')
  })

  it('makes an import undoable, however many lists it brought in', () => {
    const id = seedList('Original')
    store.addCatalogItem(id, 'Milk', true)

    store.applyImport([
      { list: incoming('Imported A'), mode: 'create' },
      { list: incoming('Imported B'), mode: 'create' },
    ])
    expect(store.state.lists.map((l) => l.name)).toEqual(['Original', 'Imported A', 'Imported B'])

    store.undo()
    expect(store.state.lists.map((l) => l.name)).toEqual(['Original'])
    expect(store.getList(id)!.items).toHaveLength(1)
  })
})

describe('importing lists', () => {
  it('keeps an incoming id when it is free and mints one when it collides', () => {
    const id = seedList('Mine')

    store.applyImport([{ list: incoming('Fresh'), mode: 'create' }])
    expect(store.state.lists.at(-1)!.id).toBe('in-Fresh')

    // Same id as a list already here: two lists sharing one id would break every lookup.
    store.applyImport([{ list: { ...incoming('Clash'), id }, mode: 'create' }])
    expect(store.state.lists.at(-1)!.id).not.toBe(id)
    expect(store.state.lists.at(-1)!.name).toBe('Clash')
  })

  it('merges additively: nothing removed, no quantity touched', () => {
    const id = seedList('Groceries')
    store.addCatalogItem(id, 'Milk', true)
    store.addCatalogItem(id, 'Kept only in catalog', false)
    const milk = store.getList(id)!.catalog.find((c) => c.name === 'Milk')!
    store.setQty(id, milk.id, 5)

    // Milk is already here at ×5, and comes back at ×1. Eggs is new and on the list.
    store.applyImport([
      { list: incoming('Groceries', ['Milk', 'Eggs'], ['Milk', 'Eggs']), mode: 'merge', targetId: id },
    ])

    const after = store.getList(id)!
    expect(after.catalog.map((c) => c.name).sort()).toEqual([
      'Eggs',
      'Kept only in catalog',
      'Milk',
    ])
    expect(after.items.find((it) => it.cid === milk.id)!.qty).toBe(5)
    expect(after.items).toHaveLength(2)
    // Only one list: a merge must not also leave a copy behind.
    expect(store.state.lists).toHaveLength(1)
  })

  it('merges a name that differs only by case into the entry already here', () => {
    const id = seedList('Groceries')
    store.addCatalogItem(id, 'Milk', false)

    store.applyImport([{ list: incoming('Groceries', ['MILK']), mode: 'merge', targetId: id }])

    expect(store.getList(id)!.catalog.map((c) => c.name)).toEqual(['Milk'])
  })

  it('overwrites the contents but keeps the local list id', () => {
    const id = seedList('Groceries')
    store.addCatalogItem(id, 'Milk', true)

    store.applyImport([
      { list: incoming('Groceries', ['Eggs'], ['Eggs']), mode: 'overwrite', targetId: id },
    ])

    // The id survives because the list may be the screen behind the dialog.
    const after = store.getList(id)!
    expect(after.catalog.map((c) => c.name)).toEqual(['Eggs'])
    expect(after.items).toHaveLength(1)
    expect(store.state.lists).toHaveLength(1)
  })

  it('imports as a new list when the target has gone', () => {
    store.applyImport([{ list: incoming('Ghost'), mode: 'merge', targetId: 'no-such-list' }])
    expect(store.state.lists.map((l) => l.name)).toEqual(['Ghost'])
  })

  it('matches an existing list by name, case-insensitively', () => {
    seedList('Groceries')
    expect(store.findListByName('  groceries ')?.name).toBe('Groceries')
    expect(store.findListByName('Hardware')).toBeUndefined()
  })
})

describe('importing plain text', () => {
  it('puts unticked and unmarked items on the list, ticked ones only in the catalog', () => {
    const id = seedList('Groceries')

    store.importTextItems(id, [
      { name: '2032 batteries', checked: false },
      { name: 'Sponge Duster', checked: true },
      { name: 'Black laundry basket', checked: null },
    ])

    const list = store.getList(id)!
    expect(list.catalog.map((c) => c.name).sort()).toEqual([
      '2032 batteries',
      'Black laundry basket',
      'Sponge Duster',
    ])
    const onList = list.items.map((it) => store.catalogName(list, it.cid)).sort()
    expect(onList).toEqual(['2032 batteries', 'Black laundry basket'])
  })

  it('never duplicates a row, deletes one, or edits a quantity', () => {
    const id = seedList('Groceries')
    store.addCatalogItem(id, 'Milk', true)
    store.addCatalogItem(id, 'Bread', true)
    const milk = store.getList(id)!.catalog.find((c) => c.name === 'Milk')!
    store.setQty(id, milk.id, 4)

    store.importTextItems(id, [
      { name: 'milk', checked: false },
      { name: 'Eggs', checked: false },
    ])

    const list = store.getList(id)!
    expect(list.catalog).toHaveLength(3)
    expect(list.items).toHaveLength(3)
    expect(list.items.find((it) => it.cid === milk.id)!.qty).toBe(4)
    // Bread was not in the paste and must survive it.
    expect(list.catalog.some((c) => c.name === 'Bread')).toBe(true)
  })

  it('adds a ticked item that is new to the catalog, and nothing for one already there', () => {
    const id = seedList('Groceries')
    store.addCatalogItem(id, 'Milk', false)
    const depth = store.undoStack.length

    expect(store.importTextItems(id, [{ name: 'Milk', checked: true }])).toBe(0)
    expect(store.undoStack.length).toBe(depth)

    expect(store.importTextItems(id, [{ name: 'Sponge', checked: true }])).toBe(1)
    const list = store.getList(id)!
    expect(list.catalog.map((c) => c.name)).toEqual(['Milk', 'Sponge'])
    expect(list.items).toHaveLength(0)
  })

  it('lands as one undo step with a counted label', () => {
    const id = seedList('Groceries')
    const labels: string[] = []
    store.onToast((m) => labels.push(m))

    store.importTextItems(id, [
      { name: 'Milk', checked: false },
      { name: 'Eggs', checked: false },
    ])
    expect(labels.at(-1)).toBe('Imported 2 items')

    store.undo()
    expect(store.getList(id)!.catalog).toHaveLength(0)
  })
})

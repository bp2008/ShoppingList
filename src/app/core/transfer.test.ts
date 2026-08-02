import { describe, expect, it } from 'vitest'
import { MAX_SCHEMA } from './migrations'
import { TRANSFER_FORMAT, buildExport, exportFileName, parseTextItems, parseTransfer } from './transfer'
import type { List } from './types'

function list(name: string, catalog: string[] = [], onList: string[] = []): List {
  const entries = catalog.map((n, i) => ({ id: `c${i}`, name: n }))
  return {
    id: `l-${name}`,
    name,
    modified: 1_700_000_000_000,
    catalog: entries,
    items: entries.filter((c) => onList.includes(c.name)).map((c) => ({ cid: c.id, qty: 1 })),
    showOthers: false,
  }
}

describe('export', () => {
  it('round-trips through parseTransfer', () => {
    const source = [list('Groceries', ['Milk', 'Eggs'], ['Milk'])]
    const result = parseTransfer(buildExport(source))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.lists).toHaveLength(1)
    expect(result.lists[0]!.name).toBe('Groceries')
    expect(result.lists[0]!.catalog.map((c) => c.name)).toEqual(['Milk', 'Eggs'])
    expect(result.lists[0]!.items).toHaveLength(1)
  })

  it('stamps the format and the schema it was written by', () => {
    const payload = JSON.parse(buildExport([list('A')]))
    expect(payload.format).toBe(TRANSFER_FORMAT)
    expect(payload.schemaVersion).toBe(MAX_SCHEMA)
  })

  it('names the file by local date', () => {
    expect(exportFileName(new Date(2026, 7, 2))).toBe('shopping-list-2026-08-02.json')
  })
})

describe('parseTransfer', () => {
  it('accepts a bare array and a bare { lists }, so older exports still import', () => {
    const bare = [{ id: 'x', name: 'Old', catalog: [], items: [], showOthers: false }]
    expect(parseTransfer(JSON.stringify(bare)).ok).toBe(true)
    expect(parseTransfer(JSON.stringify({ lists: bare })).ok).toBe(true)
  })

  it('refuses data written by a newer schema rather than dropping what it cannot read', () => {
    const text = JSON.stringify({ schemaVersion: MAX_SCHEMA + 1, lists: [list('A')] })
    const result = parseTransfer(text)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toMatch(/newer version/)
  })

  it('reports empty, unparseable and list-free input separately', () => {
    expect(parseTransfer('   ')).toEqual({ ok: false, reason: 'Nothing to import' })
    expect(parseTransfer('{ nope')).toEqual({ ok: false, reason: 'That is not valid JSON' })
    expect(parseTransfer('{"lists":[]}')).toEqual({ ok: false, reason: 'No lists found in that data' })
  })

  it('coerces rather than rejects, exactly as stored data is coerced', () => {
    const result = parseTransfer(
      JSON.stringify({
        lists: [
          {
            name: 'Messy',
            catalog: [{ name: 'Milk' }, { name: 'milk' }, { name: '  ' }],
            items: [{ cid: 'nope', qty: 4 }],
          },
        ],
      }),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Duplicate-by-case and blank names dropped; a dangling cid never becomes a row.
    expect(result.lists[0]!.catalog.map((c) => c.name)).toEqual(['Milk'])
    expect(result.lists[0]!.items).toEqual([])
  })
})

describe('parseTextItems', () => {
  it('reads a Google Keep checklist', () => {
    expect(
      parseTextItems('[ ] 2032 batteries\n[X] Sponge Duster\n[X] Black laundry basket'),
    ).toEqual([
      { name: '2032 batteries', checked: false },
      { name: 'Sponge Duster', checked: true },
      { name: 'Black laundry basket', checked: true },
    ])
  })

  it('strips padding and blank lines', () => {
    expect(parseTextItems('   Milk  \n\n\t \n  Eggs')).toEqual([
      { name: 'Milk', checked: null },
      { name: 'Eggs', checked: null },
    ])
  })

  it('reports no checkbox as null, not as unticked', () => {
    // The distinction is the whole point: an unmarked list is a list of things to buy.
    expect(parseTextItems('Milk')[0]!.checked).toBeNull()
    expect(parseTextItems('[] Milk')[0]!.checked).toBe(false)
  })

  it('understands bullets, empty boxes and unicode ticks', () => {
    expect(parseTextItems('- Milk\n* [x] Eggs\n☐ Bread\n☑ Jam\n• Rice')).toEqual([
      { name: 'Milk', checked: null },
      { name: 'Eggs', checked: true },
      { name: 'Bread', checked: false },
      { name: 'Jam', checked: true },
      { name: 'Rice', checked: null },
    ])
  })

  it('leaves a bracketed word alone', () => {
    expect(parseTextItems('[Brand] Milk')).toEqual([{ name: '[Brand] Milk', checked: null }])
  })

  it('collapses repeats within one paste, case-insensitively', () => {
    expect(parseTextItems('Milk\n[X] milk\n  MILK  ')).toEqual([{ name: 'Milk', checked: null }])
  })

  it('drops a line that is nothing but a checkbox', () => {
    expect(parseTextItems('[ ]\n[X]   \nMilk')).toEqual([{ name: 'Milk', checked: null }])
  })
})

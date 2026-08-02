import type { CatalogItem, List } from './types'

/**
 * Pure derivations of what the two columns display.
 *
 * The right column's ordering is computed here every time and never stored -- only the
 * left column's order is user data. Keeping these as free functions over plain arrays
 * means the column composition rules can be tested without a DOM or a live store.
 */

export interface ForeignEntry {
  name: string
  /** Name of the list this came from; rendered right-aligned in 9.5px mono. */
  source: string
}

export interface PreviewEntry {
  name: string
  qty: number
}

export function isOnList(list: List, cid: string): boolean {
  return list.items.some((it) => it.cid === cid)
}

/** This list's own catalog, alphabetical. */
export function sortedCatalog(list: List): CatalogItem[] {
  return [...list.catalog].sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Other lists' catalog names, for the "From other lists" section.
 *
 * Excludes anything already in this list's catalog, dedupes across source lists
 * case-insensitively, and sorts alphabetically. First list to contribute a name wins
 * the source attribution.
 */
export function foreignCatalog(list: List, all: List[]): ForeignEntry[] {
  const own = new Set(list.catalog.map((c) => c.name.trim().toLowerCase()))
  const seen = new Set<string>()
  const out: ForeignEntry[] = []

  for (const other of all) {
    if (other.id === list.id) continue
    for (const c of other.catalog) {
      const key = c.name.trim().toLowerCase()
      if (own.has(key) || seen.has(key)) continue
      seen.add(key)
      out.push({ name: c.name, source: other.name })
    }
  }

  return out.sort((a, b) => a.name.localeCompare(b.name))
}

export function matchesQuery(text: string, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return text.toLowerCase().includes(q)
}

/** Home search matches a list's name OR any name in its catalog. */
export function filterLists(lists: List[], query: string): List[] {
  const q = query.trim()
  if (!q) return lists
  return lists.filter(
    (l) => matchesQuery(l.name, q) || l.catalog.some((c) => matchesQuery(c.name, q)),
  )
}

/** Home tiles show up to six item lines, in the list's own order. */
export function listPreview(list: List, limit = 6): PreviewEntry[] {
  return list.items.slice(0, limit).map((it) => ({
    name: list.catalog.find((c) => c.id === it.cid)?.name ?? '',
    qty: it.qty,
  }))
}

/** Tiles are ordered most-recently-modified first. */
export function listsByRecency(lists: List[]): List[] {
  return [...lists].sort((a, b) => b.modified - a.modified)
}

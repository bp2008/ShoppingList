import { describe, expect, it } from 'vitest'
import {
  AUTOSCROLL_BAND,
  COLUMN_OVERSHOOT,
  autoScrollVelocity,
  chipCenterX,
  dropHint,
  gripsVisible,
  hitColumn,
  insertionIndex,
  resolveDrop,
  type Rect,
} from './dragMath'

/** Four 40px rows starting at y=100. */
const rows = [
  { top: 100, bottom: 140 },
  { top: 140, bottom: 180 },
  { top: 180, bottom: 220 },
  { top: 220, bottom: 260 },
]

describe('insertionIndex', () => {
  it('is 0 above the first midpoint', () => {
    expect(insertionIndex(rows, 100)).toBe(0)
    expect(insertionIndex(rows, 119)).toBe(0)
  })

  it('advances as each midpoint is passed', () => {
    expect(insertionIndex(rows, 121)).toBe(1)
    expect(insertionIndex(rows, 161)).toBe(2)
    expect(insertionIndex(rows, 201)).toBe(3)
    expect(insertionIndex(rows, 241)).toBe(4)
  })

  it('can address the end of the list', () => {
    expect(insertionIndex(rows, 9999)).toBe(rows.length)
  })

  it('is 0 for an empty column', () => {
    expect(insertionIndex([], 500)).toBe(0)
  })
})

describe('hitColumn', () => {
  const columns: { side: 'left' | 'right'; rect: Rect }[] = [
    { side: 'left', rect: { left: 0, right: 200, top: 100, bottom: 400 } },
    { side: 'right', rect: { left: 208, right: 408, top: 100, bottom: 400 } },
  ]

  it('identifies each column', () => {
    expect(hitColumn(columns, 100, 200)).toBe('left')
    expect(hitColumn(columns, 300, 200)).toBe('right')
  })

  it('accepts overshoot past the top and bottom', () => {
    expect(hitColumn(columns, 100, 400 + COLUMN_OVERSHOOT)).toBe('left')
    expect(hitColumn(columns, 100, 100 - COLUMN_OVERSHOOT)).toBe('left')
  })

  it('rejects beyond the overshoot', () => {
    expect(hitColumn(columns, 100, 400 + COLUMN_OVERSHOOT + 1)).toBeNull()
  })

  it('rejects the gutter between columns', () => {
    expect(hitColumn(columns, 204, 200)).toBeNull()
  })

  it('rejects horizontally outside everything', () => {
    expect(hitColumn(columns, 500, 200)).toBeNull()
  })
})

describe('autoScrollVelocity', () => {
  const column = { top: 100, bottom: 500 }

  it('is still in the middle', () => {
    expect(autoScrollVelocity(column, 300)).toBe(0)
  })

  it('creeps at the inner edge of the band', () => {
    // Just inside the top band: minimum speed, upward.
    expect(autoScrollVelocity(column, 100 + AUTOSCROLL_BAND - 1)).toBeCloseTo(-3, 5)
    expect(autoScrollVelocity(column, 500 - AUTOSCROLL_BAND + 1)).toBeCloseTo(3, 5)
  })

  it('accelerates toward the edge', () => {
    const near = Math.abs(autoScrollVelocity(column, 130))
    const nearer = Math.abs(autoScrollVelocity(column, 110))
    expect(nearer).toBeGreaterThan(near)
  })

  it('reaches band/3 at the very edge', () => {
    expect(autoScrollVelocity(column, 100)).toBeCloseTo(-AUTOSCROLL_BAND / 3, 5)
    expect(autoScrollVelocity(column, 500)).toBeCloseTo(AUTOSCROLL_BAND / 3, 5)
  })

  it('does not runaway past the edge', () => {
    // Overshooting the column must not produce unbounded speed.
    expect(Math.abs(autoScrollVelocity(column, 40))).toBeLessThanOrEqual(AUTOSCROLL_BAND / 3)
    expect(Math.abs(autoScrollVelocity(column, 600))).toBeLessThanOrEqual(AUTOSCROLL_BAND / 3)
  })
})

describe('resolveDrop', () => {
  const base = { index: 2, alreadyOnList: false } as const

  it('adds from the catalog, keeping the catalog entry', () => {
    expect(resolveDrop({ ...base, origin: 'right', target: 'left' })).toEqual({ kind: 'add', index: 2 })
  })

  it('adopts a foreign catalog item', () => {
    expect(resolveDrop({ ...base, origin: 'foreign', target: 'left' })).toEqual({
      kind: 'adopt',
      index: 2,
    })
  })

  it('increments instead of duplicating when already on the list', () => {
    expect(resolveDrop({ ...base, origin: 'right', target: 'left', alreadyOnList: true })).toEqual({
      kind: 'increment',
    })
    expect(resolveDrop({ ...base, origin: 'foreign', target: 'left', alreadyOnList: true })).toEqual({
      kind: 'increment',
    })
  })

  it('removes when dragged out of the list', () => {
    expect(resolveDrop({ ...base, origin: 'left', target: 'right' })).toEqual({ kind: 'remove' })
  })

  it('reorders within the list', () => {
    expect(resolveDrop({ ...base, origin: 'left', target: 'left' })).toEqual({ kind: 'move', index: 2 })
  })

  it('does nothing within the catalog, whose order is derived', () => {
    expect(resolveDrop({ ...base, origin: 'right', target: 'right' })).toEqual({ kind: 'none' })
  })

  it('cancels when released outside both columns', () => {
    for (const origin of ['left', 'right', 'foreign'] as const) {
      expect(resolveDrop({ ...base, origin, target: null })).toEqual({ kind: 'none' })
    }
  })
})

describe('dropHint', () => {
  it('uses the handoff copy', () => {
    expect(dropHint('right', 'left')).toBe('DROP TO ADD')
    expect(dropHint('left', 'left')).toBe('DROP TO REORDER')
    expect(dropHint('left', 'right')).toBe('DROP TO REMOVE')
  })

  it('leaves the catalog header alone for a no-op drag', () => {
    expect(dropHint('right', 'right')).toBe('')
  })

  it('is empty with no target', () => {
    expect(dropHint('left', null)).toBe('')
  })
})

describe('chipCenterX', () => {
  const VIEWPORT = 360
  const CHIP = 120

  it('follows the pointer in open space', () => {
    expect(chipCenterX(180, CHIP, VIEWPORT)).toBe(180)
  })

  it('keeps the chip on screen near the left edge', () => {
    // A 120px chip centred on x=10 would start at -50.
    expect(chipCenterX(10, CHIP, VIEWPORT)).toBe(64)
  })

  it('keeps the chip on screen near the right edge', () => {
    expect(chipCenterX(355, CHIP, VIEWPORT)).toBe(296)
  })

  it('centres a chip too wide to fit rather than picking a bad edge', () => {
    expect(chipCenterX(10, 400, VIEWPORT)).toBe(180)
  })
})

describe('gripsVisible', () => {
  it('honours the setting at normal widths', () => {
    expect(gripsVisible(700, true)).toBe(true)
    expect(gripsVisible(700, false)).toBe(false)
  })

  it('overrides the setting on a narrow screen', () => {
    expect(gripsVisible(320, true)).toBe(false)
  })

  it('keeps grips exactly at the threshold', () => {
    expect(gripsVisible(340, true)).toBe(true)
    expect(gripsVisible(339, true)).toBe(false)
  })
})

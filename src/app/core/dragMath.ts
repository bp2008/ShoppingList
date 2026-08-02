/**
 * Drag geometry.
 *
 * Every constant here is specified in the design handoff, not chosen. They are kept as
 * pure functions over plain rectangles so the behaviour can be tested without a DOM,
 * without pointer events, and without a running app -- which matters, because these are
 * the numbers that decide whether a drag feels right on a phone and they are impossible
 * to eyeball from code review.
 */

export interface Span {
  top: number
  bottom: number
}

export interface Rect extends Span {
  left: number
  right: number
}

export type Side = 'left' | 'right'

/** Grip column width, and the icon hit target size generally. */
export const GRIP_WIDTH = 44

/** Long-press duration when grips are unavailable. */
export const LONG_PRESS_MS = 340

/** Movement beyond this before the long-press fires cancels it and lets the page scroll. */
export const LONG_PRESS_SLOP = 9

/** Distance from a column edge at which auto-scroll engages. */
export const AUTOSCROLL_BAND = 54

/** Slowest auto-scroll, at the outer edge of the band. */
export const AUTOSCROLL_MIN = 3

/** Vertical tolerance past a column's top and bottom when hit-testing. */
export const COLUMN_OVERSHOOT = 30

/** Below this app width, grip columns are dropped and drag becomes long-press only. */
export const NARROW_WIDTH = 340

/** Haptic tick on drag start. */
export const VIBRATE_MS = 12

/**
 * Vertical gap between the pointer and the bottom edge of the drag chip.
 *
 * DEVIATION FROM THE HANDOFF, which offsets the chip +14px right / -22px up. That was
 * designed against grips on the left of both columns; with the mirrored grips this build
 * uses, the dominant drag travels leftward and a right-offset chip covers the column you
 * are aiming at. The chip is centred horizontally above the pointer instead, which is
 * symmetric and obscures neither column regardless of drag direction.
 */
export const CHIP_GAP = 14

/** Keep the chip fully on screen; it is wider than a column on a narrow phone. */
export const CHIP_EDGE_MARGIN = 4

/**
 * Horizontal centre for the drag chip, clamped to the viewport.
 *
 * Without the clamp, a chip centred on a thumb near either edge hangs off the screen --
 * `min-width` is 96px while a column on a 320px device is about 150px.
 */
export function chipCenterX(pointerX: number, chipWidth: number, viewportWidth: number): number {
  const half = chipWidth / 2
  const min = half + CHIP_EDGE_MARGIN
  const max = viewportWidth - half - CHIP_EDGE_MARGIN
  // A chip wider than the viewport cannot satisfy both bounds; centre it.
  if (min > max) return viewportWidth / 2
  return Math.min(Math.max(pointerX, min), max)
}

/**
 * Where a dropped row would land.
 *
 * Defined by the handoff as "the number of rows whose vertical midpoint is above the
 * pointer". Rows must be supplied in visual order. The result is an insertion index into
 * the pre-move array, so it ranges 0..rows.length inclusive.
 */
export function insertionIndex(rows: readonly Span[], pointerY: number): number {
  let index = 0
  for (const row of rows) {
    if ((row.top + row.bottom) / 2 < pointerY) index++
  }
  return index
}

/**
 * Which column the pointer is over, with vertical slack.
 *
 * The overshoot exists because the columns do not span the viewport: without it, dragging
 * to just below the last row -- the natural gesture for "put it at the end" -- would read
 * as dropping outside both columns and cancel.
 */
export function hitColumn(
  columns: readonly { side: Side; rect: Rect }[],
  x: number,
  y: number,
  overshoot: number = COLUMN_OVERSHOOT,
): Side | null {
  for (const { side, rect } of columns) {
    if (x < rect.left || x > rect.right) continue
    if (y < rect.top - overshoot || y > rect.bottom + overshoot) continue
    return side
  }
  return null
}

/**
 * Auto-scroll speed in pixels per frame, signed: negative scrolls up.
 *
 * `max(3, penetration / 3)`, where penetration is how far into the 54px edge band the
 * pointer has reached. So it creeps at the band's inner boundary and accelerates toward
 * the edge, rather than lurching the moment the band is entered.
 */
export function autoScrollVelocity(
  column: Span,
  pointerY: number,
  band: number = AUTOSCROLL_BAND,
): number {
  const fromTop = pointerY - column.top
  if (fromTop < band) {
    const penetration = Math.min(band, band - fromTop)
    return -Math.max(AUTOSCROLL_MIN, penetration / 3)
  }

  const fromBottom = column.bottom - pointerY
  if (fromBottom < band) {
    const penetration = Math.min(band, band - fromBottom)
    return Math.max(AUTOSCROLL_MIN, penetration / 3)
  }

  return 0
}

export type DragOrigin = 'left' | 'right' | 'foreign'

export type DropAction =
  | { kind: 'add'; index: number }
  | { kind: 'adopt'; index: number }
  | { kind: 'increment' }
  | { kind: 'remove' }
  | { kind: 'move'; index: number }
  | { kind: 'none' }

/**
 * The drop matrix, as a decision rather than a pile of branches at the call site.
 *
 * It is deliberately asymmetric: dragging out of the catalog COPIES (the catalog keeps
 * the item), dragging out of the list REMOVES, and dragging within the catalog does
 * nothing because the right column's order is derived and cannot be edited.
 */
export function resolveDrop(params: {
  origin: DragOrigin
  target: Side | null
  /** Insertion index in the left column, when the target is the left column. */
  index: number
  /** Whether the dragged catalog item is already on the left list. */
  alreadyOnList: boolean
}): DropAction {
  const { origin, target, index, alreadyOnList } = params

  // Released outside both columns: cancel.
  if (target === null) return { kind: 'none' }

  if (origin === 'left') {
    if (target === 'right') return { kind: 'remove' }
    return { kind: 'move', index }
  }

  // From the catalog.
  if (target === 'right') return { kind: 'none' }
  if (alreadyOnList) return { kind: 'increment' }
  return origin === 'foreign' ? { kind: 'adopt', index } : { kind: 'add', index }
}

/** Header copy while a column is hovered. Empty string means "leave the header alone". */
export function dropHint(origin: DragOrigin, target: Side | null): string {
  if (target === null) return ''
  if (origin === 'left') return target === 'right' ? 'DROP TO REMOVE' : 'DROP TO REORDER'
  return target === 'left' ? 'DROP TO ADD' : ''
}

/** Grips are hidden below NARROW_WIDTH regardless of the user's setting. */
export function gripsVisible(appWidth: number, setting: boolean): boolean {
  return setting && appWidth >= NARROW_WIDTH
}

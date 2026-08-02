import {
  AUTOSCROLL_BAND,
  LONG_PRESS_MS,
  LONG_PRESS_SLOP,
  VIBRATE_MS,
  autoScrollVelocity,
  hitColumn,
  insertionIndex,
  resolveDrop,
  type DragOrigin,
  type DropAction,
  type Rect,
  type Side,
  type Span,
} from './dragMath'

/**
 * Pointer wiring for drag and drop.
 *
 * ==========================================================================
 * TEARDOWN IS THE POINT OF THIS FILE. READ THIS BEFORE CHANGING ANYTHING.
 * ==========================================================================
 *
 * A drag installs global side effects -- a non-passive `touchmove` handler that calls
 * preventDefault, a body style, a pointer capture, an animation frame loop. If any of
 * them survives the drag, native touch scrolling is dead for the rest of the session:
 * the columns simply stop responding to a finger, while auto-scroll during a drag keeps
 * working because it scrolls programmatically. That exact symptom was observed in the
 * design prototype.
 *
 * It is a class of bug, not a bug, so the structure defends against all of it at once:
 *
 *   - ONE AbortController per drag. Every listener is registered with `{ signal }`, so
 *     teardown is a single `abort()` that cannot be partially applied and cannot drift
 *     out of sync with registration when a listener is added later.
 *   - Teardown is idempotent and runs from every exit: pointerup, pointercancel,
 *     lostpointercapture, visibilitychange, window blur, AND a `finally` around the drop
 *     commit, so an exception thrown by a store mutation still restores scrolling.
 *   - No listener is ever left attached and gated on an `isDragging` flag. A stale flag
 *     disables scrolling with nothing visibly wrong; attach and detach instead.
 *   - `touch-action` is static CSS (`none` on grips, `pan-y` on row text) and is never
 *     toggled from JavaScript. What is never dynamic cannot get stuck.
 *
 * The dev-only assertion at the end of teardown fails loudly rather than letting a
 * regression here degrade silently into an app that cannot be scrolled.
 */

export interface DragSource {
  origin: DragOrigin
  /** Catalog id in the current list. Empty for a foreign item not yet adopted. */
  cid: string
  name: string
  /** Index within the left column; -1 when dragging from the catalog. */
  fromIndex: number
}

export interface DragState {
  source: DragSource
  /** Viewport coordinates of the pointer. */
  x: number
  y: number
  target: Side | null
  /** Insertion index in the left column; -1 when not over the left column. */
  index: number
}

export interface DragHost {
  /** Column geometry and their scrollable elements, measured now. */
  columns(): { side: Side; rect: Rect; scroller: HTMLElement }[]
  /** Left column row spans in visual order. */
  leftRowSpans(): Span[]
  alreadyOnList(source: DragSource): boolean
  /** Apply the drop. May throw; teardown still runs. */
  commit(action: DropAction, source: DragSource): void
  /** Render hook. Called with null when the drag ends. */
  update(state: DragState | null): void
  /** Drag is disabled while a search query is active: a filtered reorder is ambiguous. */
  locked(): boolean
}

const isDev = import.meta.env?.DEV ?? false

export class DragController {
  #host: DragHost
  #abort: AbortController | null = null
  #state: DragState | null = null
  #raf = 0
  #pressTimer: ReturnType<typeof setTimeout> | null = null
  #capturedBy: Element | null = null
  #pointerId = -1

  constructor(host: DragHost) {
    this.#host = host
  }

  get active(): boolean {
    return this.#state !== null
  }

  /**
   * Begin immediately. Used by the grip, whose whole purpose is to start a drag, so the
   * gesture is unambiguous and needs no delay.
   */
  startFromGrip(event: PointerEvent, source: DragSource): void {
    if (this.#host.locked()) return
    event.preventDefault()
    this.#begin(event, source)
  }

  /**
   * Begin after a long press anywhere on the row.
   *
   * The fallback for when grips are hidden, or the screen is too narrow for them. Moving
   * more than the slop before it fires cancels it and lets the browser scroll normally --
   * without that, every scroll attempt would turn into a drag.
   */
  startFromLongPress(event: PointerEvent, source: DragSource): void {
    if (this.#host.locked()) return

    const startX = event.clientX
    const startY = event.clientY
    const pending = new AbortController()
    const signal = pending.signal

    const cancelPending = () => {
      if (this.#pressTimer) {
        clearTimeout(this.#pressTimer)
        this.#pressTimer = null
      }
      pending.abort()
    }

    const onMove = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) > LONG_PRESS_SLOP) cancelPending()
    }

    document.addEventListener('pointermove', onMove, { signal })
    document.addEventListener('pointerup', cancelPending, { signal })
    document.addEventListener('pointercancel', cancelPending, { signal })
    document.addEventListener('scroll', cancelPending, { signal, capture: true })

    this.#pressTimer = setTimeout(() => {
      this.#pressTimer = null
      pending.abort()
      this.#begin(event, source)
    }, LONG_PRESS_MS)
  }

  /** Abort a drag in progress without applying it. */
  cancel(): void {
    this.#teardown()
  }

  /** Release everything. Call from the component's unmount hook. */
  destroy(): void {
    if (this.#pressTimer) {
      clearTimeout(this.#pressTimer)
      this.#pressTimer = null
    }
    this.#teardown()
  }

  /* ------------------------------------------------------------------ internals */

  #begin(event: PointerEvent, source: DragSource): void {
    if (this.#state) this.#teardown()

    const abort = new AbortController()
    const signal = abort.signal
    this.#abort = abort
    this.#pointerId = event.pointerId
    this.#state = {
      source,
      x: event.clientX,
      y: event.clientY,
      target: null,
      index: -1,
    }

    // Route all subsequent pointer events here even if the finger leaves the element.
    const target = event.target as Element | null
    if (target && 'setPointerCapture' in target) {
      try {
        target.setPointerCapture(event.pointerId)
        this.#capturedBy = target
      } catch {
        /* capture is an optimisation, not a requirement */
      }
    }

    document.addEventListener('pointermove', this.#onMove, { signal })
    document.addEventListener('pointerup', this.#onUp, { signal })
    document.addEventListener('pointercancel', this.#onCancel, { signal })
    document.addEventListener('lostpointercapture', this.#onCancel, { signal })
    window.addEventListener('blur', this.#onCancel, { signal })
    document.addEventListener('visibilitychange', this.#onVisibility, { signal })

    // Non-passive, so preventDefault actually suppresses the browser's own scrolling
    // while a drag is in flight. Removed by abort() and by nothing else.
    document.addEventListener('touchmove', this.#onTouchMove, { passive: false, signal })

    document.body.style.userSelect = 'none'

    navigator.vibrate?.(VIBRATE_MS)

    this.#recompute(event.clientX, event.clientY)
  }

  #onTouchMove = (e: TouchEvent): void => {
    if (this.#state) e.preventDefault()
  }

  #onVisibility = (): void => {
    if (document.visibilityState === 'hidden') this.#teardown()
  }

  #onCancel = (): void => {
    this.#teardown()
  }

  #onMove = (e: PointerEvent): void => {
    if (!this.#state || e.pointerId !== this.#pointerId) return
    this.#recompute(e.clientX, e.clientY)
  }

  #onUp = (e: PointerEvent): void => {
    if (!this.#state || e.pointerId !== this.#pointerId) return

    const state = this.#state
    const action = resolveDrop({
      origin: state.source.origin,
      target: state.target,
      index: state.index < 0 ? 0 : state.index,
      alreadyOnList: this.#host.alreadyOnList(state.source),
    })

    try {
      if (action.kind !== 'none') this.#host.commit(action, state.source)
    } finally {
      // Unconditional. A store mutation that throws must not leave the document with a
      // preventDefault'd touchmove handler attached -- the user would be left unable to
      // scroll, on top of whatever the original bug was.
      this.#teardown()
    }
  }

  #recompute(x: number, y: number): void {
    const state = this.#state
    if (!state) return

    const columns = this.#host.columns()
    const target = hitColumn(columns, x, y)

    state.x = x
    state.y = y
    state.target = target
    state.index = target === 'left' ? insertionIndex(this.#host.leftRowSpans(), y) : -1

    this.#host.update(state)
    this.#syncAutoScroll(columns, y)
  }

  #syncAutoScroll(columns: ReturnType<DragHost['columns']>, y: number): void {
    const state = this.#state
    if (!state || !state.target) {
      this.#stopAutoScroll()
      return
    }

    const column = columns.find((c) => c.side === state.target)
    if (!column) {
      this.#stopAutoScroll()
      return
    }

    const velocity = autoScrollVelocity(column.rect, y, AUTOSCROLL_BAND)
    if (velocity === 0) {
      this.#stopAutoScroll()
      return
    }

    if (this.#raf) return
    const step = () => {
      const current = this.#state
      if (!current || !current.target) {
        this.#raf = 0
        return
      }
      const cols = this.#host.columns()
      const col = cols.find((c) => c.side === current.target)
      if (!col) {
        this.#raf = 0
        return
      }
      const v = autoScrollVelocity(col.rect, current.y, AUTOSCROLL_BAND)
      if (v === 0) {
        this.#raf = 0
        return
      }
      col.scroller.scrollTop += v
      // Scrolling moved the rows under a stationary pointer, so the insertion index has
      // to be recomputed even though nothing moved.
      current.index =
        current.target === 'left' ? insertionIndex(this.#host.leftRowSpans(), current.y) : -1
      this.#host.update(current)
      this.#raf = requestAnimationFrame(step)
    }
    this.#raf = requestAnimationFrame(step)
  }

  #stopAutoScroll(): void {
    if (this.#raf) {
      cancelAnimationFrame(this.#raf)
      this.#raf = 0
    }
  }

  /** Idempotent. Safe to call from any exit path, in any order, more than once. */
  #teardown = (): void => {
    this.#stopAutoScroll()

    if (this.#capturedBy) {
      try {
        this.#capturedBy.releasePointerCapture(this.#pointerId)
      } catch {
        /* already released, or never captured */
      }
      this.#capturedBy = null
    }

    // One call removes every listener registered for this drag.
    this.#abort?.abort()
    this.#abort = null

    this.#pointerId = -1
    document.body.style.userSelect = ''

    if (this.#state) {
      this.#state = null
      this.#host.update(null)
    }

    if (isDev) this.#assertClean()
  }

  /**
   * Fail loudly in development rather than degrading into an unscrollable app.
   *
   * Listeners cannot be enumerated, so this checks the bookkeeping that governs them:
   * an aborted controller means every `{ signal }` listener is gone.
   */
  #assertClean(): void {
    const problems: string[] = []
    if (this.#abort !== null) problems.push('AbortController still live')
    if (this.#raf !== 0) problems.push('auto-scroll frame still queued')
    if (this.#capturedBy !== null) problems.push('pointer capture not released')
    if (document.body.style.userSelect !== '') problems.push('body user-select not cleared')
    if (problems.length) {
      throw new Error(`Drag teardown incomplete: ${problems.join('; ')}. Touch scrolling would be broken.`)
    }
  }
}

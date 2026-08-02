// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DragController, type DragHost, type DragSource } from './dragController'
import { LONG_PRESS_MS, LONG_PRESS_SLOP, type DropAction } from './dragMath'

/*
 * These tests exist for one reason: a bug observed in the design prototype where vertical
 * scrolling in both columns died permanently, while auto-scroll during a drag kept
 * working. That is the signature of a drag-scoped global side effect surviving the drag
 * -- most likely the non-passive touchmove handler that calls preventDefault.
 *
 * So the assertion after every exit path is the same and it is deliberately behavioural
 * rather than structural: dispatch a cancelable touchmove at the document and require
 * that nobody prevented it. If anything is still attached, the page cannot scroll.
 */

function pointerEvent(type: string, x: number, y: number, pointerId = 1): PointerEvent {
  const e = new Event(type, { bubbles: true, cancelable: true }) as unknown as Record<string, unknown>
  e.clientX = x
  e.clientY = y
  e.pointerId = pointerId
  return e as unknown as PointerEvent
}

/** True when the document still has something preventing native touch scrolling. */
function touchScrollBlocked(): boolean {
  const e = new Event('touchmove', { bubbles: true, cancelable: true })
  document.dispatchEvent(e)
  return e.defaultPrevented
}

interface ListenerRecord {
  target: EventTarget
  type: string
  listener: unknown
  signal: AbortSignal | undefined
  removed: boolean
}

/**
 * Detect listeners a drag installed and failed to release.
 *
 * The behavioural check above cannot do this on its own. The touchmove handler is also
 * gated on drag state as a second line of defence, so a listener that leaks still
 * declines to preventDefault and the page still scrolls -- deleting the `abort()` call
 * entirely left every behavioural test passing.
 *
 * Since AbortSignal removal never calls removeEventListener, a listener counts as
 * released if it was explicitly removed OR its signal is aborted.
 */
type Patchable = Record<string, any>

/** The prototype in `obj`'s chain that actually owns `prop`. */
function ownerOf(obj: object, prop: string): Patchable | null {
  let p: object | null = obj
  while (p) {
    if (Object.prototype.hasOwnProperty.call(p, prop)) return p as Patchable
    p = Object.getPrototypeOf(p)
  }
  return null
}

function trackListeners() {
  const records: ListenerRecord[] = []
  const patched: { owner: Patchable; add: any; remove: any }[] = []

  // Patching EventTarget.prototype is NOT enough: in happy-dom (and in browsers for
  // `window`) addEventListener is redefined further down the chain, so a naive patch
  // silently intercepts nothing and every assertion below passes vacuously.
  for (const target of [document, window] as object[]) {
    const owner = ownerOf(target, 'addEventListener')
    if (!owner || patched.some((p) => p.owner === owner)) continue

    const add = owner.addEventListener
    const remove = owner.removeEventListener
    patched.push({ owner, add, remove })

    owner.addEventListener = function (this: EventTarget, type: string, listener: unknown, options: unknown) {
      const signal =
        options && typeof options === 'object'
          ? (options as AddEventListenerOptions).signal
          : undefined
      records.push({ target: this, type, listener, signal, removed: false })
      return add.call(this, type, listener, options)
    }
    owner.removeEventListener = function (this: EventTarget, type: string, listener: unknown, options: unknown) {
      for (const r of records) {
        if (r.target === this && r.type === type && r.listener === listener) r.removed = true
      }
      return remove.call(this, type, listener, options)
    }
  }

  // Signal support is itself implemented with an 'abort' listener on the AbortSignal.
  // Those are bookkeeping for the mechanism under test, not listeners the drag installed.
  const ours = (r: ListenerRecord) =>
    !(typeof AbortSignal !== 'undefined' && r.target instanceof AbortSignal)

  return {
    restore() {
      for (const p of patched) {
        p.owner.addEventListener = p.add
        p.owner.removeEventListener = p.remove
      }
    },
    /** Listeners observed. Guards against the harness silently seeing nothing. */
    observed(): number {
      return records.filter(ours).length
    },
    leaked(): string[] {
      return records
        .filter(ours)
        .filter((r) => !r.removed && !(r.signal && r.signal.aborted))
        .map((r) => r.type)
    },
  }
}

const SOURCE: DragSource = { origin: 'right', cid: 'c1', name: 'Milk', fromIndex: -1 }

function makeHost(overrides: Partial<DragHost> = {}) {
  const scroller = document.createElement('div')
  document.body.appendChild(scroller)
  const commits: DropAction[] = []
  const host: DragHost = {
    columns: () => [
      { side: 'left', rect: { left: 0, right: 100, top: 0, bottom: 400 }, scroller },
      { side: 'right', rect: { left: 110, right: 210, top: 0, bottom: 400 }, scroller },
    ],
    leftRowSpans: () => [
      { top: 0, bottom: 40 },
      { top: 40, bottom: 80 },
    ],
    alreadyOnList: () => false,
    commit: (action) => {
      commits.push(action)
    },
    update: () => {},
    locked: () => false,
    ...overrides,
  }
  return { host, commits, scroller }
}

let controller: DragController | null = null

beforeEach(() => {
  document.body.innerHTML = ''
  document.body.removeAttribute('style')
})

afterEach(() => {
  controller?.destroy()
  controller = null
  vi.useRealTimers()
})

describe('teardown restores scrolling on every exit path', () => {
  it('is not blocking before any drag', () => {
    expect(touchScrollBlocked()).toBe(false)
  })

  it('blocks only while a drag is in flight', () => {
    const { host } = makeHost()
    controller = new DragController(host)
    controller.startFromGrip(pointerEvent('pointerdown', 50, 20), SOURCE)

    expect(controller.active).toBe(true)
    expect(touchScrollBlocked()).toBe(true)
  })

  it('after a completed drop', () => {
    const { host, commits } = makeHost()
    controller = new DragController(host)
    controller.startFromGrip(pointerEvent('pointerdown', 150, 20), SOURCE)
    document.dispatchEvent(pointerEvent('pointermove', 50, 60))
    document.dispatchEvent(pointerEvent('pointerup', 50, 60))

    expect(commits).toHaveLength(1)
    expect(touchScrollBlocked()).toBe(false)
    expect(document.body.style.userSelect).toBe('')
  })

  it('after a drop outside both columns', () => {
    const { host, commits } = makeHost()
    controller = new DragController(host)
    controller.startFromGrip(pointerEvent('pointerdown', 150, 20), SOURCE)
    document.dispatchEvent(pointerEvent('pointermove', 900, 900))
    document.dispatchEvent(pointerEvent('pointerup', 900, 900))

    expect(commits).toHaveLength(0)
    expect(touchScrollBlocked()).toBe(false)
  })

  it('after pointercancel (incoming call, notification shade)', () => {
    const { host } = makeHost()
    controller = new DragController(host)
    controller.startFromGrip(pointerEvent('pointerdown', 150, 20), SOURCE)
    document.dispatchEvent(pointerEvent('pointercancel', 150, 20))

    expect(controller.active).toBe(false)
    expect(touchScrollBlocked()).toBe(false)
  })

  it('after losing pointer capture', () => {
    const { host } = makeHost()
    controller = new DragController(host)
    controller.startFromGrip(pointerEvent('pointerdown', 150, 20), SOURCE)
    document.dispatchEvent(pointerEvent('lostpointercapture', 150, 20))

    expect(touchScrollBlocked()).toBe(false)
  })

  it('after the app is backgrounded mid-drag', () => {
    const { host } = makeHost()
    controller = new DragController(host)
    controller.startFromGrip(pointerEvent('pointerdown', 150, 20), SOURCE)

    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))

    expect(controller.active).toBe(false)
    expect(touchScrollBlocked()).toBe(false)
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
  })

  it('after the window loses focus', () => {
    const { host } = makeHost()
    controller = new DragController(host)
    controller.startFromGrip(pointerEvent('pointerdown', 150, 20), SOURCE)
    window.dispatchEvent(new Event('blur'))

    expect(touchScrollBlocked()).toBe(false)
  })

  it('even when the drop commit throws', () => {
    // The scenario that motivated the `finally`: a bug in a store mutation must not also
    // cost the user their ability to scroll.
    const { host } = makeHost({
      commit: () => {
        throw new Error('store blew up')
      },
    })
    controller = new DragController(host)
    controller.startFromGrip(pointerEvent('pointerdown', 150, 20), SOURCE)
    document.dispatchEvent(pointerEvent('pointermove', 50, 60))

    expect(() => document.dispatchEvent(pointerEvent('pointerup', 50, 60))).toThrow()

    expect(controller.active).toBe(false)
    expect(touchScrollBlocked()).toBe(false)
    expect(document.body.style.userSelect).toBe('')
  })

  it('after destroy() during an active drag', () => {
    const { host } = makeHost()
    controller = new DragController(host)
    controller.startFromGrip(pointerEvent('pointerdown', 150, 20), SOURCE)
    controller.destroy()

    expect(touchScrollBlocked()).toBe(false)
  })

  it('tolerates teardown being run twice', () => {
    const { host } = makeHost()
    controller = new DragController(host)
    controller.startFromGrip(pointerEvent('pointerdown', 150, 20), SOURCE)
    controller.cancel()
    expect(() => controller!.cancel()).not.toThrow()
    expect(touchScrollBlocked()).toBe(false)
  })
})

describe('teardown releases every listener it installed', () => {
  it('the tracker actually intercepts listeners', () => {
    // Without this, a harness that patched the wrong prototype would make every
    // assertion in this block pass while observing nothing at all.
    const { host } = makeHost()
    controller = new DragController(host)
    const tracker = trackListeners()
    try {
      controller.startFromGrip(pointerEvent('pointerdown', 150, 20), SOURCE)
    } finally {
      tracker.restore()
    }
    expect(tracker.observed()).toBeGreaterThan(0)
    expect(tracker.leaked().length).toBeGreaterThan(0) // still mid-drag
  })

  it('after a completed drop', () => {
    const { host } = makeHost()
    controller = new DragController(host)
    const tracker = trackListeners()
    try {
      controller.startFromGrip(pointerEvent('pointerdown', 150, 20), SOURCE)
      document.dispatchEvent(pointerEvent('pointermove', 50, 60))
      document.dispatchEvent(pointerEvent('pointerup', 50, 60))
    } finally {
      tracker.restore()
    }
    expect(tracker.observed()).toBeGreaterThan(0)
    expect(tracker.leaked()).toEqual([])
  })

  it('after pointercancel', () => {
    const { host } = makeHost()
    controller = new DragController(host)
    const tracker = trackListeners()
    try {
      controller.startFromGrip(pointerEvent('pointerdown', 150, 20), SOURCE)
      document.dispatchEvent(pointerEvent('pointercancel', 150, 20))
    } finally {
      tracker.restore()
    }
    expect(tracker.leaked()).toEqual([])
  })

  it('even when the drop commit throws', () => {
    const { host } = makeHost({
      commit: () => {
        throw new Error('store blew up')
      },
    })
    controller = new DragController(host)
    const tracker = trackListeners()
    try {
      controller.startFromGrip(pointerEvent('pointerdown', 150, 20), SOURCE)
      document.dispatchEvent(pointerEvent('pointermove', 50, 60))
      expect(() => document.dispatchEvent(pointerEvent('pointerup', 50, 60))).toThrow()
    } finally {
      tracker.restore()
    }
    expect(tracker.leaked()).toEqual([])
  })

  it('after an abandoned long press', () => {
    vi.useFakeTimers()
    const { host } = makeHost()
    controller = new DragController(host)
    const tracker = trackListeners()
    try {
      controller.startFromLongPress(pointerEvent('pointerdown', 150, 20), SOURCE)
      document.dispatchEvent(pointerEvent('pointermove', 150, 20 + LONG_PRESS_SLOP + 1))
      vi.advanceTimersByTime(LONG_PRESS_MS * 2)
    } finally {
      tracker.restore()
    }
    expect(tracker.leaked()).toEqual([])
  })

  it('does not accumulate listeners across repeated drags', () => {
    const { host } = makeHost()
    controller = new DragController(host)
    const tracker = trackListeners()
    try {
      for (let i = 0; i < 5; i++) {
        controller.startFromGrip(pointerEvent('pointerdown', 150, 20), SOURCE)
        document.dispatchEvent(pointerEvent('pointermove', 50, 60))
        document.dispatchEvent(pointerEvent('pointerup', 50, 60))
      }
    } finally {
      tracker.restore()
    }
    expect(tracker.leaked()).toEqual([])
  })
})

describe('long press', () => {
  it('starts a drag after the delay', () => {
    vi.useFakeTimers()
    const { host } = makeHost()
    controller = new DragController(host)
    controller.startFromLongPress(pointerEvent('pointerdown', 150, 20), SOURCE)

    expect(controller.active).toBe(false)
    vi.advanceTimersByTime(LONG_PRESS_MS)
    expect(controller.active).toBe(true)
  })

  it('is cancelled by movement beyond the slop, leaving scrolling alone', () => {
    vi.useFakeTimers()
    const { host } = makeHost()
    controller = new DragController(host)
    controller.startFromLongPress(pointerEvent('pointerdown', 150, 20), SOURCE)

    document.dispatchEvent(pointerEvent('pointermove', 150, 20 + LONG_PRESS_SLOP + 1))
    vi.advanceTimersByTime(LONG_PRESS_MS * 2)

    expect(controller.active).toBe(false)
    // The crucial half: an abandoned long press must not have blocked scrolling.
    expect(touchScrollBlocked()).toBe(false)
  })

  it('survives small jitter within the slop', () => {
    vi.useFakeTimers()
    const { host } = makeHost()
    controller = new DragController(host)
    controller.startFromLongPress(pointerEvent('pointerdown', 150, 20), SOURCE)

    document.dispatchEvent(pointerEvent('pointermove', 152, 23))
    vi.advanceTimersByTime(LONG_PRESS_MS)

    expect(controller.active).toBe(true)
  })

  it('is abandoned when the finger lifts first', () => {
    vi.useFakeTimers()
    const { host } = makeHost()
    controller = new DragController(host)
    controller.startFromLongPress(pointerEvent('pointerdown', 150, 20), SOURCE)

    document.dispatchEvent(pointerEvent('pointerup', 150, 20))
    vi.advanceTimersByTime(LONG_PRESS_MS * 2)

    expect(controller.active).toBe(false)
    expect(touchScrollBlocked()).toBe(false)
  })
})

describe('locking', () => {
  it('refuses to start while a search query is active', () => {
    const { host } = makeHost({ locked: () => true })
    controller = new DragController(host)
    controller.startFromGrip(pointerEvent('pointerdown', 150, 20), SOURCE)

    expect(controller.active).toBe(false)
    expect(touchScrollBlocked()).toBe(false)
  })
})

describe('drop resolution through the controller', () => {
  it('reports the insertion index computed from row midpoints', () => {
    const { host, commits } = makeHost()
    controller = new DragController(host)
    controller.startFromGrip(pointerEvent('pointerdown', 150, 20), SOURCE)
    // y=60 is past the first row midpoint (20) but not the second (60).
    document.dispatchEvent(pointerEvent('pointermove', 50, 60))
    document.dispatchEvent(pointerEvent('pointerup', 50, 60))

    expect(commits[0]).toEqual({ kind: 'add', index: 1 })
  })

  it('increments instead of adding when the item is already on the list', () => {
    const { host, commits } = makeHost({ alreadyOnList: () => true })
    controller = new DragController(host)
    controller.startFromGrip(pointerEvent('pointerdown', 150, 20), SOURCE)
    document.dispatchEvent(pointerEvent('pointermove', 50, 10))
    document.dispatchEvent(pointerEvent('pointerup', 50, 10))

    expect(commits[0]).toEqual({ kind: 'increment' })
  })
})

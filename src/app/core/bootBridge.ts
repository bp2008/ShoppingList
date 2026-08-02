/**
 * Bridge to the bootloader's globals (see src/shell/bootloader.js).
 *
 * Every one of these is optional at runtime: `npm run dev` serves src/app/index.html
 * directly with no bootloader present, so the app must run fine without them.
 */

declare global {
  interface Window {
    /** Set by signalReady(). The bootloader's health check reads this. */
    __APP_READY__?: boolean
    /** Disarms the bootloader watchdog. */
    __bootOk?: () => void
    /** Reports an unrecoverable failure. Schedules the rescue screen; does not throw. */
    __bootFail?: (reason: string, err?: unknown) => void
    /** Opens the rescue screen directly (About -> Troubleshooting). */
    __rescue?: (reason: string) => void
  }
}

/**
 * Tell the bootloader the app rendered.
 *
 * Deferred past mount because the bootloader's health check requires the top bar to have
 * a non-zero offsetHeight -- signalling before layout would let a mounted-but-blank app
 * report itself healthy.
 *
 * Whichever of the two clocks fires first wins, and that redundancy is load-bearing:
 * requestAnimationFrame does not fire at all while the document is hidden, and a PWA can
 * absolutely be launched and immediately backgrounded, or restored into a hidden tab.
 * On rAF alone, that healthy launch never reports in and the watchdog rolls it back.
 */
export function signalReady(): void {
  let signalled = false
  const fire = () => {
    if (signalled) return
    signalled = true
    window.__APP_READY__ = true
    window.__bootOk?.()
  }
  requestAnimationFrame(fire)
  setTimeout(fire, 150)
}

/**
 * Wrap a code path whose failure leaves the app unusable, so the exception escalates to
 * the rescue screen instead of silently producing a half-broken UI.
 *
 * Reserved for a short list: menu open, list open, store commit, persistence write.
 * Ordinary errors should NOT go through here -- see the escalation table in the plan;
 * tearing down a working session over one stray error is worse than the error.
 *
 * The error is always rethrown, and __bootFail defers the actual rescue render to a
 * macrotask, so callers' `finally` blocks still run first. The drag engine depends on
 * that ordering: its teardown must restore scrolling even when the drop commit throws.
 */
export function criticalSection<T>(name: string, fn: () => T): T {
  try {
    return fn()
  } catch (err) {
    window.__bootFail?.(`critical:${name}`, err)
    throw err
  }
}

export {}

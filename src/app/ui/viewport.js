/**
 * The browser's *visual* viewport, published as CSS variables.
 *
 * WHY THIS EXISTS. A dialog centred with `position: fixed; inset: 0` disappears behind the
 * on-screen keyboard, which is exactly when a dialog with a text field is on screen. The
 * keyboard shrinks the VISUAL viewport but leaves the LAYOUT viewport alone, and every
 * fixed box — including the app root — is positioned against the layout viewport, so
 * nothing in CSS notices. `window.visualViewport` is the only thing that reports the area
 * the user can actually see, so it is mirrored onto the document element and the dialog
 * scrim sizes itself from it.
 *
 * `offsetTop` matters as well as `height`: iOS scrolls the visual viewport up inside the
 * layout viewport instead of only shortening it, so a scrim pinned to `top: 0` would be
 * short AND in the wrong place.
 *
 * Consumers must supply a fallback — `var(--vv-height, 100%)` — because these are unset
 * until installViewport() has run, and a browser without the API never sets them at all.
 * That fallback is the full layout viewport, i.e. today's behaviour.
 */

const root = document.documentElement

function publish() {
  const vv = window.visualViewport
  root.style.setProperty('--vv-height', `${Math.round(vv ? vv.height : window.innerHeight)}px`)
  root.style.setProperty('--vv-top', `${Math.round(vv ? vv.offsetTop : 0)}px`)
}

/**
 * Start tracking. Installed once, for the life of the app.
 *
 * `scroll` is listened to as well as `resize` because pinch-zoom and the iOS keyboard both
 * move the visual viewport without resizing it.
 */
export function installViewport() {
  const vv = window.visualViewport
  if (vv) {
    vv.addEventListener('resize', publish)
    vv.addEventListener('scroll', publish)
  } else {
    window.addEventListener('resize', publish)
  }
  publish()
}

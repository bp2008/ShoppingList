/**
 * Which kind of device the user last touched the app with, published as `data-input` on
 * the <html> element (`mouse` or `touch`).
 *
 * WHY THIS EXISTS. This is a touchscreen app first, and on a touchscreen a `:hover` rule
 * is a lie: the browser applies hover to the last thing tapped and leaves it applied, so
 * every button the user touches stays lit as though the pointer were resting on it. The
 * usual fix, `@media (hover: hover)`, is not enough — a Windows touchscreen laptop or a
 * Chromebook reports hover support and still hands you sticky hover from a finger.
 *
 * So hover styling is gated on the LAST input that was actually used, which flips back
 * and forth as the user does. Press feedback (`:active`) is left ungated: it is correct
 * for both, and it is the only feedback a touch user gets while their finger is down.
 * Keyboard focus rings are `:focus-visible`, which the browser already scopes correctly.
 *
 * Consumed by the `.tap` / `.tap-inv` utilities in styles/tokens.css. The rescue screen
 * cannot import this — it runs with no stylesheets at all — and carries its own two-line
 * equivalent; see src/shell/rescue.js.
 */

let mode = ''

function set(next) {
  if (next === mode) return
  mode = next
  document.documentElement.dataset.input = next
}

export function installInputMode() {
  // Best guess for the first paint, before any input has happened.
  const fine = typeof matchMedia === 'function' && matchMedia('(hover: hover) and (pointer: fine)')
  set(fine && fine.matches ? 'mouse' : 'touch')

  // Capture phase and passive: this must observe every press without being able to
  // interfere with one, least of all with a drag.
  const options = { capture: true, passive: true }

  window.addEventListener(
    'pointerdown',
    (e) => set(e.pointerType === 'mouse' ? 'mouse' : 'touch'),
    options,
  )

  // A mouse that is only moved, never clicked, must still restore hover styling.
  window.addEventListener(
    'pointermove',
    (e) => {
      if (mode !== 'mouse' && e.pointerType === 'mouse') set('mouse')
    },
    options,
  )

  // iOS Safari only applies :active to an element while some touch listener exists on
  // the way to the document. This empty one is that listener, and is why touch press
  // feedback works there at all.
  window.addEventListener('touchstart', () => {}, { passive: true })
}

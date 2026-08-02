import { watchEffect } from 'vue'
import { state } from '../core/store'

/**
 * Theme application.
 *
 * Two responsibilities the handoff calls out: `System` must follow the OS preference
 * live rather than only at startup, and the `theme-color` meta must be updated whenever
 * the active theme changes — otherwise an installed PWA keeps a white status bar behind
 * a true-black OLED app.
 */

const query = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null

let systemPrefersDark = query ? query.matches : false
let notify = () => {}

if (query) {
  const onChange = (e) => {
    systemPrefersDark = e.matches
    notify()
  }
  // addEventListener over addListener: Safari < 14 is well outside the target range.
  query.addEventListener('change', onChange)
}

export function isDark() {
  if (state.settings.theme === 'oled') return true
  if (state.settings.theme === 'light') return false
  return systemPrefersDark
}

export function installTheme() {
  const apply = () => {
    const dark = isDark()
    document.body.setAttribute('data-theme', dark ? 'oled' : 'light')
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', dark ? '#000000' : '#ffffff')
  }

  // Re-run when the stored preference changes...
  const stop = watchEffect(apply)
  // ...and when the OS preference changes while set to System.
  notify = apply
  apply()
  return stop
}

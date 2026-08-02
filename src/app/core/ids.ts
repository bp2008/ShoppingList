/**
 * Identifier generation.
 *
 * crypto.randomUUID is unavailable on insecure origins, which is exactly where this app
 * gets tested (a phone hitting a dev box over plain http on the LAN). The fallback is
 * not cryptographically meaningful and does not need to be -- these ids are only ever
 * compared within one device's own document.
 */
export function newId(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return (
    Date.now().toString(36) +
    '-' +
    Math.random().toString(36).slice(2, 10) +
    Math.random().toString(36).slice(2, 10)
  )
}

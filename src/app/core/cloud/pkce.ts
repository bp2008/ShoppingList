/**
 * PKCE (RFC 7636), the reason this app can talk to Dropbox with no backend.
 *
 * A confidential OAuth client proves itself with a secret, which a static site cannot
 * keep. PKCE replaces that with a secret generated per attempt and never sent anywhere
 * except in the final token exchange -- so the app key can sit in the bundle in plain
 * sight, where anyone reading the JavaScript will find it, and still be useless on its own.
 *
 * Pure and DOM-free so the whole file is testable under the `node` vitest environment;
 * `crypto.subtle` and `btoa` are globals in browsers and in Node 20+ alike.
 */

/** RFC 7636 allows 43-128 characters. 64 random bytes lands at 86 of base64url. */
const VERIFIER_BYTES = 64

/** Enough to make a replayed `?code=` from another tab statistically impossible. */
const STATE_BYTES = 16

/**
 * base64url, i.e. base64 with the two URL-hostile characters swapped and no padding.
 *
 * Plain `btoa` output would be re-encoded in a query string and no longer match what the
 * server hashed, which fails the exchange with an error that says nothing about why.
 */
function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function randomBase64url(byteLength: number): string {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)
  return base64url(bytes)
}

/** The secret half. Held locally until the exchange, never put in a URL. */
export function createVerifier(): string {
  return randomBase64url(VERIFIER_BYTES)
}

/** The public half: SHA-256 of the verifier, which is what travels in the auth URL. */
export async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64url(new Uint8Array(digest))
}

/**
 * Opaque value echoed back through the redirect.
 *
 * Guards against acting on a `?code=` this app did not ask for -- a stale bookmark, a
 * link someone else crafted, or a second attempt racing the first.
 */
export function createState(): string {
  return randomBase64url(STATE_BYTES)
}

/**
 * Where this build is allowed to complete a Dropbox sign-in.
 *
 * ============================================================================
 * THIS LIST MUST MATCH THE REDIRECT URIs IN THE DROPBOX APP CONSOLE, EXACTLY.
 * ============================================================================
 *
 * Dropbox will only ever return an authorisation code to a URI registered against the app
 * key, so a copy of this site running anywhere else CANNOT complete the flow -- the sign-in
 * would bounce the user out to Dropbox and strand them there with an error page from
 * somebody else's service. That is the failure this list exists to prevent: the app checks
 * its own address up front and says plainly that cloud backup is not configured here,
 * rather than offering a button that leads somewhere broken.
 *
 * It is also why the app key can be a public constant. The key alone is useless without
 * control of one of these addresses -- guard this list, not the key.
 *
 * Adding an entry here does nothing on its own. Register it in the console first.
 */
export const REDIRECT_URIS: readonly string[] = [
  'http://localhost:5173/',
  'https://bp2008.github.io/ShoppingList/',
]

/**
 * The registered URI this location counts as, or null if it is not one of them.
 *
 * Returns the entry FROM THE LIST rather than what was derived from `location`, so the
 * `redirect_uri` sent to Dropbox is guaranteed byte-identical to the registered string. A
 * mismatch of a single character there is rejected, and the error says nothing useful.
 *
 * Query and hash are ignored -- the app is a hash router, so it is almost never sitting at
 * the bare directory when the user taps Connect. `index.html` is trimmed and a trailing
 * slash is enforced, because both name the same directory that gets registered.
 */
export function matchRedirectUri(
  href: string,
  allowed: readonly string[] = REDIRECT_URIS,
): string | null {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return null
  }

  let path = url.pathname.replace(/index\.html$/, '')
  if (!path.endsWith('/')) path += '/'
  const here = url.origin + path

  return allowed.find((uri) => uri === here) ?? null
}

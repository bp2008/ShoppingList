/**
 * The Dropbox API surface this app uses, as raw `fetch`.
 *
 * NO SDK ON PURPOSE. The official JavaScript SDK is a large dependency for six endpoints,
 * and this bundle is precached on a phone and expected to work offline forever -- the
 * whole app has three runtime dependencies. What is here is the complete set: authorise,
 * exchange, refresh, upload, list, download, delete, whoami.
 *
 * Every call funnels its failures into a `CloudError` carrying a `kind`, because the
 * caller's decision is only ever one of three: reconnect (auth), try again later
 * (network / rate-limit), or give up and show the message (api).
 */

/** Injected by vite.config.js. Empty in a build that was made without an app key. */
const APP_KEY = __DROPBOX_APP_KEY__

const AUTH_URL = 'https://www.dropbox.com/oauth2/authorize'
const TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token'
const RPC_BASE = 'https://api.dropboxapi.com/2/'
const CONTENT_BASE = 'https://content.dropboxapi.com/2/'

/** Renew this long before the server would actually reject the token. */
const EXPIRY_MARGIN_MS = 60_000

export type CloudErrorKind = 'auth' | 'network' | 'rate-limit' | 'api'

export class CloudError extends Error {
  readonly kind: CloudErrorKind

  constructor(kind: CloudErrorKind, message: string) {
    super(message)
    this.name = 'CloudError'
    this.kind = kind
  }
}

export interface TokenSet {
  accessToken: string
  /** Epoch ms, already reduced by the safety margin. */
  expiresAt: number
  /** Present on the initial exchange only; refreshing does not reissue one. */
  refreshToken?: string
}

export interface RemoteFile {
  name: string
  /** Path within the app folder, e.g. `/backup-2026-08-02-1431.json`. */
  path: string
  size: number
  /** Epoch ms, from `server_modified`. */
  modified: number
}

export function isConfigured(): boolean {
  return APP_KEY !== ''
}

/* --------------------------------------------------------------------------- helpers */

/** Anything outside printable ASCII has to be escaped; see `apiArg`. */
const MAX_HEADER_SAFE = 0x7e

/**
 * `Dropbox-API-Arg` travels in an HTTP header, which may only carry ASCII.
 *
 * Our own file names are ASCII by construction, but a path can also come back from
 * `listFolder` after the user renamed something in their own Dropbox folder, and a bare
 * `JSON.stringify` of that would produce a header the browser refuses to send.
 *
 * Walked by UTF-16 code unit rather than by codepoint on purpose: a surrogate pair has to
 * come out as two `\uXXXX` escapes, which is what JSON expects, and iterating by codepoint
 * would emit one malformed five-digit escape instead.
 */
function apiArg(value: unknown): string {
  const json = JSON.stringify(value)
  let out = ''
  for (let i = 0; i < json.length; i++) {
    const code = json.charCodeAt(i)
    out += code > MAX_HEADER_SAFE ? '\\u' + code.toString(16).padStart(4, '0') : json.charAt(i)
  }
  return out
}

/** Anything that is not a clean HTTP response: offline, DNS, CORS, aborted. */
async function send(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init)
  } catch {
    throw new CloudError('network', 'Could not reach Dropbox')
  }
}

async function failure(res: Response): Promise<CloudError> {
  const body = await res.text().catch(() => '')

  if (res.status === 401) return new CloudError('auth', 'Dropbox sign-in has expired')
  if (res.status === 429) return new CloudError('rate-limit', 'Dropbox is rate limiting; try later')
  if (res.status >= 500) return new CloudError('network', 'Dropbox is unavailable')

  // 400 from the token endpoint with invalid_grant means the user revoked this app, or
  // the refresh token was replaced. Either way the only cure is connecting again.
  if (body.includes('invalid_grant')) {
    return new CloudError('auth', 'Dropbox access was revoked')
  }
  // Not the user's problem at all: the app key this build was compiled with is wrong or
  // the Dropbox app was deleted. Says so plainly rather than inviting them to retry.
  if (body.includes('invalid_client')) {
    return new CloudError('api', 'This build has an invalid Dropbox app key')
  }
  return new CloudError('api', `Dropbox refused the request (${res.status})`)
}

/* ------------------------------------------------------------------------------ auth */

/** Where to send the browser to start the flow. A full-page navigation, never a popup. */
export function authorizeUrl(challenge: string, state: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: APP_KEY,
    response_type: 'code',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    // The whole reason Dropbox was chosen: this is what yields a refresh token that a
    // browser-only client may hold, so backups can run without an interactive sign-in.
    token_access_type: 'offline',
    redirect_uri: redirectUri,
    state,
  })
  return `${AUTH_URL}?${params}`
}

async function token(body: Record<string, string>): Promise<TokenSet> {
  const res = await send(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  })
  if (!res.ok) throw await failure(res)

  const json = (await res.json()) as {
    access_token?: string
    expires_in?: number
    refresh_token?: string
  }
  if (!json.access_token) throw new CloudError('api', 'Dropbox returned no access token')

  const set: TokenSet = {
    accessToken: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 14400) * 1000 - EXPIRY_MARGIN_MS,
  }
  if (json.refresh_token) set.refreshToken = json.refresh_token
  return set
}

/** No client secret anywhere: the verifier is what proves this is the same client. */
export function exchangeCode(
  code: string,
  verifier: string,
  redirectUri: string,
): Promise<TokenSet> {
  return token({
    grant_type: 'authorization_code',
    code,
    code_verifier: verifier,
    client_id: APP_KEY,
    redirect_uri: redirectUri,
  })
}

export function refreshAccessToken(refreshToken: string): Promise<TokenSet> {
  return token({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: APP_KEY,
  })
}

/* ------------------------------------------------------------------------------- rpc */

async function rpc<T>(accessToken: string, endpoint: string, args?: unknown): Promise<T> {
  const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}` }
  const init: RequestInit = { method: 'POST', headers }

  // Endpoints that take no arguments must be sent with no body AND no Content-Type;
  // an empty JSON body is rejected as a malformed request rather than ignored.
  if (args !== undefined) {
    headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(args)
  }

  const res = await send(RPC_BASE + endpoint, init)
  if (!res.ok) throw await failure(res)
  return (await res.json()) as T
}

/** Requires the `account_info.read` scope. Display only -- nothing depends on it. */
export async function currentAccount(accessToken: string): Promise<string> {
  const json = await rpc<{ email?: string }>(accessToken, 'users/get_current_account')
  return json.email ?? ''
}

interface ListEntry {
  '.tag'?: string
  name?: string
  path_lower?: string
  size?: number
  server_modified?: string
}

/**
 * With App folder access the empty string is the app folder's own root, and every path
 * below is relative to it. There is no way to name anything outside it.
 */
export async function listFolder(accessToken: string): Promise<RemoteFile[]> {
  const json = await rpc<{ entries?: ListEntry[] }>(accessToken, 'files/list_folder', { path: '' })

  const files: RemoteFile[] = []
  for (const entry of json.entries ?? []) {
    if (entry['.tag'] !== 'file' || !entry.name || !entry.path_lower) continue
    files.push({
      name: entry.name,
      path: entry.path_lower,
      size: entry.size ?? 0,
      modified: entry.server_modified ? Date.parse(entry.server_modified) : 0,
    })
  }
  return files
}

export async function deleteFile(accessToken: string, path: string): Promise<void> {
  await rpc(accessToken, 'files/delete_v2', { path })
}

/* --------------------------------------------------------------------------- content */

/**
 * `mode: 'add'` with `autorename: false` so an upload can never overwrite an existing
 * snapshot. Names carry the minute, so a genuine collision means two backups in the same
 * minute, and failing that second one is correct -- the first already holds the data.
 */
export async function upload(accessToken: string, path: string, text: string): Promise<void> {
  const res = await send(CONTENT_BASE + 'files/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': apiArg({ path, mode: 'add', autorename: false, mute: true }),
    },
    body: text,
  })
  if (!res.ok) throw await failure(res)
}

export async function download(accessToken: string, path: string): Promise<string> {
  const res = await send(CONTENT_BASE + 'files/download', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Dropbox-API-Arg': apiArg({ path }),
    },
  })
  if (!res.ok) throw await failure(res)
  return res.text()
}

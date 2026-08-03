/**
 * Cloud backup: the whole feature, as seen by the UI.
 *
 * Automatic backup, manual restore. Deliberately not sync -- nothing here ever writes to
 * the store, and the only way cloud data reaches a list is the user choosing a snapshot
 * and going through the ordinary import dialog.
 *
 * TWO RULES THIS FILE MUST NEVER BREAK:
 *
 * 1. Nothing here may throw into the app. Every entry point resolves; failures land in
 *    `cloud.error` and stay there. An offline phone is the normal case, not an error, and
 *    a cloud problem must never reach the bootloader watchdog or a critical section.
 *
 * 2. Backups are the same bytes as a manual export. `buildExport` produces the payload and
 *    `parseTransfer` reads it back, so a snapshot in the user's Dropbox is a file they can
 *    open, read, and paste into "Import lists..." by hand if this code is ever the problem.
 */

import { state } from '../store'
import { buildExport } from '../transfer'
import { backupFileName, hashLists, isDue, prunable } from './backup'
import { matchRedirectUri } from './config'
import * as api from './dropbox'
import { CloudError, type RemoteFile } from './dropbox'
import { challengeFor, createState, createVerifier } from './pkce'
import * as connection from './state'
import { cloud } from './state'

export { cloud } from './state'
export type { RemoteFile } from './dropbox'

/*
 * The in-flight half of the OAuth round trip.
 *
 * localStorage, NOT sessionStorage. The flow leaves the origin entirely and comes back
 * through a fresh page load, and sessionStorage is the more fragile of the two across that
 * boundary -- particularly in an installed PWA, where the returning context may not be
 * treated as the same session at all.
 */
const VERIFIER_KEY = 'slp.cloud.verifier'
const STATE_KEY = 'slp.cloud.state'
const STARTED_KEY = 'slp.cloud.started'

/** Beyond this, an unfinished sign-in is stale rather than lost, and is dropped quietly. */
const ROUND_TRIP_MS = 10 * 60 * 1000

/** Shown when the browser left for Dropbox and never came back with anything. */
const LOST_ROUND_TRIP =
  "Sign-in didn't finish. Cloud backup may not work in the installed app on this device " +
  '-- use Export lists to save a copy instead.'

/** Captured synchronously at boot by `captureRedirect`, consumed by `init`. */
let pending: { code: string; state: string } | null = null

let accessToken = ''
let accessExpiry = 0

/*
 * Resolves once the stored connection has been read back and any pending sign-in has been
 * settled -- i.e. once "are we connected?" has a real answer.
 *
 * The URL owns the UI in this app, so a reload with the restore dialog open re-opens it
 * immediately, well before `init()` has been anywhere near IndexedDB. Without this gate
 * that dialog asks a not-yet-restored connection for a file list and reports the user as
 * signed out, which is both wrong and alarming.
 */
let markReady = (): void => {}
const ready = new Promise<void>((resolve) => {
  markReady = resolve
})

/**
 * Whether cloud backup can work here at all, and if not, which of the two reasons it is.
 *
 * Both non-ready states are shown to the user as a greyed-out card rather than hidden, so
 * that somebody running a fork or a local copy is told why the feature is inert instead of
 * discovering it by tapping a button that leads to a Dropbox error page.
 */
export type Availability = 'ready' | 'no-key' | 'wrong-address'

export function availability(): Availability {
  if (!api.isConfigured()) return 'no-key'
  return matchRedirectUri(location.href) ? 'ready' : 'wrong-address'
}

/** The address this copy is running at, for explaining a `wrong-address` verdict. */
export function currentAddress(): string {
  return location.origin + location.pathname.replace(/index\.html$/, '')
}

/**
 * The exact registered URI to hand Dropbox, or null when this address is not one.
 *
 * Deliberately the string from the allow-list rather than one rebuilt from `location`:
 * Dropbox compares `redirect_uri` byte for byte against what is registered.
 */
function redirectUri(): string | null {
  return matchRedirectUri(location.href)
}

/* -------------------------------------------------------------------- the round trip */

/**
 * Take the OAuth result out of the URL, before anything else looks at it.
 *
 * CALLED FROM main.js INSIDE THE BOOTLOADER WATCHDOG WINDOW, so it is synchronous, does no
 * work worth speaking of, and cannot throw -- an exception above `signalReady()` gets a
 * perfectly healthy build rolled back. The token exchange it enables is a network call and
 * happens later, from `init()`.
 *
 * The code arrives as a real query string, before the `#`, so hash routing never sees it.
 * Stripping it matters: authorisation codes are single-use, and leaving one in the URL
 * means a reload retries it and fails.
 */
export function captureRedirect(): void {
  try {
    const params = new URLSearchParams(location.search)
    const code = params.get('code')
    const returned = params.get('state')

    if (code && returned) pending = { code, state: returned }
    if (!code && !params.has('error')) return

    // Preserve history.state as-is: vue-router reads `back` off it to decide whether the
    // in-app close button can safely be a history.back().
    history.replaceState(history.state, '', location.pathname + location.hash)
  } catch {
    pending = null
  }
}

function clearPending(): void {
  pending = null
  try {
    localStorage.removeItem(VERIFIER_KEY)
    localStorage.removeItem(STATE_KEY)
    localStorage.removeItem(STARTED_KEY)
  } catch {
    /* private mode; nothing to clear */
  }
}

/**
 * Did a sign-in start recently and never come back?
 *
 * This is the iOS canary. An installed PWA may not return from an external redirect at
 * all, and this device cannot be tested here -- so rather than leaving the user tapping a
 * button that silently does nothing, the marker left behind before the redirect is proof
 * enough to say so plainly and point at the export that does work.
 */
function detectLostRoundTrip(): void {
  let started: string | null = null
  try {
    started = localStorage.getItem(STARTED_KEY)
  } catch {
    return
  }
  if (!started) return

  const age = Date.now() - Number(started)
  if (age >= 0 && age < ROUND_TRIP_MS) cloud.error = LOST_ROUND_TRIP
  clearPending()
}

/**
 * Send the browser to Dropbox.
 *
 * A full-page navigation, never a popup: popups do not open in an installed iOS PWA, and
 * since iOS 17.5 an OAuth popup cannot talk back to its opener anyway.
 */
export async function beginConnect(): Promise<void> {
  // Belt and braces: the UI already disables the control when this is not 'ready', and
  // sending the user to Dropbox from an unregistered address strands them on an error page
  // that is not ours and that they cannot act on.
  const registered = availability() === 'ready' ? redirectUri() : null
  if (!registered) return
  cloud.error = ''

  try {
    const verifier = createVerifier()
    const stateValue = createState()
    const challenge = await challengeFor(verifier)

    localStorage.setItem(VERIFIER_KEY, verifier)
    localStorage.setItem(STATE_KEY, stateValue)
    localStorage.setItem(STARTED_KEY, String(Date.now()))

    location.assign(api.authorizeUrl(challenge, stateValue, registered))
  } catch {
    cloud.error = 'Could not start Dropbox sign-in on this device'
  }
}

/** Trade the captured code for tokens. Resolves either way; failures land in `cloud.error`. */
async function completeConnect(): Promise<void> {
  if (!pending) return

  let verifier: string | null = null
  let expected: string | null = null
  try {
    verifier = localStorage.getItem(VERIFIER_KEY)
    expected = localStorage.getItem(STATE_KEY)
  } catch {
    /* handled below */
  }

  // A code with no verifier, or a state that does not match the one we generated, is not
  // ours: a stale bookmark, a second tab, or something crafted. Refuse it silently.
  if (!verifier || !expected || expected !== pending.state) {
    clearPending()
    return
  }

  // The same registered string the authorisation request was made with; Dropbox rejects
  // the exchange if the two differ at all.
  const registered = redirectUri()
  if (!registered) {
    clearPending()
    return
  }

  const code = pending.code
  clearPending()
  cloud.busy = true

  try {
    const tokens = await api.exchangeCode(code, verifier, registered)
    if (!tokens.refreshToken) {
      cloud.error = 'Dropbox did not grant offline access'
      return
    }

    // Display only, and not worth failing the connection over.
    let email = ''
    try {
      email = await api.currentAccount(tokens.accessToken)
    } catch {
      /* ignored */
    }

    accessToken = tokens.accessToken
    accessExpiry = tokens.expiresAt
    await connection.connect(tokens.refreshToken, email)
  } catch (err) {
    cloud.error = messageFor(err)
  } finally {
    cloud.busy = false
  }
}

/* ------------------------------------------------------------------------------ auth */

function messageFor(err: unknown): string {
  return err instanceof CloudError ? err.message : 'Cloud backup failed'
}

async function currentToken(): Promise<string> {
  if (accessToken && Date.now() < accessExpiry) return accessToken

  const refresh = connection.getRefreshToken()
  if (!refresh) throw new CloudError('auth', 'Not connected to Dropbox')

  const tokens = await api.refreshAccessToken(refresh)
  accessToken = tokens.accessToken
  accessExpiry = tokens.expiresAt
  return accessToken
}

/**
 * Run something with a live token, retrying once if the token turns out to be dead.
 *
 * An access token can be rejected before its stated expiry -- the user revoked the app, or
 * the clock is off -- so a single 401 is worth one forced renewal before giving up.
 */
async function withToken<T>(fn: (token: string) => Promise<T>): Promise<T> {
  // Never act on "not connected" before that has been read back off disk.
  await ready

  // Outside the try on purpose: a refresh that fails has already told us the credential is
  // dead, and retrying it just asks the same question twice.
  const token = await currentToken()
  try {
    return await fn(token)
  } catch (err) {
    if (!(err instanceof CloudError) || err.kind !== 'auth') throw err
    accessToken = ''
    accessExpiry = 0
    return fn(await currentToken())
  }
}

/* --------------------------------------------------------------------------- backups */

/**
 * The exact bytes uploaded, and the hash that decides whether to bother.
 *
 * The hash covers `state.lists` and NOT the export payload: `buildExport` stamps
 * `exportedAt`, so hashing its output would differ every single call and the "nothing
 * changed" check would never once be true.
 */
async function currentSnapshot(): Promise<{ payload: string; hash: string }> {
  const lists = state.lists
  return { payload: buildExport(lists), hash: await hashLists(JSON.stringify(lists)) }
}

async function runBackup(force: boolean): Promise<void> {
  if (!cloud.connected || cloud.busy) return

  const { payload, hash } = await currentSnapshot()
  if (
    !force &&
    !isDue({ hash, lastHash: connection.getLastBackupHash(), lastAt: cloud.lastBackupAt, now: Date.now() })
  ) {
    return
  }

  cloud.busy = true
  try {
    await withToken(async (token) => {
      await api.upload(token, '/' + backupFileName(), payload)

      // Pruning is a courtesy, not part of the backup. A failure here has already left the
      // new snapshot safely uploaded, so it must not report the backup as failed.
      try {
        const names = (await api.listFolder(token)).map((f) => f.name)
        for (const name of prunable(names)) await api.deleteFile(token, '/' + name)
      } catch {
        /* ignored */
      }
    })
    await connection.recordBackup(hash, Date.now())
  } catch (err) {
    cloud.error = messageFor(err)
  } finally {
    cloud.busy = false
  }
}

/**
 * Explicit "Back up now": ignores the interval, but still skips if nothing changed.
 *
 * Resolves even when it fails, like every exported entry point here -- see rule 1. The
 * shell's prelude turns an unhandled rejection into a bootloader error report, so a
 * cloud failure that escaped would be capable of rolling the app back.
 */
export async function backupNow(): Promise<void> {
  cloud.error = ''
  try {
    await runBackup(true)
  } catch {
    cloud.error = 'Cloud backup failed'
  }
}

/**
 * The automatic path. Cheap and silent when nothing is due.
 *
 * Called on start and whenever the app becomes visible again -- NOT on pagehide, where a
 * network call cannot be awaited and would be cut off mid-flight. On a phone, coming back
 * to the app is frequent enough that this is the practical equivalent, and anything missed
 * is caught by the next launch.
 */
export async function maybeBackup(): Promise<void> {
  try {
    await runBackup(false)
  } catch {
    /* rule 1: silent, and never a rejected promise */
  }
}

export async function listBackups(): Promise<RemoteFile[]> {
  const files = await withToken((token) => api.listFolder(token))
  return files.sort((a, b) => b.modified - a.modified)
}

export function fetchBackup(path: string): Promise<string> {
  return withToken((token) => api.download(token, path))
}

export async function disconnect(): Promise<void> {
  accessToken = ''
  accessExpiry = 0
  await connection.disconnect()
}

/* ------------------------------------------------------------------------------ init */

/**
 * Everything asynchronous, run once after mount.
 *
 * Never awaited by anything on the critical path: the app is fully usable before this
 * resolves, and if it never resolves at all nothing else notices.
 */
export async function init(): Promise<void> {
  // Nothing is restored and nothing is uploaded from an address that could not have signed
  // in here in the first place, so a copy running elsewhere is completely inert.
  if (availability() !== 'ready') {
    markReady()
    return
  }

  try {
    await connection.restore()

    if (pending) await completeConnect()
    else detectLostRoundTrip()
  } catch {
    /* by rule 1: nothing here reaches the app */
  } finally {
    // BEFORE the first backup, and unconditionally. `withToken` waits on this, and
    // `maybeBackup` goes through `withToken` -- releasing it afterwards would deadlock the
    // very call below, and releasing it only on success would hang the restore dialog
    // forever on a device that failed to read its own IndexedDB.
    markReady()
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void maybeBackup()
  })

  await maybeBackup()
}

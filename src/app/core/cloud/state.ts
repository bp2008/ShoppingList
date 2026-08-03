/**
 * Connection state: what the UI renders, and what survives a relaunch.
 *
 * THE REFRESH TOKEN IS NOT IN THE REACTIVE OBJECT. It is a long-lived credential, and
 * anything in `cloud` is one careless `{{ }}` or one devtools glance away from being on
 * screen. Keeping it in a module-scoped variable means the only way to read it is to call
 * for it deliberately.
 *
 * None of this lives in `PersistedDoc`. Two reasons, both load-bearing: the `doc` key is a
 * contract shared with shell/rescue.js and shell/reset.html, and touching its shape would
 * mean a schema migration for a field that is not user data at all; and this is
 * device-local, so it must never travel inside an export.
 */

import { reactive } from 'vue'
import { loadCloud, saveCloud } from '../persist'

/** What the Settings card binds to. Safe to render in full. */
export interface CloudView {
  /** Whether a refresh token is held. Not a claim that it still works. */
  connected: boolean
  accountEmail: string
  lastBackupAt: number | null
  /** A backup or restore is in flight. */
  busy: boolean
  /** User-facing failure text, or '' when there is nothing to say. */
  error: string
}

export const cloud = reactive<CloudView>({
  connected: false,
  accountEmail: '',
  lastBackupAt: null,
  busy: false,
  error: '',
})

/** The persisted half. `provider` exists so a second provider could be told apart later. */
interface StoredCloud {
  provider: 'dropbox'
  refreshToken: string
  accountEmail: string
  lastBackupAt: number | null
  lastBackupHash: string | null
}

let refreshToken = ''
let lastBackupHash: string | null = null

export function getRefreshToken(): string {
  return refreshToken
}

export function getLastBackupHash(): string | null {
  return lastBackupHash
}

function snapshot(): StoredCloud {
  return {
    provider: 'dropbox',
    refreshToken,
    accountEmail: cloud.accountEmail,
    lastBackupAt: cloud.lastBackupAt,
    lastBackupHash,
  }
}

/** Best effort by design: failing to remember the connection must not break the app. */
async function persist(): Promise<void> {
  try {
    await saveCloud(snapshot())
  } catch {
    /* ignored */
  }
}

/** Read whatever a previous session left. Never throws. */
export async function restore(): Promise<void> {
  let raw: unknown
  try {
    raw = await loadCloud()
  } catch {
    return
  }
  if (!raw || typeof raw !== 'object') return

  const stored = raw as Partial<StoredCloud>
  if (typeof stored.refreshToken !== 'string' || stored.refreshToken === '') return

  refreshToken = stored.refreshToken
  lastBackupHash = typeof stored.lastBackupHash === 'string' ? stored.lastBackupHash : null
  cloud.accountEmail = typeof stored.accountEmail === 'string' ? stored.accountEmail : ''
  cloud.lastBackupAt = typeof stored.lastBackupAt === 'number' ? stored.lastBackupAt : null
  cloud.connected = true
}

export async function connect(token: string, email: string): Promise<void> {
  refreshToken = token
  cloud.accountEmail = email
  cloud.connected = true
  cloud.error = ''
  await persist()
}

/**
 * Forget everything local. Deliberately does NOT delete the backups.
 *
 * Disconnecting is how a user stops this device syncing, not how they destroy their
 * history -- the snapshots are in their own Dropbox and are theirs to keep.
 */
export async function disconnect(): Promise<void> {
  refreshToken = ''
  lastBackupHash = null
  cloud.connected = false
  cloud.accountEmail = ''
  cloud.lastBackupAt = null
  cloud.error = ''
  await persist()
}

export async function recordBackup(hash: string, at: number): Promise<void> {
  lastBackupHash = hash
  cloud.lastBackupAt = at
  cloud.error = ''
  await persist()
}

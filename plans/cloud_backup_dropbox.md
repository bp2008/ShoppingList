# Cloud backup to Dropbox

## Context

Shopping List stores everything in IndexedDB on one device. The README is explicit that
this means there is no backup, and the only migration path to a new phone is exporting
JSON by hand. That is the gap this closes: **automatic off-device backups, and a manual
restore** for a new device. It is deliberately *not* two-way sync.

Dropbox is the provider because it is the only mainstream cloud storage that issues a
**long-lived refresh token to a browser-only PKCE client**. Google and Microsoft both cap
browser credentials (Google issues no refresh token at all; Microsoft's SPA refresh tokens
die after 24h), which for an app opened once a week means an interactive sign-in almost
every session. Dropbox is the only one where "automatic" is honest. No backend is
required, so GitHub Pages static hosting is preserved.

**First step when executing: copy this plan to `plans/cloud_backup_dropbox.md`** so it
lives with the repo's other design docs.

## Scope

In: automatic snapshot upload, retention of the last N snapshots, manual restore, connect
and disconnect, status display.
Out: two-way sync, conflict resolution, per-list sync, sharing, any second provider.

## One-time Dropbox console setup (manual, before coding)

At <https://www.dropbox.com/developers/apps>, with any free Dropbox account:

| Field | Value |
| --- | --- |
| API | Scoped access |
| Access type | **App folder** — confines the app to `Apps/<name>/` |
| App name | **`Shopping List by bp2008`** |
| Permissions | `files.content.write`, `files.content.read`, `account_info.read` |
| Redirect URIs | `https://bp2008.github.io/ShoppingList/` and `http://localhost:5173/` |

The name is effectively permanent — the console has no rename, and it is visible both on
the consent screen and as the folder name in the user's Dropbox. The console rejects names
already taken globally, so verify it is available before anything else.

Only the **app key** is needed. No app secret: PKCE replaces it, which is why this works
from static hosting at all. Dropbox's own [`pkce-browser`
example](https://github.com/dropbox/dropbox-sdk-js/tree/main/examples/javascript/pkce-browser)
confirms the browser-side token exchange (app key only, `offline` access requested).

The app stays in Development status until it links 50 users; production approval is a form
(description, icon, branding compliance) and only becomes relevant at that point.

## Architecture

### New files — `src/app/core/cloud/` (TypeScript, type-checked, per the `core/` convention)

| File | Responsibility |
| --- | --- |
| `pkce.ts` | Verifier/challenge generation via `crypto.subtle`. Pure, unit-tested. |
| `dropbox.ts` | Raw `fetch` against six Dropbox endpoints; token exchange and refresh. |
| `backup.ts` | Policy only: is a backup due, what to name it, what to prune. Pure, unit-tested. |
| `state.ts` | Reactive connection state + its own IndexedDB persistence. |
| `index.ts` | The orchestration the UI calls: `connect()`, `disconnect()`, `backupNow()`, `listBackups()`, `fetchBackup()`, `maybeBackup()`. |

**No Dropbox SDK.** The app has three runtime dependencies and a strong minimalism ethos;
six `fetch` calls are ~120 lines and avoid a large dependency in the offline bundle.

Endpoints used: `oauth2/token` (exchange + refresh), `2/files/upload`,
`2/files/list_folder`, `2/files/download`, `2/files/delete_v2`,
`2/users/get_current_account`. With App folder access, `/backup-x.json` is already
relative to the app folder root.

### New component

`src/app/components/CloudRestoreDialog.vue` — lists snapshots (name, date, size), user
picks one, it downloads and hands the text to the **existing** import machinery.

### Modified files

| File | Change |
| --- | --- |
| `src/app/core/persist.ts` | Add `loadCloud()` / `saveCloud()` against a new `cloud` key. `DOC_KEY` untouched. |
| `src/app/main.js` | Capture the OAuth redirect **synchronously** before `createAppRouter()`. |
| `src/app/ui/navigation.js` | Add `cloud-restore` to the `DIALOGS` set. |
| `src/app/components/Dialogs.vue` | Dispatch `cloud-restore`. |
| `src/app/components/SettingsSheet.vue` | New "Cloud backup" card under "Your data". |
| `vite.config.js` | `define: { __DROPBOX_APP_KEY__: JSON.stringify(process.env.DROPBOX_APP_KEY ?? '') }` |

## Key design decisions

**1. Reuse the export format verbatim.** The uploaded payload is `buildExport(state.lists)`
from [transfer.ts:33](src/app/core/transfer.ts:33). Restore runs the downloaded text
through `parseTransfer()` and then the existing choose-what-to-import stage and
`store.applyImport()`. No new format, no new migration surface, no new undo semantics — a
restore is one `commit()` and therefore one undo away, exactly like a file import. It also
means a cloud snapshot is byte-identical to a manual export and can be recovered by hand.

**2. Hash `JSON.stringify(state.lists)`, never the export payload.** `buildExport` stamps
`exportedAt`, so hashing its output would differ on every call and defeat change detection
entirely. Hash the same thing `commit()` snapshots.

**3. Cloud state lives under a new IndexedDB key, not in `doc`.** Adding it to
`PersistedDoc` would touch the `slp-data`/`kv`/`doc` contract shared with `rescue.js` and
`reset.html` — [the single most important safety property in the
project](DEVELOPING.md:511) — and force a schema migration. It is also device-local: a
refresh token must never travel inside an export. Shape:

```ts
interface CloudState {
  provider: 'dropbox'
  refreshToken: string          // long-lived, at rest in IndexedDB
  accountEmail?: string         // display only
  lastBackupAt: number | null
  lastBackupHash: string | null
  lastError: string | null
}
```

The access token is held **in memory only** and re-derived from the refresh token on
demand.

**4. The redirect must not endanger boot.** `main.js` runs inside the bootloader watchdog
window — nothing above `signalReady()` may throw or a healthy build gets rolled back. So
split it: the **capture** is synchronous, trivial, and wrapped in `try/catch` (read
`location.search`, stash the code, `history.replaceState` to strip it); the **token
exchange** is a network call fired after mount. Nothing cloud-related ever goes through
`criticalSection()` or reaches `__bootFail`.

The code arrives as a real query string *before* the `#`, so hash routing never sees it and
`syncUi()` is unaffected. The service worker serves the cached shell for any navigation
regardless of query ([sw.js:96](src/shell/sw.js:96)), so the redirect lands correctly even
offline-first.

**5. PKCE verifier in `localStorage`, not `sessionStorage`.** The Dropbox example uses
`sessionStorage`, which is the more fragile choice across an external redirect. Full-page
redirect throughout — no popups, no `window.opener` dependency.

**6. Backup cadence.** Due when the lists hash differs from `lastBackupHash` **and** ≥6h
since `lastBackupAt`. Checked on app start (after mount), on `visibilitychange → visible`,
and on a ~2 minute debounce after a commit. **Never on `pagehide`** — a network call cannot
be awaited there. A manual "Back up now" ignores the timer. Every failure is swallowed into
`lastError` and shown as a status line; a cloud failure must never surface as an app error
or block a save.

**7. Retention.** Files named `backup-YYYY-MM-DD-HHmm.json`, keeping the newest 10 and
deleting the rest after a successful upload.

**8. App key is a committed constant, defaulting to empty.** When `__DROPBOX_APP_KEY__` is
`''` the entire cloud UI is compiled out, which is the right default for a fork.

The key is **tracked in `vite.config.js`, not hidden in a `.env`.** It is a public client id:
there is no app secret in this project (PKCE replaces it), and the key ships in readable
JavaScript inside `docs/releases/<buildId>/assets/*.js`, which is tracked — so it is in git
either way. An ignored file would hide it from nobody while guaranteeing that a fresh clone
or a second machine silently builds a release with cloud backup missing and no error.

What actually stops another site from using the key is the registered redirect URI list in
the Dropbox console, not the key's secrecy. An environment/`.env` override exists for
testing against a throwaway app, and the build warns on stderr when one is in effect.

## The iOS problem, and the fallback

There is no iPhone available to test on, and an installed iOS PWA may not complete an
external OAuth redirect back into the app. The design mitigates by construction (full-page
redirect, no popup, no `window.opener`, verifier in `localStorage`), but it ships untested
on that platform.

So the flow **detects its own failure**: before redirecting, write a
`slp.cloud.pending` marker with a timestamp. On boot, if there is no `code` in the URL but
a marker under 10 minutes old exists, the round trip was lost — clear it and show:

> Sign-in didn't finish. Cloud backup may not work in the installed app on this device —
> use **Export lists…** to save a copy instead.

Note the message must **not** suggest retrying in Safari: on iOS a Home Screen web app has
storage separate from Safari, so connecting there would not carry into the installed app.

Ship it, and treat any iPhone report as the confirmation this can't be gathered locally.

## Documentation to update

Four places currently assert something that stops being true:

- [README.md:44](README.md:44) — "no account, no server, and nothing is sent anywhere"
- [README.md:70](README.md:70) — "**No sync.** One device at a time"
- [Dialogs.vue:188](src/app/components/Dialogs.vue:188) — About dialog, same claim
- [SettingsSheet.vue:120](src/app/components/SettingsSheet.vue:120) — "an export is the only backup there is"

Also add the `cloud` key to the **Storage reference** table in
[DEVELOPING.md:616](DEVELOPING.md:616), and a short section covering the Dropbox setup and
the untested-on-iOS status.

## Verification

1. `npm run check` and `npm test` clean. New unit tests: `pkce.test.ts` (challenge derived
   correctly, verifier length/charset) and `backup.test.ts` (due/not-due matrix, retention
   pruning keeps exactly the newest 10, filename formatting).
2. Set the `DROPBOX_APP_KEY` constant in `vite.config.js`, `npm run dev`, then end-to-end
   against a real Dropbox account:
   connect → verify `Apps/Shopping List by bp2008/` appears with a snapshot → edit a list,
   confirm a second snapshot after the interval → restore on a profile with different data
   and confirm the merge/overwrite choice and that one undo reverts it.
3. Confirm the feature is fully hidden when `DROPBOX_APP_KEY` is unset.
4. Confirm backups still contain valid export JSON by pasting one into **Import lists…**.
5. Disconnect clears the refresh token and stops uploads; re-connect works.
6. **`npm run build` must report an unchanged `shell` hash.** All changes are under
   `src/app/**`, so `sw.js` and the bootloader must stay byte-identical — a changed shell
   here means the design has regressed.
7. Airplane mode: app starts, saves, and operates normally with cloud calls failing
   silently into the status line.

## Risks

- **iOS redirect** — unverifiable locally; mitigated by detection and an honest fallback.
- **Refresh token at rest in IndexedDB** — a long-lived credential on the device. Scoped to
  one app folder, and disconnect revokes locally; acceptable, but it is a real change in
  the app's security posture and should be stated in the docs.
- **Registered redirect URIs pin the deployment.** The app is deliberately path-independent
  ("one artifact, any URL"), but OAuth requires exact registered URIs, so cloud backup only
  works at the production and localhost URLs. Staging will not have it.

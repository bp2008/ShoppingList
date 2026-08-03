# Shopping List

A shopping list app that is easy to install and works offline.

**[Open Shopping List →](https://bp2008.github.io/ShoppingList/)**

## Installing

Open the link above, then:

- **Android (Chrome)** — menu → *Add to Home screen* / *Install app*
- **iOS (Safari)** — Share → *Add to Home Screen*
- **Desktop (Chrome/Edge)** — the install icon at the right of the address bar

Installing gets you a normal-looking app and home screen icon. It works from the browser
too if you prefer, offline capability included.

---

## The idea

Most list apps make you retype "milk" every week or dig through unordered lists of checked-off items to add them back. This app is different: it has two columns:

- **A catalog** — everything you might ever buy at that shop. Always sorted alphabetically.
- **A list** — what you need *this* trip.  Mange your list by dragging items in and out of the catalog.

So the weekly routine is dragging a handful of names from the right column to the left,
not typing them.  Drag them back to the right to remove them from your list.  The catalog 
keeps them for next time.

Each shopping list has its own catalog, so "Groceries" and "Hardware" don't get tangled. If you do
want an item that lives on another list, turn on **Show catalog items from other lists**
and it appears in a *From other lists* section, ready to drag over. Dragging it copies it
into this list's catalog, leaving the original alone.

## Works without an internet connection

The app is installable and usable fully offline. Once you have opened it, it does not need the
network again — not to start, not to load, not to save.  Updates are automatic and are 
handled carefully with the ability to roll back if you get a bad update.

## Privacy

Your shopping lists and settings are stored in your web browser's sandboxed storage.  Nothing leaves your device unless you want it to.

Clearing your browser's site data for `bp2008.github.io` deletes your shopping lists.  Back them up first if you care about them.

## Cloud backup (recommended)

This app cannot store files on your device in a way that is backed up automatically by Android or iOS.  Your shopping lists are stored in your web browser's sandboxed internal storage, which is typically not backed up or synchronized between devices.

**[[Dropbox]](https://www.dropbox.com/)** is the only supported cloud backup service, because they have a simple API that works well with a serverless Progressive Web App like this one.  It is free to sign up for Dropbox, and this app requires very little storage space.

 **Settings → Cloud backup → Connect
Dropbox** signs you in once; after that the app quietly saves a snapshot to a folder of its
own — `Apps/Shopping List by bp2008/` — whenever your lists have changed and it has been a
few hours since the last backup. The last 60 backups are kept.

It is a backup, not two-way sync.  Restoring a backup must be performed via the **Restore…** button.

The snapshots stored in Dropbox are ordinary JSON-formatted export files. You can open one in your Dropbox and read it, or
paste it into **Import lists…** by hand if you'd like to restore on a device that isn't connected to your Dropbox account.

Disconnecting from dropbox forgets the account on this device and does not delete any backups from Dropbox.

The app can only see its own folder, never the rest of your Dropbox.

If you are running your own copy of this project rather than the link at the top of this page, cloud
backup will show greyed out and explain why it is disabled. Dropbox only accepts sign-in from addresses
registered against the app, so a copy served from anywhere else cannot use it — you would
need your own Dropbox app key and your own address in `REDIRECT_URIS`. Export and import work
normally either way.

## Import / Export

**Settings → Your data** can manually import and export any or all of your shopping lists.

You can also import and export items from individual lists as simple plain text.  For example this makes it easy to migrate a list from Google Keep to this Shopping List app.

## Known feature gaps

- **Accessibility.** Dragging is currently the only way to move items, so the app cannot be
  used with a keyboard or a screen reader. This is the biggest gap and it is understood.
- **No sync.** Cloud backup copies this device's lists *up*; it never automatically syncs or merges two devices.
  Moving to a new phone requires a restore operation, done once, by hand.
- **Cloud backup is untested on iPhone.** The sign-in to Dropbox leaves the app and comes back, which
  is untested on an installed progressive web app on iOS. If it fails there, the app says so and points
  you at export; everything else works as normal.

## Building it yourself

Requires Node 20 or newer.

```bash
npm install && npm run build
```

Full technical documentation — architecture, the update and recovery model, and the
build / stage / release procedures — is in **[DEVELOPING.md](DEVELOPING.md)**.

## License

[GNU General Public License v3.0](LICENSE).

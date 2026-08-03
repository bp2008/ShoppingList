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

The app is installable and fully offline. Once you have opened it, it does not need the
network again — not to start, not to load, not to save.  Updates are automatic and are 
handled carefully with the ability to roll back if you get a bad update.

## Your data

Everything is stored on your device. There is no server of ours anywhere in the picture,
and by default nothing leaves the phone at all.

**Settings → Your data** has import and export:

- **Export lists…** — tick the lists you want, then copy them to the clipboard or save
  them as a JSON file.
- **Import lists…** — paste, or load a file, then tick what to bring in. If a list you are
  importing has the same name as one you already have, you choose: **merge** adds whatever
  is missing and changes nothing else, **overwrite** replaces that list entirely. Either
  way it is one undo away.

On a list, the menu also has **Add items from text…**, for pasting a plain list of names —
one per line. A Google Keep checklist pastes in as-is: `[ ]` and `[X]` are understood, and
anything already ticked goes into the catalog without joining your list. It only ever adds;
nothing is removed and no quantity changes. **Copy list as text** is the other direction,
putting a shopping list on the clipboard in a form you can paste into a message.

Uninstalling the app, or clearing your browser's site data, deletes your lists. Export
first if you care about them.

## Cloud backup

Optional, off until you turn it on, and Dropbox only. **Settings → Cloud backup → Connect
Dropbox** signs you in once; after that the app quietly saves a snapshot to a folder of its
own — `Apps/Shopping List by bp2008/` — whenever your lists have changed and it has been a
few hours since the last one. The last ten are kept.

It is a backup, not sync. Nothing is ever pulled down on its own: **Restore…** lists your
snapshots, and picking one hands it to the same import screen a pasted file would go
through, so you still choose which lists to bring in and whether to merge or overwrite —
and it is still one undo away.

The snapshots are ordinary export files. You can open one in your Dropbox and read it, or
paste it into **Import lists…** by hand if you would rather not use the restore screen.
Disconnecting forgets the account on this device and leaves every snapshot where it is.

The app can only see its own folder, never the rest of your Dropbox.

If you are running your own copy of this project rather than the link at the top, cloud
backup will show greyed out and say so. Dropbox only accepts sign-in from addresses
registered against the app, so a copy served from anywhere else cannot use it — you would
need your own Dropbox app and your own address in `REDIRECT_URIS`. Export and import work
normally either way.

## Known feature gaps

- **Accessibility.** Dragging is currently the only way to move items, so the app cannot be
  used with a keyboard or a screen reader. This is the biggest gap and it is understood.
- **No sync.** Cloud backup copies this device's lists *up*; it never merges two devices.
  Moving to a new phone is a restore, done once, by hand.
- **Cloud backup is untested on iPhone.** The sign-in leaves the app and comes back, which
  an installed iOS web app may not survive. If it fails there the app says so and points
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

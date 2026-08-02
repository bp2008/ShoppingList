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

Everything is stored on your device. There is no account, no server, and nothing is sent
anywhere.

That also means there is no automatic backup, so the menu has **Import / export data**:
your lists as plain JSON that you can copy, save to a file, and paste back in later or on
another device. **Copy list as text** puts a shopping list on the clipboard in a form you
can paste into a message.

Uninstalling the app, or clearing your browser's site data, deletes your lists. Export
first if you care about them.

## Known feature gaps

- **Accessibility.** Dragging is currently the only way to move items, so the app cannot be
  used with a keyboard or a screen reader. This is the biggest gap and it is understood.
- **No sync.** One device at a time, unless you move JSON around by hand.

## Building it yourself

Requires Node 20 or newer.

```bash
npm install && npm run build
```

Full technical documentation — architecture, the update and recovery model, and the
build / stage / release procedures — is in **[DEVELOPING.md](DEVELOPING.md)**.

## License

[GNU General Public License v3.0](LICENSE).

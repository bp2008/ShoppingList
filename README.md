# Shopping List

A shopping list you can use in a shop — including the aisle at the back with no signal.

**[Open Shopping List →](https://bp2008.github.io/ShoppingList/)**

> **Status: early.** Version 0.1.0. The app works, but it has not had a real shopping trip
> yet, and it is not yet usable without a touchscreen or mouse — see
> [Known gaps](#known-gaps).

---

## The idea

Most list apps make you retype "milk" every week. This one separates the two things you
actually do:

- **A catalog** — everything you might ever buy at that shop. You build it once, and it
  stays.
- **A list** — what you need *this* trip. You drag items across from the catalog.

So the weekly routine is dragging a handful of names from the right column to the left,
not typing them. When you get home, drag them back off — the catalog keeps them for next
time.

Each list has its own catalog, so "Groceries" and "Hardware" don't get tangled. If you do
want an item that lives on another list, turn on **Show catalog items from other lists**
and it appears in a *From other lists* section, ready to drag over. Dragging it copies it
into this list's catalog, leaving the original alone.

## Using it

The whole screen is two columns, side by side, at every screen size: **your list** on the
left, **the catalog** on the right. Both columns' drag handles sit against the middle, so
moving an item across is a short thumb movement rather than a swipe across the phone.

| To do this | Do that |
| --- | --- |
| Add something to your list | Drag it from the catalog to the left column |
| Set a quantity | Drag it across again, or tap the `×2` badge |
| Reorder your list | Drag a row up or down within the left column |
| Take something off the list | Drag it to the right column — the catalog keeps it |
| Add a brand new item | Tap **+** |
| Tidy up the catalog | Menu → **Remove items from catalog…** |

If drag handles are turned off, or your screen is very narrow, press and hold a row for a
moment to pick it up instead.

**Everything is undoable.** The menu's Undo and Redo buttons name the exact thing they
will reverse — "Removed *Milk*", "Deleted 3 catalog items" — and the last 50 actions are
kept. Deleting a whole list is undoable too.

## Works without a signal

The app is installable and fully offline. Once you have opened it, it does not need the
network again — not to start, not to load, not to save.

Updates are handled carefully, because a shop is exactly where you don't want an app to
break:

- A new version downloads **completely, in the background**, while you keep using the old
  one. A dropped connection halfway through changes nothing — it simply tries again later.
- Switching to the new version happens **entirely on your device**, with no network
  involved at all.
- If a version turns out to be broken, the app **notices and goes back** to the last one
  that worked, on its own.
- If everything goes wrong, a plain recovery screen appears with an **Export my lists**
  button that works even when nothing else does.

## Your data

Everything is stored on your device. There is no account, no server, and nothing is sent
anywhere.

That also means there is no automatic backup, so the menu has **Import / export data**:
your lists as plain JSON that you can copy, save to a file, and paste back in later or on
another device. **Copy list as text** puts a shopping list on the clipboard in a form you
can paste into a message.

Uninstalling the app, or clearing your browser's site data, deletes your lists. Export
first if you care about them.

## Installing

Open the link above, then:

- **Android (Chrome)** — menu → *Add to Home screen* / *Install app*
- **iOS (Safari)** — Share → *Add to Home Screen*
- **Desktop (Chrome/Edge)** — the install icon at the right of the address bar

Installing gets you a normal-looking app with no browser chrome. It works from the browser
too, offline included.

## Settings

- **Appearance** — Light, OLED black, or follow the system. OLED black is true black, so
  it actually saves power on an OLED phone.
- **Minimum row height** — 32 to 60 pixels, for gloves or precision.
- **Show drag grips** — off gives you more room for long names; press and hold to drag.
- **Ask quantity on duplicate drag** — off makes a repeat drag just add one more.

## Known gaps

Honest list of what isn't done yet:

- **Accessibility.** Dragging is currently the only way to move items, so the app cannot be
  used with a keyboard or a screen reader. This is the biggest gap and it is understood.
- **No sync.** One device at a time, unless you move JSON around by hand.
- **Not yet road-tested.** It works, but it hasn't done a real shop.

## Building it yourself

Requires Node 20 or newer.

```bash
npm install && npm run build
```

Full technical documentation — architecture, the update and recovery model, and the
build / stage / release procedures — is in **[DEVELOPING.md](DEVELOPING.md)**.

## License

[GNU General Public License v3.0](LICENSE).

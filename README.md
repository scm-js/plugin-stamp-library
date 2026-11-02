# Stamp Library

A plugin for [scmJS](https://github.com/scm-js/scm-js), the browser-based StarCraft 1 /
Brood War map editor. It keeps pieces of terrain you want to use again (a ramp, a bridge with
its shores, a cliff corner, a mineral line) as named *stamps*. The stamps are kept in the
editor's storage, so they are there whatever map is open.

- Save the marked area, or the selected units, sprites, doodads or locations, as a stamp with
  a name, tags and a note.
- Click a stamp to lay it down. The piece follows the pointer, drawn with the map's own
  graphics. Each placement is one undo step.
- A piece copied from the isometric grid goes back down on the same grid, so a stamped ramp
  meets the cliffs around it the way the original did.
- Search, filter by tag, and sort the library.
- Export stamps to a JSON file, or copy one as a line of text to paste into a chat.

## Install

Stamp Library comes with scmJS. It is in the plugin list from the start, marked *default* and
turned on.

To add it by hand, open **Plugins ▸ Manage Plugins…**, paste

```
https://github.com/scm-js/plugin-stamp-library
```

and press **Add**. To pin a version, add a ref: `github:scm-js/plugin-stamp-library@v1.2.0`.

## Use

**Tools ▸ Stamp Library…** (`Ctrl+Shift+L`, or **Stamp Library…** on the map's right-click
menu) opens the Stamps panel. It floats over the map and can be dragged and resized. Press
**Dock** at the bottom to put it in the right dock with Minimap, Layers and Properties, and
**Float** to take it out again. The same choice is under
**Edit ▸ Preferences ▸ Plugins ▸ Stamp Library**.

### Saving a stamp

1. On the Cut / Copy / Paste layer, drag a rectangle around the piece.
2. Choose **Edit ▸ Save as Stamp…** (`Ctrl+Shift+K`), **Save area as stamp…** on the
   right-click menu, or **Save area…** in the panel.
3. Give it a name, and optionally tags (comma-separated) and a note. The picture at the top
   shows what you are saving. Press **Save**.

On the Units, Sprites, Doodads or Locations layer, the same commands save the selected
objects, as Ctrl+C would copy them. The panel's button then reads **Save selection…**.
**Save clipboard…** saves whatever Ctrl+C last copied, from this map or another.

A stamp keeps everything inside the rectangle: terrain, doodads, units, sprites, locations
and fog. You choose which parts to lay down when you use it.

### Laying one down

Click a card. The panel shows the stamp's details and options. On the map, the piece follows
the pointer inside a dashed outline, which turns red when part of it would fall off the map.
The status bar says what a click will do.

Click to lay the stamp down, as many times as you like. Press Esc, right-click, or click the
card again to stop.

The options under the details:

- **Add to what is there** lays the stamp over the map. **Replace the area's objects** first
  removes the units, sprites and doodads inside the rectangle. Locations are never removed.
- **Keep isometric alignment** places the piece only on the same isometric grid it was
  copied from (every second tile each way). Hold Shift while clicking to place it anywhere
  for one click. A stamp saved from selected objects is never snapped.
- The ticks after that are the stamp's parts. Untick **Units** to lay the ground without the
  minerals, or **Terrain** to place only the units. **Locations** and **Fog** start unticked.

Laying a stamp works like a paste. Units get new serial numbers, with add-on and nydus links
kept, and locations take free slots. The isometric data (ISOM) is not updated, so the
isometric brush may not work well on that ground until it is rebuilt.
**Tools ▸ Repair Map…** can rebuild it.

Terrain and doodads from another tileset are refused: a Jungle ramp stays a Jungle ramp.

### The library

Right-click a card, or press **More ▾**, for:

- **Edit name, tags and notes…**
- **Replace contents with the marked area**, for a better version of the same piece
- **Duplicate**
- **Copy as text**
- **Export to a file…**
- **Delete…**

The search box matches names, tags, notes and the tileset's name. Click a tag under it to
filter by that tag, and again to drop it. The sort menu orders stamps by newest, name, size
or most used. **This tileset only** hides stamps from other tilesets, and the panel says how
many are hidden.

### Sharing

**Export…** writes a JSON file of the whole library, the current search results, or the
selected stamp. **Import…** reads one back, and so does dropping the file onto the panel.
Stamps already in the library are matched by id and left alone unless you tick **Replace them with the file's version**.

**Copy as text** puts one stamp on the clipboard as a line of JSON. Paste it into a chat or a
forum post, and the other person adds it with **From text…**.

A file is a `{ "format": "scmjs-stamps", "version": 1 }` document with a `stamps` array. Each
stamp holds its tiles as base64 and its objects as JSON. One stamp or a hundred, the format is
the same.

### Where stamps are kept

Stamps are kept in the browser's storage for the editor's address. You can see and clear
them under **Edit ▸ Preferences ▸ Storage**. The editor has a few megabytes in all. A ramp
takes a kilobyte or two and a whole base about ten, so a library of hundreds fits.

If the browser refuses to save, the panel says so. The stamp is kept until the editor closes,
so export the library before then.

Browser storage is not a backup, and another browser or computer starts with an empty
library. Export the library now and then.

## Development

```sh
npm install
npm run typecheck
npm test
npm run build      # dist/plugin.js
npm run dev        # rebuild on change
```

| File | What it holds |
| --- | --- |
| `plugin.ts` | The panel, the dialogs, the stamping tool and the storage. |
| `library.ts` | The stamp model, the file format, search, sort, tags and the grid snap. Pure, tested. |
| `i18n.ts`, `ko.ts` | Translation helpers and the Korean strings. |
| `dist/plugin.js` | The bundle the editor loads. CI commits it on every push to `main`. |

To try local changes, serve this folder with CORS (`npx serve --cors .`), add
`http://localhost:3000/` in **Manage Plugins…**, and press **Reload** after each edit. A
plugin runs with the editor's own privileges. There is no sandbox.

Types come from [`@scm-js/plugin-api`](https://github.com/scm-js/plugin-api), a devDependency
generated from the editor's plugin contract. `npm update @scm-js/plugin-api` picks up the
newest version. This plugin needs `api.clipboard.capture`, `tx.paste` and
`api.graphics.renderClip` (plugin-api 1.17 or later). It is the worked example for those and
for `api.storage` in the [plugin guide](https://docs.scmjs.dev/plugins/).

## Licence

MIT. See [LICENSE](LICENSE).

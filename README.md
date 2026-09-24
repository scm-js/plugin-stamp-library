# Stamp Library

A plugin for [scmJS](https://github.com/jeany55/scm-js), the browser-based StarCraft 1 /
Brood War map editor. It keeps the pieces you build once and want again.

Anyone who works in extended terrain has a map somewhere that is really a parts bin: the
ramp that took an hour to get right, the bridge with its shores, the cliff corner the
isometric brush never draws, a mineral line laid out just so. Every new map starts with
opening that old one, marking the piece, copying, switching maps, pasting. This plugin
makes those pieces **stamps**: named, tagged, kept in the editor's own storage so they are
there whatever map is open, and laid down with one click and a preview under the pointer.

- **Save** the marked area (or the units, sprites, doodads or locations you have selected)
  as a stamp, with a name, tags and a note. Or save whatever is on the clipboard.
- **Stamp** it: click a card, move over the map — the piece hangs under the pointer, drawn
  with the map's own graphics — and click to lay it down. One undo step. Keep clicking to
  lay it down again; Esc or a right-click stops.
- **Keep it aligned.** A piece copied off the isometric lattice goes back down on the same
  lattice, so a stamped ramp meets the cliffs around it the way the original did. Shift
  while placing puts it anywhere.
- **Find it.** Search names, tags and notes; filter by tag with one click; show only the
  open map's tileset, or all of them; sort by newest, name, size or most used.
- **Share it.** Export the library, the current search or one stamp as a JSON file anyone
  can import (or drop onto the panel). Or *Copy as text* puts one stamp on the clipboard as
  a line of JSON to paste into a chat; the other side adds it with *From text…*.

## Install

In scmJS: **Plugins ▸ Manage Plugins…**, paste

```
https://github.com/scm-js/plugin-stamp-library
```

and press **Add**. It is normally already in that list, marked *default*; tick it on if it
is off. To pin a version, add a ref: `github:scm-js/plugin-stamp-library@v1.0.0`.

## Use

**Tools ▸ Stamp Library…** (also `Ctrl+Shift+L`, or *Stamp Library…* on the map's
right-click menu) opens the **Stamps** panel. It floats over the map and can be dragged
and resized; press **Dock** at its bottom to put it in the right dock with Minimap, Layers
and Properties instead, and **Float** to take it out again. The same choice is on the
plugin's page in **Edit ▸ Preferences ▸ Plugins ▸ Stamp Library**.

### Saving a stamp

1. On the **Cut / Copy / Paste** layer, drag a rectangle around the piece.
2. **Edit ▸ Save as Stamp…** (`Ctrl+Shift+K`), *Save area as stamp…* on the right-click
   menu, or **Save area…** in the panel.
3. Give it a name and, if you like, tags (comma-separated) and a note. The picture at the
   top is what you are saving. **Save**.

On the Units, Sprites, Doodads or Locations layer the same commands save the selected
objects instead of an area, as Ctrl+C would copy them. **Save clipboard…** saves whatever
Ctrl+C last copied, from this map or another.

A stamp holds everything the rectangle held — the terrain (both the picture and the ground
under the doodads), doodads, units, sprites, locations and fog — so you choose what to lay
down later, not what to keep now.

### Laying one down

Click a card. The panel shows the stamp's details and the stamping options; the map shows
the piece under the pointer with a dashed outline (red when part of it would fall off the
map) and the status bar says what a click will do. Click to lay it down, as many times as
you like. **Esc**, a right-click, or clicking the card again stops.

Under the details:

- **Add to what is there** lays the stamp over the map. **Replace the area's objects**
  removes the units, sprites and doodads inside the rectangle first (locations never).
- **Keep isometric alignment** places the piece only where it sits on the same lattice it
  was copied from — every second tile each way from the corner it came off. Hold **Shift**
  while clicking to ignore it for one placement. A stamp saved from selected objects has
  no lattice and is never snapped.
- The ticks after that are the stamp's parts: untick **Units** to lay down the ground
  without the minerals, or **Terrain** to place only the units. Locations and fog start
  unticked.

A stamp is an ordinary paste as far as the map is concerned: terrain goes into both tile
sections, doodads are re-stamped from the tileset's catalogue, units get fresh serials with
their add-on and nydus links kept, locations take free slots. The isometric record (ISOM)
is not touched, as with any paste — run Rebuild ISOM from Tiles afterwards if you want the
isometric brush back on that ground. Terrain and doodads from another tileset are refused;
a Jungle ramp stays a Jungle ramp.

### The library

Right-click a card (or press **More ▾**) for the rest: **Edit name, tags and notes…**,
**Replace contents with the marked area** (a better version of the same piece, same name),
**Duplicate**, **Copy as text**, **Export to a file…**, **Delete…**.

The search box matches names, tags, notes and the tileset's name. The tag chips under it
filter; click one to include it, again to drop it. **This tileset only** hides stamps from
other tilesets — they cannot be stamped here anyway, apart from their objects — and the
panel says how many it is hiding.

### Sharing

**Export…** writes a JSON file: the whole library, what the current search shows, or the
selected stamp. **Import…** reads one back (so does dropping the file onto the panel);
stamps already in the library are recognised by id and left alone unless you tick
*Replace*. **From text…** takes the same JSON pasted into a box, which is how a stamp
copied with **Copy as text** travels through a chat message or a forum post.

The file format is plain: each stamp's tiles as base64 and its records as JSON, in the
`stamps` array of a `{ "format": "scmjs-stamps", "version": 1 }` document. A file holding
one stamp and a file holding a hundred are the same format.

### Where it lives

Stamps are kept in the browser's storage for the editor's address, under the plugin's own
key, and listed in Preferences ▸ Browser storage where they can be cleared. That storage is
a few megabytes for the whole editor; a stamp of a ramp is a kilobyte or two, a whole base
perhaps ten, so a library of hundreds fits. Should the browser refuse a write, the panel
says so and the stamp stays until the editor closes — export the library then. Exporting
now and then is a good habit anyway: browser storage is a convenience, not a backup, and
another browser or another machine starts empty until you import.

## Layout

| | |
| --- | --- |
| `plugin.json` | the manifest the editor reads (name, version, `entry`, `build`, `icon`, the API version it needs) |
| `plugin.ts` | `activate(api)`: the panel, the dialogs, the stamping tool, the storage mirror |
| `library.ts` | the pure part: the stamp model, the base64 codec and the share-file format, searching, sorting, tags, the lattice snap |
| `dist/plugin.js` | the bundle the editor loads; `npm run build` writes it, CI commits it |
| `tests/` | vitest over `library.ts` |

Types come from [`@scm-js/plugin-api`](https://github.com/scm-js/plugin-api), a devDependency
generated from the editor's own `src/plugins/api.ts`; `npm update @scm-js/plugin-api` takes the
newest contract. This plugin needs the editor's `clipboard.capture`, `tx.paste` and
`graphics.renderClip`, which arrived with plugin-api 1.17.

## Development

```sh
npm install
npm run typecheck
npm test
```

`dist/plugin.js` is what the editor loads (`build` in the manifest): `npm run build` writes
it with esbuild, and CI commits it on every push to `main` and checks at a tag that it is
what the source builds to. Run `npm run dev` while you work so the bundle follows your
edits. To try local changes, serve this directory with CORS enabled (`npx serve --cors .`)
and add `http://localhost:3000/` in Manage Plugins, then use **Reload** after each edit.

A plugin runs with the editor's own privileges. There is no sandbox.

See [`docs/plugins.md`](https://github.com/jeany55/scm-js/blob/main/docs/plugins.md) in the editor
for the API tour; this plugin is the worked example for `api.clipboard.capture`, `tx.paste`,
`api.graphics.renderClip` and a library kept in `api.storage`.

## Licence

MIT — see [LICENSE](LICENSE).

/**
 * Stamp Library — a plugin for the scmJS map editor (https://github.com/jeany55/scm-js).
 *
 * The pieces a map maker builds once and wants again — a hand-tuned ramp, a bridge with
 * its shores, a cliff corner the brush never draws right, a whole mineral line — kept as
 * named *stamps* in the browser's storage, so they outlive the map they came from and
 * follow the editor from map to map. Tools ▸ Stamp Library… opens the panel in the right
 * dock: click a stamp and it hangs under the pointer, drawn with the map's own graphics;
 * click the map and it goes down as one undo step. Save from the marked area or from the
 * clipboard, search and tag, export the library as a JSON file, or copy one stamp as a
 * line of text for a friend to paste back in.
 *
 * `library.ts` is the pure half (the model, the codec, the searching, the lattice) and
 * has the tests. This file is the panel, the dialogs and the map tool. The editor is
 * reached through `api.clipboard.capture` (a clip without touching the user's clipboard),
 * `tx.paste` (a clip laid down inside a transaction), `api.graphics.renderClip` (the
 * thumbnails and the ghost) and `api.storage`. Plain DOM only, in the editor's own
 * widget classes plus a scoped stylesheet.
 */
import type {
  Clip, ClipParts, ClipSource, MapPointer, MapToolHandle, MapView, PanelHandle, PasteMode, PluginApi, PluginImage, Rect,
} from "@scm-js/plugin-api";
import {
  allTags, contentsOf, decodeShare, encodeShare, filterStamps, formatSize, makeStamp, newId, parseTags, partsOf, planMerge, snapToLattice, sortStamps, SORTS,
  stampSummary, storedSize, tilesetName, uniqueName, type SortBy, type Stamp,
} from "./library";

const VERSION = "1.0.0";
const TILE = 32;

/* ── DOM helpers ────────────────────────────────────────── */

type Child = Node | string | null | undefined | false;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "className") el.className = String(v);
      else if (k === "style") el.setAttribute("style", String(v));
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      else if (k in el && typeof v !== "string") (el as unknown as Record<string, unknown>)[k] = v;
      else el.setAttribute(k, String(v));
    }
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(typeof c === "string" ? document.createTextNode(c) : c);
  return el;
}

const STYLE = `
.stl { display: flex; flex-direction: column; flex: 1; min-height: 0; gap: 6px; font-size: var(--fs-sm, 11.5px); }
.stl .stl-bar { display: flex; gap: 4px; align-items: center; }
.stl .stl-bar .input { flex: 1; min-width: 0; }
.stl .stl-bar .select { width: auto; flex: 0 0 auto; }
.stl .stl-line { display: flex; align-items: center; gap: 8px; color: var(--text-dim, #99a2b3); min-height: 20px; }
.stl .stl-line .grow { flex: 1; }
.stl .stl-tags { display: flex; flex-wrap: wrap; gap: 3px; }
.stl .stl-tag { padding: 1px 7px; border-radius: 9px; border: 1px solid var(--border, #2c3341); background: var(--bg-3, #222732); color: var(--text-dim, #99a2b3); font-size: var(--fs-xs, 10.5px); cursor: pointer; line-height: 14px; }
.stl .stl-tag:hover { background: var(--bg-4, #2b313e); color: var(--text, #dde2ea); }
.stl .stl-tag.on { background: var(--teal-dim, #2c8a83); border-color: var(--teal, #4fd1c5); color: #fff; }
.stl .stl-grid { flex: 1; min-height: 80px; overflow: auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(86px, 1fr)); grid-auto-rows: max-content; gap: 5px; align-content: start; padding: 5px; background: var(--bg-0, #0a0c10); border: 1px solid var(--border, #2c3341); border-radius: var(--radius, 3px); box-shadow: var(--bevel-sunken); }
.stl .stl-grid.drop { outline: 2px dashed var(--teal, #4fd1c5); outline-offset: -4px; }
.stl .stl-empty { grid-column: 1 / -1; padding: 18px 10px; text-align: center; color: var(--text-faint, #5d6675); line-height: 1.5; }
.stl .stl-card { display: flex; flex-direction: column; gap: 3px; padding: 4px; border: 1px solid transparent; border-radius: var(--radius, 3px); background: var(--bg-2, #191d25); color: var(--text, #dde2ea); cursor: pointer; text-align: left; font: inherit; min-width: 0; }
.stl .stl-card > * { width: 100%; min-width: 0; }
.stl .stl-card:hover { background: var(--bg-3, #222732); border-color: var(--border, #2c3341); }
.stl .stl-card.sel { border-color: var(--border-strong, #3b4453); background: var(--bg-3, #222732); }
.stl .stl-card.on { border-color: var(--teal, #4fd1c5); box-shadow: 0 0 0 1px var(--teal, #4fd1c5) inset; }
.stl .stl-card.foreign .stl-thumb { opacity: .45; }
.stl .stl-thumb { position: relative; width: 100%; aspect-ratio: 4 / 3; background: var(--bg-0, #0a0c10); border-radius: 2px; overflow: hidden; display: flex; align-items: center; justify-content: center; }
.stl .stl-thumb canvas { max-width: 100%; max-height: 100%; image-rendering: auto; }
.stl .stl-thumb .stl-badge { position: absolute; right: 3px; bottom: 3px; padding: 0 5px; border-radius: 8px; background: rgba(10,12,16,.8); color: var(--gold-hi, #f4d08a); font-size: var(--fs-xs, 10.5px); line-height: 14px; }
.stl .stl-thumb .stl-none { color: var(--text-faint, #5d6675); font-size: var(--fs-xs, 10.5px); text-align: center; padding: 4px; }
.stl .stl-card .stl-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: var(--fs-sm, 11.5px); }
.stl .stl-card .stl-meta { color: var(--text-faint, #5d6675); font-size: var(--fs-xs, 10.5px); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.stl .stl-detail { display: flex; flex-direction: column; gap: 4px; padding: 6px 8px; border: 1px solid var(--border, #2c3341); border-radius: var(--radius, 3px); background: var(--bg-2, #191d25); }
.stl .stl-detail .stl-title { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
.stl .stl-detail .stl-title b { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--gold, #e6b95c); }
.stl .stl-detail .stl-dim { color: var(--text-dim, #99a2b3); }
.stl .stl-detail .stl-notes { color: var(--text-dim, #99a2b3); white-space: pre-wrap; max-height: 60px; overflow: auto; }
.stl .stl-actions { display: flex; gap: 4px; flex-wrap: wrap; }
.stl .stl-actions .btn { padding: 0 8px; }
.stl .stl-opts { display: flex; flex-direction: column; gap: 3px; }
.stl .stl-opts .stl-line { gap: 10px; }
.stl .stl-parts { display: flex; flex-wrap: wrap; gap: 2px 10px; }
.stl .stl-parts .check { height: 18px; }
.stl .stl-foot { display: flex; gap: 4px; flex-wrap: wrap; }
.stl .stl-foot .btn { padding: 0 8px; }
.stl .stl-foot .grow { flex: 1; }
.stl-menu { position: fixed; z-index: 1000; min-width: 170px; padding: 4px; background: var(--bg-2, #191d25); border: 1px solid var(--border-strong, #3b4453); border-radius: var(--radius-lg, 5px); box-shadow: var(--shadow-pop); font-size: var(--fs-sm, 11.5px); }
.stl-menu button { display: flex; width: 100%; align-items: center; gap: 8px; height: 24px; padding: 0 10px; border: none; border-radius: var(--radius, 3px); background: transparent; color: var(--text, #dde2ea); font: inherit; text-align: left; cursor: pointer; }
.stl-menu button:hover { background: var(--sel, #2b4f80); color: #fff; }
.stl-menu button.danger:hover { background: var(--danger, #d9534f); }
.stl-menu button:disabled { opacity: .45; pointer-events: none; }
.stl-menu .sep { height: 1px; margin: 4px 6px; background: var(--border, #2c3341); }
.stl-dlg { display: flex; flex-direction: column; gap: 10px; }
.stl-dlg .stl-preview { display: flex; align-items: center; justify-content: center; min-height: 96px; max-height: 220px; padding: 8px; background: var(--bg-0, #0a0c10); border: 1px solid var(--border, #2c3341); border-radius: var(--radius, 3px); }
.stl-dlg .stl-preview canvas { max-width: 100%; max-height: 200px; }
.stl-dlg .stl-preview .stl-none { color: var(--text-faint, #5d6675); }
.stl-dlg .textarea { min-height: 56px; }
`;

/* ── Settings ───────────────────────────────────────────── */

interface Settings {
  sort: SortBy;
  /** Show only the stamps of the open map's tileset. */
  thisTileset: boolean;
  mode: PasteMode;
  /** Keep a stamp on the isometric lattice it was copied from. */
  snap: boolean;
  /** Which parts to lay down, of the ones a stamp carries. */
  parts: ClipParts;
  /** Whether the panel was open when the editor closed. */
  open: boolean;
  /** Floating over the map, or in the right dock with the built-in panels. */
  dock: "float" | "right";
}

const DEFAULT_SETTINGS: Settings = {
  sort: "recent", thisTileset: true, mode: "merge", snap: true,
  parts: { terrain: true, doodads: true, units: true, sprites: true, locations: false, fog: false },
  open: false,
  dock: "float",
};

const PART_LABELS: { key: keyof ClipParts; label: string }[] = [
  { key: "terrain", label: "Terrain" }, { key: "doodads", label: "Doodads" }, { key: "units", label: "Units" },
  { key: "sprites", label: "Sprites" }, { key: "locations", label: "Locations" }, { key: "fog", label: "Fog" },
];

/** Every part, for capturing: the user chooses what to lay down when stamping, so nothing is left out at save time. */
const ALL_PARTS: ClipParts = { terrain: true, doodads: true, units: true, sprites: true, locations: true, fog: true };

/* ── Storage ────────────────────────────────────────────── */

/**
 * The stamps in memory, mirrored to `api.storage`: `index` holds the ids in order and
 * `stamp.<id>` each record, so a change writes one small record. A refused write (the
 * browser's quota) keeps the stamp in memory and says so once, so the user can export.
 */
class Library {
  stamps: Stamp[] = [];
  private readonly api: PluginApi;
  private listeners = new Set<() => void>();
  private warned = false;

  constructor(api: PluginApi) { this.api = api; }

  load(): void {
    const index = this.api.storage.get<string[]>("index", []);
    const out: Stamp[] = [];
    let broken = 0;
    for (const id of index) {
      const raw = this.api.storage.get<unknown>(`stamp.${id}`, null);
      if (raw === null) continue;
      const parsed = decodeShare(JSON.stringify(raw));
      if ("stamps" in parsed && parsed.stamps[0]) out.push(parsed.stamps[0]); else broken++;
    }
    this.stamps = out;
    if (broken > 0) this.api.log(`${broken} stored stamp${broken === 1 ? "" : "s"} could not be read and ${broken === 1 ? "was" : "were"} left out.`);
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  byId(id: string): Stamp | undefined {
    return this.stamps.find((s) => s.id === id);
  }

  add(stamp: Stamp): void {
    this.stamps.push(stamp);
    this.write(stamp);
    this.writeIndex();
    this.emit();
  }

  update(stamp: Stamp, touch = true): void {
    if (touch) stamp.modified = new Date().toISOString();
    this.write(stamp);
    this.emit();
  }

  remove(id: string): void {
    this.stamps = this.stamps.filter((s) => s.id !== id);
    this.api.storage.remove(`stamp.${id}`);
    this.writeIndex();
    this.emit();
  }

  /** Put several in at once (an import), replacing by id where asked. */
  merge(added: Stamp[], replaced: Stamp[]): void {
    for (const s of replaced) {
      const i = this.stamps.findIndex((x) => x.id === s.id);
      if (i >= 0) this.stamps[i] = s; else this.stamps.push(s);
      this.write(s);
    }
    for (const s of added) { this.stamps.push(s); this.write(s); }
    this.writeIndex();
    this.emit();
  }

  /** Characters the library occupies in storage. */
  size(): number {
    return this.stamps.reduce((n, s) => n + storedSize(s), 0);
  }

  private write(stamp: Stamp): void {
    const stored = JSON.parse(encodeShare([stamp])).stamps[0];
    if (!this.api.storage.set(`stamp.${stamp.id}`, stored)) this.quota(stamp);
  }

  private writeIndex(): void {
    this.api.storage.set("index", this.stamps.map((s) => s.id));
  }

  private quota(stamp: Stamp): void {
    if (this.warned) return;
    this.warned = true;
    this.api.ui.toast({
      kind: "warn", title: `“${stamp.name}” could not be kept in the browser's storage`,
      detail: `The browser refused the write — its storage is nearly full (the library is ${formatSize(this.size())}). The stamp stays until the editor closes; export the library to a file to keep it.`,
      ttl: 0,
    });
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}

/* ── Pictures ───────────────────────────────────────────── */

/**
 * `renderClip` is synchronous and uncached, so the pictures are kept here: one full-size
 * canvas per stamp for the ghost (capped so a big stamp does not make a huge canvas) and
 * one small one for its card. Both are dropped when the graphics change — a GRP arriving,
 * another tileset loading, the game data switching.
 */
class Pictures {
  private readonly api: PluginApi;
  private full = new Map<string, PluginImage | null>();
  private thumbs = new Map<string, PluginImage | null>();

  constructor(api: PluginApi) { this.api = api; }

  invalidate(id?: string): void {
    if (id === undefined) { this.full.clear(); this.thumbs.clear(); return; }
    this.full.delete(id);
    this.thumbs.delete(id);
  }

  ghost(stamp: Stamp): PluginImage | null {
    if (!this.full.has(stamp.id)) {
      const longest = Math.max(stamp.clip.width, stamp.clip.height);
      const ppt = Math.max(2, Math.min(TILE, Math.floor(2048 / longest)));
      this.full.set(stamp.id, this.api.graphics.renderClip(stamp.clip, { pixelsPerTile: ppt }));
    }
    return this.full.get(stamp.id) ?? null;
  }

  thumb(stamp: Stamp): PluginImage | null {
    if (!this.thumbs.has(stamp.id)) {
      const longest = Math.max(stamp.clip.width, stamp.clip.height);
      const ppt = Math.max(1, Math.min(8, Math.floor(240 / longest)));
      this.thumbs.set(stamp.id, this.api.graphics.renderClip(stamp.clip, { pixelsPerTile: ppt }));
    }
    return this.thumbs.get(stamp.id) ?? null;
  }

  /** Ask for the unit graphics a stamp draws, so the thumbnail fills in when they arrive. */
  request(stamp: Stamp): void {
    for (const u of stamp.clip.units) this.api.graphics.requestUnit(u.unitId);
    for (const s of stamp.clip.sprites) this.api.graphics.requestSprite(s.flags & 0x1000 ? "pure" : "unit", s.spriteId);
  }
}

/** A `<canvas>` showing a picture scaled to fit a box, sharp at the device's pixel ratio. */
function pictureCanvas(img: PluginImage, maxW: number, maxH: number): HTMLCanvasElement {
  const scale = Math.min(maxW / img.width, maxH / img.height, 4);
  const w = Math.max(1, Math.round(img.width * scale)), hgt = Math.max(1, Math.round(img.height * scale));
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const c = h("canvas", { width: Math.round(w * dpr), height: Math.round(hgt * dpr), style: `width:${w}px;height:${hgt}px` });
  const ctx = c.getContext("2d");
  if (ctx) {
    ctx.imageSmoothingEnabled = scale < 1;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img.image, 0, 0, c.width, c.height);
  }
  return c;
}

/* ── The plugin ─────────────────────────────────────────── */

class StampLibrary {
  readonly api: PluginApi;
  readonly settings: Settings;
  readonly lib: Library;
  readonly pictures: Pictures;
  panel: PanelHandle | null = null;
  /** The stamp whose card is highlighted and whose details show. */
  selected: string | null = null;
  /** The stamp under the pointer while the map tool runs. */
  active: Stamp | null = null;
  tool: MapToolHandle | null = null;
  query = "";
  tagFilter: string[] = [];
  private refreshPanel: (() => void) | null = null;
  private refreshFooter: (() => void) | null = null;

  constructor(api: PluginApi) {
    this.api = api;
    const stored = api.storage.get<Partial<Settings>>("settings", {});
    this.settings = { ...DEFAULT_SETTINGS, ...stored, parts: { ...DEFAULT_SETTINGS.parts, ...(stored.parts ?? {}) } };
    this.lib = new Library(api);
    this.pictures = new Pictures(api);
    this.lib.load();
    this.lib.onChange(() => this.refresh());
  }

  save(): void { this.api.storage.set("settings", this.settings); }

  /** ERA of the open map, or null. */
  era(): number | null {
    return this.api.document.info()?.era ?? null;
  }

  refresh(): void { this.refreshPanel?.(); }

  /* ── Capturing ── */

  /** What "Save area" would take right now: the marked area, else the object layer's selection. */
  captureSource(): { source: ClipSource; origin: { x: number; y: number } | null; label: string } | null {
    if (!this.api.document.isOpen()) return null;
    const rect = this.api.selection.markedArea();
    if (rect) return { source: { rect }, origin: { x: rect.x0, y: rect.y0 }, label: `the marked ${rect.x1 - rect.x0} × ${rect.y1 - rect.y0} area` };
    const layer = this.api.selection.layer();
    const sel = layer === "units" ? { units: this.api.selection.units() }
      : layer === "sprites" ? { sprites: this.api.selection.sprites() }
      : layer === "doodads" ? { doodads: this.api.selection.doodads() }
      : layer === "locations" ? { locations: this.api.selection.locations() }
      : null;
    if (!sel) return null;
    const n = Object.values(sel)[0]?.length ?? 0;
    if (n === 0) return null;
    return { source: sel, origin: null, label: `the ${n} selected ${layer === "locations" ? "location" : layer.slice(0, -1)}${n === 1 ? "" : "s"}` };
  }

  saveFromMap(): void {
    const src = this.captureSource();
    const clip = src ? this.api.clipboard.capture(src.source, { parts: ALL_PARTS }) : null;
    if (!src || !clip) {
      this.api.ui.toast({ kind: "info", title: "Nothing to save as a stamp", detail: "Mark an area on the Cut / Copy / Paste layer, or select units, sprites, doodads or locations on their layer, then try again." });
      return;
    }
    void this.editDialog(null, clip, src.origin);
  }

  saveFromClipboard(): void {
    const clip = this.api.clipboard.clip();
    if (!clip) {
      this.api.ui.toast({ kind: "info", title: "The clipboard is empty", detail: "Copy something on the map first (Ctrl+C), then save it as a stamp." });
      return;
    }
    // The marked area is usually where the clip was copied from; when it is the clip's size, take it as the origin.
    const marked = this.api.selection.markedArea();
    const origin = marked && marked.x1 - marked.x0 === clip.width && marked.y1 - marked.y0 === clip.height ? { x: marked.x0, y: marked.y0 } : null;
    void this.editDialog(null, clip, origin);
  }

  /* ── Stamping ── */

  start(stamp: Stamp): void {
    if (!this.api.document.isOpen()) return;
    const api = this.api;
    const era = this.era();
    const foreign = era !== null && stamp.clip.era !== era;
    if (foreign && !stamp.clip.units.length && !stamp.clip.sprites.length && !stamp.clip.locations.length && !stamp.clip.fog) {
      api.ui.toast({ kind: "info", title: `“${stamp.name}” is a ${tilesetName(stamp.clip.era)} piece`, detail: `Its tiles mean something else on ${tilesetName(era)}. Open a ${tilesetName(stamp.clip.era)} map to lay it down.` });
      return;
    }
    this.tool?.stop();
    this.active = stamp;
    this.selected = stamp.id;
    let hover: { x: number; y: number } | null = null;
    const place = (p: MapPointer) => (this.settings.snap && !p.shift ? snapToLattice(p.tx, p.ty, stamp.origin) : { x: p.tx, y: p.ty });
    const info = api.document.info();
    const mapW = info?.width ?? 0, mapH = info?.height ?? 0;
    const tool = api.ui.mapTool({
      name: `Stamp: ${stamp.name}`,
      hint: foreign ? `click to lay down its objects · its ${tilesetName(stamp.clip.era)} terrain stays off` : `click to lay it down${stamp.origin && this.settings.snap ? " · Shift for free placement" : ""}`,
      cursor: "copy",
      onMove: (p) => { hover = p.inMap ? place(p) : null; tool.redraw(); },
      onDown: (p) => { this.stamp(stamp, place(p)); },
      draw: (ctx, view) => {
        if (!hover) return;
        const { x, y } = hover;
        const w = stamp.clip.width, ht = stamp.clip.height;
        const left = view.x(x * TILE), top = view.y(y * TILE), pw = w * view.tilePx, ph = ht * view.tilePx;
        const img = foreign ? null : this.pictures.ghost(stamp);
        if (img) {
          ctx.globalAlpha = 0.75;
          ctx.imageSmoothingEnabled = view.tilePx < TILE;
          ctx.drawImage(img.image, left, top, pw, ph);
          ctx.globalAlpha = 1;
        }
        const off = x < 0 || y < 0 || x + w > mapW || y + ht > mapH;
        ctx.lineWidth = 1;
        ctx.strokeStyle = off ? "#d9534f" : "#e6b95c";
        ctx.setLineDash([5, 3]);
        ctx.strokeRect(Math.round(left) + 0.5, Math.round(top) + 0.5, Math.round(pw) - 1, Math.round(ph) - 1);
        ctx.setLineDash([]);
        this.label(ctx, view, left, top + ph, stamp.name);
      },
      onStop: () => {
        if (this.active === stamp) { this.active = null; this.tool = null; }
        this.refresh();
      },
    });
    this.tool = tool;
    this.refresh();
  }

  private label(ctx: CanvasRenderingContext2D, view: MapView, x: number, y: number, text: string): void {
    void view;
    ctx.font = `10px ${getComputedStyle(document.body).getPropertyValue("--font-mono") || "monospace"}`;
    const tw = ctx.measureText(text).width;
    ctx.fillStyle = "rgba(10,12,16,0.8)";
    ctx.fillRect(x, y + 3, tw + 8, 15);
    ctx.fillStyle = "#f4d08a";
    ctx.fillText(text, x + 4, y + 14);
  }

  stamp(stamp: Stamp, at: { x: number; y: number }): void {
    const has = partsOf(stamp.clip);
    const parts: ClipParts = { ...has };
    for (const p of PART_LABELS) parts[p.key] = has[p.key] && this.settings.parts[p.key];
    const r = this.api.document.edit(`Stamp ${stamp.name}`, (tx) => tx.paste(stamp.clip, at.x, at.y, { parts, mode: this.settings.mode }));
    if (r.changed) {
      const info = this.api.document.info();
      const rect: Rect = { x0: Math.max(0, at.x), y0: Math.max(0, at.y), x1: Math.min(info?.width ?? Infinity, at.x + stamp.clip.width), y1: Math.min(info?.height ?? Infinity, at.y + stamp.clip.height) };
      this.api.selection.markArea(rect);
      stamp.used++;
      stamp.lastUsed = new Date().toISOString();
      this.lib.update(stamp, false);
    }
    if (r.notes.length > 0) this.api.ui.status(`${stamp.name}: ${r.notes.join("; ")}`);
    else if (!r.changed) this.api.ui.status(`${stamp.name}: nothing to lay down here`);
  }

  stop(): void { this.tool?.stop(); }

  /* ── Dialogs ── */

  /**
   * Name, tags and notes — for a new stamp (with the clip to keep and a preview of it)
   * or an existing one. Resolves with the stamp saved, or null.
   */
  editDialog(existing: Stamp | null, clip: Clip | null, origin: { x: number; y: number } | null): Promise<Stamp | null> {
    const api = this.api;
    const w = api.ui.widgets;
    const isNew = existing === null;
    const theClip = clip ?? existing!.clip;
    return new Promise((resolve) => {
      let settled = false;
      const done = (s: Stamp | null) => { if (!settled) { settled = true; resolve(s); } };
      const name = w.text({ value: existing?.name ?? uniqueName(this.suggestName(theClip), this.lib.stamps), placeholder: "What the piece is" });
      const tags = w.text({ value: existing?.tags.join(", ") ?? "", placeholder: "ramp, cliff, north — comma-separated" });
      const notes = h("textarea", { className: "textarea", placeholder: "Anything worth remembering: where it fits, what to fix after stamping", value: existing?.notes ?? "" });
      const known = allTags(this.lib.stamps).map((t) => t.tag);
      const preview = h("div", { className: "stl-preview" });
      const img = api.graphics.renderClip(theClip, { pixelsPerTile: Math.max(1, Math.min(16, Math.floor(400 / Math.max(theClip.width, theClip.height)))) });
      preview.append(img ? pictureCanvas(img, 440, 200) : h("span", { className: "stl-none" }, this.era() !== null && this.era() !== theClip.era ? `A ${tilesetName(theClip.era)} piece — drawn once a ${tilesetName(theClip.era)} map is open` : "No picture without the tileset graphics"));
      const body = h("div", { className: "stl-dlg" },
        preview,
        w.hint(`${theClip.width} × ${theClip.height} tiles · ${tilesetName(theClip.era)} · ${contentsOf(theClip) || "empty"}${origin ? ` · copied from (${origin.x}, ${origin.y})` : ""}`),
        w.form([{ label: "Name", field: name }, { label: "Tags", field: tags }, { label: "Notes", field: notes }]),
        known.length > 0 ? w.hint(`Tags in use: ${known.slice(0, 12).join(", ")}${known.length > 12 ? ", …" : ""}`) : null,
      );
      const commit = () => {
        const label = name.value.trim();
        if (!label) { name.focus(); return false; }
        if (isNew) {
          const stamp = makeStamp(uniqueName(label, this.lib.stamps), theClip, { tags: parseTags(tags.value), notes: notes.value, origin });
          this.lib.add(stamp);
          this.selected = stamp.id;
          this.pictures.request(stamp);
          api.ui.toast({ kind: "ok", title: `Saved “${stamp.name}”`, detail: stampSummary(stamp) });
          this.openPanel();
          done(stamp);
        } else {
          existing.name = uniqueName(label, this.lib.stamps, existing.id);
          existing.tags = parseTags(tags.value);
          existing.notes = notes.value;
          this.lib.update(existing);
          done(existing);
        }
        return true;
      };
      const dlg = api.ui.dialog({
        title: isNew ? "Save as Stamp" : `Edit “${existing.name}”`,
        size: "md",
        mount: (el) => {
          el.append(body);
          setTimeout(() => { name.focus(); name.select(); }, 0);
          const onKey = (e: KeyboardEvent) => { if (e.key === "Enter" && e.target !== notes) { e.preventDefault(); if (commit()) dlg.close(); } };
          el.addEventListener("keydown", onKey);
          return () => { el.removeEventListener("keydown", onKey); done(null); };
        },
        buttons: [
          { label: "Cancel" },
          { label: isNew ? "Save" : "OK", primary: true, run: () => commit() },
        ],
      });
    });
  }

  /** `Jungle piece 12 × 8`, or `3 units`, for a fresh stamp's name field. */
  private suggestName(clip: Clip): string {
    if (clip.tiles) return `${tilesetName(clip.era)} piece ${clip.width} × ${clip.height}`;
    const c = contentsOf(clip);
    return c ? c.split(" · ")[0].replace(/^\w/, (m) => m.toUpperCase()) : "New stamp";
  }

  async replaceContents(stamp: Stamp): Promise<void> {
    const src = this.captureSource();
    const clip = src ? this.api.clipboard.capture(src.source, { parts: ALL_PARTS }) : null;
    if (!src || !clip) {
      this.api.ui.toast({ kind: "info", title: "Nothing to replace it with", detail: "Mark an area or select objects on the map first." });
      return;
    }
    const ok = await this.api.ui.confirm(`Replace what “${stamp.name}” holds with ${src.label} (${clip.width} × ${clip.height}, ${tilesetName(clip.era)})? Its name, tags and notes stay.`, { title: "Replace contents", confirmLabel: "Replace" });
    if (!ok) return;
    stamp.clip = clip;
    stamp.origin = src.origin;
    this.pictures.invalidate(stamp.id);
    this.lib.update(stamp);
    this.api.ui.toast({ kind: "ok", title: `“${stamp.name}” updated`, detail: stampSummary(stamp) });
  }

  duplicate(stamp: Stamp): void {
    const copy = makeStamp(uniqueName(stamp.name, this.lib.stamps), stamp.clip, { tags: stamp.tags, notes: stamp.notes, origin: stamp.origin, id: newId() });
    this.lib.add(copy);
    this.selected = copy.id;
    this.refresh();
  }

  async remove(stamp: Stamp): Promise<void> {
    const ok = await this.api.ui.confirm(`Delete “${stamp.name}” from the library? This cannot be undone.`, { title: "Delete stamp", confirmLabel: "Delete", danger: true });
    if (!ok) return;
    if (this.active === stamp) this.stop();
    if (this.selected === stamp.id) this.selected = null;
    this.pictures.invalidate(stamp.id);
    this.lib.remove(stamp.id);
  }

  /* ── Sharing ── */

  async copyAsText(stamp: Stamp): Promise<void> {
    const text = encodeShare([stamp], { generator: `Stamp Library ${VERSION}` });
    try {
      await navigator.clipboard.writeText(text);
      this.api.ui.toast({ kind: "ok", title: `“${stamp.name}” copied as text`, detail: `${formatSize(text.length)}. Paste it to anyone with the editor; they add it with From text… in the Stamp Library panel.` });
    } catch {
      // No clipboard permission: show it in a dialog to copy by hand.
      const area = h("textarea", { className: "textarea", readOnly: true, value: text, style: "height: 140px; font-family: var(--font-mono); font-size: 10.5px" });
      this.api.ui.dialog({ title: `“${stamp.name}” as text`, size: "md", mount: (el) => { el.append(this.api.ui.widgets.hint("The browser would not write to the clipboard; select all and copy."), area); setTimeout(() => area.select(), 0); } });
    }
  }

  async fromText(): Promise<void> {
    const text = await this.api.ui.prompt("Paste the text of a stamp (or a whole library file) here.", { title: "Add stamps from text", multiline: true, confirmLabel: "Add" });
    if (text === null || !text.trim()) return;
    await this.importText(text, "the text");
  }

  async importFiles(): Promise<void> {
    const files = await this.api.ui.pickFiles({ accept: ".json,application/json", multiple: true });
    for (const f of files) await this.importText(await f.text(), f.name);
  }

  async importText(text: string, from: string): Promise<void> {
    const r = decodeShare(text);
    if ("error" in r) {
      this.api.ui.toast({ kind: "error", title: `Could not read ${from}`, detail: r.error });
      return;
    }
    let plan = planMerge(this.lib.stamps, r.stamps, false);
    const dupes = plan.skipped.length;
    if (dupes > 0) {
      const replace = await this.askReplace(r.stamps.length, dupes, from);
      if (replace === null) return;
      plan = planMerge(this.lib.stamps, r.stamps, replace);
    }
    if (plan.added.length + plan.replaced.length === 0) {
      this.api.ui.toast({ kind: "info", title: "Nothing new", detail: `Every stamp in ${from} is already in the library.` });
      return;
    }
    for (const s of plan.replaced) this.pictures.invalidate(s.id);
    this.lib.merge(plan.added, plan.replaced);
    for (const s of [...plan.added, ...plan.replaced]) this.pictures.request(s);
    if (plan.added[0]) this.selected = plan.added[0].id;
    const bits = [plan.added.length > 0 ? `${plan.added.length} added` : null, plan.replaced.length > 0 ? `${plan.replaced.length} replaced` : null, plan.skipped.length > 0 ? `${plan.skipped.length} already here` : null, r.skipped > 0 ? `${r.skipped} unreadable` : null].filter(Boolean);
    this.api.ui.toast({ kind: "ok", title: `Imported from ${from}`, detail: bits.join(" · ") });
    this.openPanel();
  }

  /** Whether to replace the stamps an import shares an id with; null to cancel. */
  private askReplace(total: number, dupes: number, from: string): Promise<boolean | null> {
    return new Promise((resolve) => {
      let answer: boolean | null = null;
      const tick = this.api.ui.widgets.checkbox("Replace them with the file's version", { value: false });
      this.api.ui.dialog({
        title: "Import stamps",
        size: "sm",
        mount: (el) => {
          el.append(h("div", { className: "stl-dlg" },
            h("div", null, `${from} holds ${total} stamp${total === 1 ? "" : "s"}; ${dupes} ${dupes === 1 ? "is" : "are"} already in the library (the same stamp, perhaps edited since).`),
            tick,
            this.api.ui.widgets.hint("Unticked, those are left as they are and only the new ones come in."),
          ));
          return () => resolve(answer);
        },
        buttons: [{ label: "Cancel" }, { label: "Import", primary: true, run: () => { answer = tick.input.checked; } }],
      });
    });
  }

  async exportDialog(shown: Stamp[]): Promise<void> {
    const all = this.lib.stamps;
    if (all.length === 0) {
      this.api.ui.toast({ kind: "info", title: "The library is empty", detail: "Save a stamp first." });
      return;
    }
    const selected = this.selected ? this.lib.byId(this.selected) ?? null : null;
    const w = this.api.ui.widgets;
    const choices: { id: string; label: string; stamps: Stamp[] }[] = [{ id: "all", label: `The whole library (${all.length})`, stamps: all }];
    if (shown.length !== all.length && shown.length > 0) choices.push({ id: "shown", label: `The ${shown.length} shown by the current search`, stamps: shown });
    if (selected) choices.push({ id: "one", label: `Only “${selected.name}”`, stamps: [selected] });
    let pick = choices[0];
    const radios = choices.map((c) => w.checkbox(c.label, { radio: true, name: "stl-export", value: c === pick, onChange: () => { pick = c; } }));
    const pretty = w.checkbox("Readable JSON (larger)", { value: false });
    await new Promise<void>((resolve) => {
      this.api.ui.dialog({
        title: "Export stamps",
        size: "sm",
        mount: (el) => {
          el.append(h("div", { className: "stl-dlg" }, w.column(...radios), pretty, w.hint("A JSON file anyone can import into their own library — with Import… in the panel, or by dropping it onto the panel.")));
          return () => resolve();
        },
        buttons: [
          { label: "Cancel" },
          { label: "Export…", primary: true, run: async () => {
            const text = encodeShare(pick.stamps, { generator: `Stamp Library ${VERSION}`, pretty: pretty.input.checked });
            const stem = pick.stamps.length === 1 ? pick.stamps[0].name.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "stamp" : "stamps";
            const name = `${stem}-${new Date().toISOString().slice(0, 10)}.json`;
            const where = await this.api.ui.saveFile(new Blob([text], { type: "application/json" }), name);
            if (where) this.api.ui.toast({ kind: "ok", title: `Exported ${pick.stamps.length} stamp${pick.stamps.length === 1 ? "" : "s"}`, detail: `${where.fileName} · ${formatSize(text.length)}` });
          } },
        ],
      });
    });
  }

  /* ── The panel ── */

  openPanel(): void {
    if (this.panel?.isOpen()) return;
    const api = this.api;
    this.settings.open = true;
    this.save();
    const docked = this.settings.dock === "right";
    this.panel = api.ui.panel({
      title: "Stamps",
      ...(docked ? { dock: "right" as const, grow: true } : { width: 340, height: 560, resizable: true }),
      mount: (body) => this.mount(body),
      onClose: () => {
        this.panel = null;
        this.refreshPanel = null;
        this.refreshFooter = null;
        if (!this.moving) { this.settings.open = false; this.save(); }
      },
    });
    void api.tileset.load().then(() => this.refresh());
  }

  /** Close and reopen the panel on the other side of the dock line; a closed panel opens there next time. */
  private moving = false;
  setDock(dock: Settings["dock"]): void {
    if (this.settings.dock === dock) return;
    this.settings.dock = dock;
    this.save();
    if (!this.panel?.isOpen()) return;
    this.moving = true;
    this.panel.close();
    this.moving = false;
    this.openPanel();
  }

  /** The plugin's page under Edit ▸ Preferences ▸ Plugins: where the panel opens. Written on OK or Apply. */
  preferencesPage(): void {
    const api = this.api;
    const w = api.ui.widgets;
    let dock: HTMLSelectElement | null = null;
    api.ui.preferencesPage({
      mount: (body) => {
        dock = w.select([{ value: "float", label: "Floating over the map" }, { value: "right", label: "Docked on the right" }], { value: this.settings.dock });
        body.append(
          w.form([{ label: "Panel", field: dock }]),
          w.hint("A floating panel is dragged about and resized from its corner; a docked one sits in the right dock with Minimap, Layers and Properties. The Dock and Float button at the bottom of the panel does the same."),
        );
        return () => { dock = null; };
      },
      apply: () => { if (dock) this.setDock(dock.value === "right" ? "right" : "float"); },
      reset: () => { if (dock) dock.value = DEFAULT_SETTINGS.dock; },
    });
  }

  togglePanel(): void {
    if (this.panel?.isOpen()) this.panel.close(); else this.openPanel();
  }

  private mount(body: HTMLElement): () => void {
    const api = this.api;
    const w = api.ui.widgets;
    const s = this.settings;
    body.append(h("style", null, STYLE));

    const search = w.text({ placeholder: "Search names, tags, notes", value: this.query, onChange: (v) => { this.query = v; render(); } });
    search.classList.add("input");
    const sort = w.select(SORTS.map((o) => ({ value: o.id, label: o.label })), { value: s.sort, onChange: (v) => { s.sort = v as SortBy; this.save(); render(); } });
    sort.title = "Order";
    const thisTileset = w.checkbox("This tileset only", { value: s.thisTileset, onChange: (v) => { s.thisTileset = v; this.save(); render(); } });
    const count = h("span", { className: "grow", style: "text-align: right" });
    const tagsRow = h("div", { className: "stl-tags" });
    const grid = h("div", { className: "stl-grid" });

    // Details of the selected stamp.
    const title = h("b");
    const summary = h("span", { className: "stl-dim" });
    const contents = h("div", { className: "stl-dim" });
    const notesEl = h("div", { className: "stl-notes" });
    const stampBtn = w.button("Stamp", { primary: true, onClick: () => { const st = this.current(); if (!st) return; if (this.active === st) this.stop(); else this.start(st); } });
    const editBtn = w.button("Edit…", { onClick: () => { const st = this.current(); if (st) void this.editDialog(st, null, st.origin); } });
    const moreBtn = w.button("More ▾", { onClick: (e) => { const st = this.current(); if (st) this.cardMenu(st, e.clientX, e.clientY); } });
    const detail = h("div", { className: "stl-detail" },
      h("div", { className: "stl-title" }, title, summary),
      contents, notesEl,
      h("div", { className: "stl-actions" }, stampBtn, editBtn, moreBtn),
    );

    // Stamping options.
    const modeAdd = w.checkbox("Add to what is there", { radio: true, name: "stl-mode", value: s.mode === "merge", onChange: () => { s.mode = "merge"; this.save(); } });
    const modeReplace = w.checkbox("Replace the area's objects", { radio: true, name: "stl-mode", value: s.mode === "replace", onChange: () => { s.mode = "replace"; this.save(); } });
    modeReplace.title = "Units, sprites and doodads inside the stamp's rectangle are removed first. Locations never are.";
    const snap = w.checkbox("Keep isometric alignment", { value: s.snap, onChange: (v) => { s.snap = v; this.save(); } });
    snap.title = "Lay a piece down only where it sits on the same isometric lattice it was copied from (every second tile each way). Shift while placing ignores it.";
    const partTicks = PART_LABELS.map((p) => w.checkbox(p.label, { value: s.parts[p.key], onChange: (v) => { s.parts[p.key] = v; this.save(); } }));
    const opts = h("div", { className: "stl-opts" },
      h("div", { className: "stl-line" }, modeAdd, modeReplace),
      h("div", { className: "stl-line" }, snap),
      h("div", { className: "stl-parts" }, ...partTicks),
    );

    // Footer.
    const saveArea = w.button("Save area…", { onClick: () => this.saveFromMap() });
    const saveClip = w.button("Save clipboard…", { onClick: () => this.saveFromClipboard() });
    const importBtn = w.button("Import…", { onClick: () => void this.importFiles() });
    const textBtn = w.button("From text…", { onClick: () => void this.fromText() });
    const exportBtn = w.button("Export…", { onClick: () => void this.exportDialog(this.shown()) });
    const docked = s.dock === "right";
    const dockBtn = w.button(docked ? "Float" : "Dock", { ghost: true, title: docked ? "Take the panel out of the dock and float it over the map" : "Put the panel in the right dock, with Minimap, Layers and Properties", onClick: () => this.setDock(docked ? "float" : "right") });
    const foot = h("div", { className: "stl-foot" }, saveArea, saveClip, h("span", { className: "grow" }), importBtn, textBtn, exportBtn, dockBtn);

    body.append(h("div", { className: "stl" },
      h("div", { className: "stl-bar" }, search, sort),
      h("div", { className: "stl-line" }, thisTileset, count),
      tagsRow, grid, detail, opts, foot,
    ));

    // Dropping a library file onto the grid imports it.
    grid.addEventListener("dragover", (e) => { if (e.dataTransfer?.types.includes("Files")) { e.preventDefault(); grid.classList.add("drop"); } });
    grid.addEventListener("dragleave", () => grid.classList.remove("drop"));
    grid.addEventListener("drop", (e) => {
      grid.classList.remove("drop");
      const files = [...(e.dataTransfer?.files ?? [])];
      if (files.length === 0) return;
      e.preventDefault();
      void (async () => { for (const f of files) await this.importText(await f.text(), f.name); })();
    });

    const render = () => {
      const era = this.era();
      const shown = this.shown();
      const all = this.lib.stamps;
      count.textContent = all.length === 0 ? "" : shown.length === all.length ? `${all.length} stamp${all.length === 1 ? "" : "s"}` : `${shown.length} of ${all.length}`;
      thisTileset.hidden = era === null;

      // Tags: the ones in use, filtering.
      tagsRow.replaceChildren();
      const tags = allTags(all);
      tagsRow.hidden = tags.length === 0;
      for (const t of tags) {
        const on = this.tagFilter.includes(t.tag);
        tagsRow.append(h("button", { className: `stl-tag ${on ? "on" : ""}`, type: "button", title: `${t.count} stamp${t.count === 1 ? "" : "s"}`, onClick: () => {
          this.tagFilter = on ? this.tagFilter.filter((x) => x !== t.tag) : [...this.tagFilter, t.tag];
          render();
        } }, t.tag));
      }

      // Cards.
      grid.replaceChildren();
      if (shown.length === 0) {
        const hiddenByTileset = era !== null && s.thisTileset ? filterStamps(all, { query: this.query, tags: this.tagFilter }).filter((st) => st.clip.era !== era) : [];
        const others = [...new Set(hiddenByTileset.map((st) => tilesetName(st.clip.era)))].join(", ");
        grid.append(h("div", { className: "stl-empty" },
          all.length === 0
            ? "No stamps yet. Mark an area on the Cut / Copy / Paste layer and press Save area…, or drop a stamps file here."
            : hiddenByTileset.length > 0
              ? `${hiddenByTileset.length === all.length ? "Every stamp here" : `${hiddenByTileset.length} stamp${hiddenByTileset.length === 1 ? "" : "s"}`} ${hiddenByTileset.length === 1 ? "is" : "are"} from ${others} — untick This tileset only to see them.`
              : "Nothing matches. Clear the search or untick the tags.",
        ));
      }
      for (const st of shown) {
        const foreign = era !== null && st.clip.era !== era;
        const thumbBox = h("div", { className: "stl-thumb" });
        const img = this.pictures.thumb(st);
        if (img) thumbBox.append(pictureCanvas(img, 200, 150));
        else thumbBox.append(h("div", { className: "stl-none" }, foreign ? tilesetName(st.clip.era) : `${st.clip.width} × ${st.clip.height}`));
        if (foreign && img) thumbBox.append(h("span", { className: "stl-badge" }, tilesetName(st.clip.era)));
        if (!img && !foreign) this.pictures.request(st);
        const card = h("button", {
          className: `stl-card ${this.selected === st.id ? "sel" : ""} ${this.active === st ? "on" : ""} ${foreign ? "foreign" : ""}`,
          type: "button",
          title: `${st.name}\n${stampSummary(st)}${st.tags.length ? `\n${st.tags.join(", ")}` : ""}${st.notes ? `\n${st.notes}` : ""}\n\nClick to stamp; right-click for more.`,
          onClick: () => { this.selected = st.id; if (this.active === st) this.stop(); else this.start(st); },
          onContextmenu: (e: MouseEvent) => { e.preventDefault(); this.selected = st.id; render(); this.cardMenu(st, e.clientX, e.clientY); },
        }, thumbBox, h("div", { className: "stl-name" }, st.name), h("div", { className: "stl-meta" }, `${st.clip.width} × ${st.clip.height}${st.used > 0 ? ` · used ${st.used}` : ""}`));
        grid.append(card);
      }

      // Details.
      const sel = this.current();
      detail.hidden = sel === null;
      if (sel) {
        title.textContent = sel.name;
        summary.textContent = stampSummary(sel);
        contents.textContent = `${contentsOf(sel.clip) || "empty"}${sel.tags.length ? ` · ${sel.tags.join(", ")}` : ""}`;
        notesEl.textContent = sel.notes;
        notesEl.hidden = !sel.notes;
        stampBtn.textContent = this.active === sel ? "Stop" : "Stamp";
        stampBtn.disabled = !api.document.isOpen();
        const has = partsOf(sel.clip);
        PART_LABELS.forEach((p, i) => { partTicks[i].hidden = !has[p.key]; });
        opts.hidden = false;
      } else {
        opts.hidden = true;
      }
      footer();
    };

    const footer = () => {
      const src = this.captureSource();
      saveArea.disabled = src === null;
      saveArea.title = src ? `Save ${src.label} as a stamp` : "Mark an area on the Cut / Copy / Paste layer, or select objects on their layer";
      saveArea.textContent = src && "rect" in src.source ? "Save area…" : src ? "Save selection…" : "Save area…";
      saveClip.disabled = api.clipboard.clip() === null;
      saveClip.title = saveClip.disabled ? "Copy something first" : `Save the clipboard's ${api.clipboard.summary(api.clipboard.clip()!)} as a stamp`;
    };

    this.refreshPanel = render;
    this.refreshFooter = footer;
    render();
    return () => { this.refreshPanel = null; this.refreshFooter = null; };
  }

  /** The stamps the panel shows under the current search, tags, tileset and order. */
  shown(): Stamp[] {
    const era = this.era();
    return sortStamps(filterStamps(this.lib.stamps, { query: this.query, tags: this.tagFilter, era: this.settings.thisTileset && era !== null ? era : null }), this.settings.sort);
  }

  current(): Stamp | null {
    return this.selected ? this.lib.byId(this.selected) ?? null : null;
  }

  footerChanged(): void { this.refreshFooter?.(); }

  /** The per-stamp menu, from a right-click on a card or the More button. */
  cardMenu(stamp: Stamp, x: number, y: number): void {
    document.querySelector(".stl-menu")?.remove();
    const item = (label: string, run: () => void, opts: { danger?: boolean; disabled?: boolean } = {}) =>
      h("button", { type: "button", className: opts.danger ? "danger" : "", disabled: opts.disabled, onClick: () => { close(); run(); } }, label);
    const open = this.api.document.isOpen();
    const menu = h("div", { className: "stl-menu", role: "menu" },
      item(this.active === stamp ? "Stop stamping" : "Stamp", () => (this.active === stamp ? this.stop() : this.start(stamp)), { disabled: !open }),
      item("Edit name, tags and notes…", () => void this.editDialog(stamp, null, stamp.origin)),
      item("Replace contents with the marked area", () => void this.replaceContents(stamp), { disabled: this.captureSource() === null }),
      item("Duplicate", () => this.duplicate(stamp)),
      h("div", { className: "sep" }),
      item("Copy as text", () => void this.copyAsText(stamp)),
      item("Export to a file…", () => { this.selected = stamp.id; void this.exportDialog([stamp]); }),
      h("div", { className: "sep" }),
      item("Delete…", () => void this.remove(stamp), { danger: true }),
    );
    const close = () => { menu.remove(); document.removeEventListener("pointerdown", onDown, true); document.removeEventListener("keydown", onKey, true); };
    const onDown = (e: PointerEvent) => { if (!menu.contains(e.target as Node)) close(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    document.body.append(menu);
    const r = menu.getBoundingClientRect();
    menu.style.left = `${Math.min(x, window.innerWidth - r.width - 6)}px`;
    menu.style.top = `${Math.min(y, window.innerHeight - r.height - 6)}px`;
    setTimeout(() => { document.addEventListener("pointerdown", onDown, true); document.addEventListener("keydown", onKey, true); }, 0);
  }
}

/* ── Activation ─────────────────────────────────────────── */

export default function activate(api: PluginApi): () => void {
  const lib = new StampLibrary(api);

  api.commands.register({ id: "open", title: "Stamp Library", run: () => lib.togglePanel() });
  api.commands.register({ id: "save-area", title: "Save as Stamp", run: () => lib.saveFromMap() });
  api.commands.register({ id: "save-clipboard", title: "Save Clipboard as Stamp", run: () => lib.saveFromClipboard() });
  api.commands.register({ id: "import", title: "Import Stamps", run: () => void lib.importFiles() });
  api.commands.register({ id: "export", title: "Export Stamps", run: () => void lib.exportDialog(lib.shown()) });

  api.menu.add("Tools", { label: "Stamp Library…", shortcut: "Ctrl+Shift+L", icon: "plugin", enabled: () => api.document.isOpen(), command: "open" });
  api.menu.add("Edit", { label: "Save as Stamp…", shortcut: "Ctrl+Shift+K", after: "Paste", enabled: () => lib.captureSource() !== null, command: "save-area" });
  api.contextMenu.add("viewport", { label: "Save area as stamp…", visible: (ctx) => ctx.markedArea !== null, command: "save-area" });
  api.contextMenu.add("viewport", { label: "Stamp Library…", command: "open" });
  api.hotkeys.add("Ctrl+Shift+L", { command: "open" });
  api.hotkeys.add("Ctrl+Shift+K", { command: "save-area" });

  // The pictures follow the graphics; the footer follows the selection and the clipboard.
  api.graphics.onImageLoaded(() => { lib.pictures.invalidate(); lib.refresh(); });
  api.events.on("gameData", () => { lib.pictures.invalidate(); lib.refresh(); });
  api.events.on("document", () => { lib.pictures.invalidate(); lib.refresh(); });
  api.events.on("settings", () => lib.refresh());
  api.events.on("selection", () => lib.footerChanged());
  api.events.on("clipboard", () => lib.footerChanged());
  api.events.on("layer", () => lib.footerChanged());

  lib.preferencesPage();

  if (lib.settings.open) lib.openPanel();
  // Every registration above is swept by the editor when the plugin is turned off; this is the rest.
  return () => { lib.stop(); lib.panel?.close(); };
}

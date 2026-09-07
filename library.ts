/**
 * The library itself, with nothing of the editor in it: what a stamp is, how it is
 * written to storage and to a share file, and the searching, sorting and snapping the
 * panel does. `plugin.ts` is the part that talks to the editor. Everything here is pure
 * and has tests.
 *
 * A stamp is a `Clip` — the editor's own self-contained copy of a rectangle: MTXM and
 * TILE ids, doodad / unit / sprite records with positions relative to the corner,
 * locations with their names, fog bytes — under a name, with tags, notes and the tile the
 * rectangle was copied from (`origin`), which is what lets a stamp go back down on the
 * same isometric lattice it came off.
 *
 * Storage is one JSON document per stamp under `stamp.<id>` and an `index` of ids in
 * order, so adding one writes one small record rather than the whole library, and a
 * library of several hundred pieces is read in one pass at activation. The share file is
 * the same records in one document, so a file holding one stamp and a file holding the
 * library are the same format — and so is the line of text *Copy as text* puts on the
 * clipboard.
 */
import type { Clip, ClipLocation, ClipParts, DoodadRecord, SpriteRecord, UnitRecord } from "@scm-js/plugin-api";

/* ── Model ───────────────────────────────────────────────── */

export const FORMAT = "scmjs-stamps";
export const FORMAT_VERSION = 1;

/** ERA index → the tileset's name, as the game orders them. */
export const TILESET_NAMES = ["Badlands", "Space Platform", "Installation", "Ashworld", "Jungle", "Desert", "Ice", "Twilight"] as const;

export function tilesetName(era: number): string {
  return TILESET_NAMES[era] ?? `Tileset ${era}`;
}

export interface StampMeta {
  id: string;
  name: string;
  tags: string[];
  notes: string;
  /** ISO dates. */
  created: string;
  modified: string;
  /** How many times it has been laid down. */
  used: number;
  lastUsed: string | null;
  /** The top-left tile the clip was copied from, or null when it was built from selected objects. */
  origin: { x: number; y: number } | null;
}

export interface Stamp extends StampMeta {
  clip: Clip;
}

/** A stamp as it is written: the clip's typed arrays as base64, everything else as JSON. */
export interface StoredStamp extends StampMeta {
  era: number;
  width: number;
  height: number;
  tiles: string | null;
  ground: string | null;
  doodads: DoodadRecord[];
  units: UnitRecord[];
  sprites: SpriteRecord[];
  locations: ClipLocation[];
  fog: string | null;
}

export interface ShareFile {
  format: typeof FORMAT;
  version: number;
  exported: string;
  /** Who wrote it — the plugin's version, for a reader wondering. */
  generator?: string;
  stamps: StoredStamp[];
}

export function newId(random: () => number = Math.random): string {
  let s = "";
  for (let i = 0; i < 12; i++) s += Math.floor(random() * 36).toString(36);
  return s;
}

export function makeStamp(name: string, clip: Clip, options: { tags?: string[]; notes?: string; origin?: { x: number; y: number } | null; now?: string; id?: string } = {}): Stamp {
  const now = options.now ?? new Date().toISOString();
  return {
    id: options.id ?? newId(),
    name: name.trim() || "Untitled stamp",
    tags: normalizeTags(options.tags ?? []),
    notes: options.notes ?? "",
    created: now,
    modified: now,
    used: 0,
    lastUsed: null,
    origin: options.origin ?? null,
    clip,
  };
}

/** The parts a clip actually carries, which is what the stamping options offer. */
export function partsOf(clip: Clip): ClipParts {
  return {
    terrain: clip.tiles !== null,
    doodads: clip.doodads.length > 0,
    units: clip.units.length > 0,
    sprites: clip.sprites.length > 0,
    locations: clip.locations.length > 0,
    fog: clip.fog !== null,
  };
}

/** `12 × 8 · Jungle`. */
export function stampSummary(stamp: Stamp): string {
  return `${stamp.clip.width} × ${stamp.clip.height} · ${tilesetName(stamp.clip.era)}`;
}

/** What is in a clip, in words — `3 doodads · 2 units`; empty for terrain alone. */
export function contentsOf(clip: Clip): string {
  const n = (count: number, noun: string) => (count === 0 ? null : `${count} ${noun}${count === 1 ? "" : "s"}`);
  return [clip.tiles ? "terrain" : null, n(clip.doodads.length, "doodad"), n(clip.units.length, "unit"), n(clip.sprites.length, "sprite"), n(clip.locations.length, "location"), clip.fog ? "fog" : null]
    .filter((p): p is string => p !== null).join(" · ");
}

/* ── Tags ────────────────────────────────────────────────── */

/** `"ramp, Cliff ,ramp"` → `["cliff", "ramp"]`: lower-case, trimmed, unique, sorted. */
export function parseTags(text: string): string[] {
  return normalizeTags(text.split(/[,;\n]/));
}

export function normalizeTags(tags: readonly string[]): string[] {
  const out = new Set<string>();
  for (const t of tags) {
    const clean = t.trim().toLowerCase().replace(/\s+/g, " ");
    if (clean) out.add(clean);
  }
  return [...out].sort();
}

export interface TagCount { tag: string; count: number }

/** Every tag in use, most used first, then alphabetical. */
export function allTags(stamps: readonly Stamp[]): TagCount[] {
  const counts = new Map<string, number>();
  for (const s of stamps) for (const t of s.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/* ── Searching and sorting ───────────────────────────────── */

export interface Filter {
  /** Words matched against the name, the tags and the notes; all must match. */
  query?: string;
  /** Every one of these tags must be on the stamp. */
  tags?: readonly string[];
  /** Only stamps of this tileset (ERA index). */
  era?: number | null;
}

export function filterStamps(stamps: readonly Stamp[], filter: Filter): Stamp[] {
  const words = (filter.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const tags = filter.tags ?? [];
  return stamps.filter((s) => {
    if (filter.era !== undefined && filter.era !== null && s.clip.era !== filter.era) return false;
    if (tags.some((t) => !s.tags.includes(t))) return false;
    if (words.length === 0) return true;
    const hay = `${s.name} ${s.tags.join(" ")} ${s.notes} ${tilesetName(s.clip.era)}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

export type SortBy = "recent" | "name" | "size" | "used";

export const SORTS: { id: SortBy; label: string }[] = [
  { id: "recent", label: "Newest first" },
  { id: "name", label: "Name" },
  { id: "size", label: "Size" },
  { id: "used", label: "Most used" },
];

export function sortStamps(stamps: readonly Stamp[], by: SortBy): Stamp[] {
  const out = [...stamps];
  const byName = (a: Stamp, b: Stamp) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  switch (by) {
    case "name": out.sort(byName); break;
    case "size": out.sort((a, b) => b.clip.width * b.clip.height - a.clip.width * a.clip.height || byName(a, b)); break;
    case "used": out.sort((a, b) => b.used - a.used || (b.lastUsed ?? "").localeCompare(a.lastUsed ?? "") || byName(a, b)); break;
    default: out.sort((a, b) => b.created.localeCompare(a.created) || byName(a, b));
  }
  return out;
}

/** A name no other stamp has: `Ramp`, `Ramp 2`, `Ramp 3`, … (`skipId` is the stamp being renamed). */
export function uniqueName(name: string, stamps: readonly Stamp[], skipId?: string): string {
  const used = new Set<string>();
  for (const s of stamps) if (s.id !== skipId) used.add(s.name.toLowerCase());
  const base = name.trim() || "Untitled stamp";
  if (!used.has(base.toLowerCase())) return base;
  const m = /^(.*?)(?: (\d+))?$/.exec(base);
  const stem = (m?.[1] ?? base).trim() || base;
  for (let i = Math.max(2, Number(m?.[2] ?? 1) + 1); ; i++) {
    const candidate = `${stem} ${i}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

/* ── The isometric lattice ───────────────────────────────── */

/**
 * The tile to stamp at so the piece sits on the same isometric lattice it was copied
 * from. The isometric brush's diamonds are two tiles wide and stagger by one tile every
 * row, so the lattice repeats every two tiles both ways: a piece copied from (ox, oy)
 * lines up at every (x, y) whose offsets from there are both even. The nearest such
 * tile at or before the pointer is answered; a stamp with no origin snaps to nothing.
 */
export function snapToLattice(x: number, y: number, origin: { x: number; y: number } | null): { x: number; y: number } {
  if (!origin) return { x, y };
  return { x: x - (((x - origin.x) % 2) + 2) % 2, y: y - (((y - origin.y) % 2) + 2) % 2 };
}

/* ── Codec ───────────────────────────────────────────────── */

const CHUNK = 0x8000;

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

export function base64ToBytes(text: string): Uint8Array {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Little-endian, whatever the machine. */
export function u16ToBase64(words: Uint16Array): string {
  const bytes = new Uint8Array(words.length * 2);
  for (let i = 0; i < words.length; i++) { bytes[i * 2] = words[i] & 0xff; bytes[i * 2 + 1] = words[i] >> 8; }
  return bytesToBase64(bytes);
}

export function base64ToU16(text: string): Uint16Array {
  const bytes = base64ToBytes(text);
  const words = new Uint16Array(bytes.length >> 1);
  for (let i = 0; i < words.length; i++) words[i] = bytes[i * 2] | (bytes[i * 2 + 1] << 8);
  return words;
}

export function encodeStamp(stamp: Stamp): StoredStamp {
  const { clip, ...meta } = stamp;
  return {
    ...meta,
    era: clip.era,
    width: clip.width,
    height: clip.height,
    tiles: clip.tiles ? u16ToBase64(clip.tiles) : null,
    ground: clip.ground ? u16ToBase64(clip.ground) : null,
    doodads: clip.doodads.map((d) => ({ ...d })),
    units: clip.units.map((u) => ({ ...u })),
    sprites: clip.sprites.map((s) => ({ ...s })),
    locations: clip.locations.map((l) => ({ ...l })),
    fog: clip.fog ? bytesToBase64(clip.fog) : null,
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const num = (v: unknown, fallback = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const arr = <T>(v: unknown, each: (x: unknown) => T | null): T[] => (Array.isArray(v) ? v.map(each).filter((x): x is T => x !== null) : []);

/** Records are copied field by field so a file carries nothing into the map but numbers. */
const unitRecord = (v: unknown): UnitRecord | null => isObj(v) && typeof v.unitId === "number" ? {
  serial: num(v.serial), x: num(v.x), y: num(v.y), unitId: num(v.unitId), relationType: num(v.relationType), validProperties: num(v.validProperties),
  validStates: num(v.validStates), owner: num(v.owner), hitPointsPercent: num(v.hitPointsPercent, 100), shieldPercent: num(v.shieldPercent, 100),
  energyPercent: num(v.energyPercent, 100), resourceAmount: num(v.resourceAmount), hangarUnits: num(v.hangarUnits), stateFlags: num(v.stateFlags),
  unused: num(v.unused), relatedSerial: num(v.relatedSerial),
} : null;
const spriteRecord = (v: unknown): SpriteRecord | null => isObj(v) && typeof v.spriteId === "number"
  ? { spriteId: num(v.spriteId), x: num(v.x), y: num(v.y), owner: num(v.owner), unused: num(v.unused), flags: num(v.flags) } : null;
const doodadRecord = (v: unknown): DoodadRecord | null => isObj(v) && typeof v.doodadId === "number"
  ? { doodadId: num(v.doodadId), x: num(v.x), y: num(v.y), owner: num(v.owner), disabled: num(v.disabled) } : null;
const clipLocation = (v: unknown): ClipLocation | null => isObj(v)
  ? { left: num(v.left), top: num(v.top), right: num(v.right), bottom: num(v.bottom), elevationFlags: num(v.elevationFlags), name: str(v.name) } : null;

/**
 * A stored record back into a stamp, or null when it is not one. Sizes are checked
 * against the arrays, so a hand-edited file cannot make a clip whose picture is shorter
 * than its rectangle.
 */
export function decodeStamp(raw: unknown): Stamp | null {
  if (!isObj(raw) || typeof raw.id !== "string" || typeof raw.name !== "string") return null;
  const width = num(raw.width), height = num(raw.height), era = num(raw.era, -1);
  if (width < 1 || height < 1 || width > 256 || height > 256 || era < 0 || era > 7) return null;
  let tiles: Uint16Array | null = null, ground: Uint16Array | null = null, fog: Uint8Array | null = null;
  try {
    if (typeof raw.tiles === "string") tiles = base64ToU16(raw.tiles);
    if (typeof raw.ground === "string") ground = base64ToU16(raw.ground);
    if (typeof raw.fog === "string") fog = base64ToBytes(raw.fog);
  } catch {
    return null;
  }
  const cells = width * height;
  if (tiles && tiles.length !== cells) return null;
  if (ground && ground.length !== cells) return null;
  if (fog && fog.length !== cells) return null;
  // A picture without its ground (an older writer, a trimmed file) stands in for both.
  if (tiles && !ground) ground = tiles.slice();
  if (!tiles && ground) tiles = ground.slice();
  const now = new Date().toISOString();
  const origin = isObj(raw.origin) ? { x: num(raw.origin.x), y: num(raw.origin.y) } : null;
  return {
    id: raw.id,
    name: raw.name.trim() || "Untitled stamp",
    tags: normalizeTags(arr(raw.tags, (t) => (typeof t === "string" ? t : null))),
    notes: str(raw.notes),
    created: str(raw.created, now),
    modified: str(raw.modified, str(raw.created, now)),
    used: Math.max(0, Math.floor(num(raw.used))),
    lastUsed: typeof raw.lastUsed === "string" ? raw.lastUsed : null,
    origin,
    clip: {
      width, height, era, tiles, ground,
      doodads: arr(raw.doodads, doodadRecord),
      units: arr(raw.units, unitRecord),
      sprites: arr(raw.sprites, spriteRecord),
      locations: arr(raw.locations, clipLocation),
      fog,
    },
  };
}

/* ── The share file ──────────────────────────────────────── */

export function encodeShare(stamps: readonly Stamp[], options: { now?: string; generator?: string; pretty?: boolean } = {}): string {
  const file: ShareFile = {
    format: FORMAT,
    version: FORMAT_VERSION,
    exported: options.now ?? new Date().toISOString(),
    ...(options.generator ? { generator: options.generator } : {}),
    stamps: stamps.map(encodeStamp),
  };
  return JSON.stringify(file, null, options.pretty ? 2 : undefined);
}

export type DecodeResult = { stamps: Stamp[]; skipped: number } | { error: string };

/**
 * Read a share file, a single stored stamp, or a bare array of them — anything the
 * plugin or a hand ever wrote. Records that do not decode are counted, not fatal.
 */
export function decodeShare(text: string): DecodeResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { error: "This is not JSON." };
  }
  let list: unknown[];
  if (Array.isArray(raw)) list = raw;
  else if (isObj(raw) && Array.isArray(raw.stamps)) {
    if (raw.format !== undefined && raw.format !== FORMAT) return { error: `This is a "${String(raw.format)}" file, not a stamp library.` };
    if (typeof raw.version === "number" && raw.version > FORMAT_VERSION) return { error: `This file was written by a newer version of the plugin (format ${raw.version}); update the plugin to read it.` };
    list = raw.stamps;
  } else if (isObj(raw) && typeof raw.id === "string" && typeof raw.width === "number") list = [raw];
  else return { error: "There are no stamps in this file." };
  const stamps: Stamp[] = [];
  let skipped = 0;
  for (const item of list) {
    const s = decodeStamp(item);
    if (s) stamps.push(s); else skipped++;
  }
  if (stamps.length === 0 && skipped > 0) return { error: `None of the ${skipped} record${skipped === 1 ? "" : "s"} in this file could be read as a stamp.` };
  return { stamps, skipped };
}

/* ── Merging an import ───────────────────────────────────── */

export interface MergePlan {
  /** Not in the library yet. */
  added: Stamp[];
  /** Already here by id; replaced when asked. */
  replaced: Stamp[];
  /** Already here and left as is. */
  skipped: Stamp[];
}

/** Sort an import into what is new and what is already here, by id. */
export function planMerge(existing: readonly Stamp[], incoming: readonly Stamp[], replace: boolean): MergePlan {
  const have = new Set(existing.map((s) => s.id));
  const plan: MergePlan = { added: [], replaced: [], skipped: [] };
  const seen = new Set<string>();
  for (const s of incoming) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    if (!have.has(s.id)) plan.added.push(s);
    else if (replace) plan.replaced.push(s);
    else plan.skipped.push(s);
  }
  return plan;
}

/** Rough size of a stamp as stored, in characters — what it costs against the browser's quota. */
export function storedSize(stamp: Stamp): number {
  return JSON.stringify(encodeStamp(stamp)).length;
}

export function formatSize(chars: number): string {
  if (chars < 1024) return `${chars} B`;
  if (chars < 1024 * 1024) return `${(chars / 1024).toFixed(chars < 10240 ? 1 : 0)} KB`;
  return `${(chars / (1024 * 1024)).toFixed(1)} MB`;
}

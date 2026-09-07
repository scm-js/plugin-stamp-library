import { describe, expect, it } from "vitest";
import type { Clip } from "@scm-js/plugin-api";
import {
  allTags, base64ToU16, contentsOf, decodeShare, decodeStamp, encodeShare, encodeStamp, filterStamps, makeStamp, newId, normalizeTags, parseTags, partsOf,
  planMerge, snapToLattice, sortStamps, stampSummary, storedSize, u16ToBase64, uniqueName,
} from "../library";

function clip(width = 3, height = 2, era = 4, extra: Partial<Clip> = {}): Clip {
  const tiles = new Uint16Array(width * height).map((_, i) => 0x100 + i);
  return { width, height, era, tiles, ground: tiles.slice(), doodads: [], units: [], sprites: [], locations: [], fog: null, ...extra };
}

const unit = (x: number, y: number, serial = 1) => ({
  serial, x, y, unitId: 7, relationType: 0, validProperties: 0, validStates: 0, owner: 2, hitPointsPercent: 100, shieldPercent: 100, energyPercent: 100,
  resourceAmount: 0, hangarUnits: 0, stateFlags: 0, unused: 0, relatedSerial: 0,
});

describe("stamps", () => {
  it("makeStamp names, normalises tags and records the origin", () => {
    const s = makeStamp("  Ramp  ", clip(), { tags: ["Cliff", " ramp", "cliff"], origin: { x: 4, y: 6 }, now: "2026-01-01T00:00:00.000Z", id: "abc" });
    expect(s).toMatchObject({ id: "abc", name: "Ramp", tags: ["cliff", "ramp"], notes: "", used: 0, lastUsed: null, origin: { x: 4, y: 6 }, created: "2026-01-01T00:00:00.000Z" });
    expect(makeStamp("   ", clip()).name).toBe("Untitled stamp");
    expect(newId()).toMatch(/^[0-9a-z]{12}$/);
    expect(newId(() => 0)).toBe("000000000000");
  });

  it("says what a clip holds", () => {
    const c = clip(3, 2, 6, { units: [unit(10, 10)], doodads: [{ doodadId: 1, x: 0, y: 0, owner: 0, disabled: 0 }] });
    expect(partsOf(c)).toEqual({ terrain: true, doodads: true, units: true, sprites: false, locations: false, fog: false });
    expect(contentsOf(c)).toBe("terrain · 1 doodad · 1 unit");
    expect(stampSummary(makeStamp("x", c))).toBe("3 × 2 · Ice");
    expect(contentsOf(clip(1, 1, 0, { tiles: null, ground: null, sprites: [{ spriteId: 1, x: 0, y: 0, owner: 0, unused: 0, flags: 0 }, { spriteId: 2, x: 0, y: 0, owner: 0, unused: 0, flags: 0 }] }))).toBe("2 sprites");
  });
});

describe("tags", () => {
  it("parses a typed list", () => {
    expect(parseTags("ramp, Cliff ;ramp\n high   ground")).toEqual(["cliff", "high ground", "ramp"]);
    expect(normalizeTags(["", "  "])).toEqual([]);
  });
  it("counts tags across the library, most used first", () => {
    const a = makeStamp("a", clip(), { tags: ["ramp", "cliff"] });
    const b = makeStamp("b", clip(), { tags: ["ramp"] });
    expect(allTags([a, b])).toEqual([{ tag: "ramp", count: 2 }, { tag: "cliff", count: 1 }]);
  });
});

describe("searching and sorting", () => {
  const ramp = makeStamp("North ramp", clip(4, 4, 4), { tags: ["ramp"], notes: "faces the main", now: "2026-01-02T00:00:00.000Z" });
  const bridge = makeStamp("Bridge", clip(8, 3, 4), { tags: ["bridge", "water"], now: "2026-01-03T00:00:00.000Z" });
  const iceRamp = makeStamp("Ice ramp", clip(4, 4, 6), { tags: ["ramp"], now: "2026-01-01T00:00:00.000Z" });
  const all = [ramp, bridge, iceRamp];

  it("filters by words, tags and tileset", () => {
    expect(filterStamps(all, { query: "ramp" }).map((s) => s.name)).toEqual(["North ramp", "Ice ramp"]);
    expect(filterStamps(all, { query: "main" }).map((s) => s.name)).toEqual(["North ramp"]);
    expect(filterStamps(all, { query: "ramp ice" }).map((s) => s.name)).toEqual(["Ice ramp"]);
    expect(filterStamps(all, { query: "jungle" }).map((s) => s.name)).toEqual(["North ramp", "Bridge"]);
    expect(filterStamps(all, { tags: ["ramp"], era: 4 }).map((s) => s.name)).toEqual(["North ramp"]);
    expect(filterStamps(all, { tags: ["water", "bridge"] }).map((s) => s.name)).toEqual(["Bridge"]);
    expect(filterStamps(all, { era: null })).toHaveLength(3);
  });

  it("sorts four ways", () => {
    expect(sortStamps(all, "recent").map((s) => s.name)).toEqual(["Bridge", "North ramp", "Ice ramp"]);
    expect(sortStamps(all, "name").map((s) => s.name)).toEqual(["Bridge", "Ice ramp", "North ramp"]);
    expect(sortStamps(all, "size").map((s) => s.name)).toEqual(["Bridge", "Ice ramp", "North ramp"]);
    const used = { ...ramp, used: 3 };
    expect(sortStamps([bridge, used, iceRamp], "used")[0].name).toBe("North ramp");
    expect(all.map((s) => s.name)).toEqual(["North ramp", "Bridge", "Ice ramp"]); // not sorted in place
  });

  it("finds a free name", () => {
    expect(uniqueName("Ramp", all)).toBe("Ramp");
    expect(uniqueName("north ramp", all)).toBe("north ramp 2");
    expect(uniqueName("North ramp", all, ramp.id)).toBe("North ramp");
    const two = [...all, makeStamp("North ramp 2", clip())];
    expect(uniqueName("North ramp 2", two)).toBe("North ramp 3");
    expect(uniqueName("  ", [])).toBe("Untitled stamp");
  });
});

describe("the lattice", () => {
  it("keeps both offsets from the origin even", () => {
    expect(snapToLattice(10, 7, { x: 4, y: 3 })).toEqual({ x: 10, y: 7 });
    expect(snapToLattice(11, 8, { x: 4, y: 3 })).toEqual({ x: 10, y: 7 });
    expect(snapToLattice(3, 2, { x: 4, y: 3 })).toEqual({ x: 2, y: 1 });
    expect(snapToLattice(-1, 0, { x: 0, y: 1 })).toEqual({ x: -2, y: -1 });
    expect(snapToLattice(11, 8, null)).toEqual({ x: 11, y: 8 });
  });
});

describe("the codec", () => {
  it("round-trips words little-endian", () => {
    const words = new Uint16Array([0, 1, 0x1234, 0xffff]);
    const text = u16ToBase64(words);
    expect(text).toBe("AAABADQS//8=");
    expect(Array.from(base64ToU16(text))).toEqual(Array.from(words));
    expect(u16ToBase64(new Uint16Array(70000))).toHaveLength(Math.ceil(140000 / 3) * 4);
  });

  it("encodes and decodes a stamp with every part", () => {
    const c = clip(2, 2, 3, {
      units: [unit(5, 6, 9)],
      sprites: [{ spriteId: 1, x: 2, y: 3, owner: 4, unused: 0, flags: 0x1000 }],
      doodads: [{ doodadId: 3, x: 32, y: 32, owner: 0, disabled: 0 }],
      locations: [{ left: 0, top: 0, right: 64, bottom: 64, elevationFlags: 0, name: "Base" }],
      fog: new Uint8Array([0, 1, 255, 3]),
    });
    const s = makeStamp("Everything", c, { tags: ["all"], notes: "n", origin: { x: 1, y: 2 }, now: "2026-01-01T00:00:00.000Z", id: "id1" });
    const stored = encodeStamp(s);
    expect(stored).toMatchObject({ id: "id1", era: 3, width: 2, height: 2, tiles: expect.any(String), fog: expect.any(String) });
    expect(JSON.parse(JSON.stringify(stored))).toEqual(stored); // plain JSON, no typed arrays
    const back = decodeStamp(JSON.parse(JSON.stringify(stored)))!;
    expect(back.id).toBe("id1");
    expect(back.clip.era).toBe(3);
    expect(Array.from(back.clip.tiles!)).toEqual(Array.from(c.tiles!));
    expect(Array.from(back.clip.fog!)).toEqual([0, 1, 255, 3]);
    expect(back.clip.units).toEqual(c.units);
    expect(back.clip.sprites).toEqual(c.sprites);
    expect(back.clip.doodads).toEqual(c.doodads);
    expect(back.clip.locations).toEqual(c.locations);
    expect(back.origin).toEqual({ x: 1, y: 2 });
    expect(storedSize(s)).toBeGreaterThan(200);
  });

  it("refuses what is not a stamp and repairs what it can", () => {
    expect(decodeStamp(null)).toBeNull();
    expect(decodeStamp({ id: "x" })).toBeNull();
    expect(decodeStamp({ id: "x", name: "n", width: 2, height: 2, era: 9 })).toBeNull();
    expect(decodeStamp({ id: "x", name: "n", width: 2, height: 2, era: 0, tiles: u16ToBase64(new Uint16Array(3)) })).toBeNull(); // short picture
    expect(decodeStamp({ id: "x", name: "n", width: 2, height: 2, era: 0, tiles: "!!!" })).toBeNull();
    const noGround = decodeStamp({ id: "x", name: "n", width: 1, height: 1, era: 0, tiles: u16ToBase64(new Uint16Array([5])) })!;
    expect(Array.from(noGround.clip.ground!)).toEqual([5]);
    const objectsOnly = decodeStamp({ id: "x", name: " ", width: 1, height: 1, era: 0, units: [{ unitId: 1, x: 1, y: 1 }, "junk"], tags: ["A", 3] })!;
    expect(objectsOnly.name).toBe("Untitled stamp");
    expect(objectsOnly.clip.tiles).toBeNull();
    expect(objectsOnly.clip.units).toHaveLength(1);
    expect(objectsOnly.clip.units[0]).toMatchObject({ unitId: 1, hitPointsPercent: 100, owner: 0 });
    expect(objectsOnly.tags).toEqual(["a"]);
  });

  it("writes and reads a share file, in any of its shapes", () => {
    const a = makeStamp("a", clip(), { id: "a" });
    const b = makeStamp("b", clip(), { id: "b" });
    const text = encodeShare([a, b], { now: "2026-01-01T00:00:00.000Z", generator: "test" });
    const file = JSON.parse(text);
    expect(file).toMatchObject({ format: "scmjs-stamps", version: 1, exported: "2026-01-01T00:00:00.000Z", generator: "test" });
    expect(file.stamps).toHaveLength(2);
    const r = decodeShare(text);
    expect("stamps" in r && r.stamps.map((s) => s.id)).toEqual(["a", "b"]);
    // One stored stamp on its own, and a bare array, read the same way.
    expect("stamps" in decodeShare(JSON.stringify(encodeStamp(a))) && true).toBe(true);
    expect("stamps" in decodeShare(JSON.stringify([encodeStamp(a)])) && true).toBe(true);
    const mixed = decodeShare(JSON.stringify({ format: "scmjs-stamps", version: 1, stamps: [encodeStamp(a), { nope: 1 }] }));
    expect(mixed).toMatchObject({ skipped: 1 });
    expect(decodeShare("not json")).toEqual({ error: "This is not JSON." });
    expect(decodeShare("{}")).toEqual({ error: "There are no stamps in this file." });
    expect(decodeShare(JSON.stringify({ format: "other", stamps: [] }))).toMatchObject({ error: expect.stringContaining("other") });
    expect(decodeShare(JSON.stringify({ format: "scmjs-stamps", version: 9, stamps: [] }))).toMatchObject({ error: expect.stringContaining("newer") });
    expect(decodeShare(JSON.stringify({ format: "scmjs-stamps", version: 1, stamps: [{ bad: true }] }))).toMatchObject({ error: expect.stringContaining("None of the 1 record") });
  });

  it("plans a merge by id", () => {
    const a = makeStamp("a", clip(), { id: "a" });
    const b = makeStamp("b", clip(), { id: "b" });
    const a2 = { ...a, name: "a renamed" };
    expect(planMerge([a], [a2, b, b], false)).toEqual({ added: [b], replaced: [], skipped: [a2] });
    expect(planMerge([a], [a2, b], true)).toEqual({ added: [b], replaced: [a2], skipped: [] });
  });
});

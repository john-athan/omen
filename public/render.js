// Pixel renderer. Every tile and every villager is drawn from code at 16 px,
// then scaled. The static village is painted once; water, smoke, light and
// people are drawn per frame.

import { T, BUILDINGS, hash2, dayPhase, roomAt, OUT_H } from "./shared/world.js";

export const TILE = 16;
const STEP_MS = 380;

// Canvas cannot read CSS custom properties per pixel, so the pixel palette
// lives here as its own token block.
const P = {
  grass: "#5d8a3c", grass2: "#6b9a45", grass3: "#4f7a33", flowerA: "#e8d36a", flowerB: "#e07a8f", flowerC: "#f2efe6",
  dirt: "#b38b5a", dirt2: "#a07b4c", dirt3: "#c49c6a", stone: "#9a968c", stone2: "#827e75", stone3: "#b3afa4", mortar: "#6f6b63",
  water: "#2f5f7f", water2: "#3a7396", water3: "#24506d", foam: "#a9d3e6",
  trunk: "#5a3b22", leaf: "#2f6a2c", leaf2: "#3d7e35", leaf3: "#245622", apple: "#c8352c",
  wall: "#d9c7a3", wall2: "#bfae8a", beam: "#5a3b22", door: "#4a2e1a", window: "#2b3140", windowLit: "#ffcf6a",
  roofRed: "#9c3f2f", roofOchre: "#b8862f", roofSlate: "#4f5a68", roofMoss: "#5f6f3a",
  fence: "#7a5a36", fence2: "#5e4428", grave: "#8f8c86", grave2: "#6d6a64",
  awningA: "#c2413a", awningB: "#efe6d2", table: "#7a5a36",
  plank: "#8a6a42", plank2: "#6f5434", crop: "#6a4a2c", sprout: "#7fb04a",
  candle: "#ffe9a8", flame: "#ffb347", ink: "#14161f", shadow: "rgba(10,12,20,.28)",
  board: "#9a7148", board2: "#86603b", board3: "#a87f53", iwall: "#5b4a3a", iwall2: "#4a3b2e", iwallTop: "#76624d",
  straw: "#d8b45c", blanket: "#7a3f4a", iron: "#3d3f45", iron2: "#55585f", brick: "#8a4a32", brick2: "#6f3a27",
  coal: "#c8452a", rug: "#8c3b2e", rug2: "#b0573f", paper: "#efe6d2", book1: "#6a3e7a", book2: "#2e6a6a", book3: "#a0702a",
  night: "rgba(14,18,46,1)", dusk: "rgba(80,40,70,1)", omen: "#8f5cff", omenDeep: "#1a0b2e",
};

function px(g, x, y, w, h, c) { g.fillStyle = c; g.fillRect(x, y, w, h); }

function speckle(g, ox, oy, seed, colors, n) {
  for (let i = 0; i < n; i++) {
    const h = hash2(seed * 31 + i, seed * 17 - i);
    const x = Math.floor(hash2(seed + i * 7, 3) * 16), y = Math.floor(h * 16);
    px(g, ox + x, oy + y, 1, 1, colors[i % colors.length]);
  }
}

export function paintWorld(world) {
  const c = new OffscreenCanvas(world.w * TILE, world.h * TILE);
  const g = c.getContext("2d");
  const at = (x, y) => (x < 0 || y < 0 || x >= world.w || y >= world.h ? T.TREE : world.tiles[y * world.w + x]);
  const lights = [], chimneys = [], waters = [];

  const ground = (x, y, v) => {
    const ox = x * TILE, oy = y * TILE, s = y * world.w + x;
    switch (v) {
      case T.PATH: case T.DOOR:
        px(g, ox, oy, 16, 16, P.dirt); speckle(g, ox, oy, s, [P.dirt2, P.dirt3], 10); break;
      case T.PLAZA: case T.WELL: case T.ALTAR: case T.STONE: {
        px(g, ox, oy, 16, 16, P.mortar);
        for (let r = 0; r < 4; r++) for (let k = 0; k < 3; k++) {
          const sx = ox + ((k * 6 + (r % 2) * 3) % 16), sy = oy + r * 4;
          const col = hash2(s + k, r) > 0.8 ? P.stone2 : P.stone;
          px(g, sx, sy, 5, 3, col);
          if (sx + 5 > ox + 16) px(g, ox, sy, sx + 5 - ox - 16, 3, col);
        }
        break;
      }
      case T.WATER: case T.DOCK:
        px(g, ox, oy, 16, 16, P.water); speckle(g, ox, oy, s, [P.water3, P.water2], 8);
        waters.push([x, y]);
        if (at(x, y - 1) !== T.WATER && at(x, y - 1) !== T.DOCK) px(g, ox, oy, 16, 2, P.foam);
        if (at(x - 1, y) !== T.WATER && at(x - 1, y) !== T.DOCK) px(g, ox, oy, 1, 16, P.foam);
        if (at(x + 1, y) !== T.WATER && at(x + 1, y) !== T.DOCK) px(g, ox + 15, oy, 1, 16, P.foam);
        if (at(x, y + 1) !== T.WATER && at(x, y + 1) !== T.DOCK) px(g, ox, oy + 15, 16, 1, P.water3);
        break;
      case T.CROP:
        px(g, ox, oy, 16, 16, P.crop);
        for (let k = 0; k < 4; k++) { px(g, ox + 1 + k * 4, oy + 9, 2, 3, P.sprout); px(g, ox + k * 4, oy + 8, 1, 1, P.sprout); px(g, ox + 3 + k * 4, oy + 7, 1, 2, P.sprout); }
        px(g, ox, oy + 13, 16, 1, P.dirt2);
        break;
      case T.VOID: px(g, ox, oy, 16, 16, P.ink); break;
      case T.IWALL:
        px(g, ox, oy, 16, 16, P.iwall);
        for (let r = 0; r < 4; r++) px(g, ox + ((r % 2) * 8), oy + r * 4 + 3, 8, 1, P.iwall2);
        if (at(x, y + 1) !== T.IWALL && at(x, y + 1) !== T.VOID) px(g, ox, oy + 14, 16, 2, P.iwallTop);
        break;
      case T.FLOOR: case T.EXIT: case T.CHAIR: case T.BED: case T.RUG:
      case T.STOVE: case T.OVEN: case T.COUNTER: case T.TABLE: case T.ANVIL: case T.FORGE: case T.BARREL: case T.SHELF: case T.DESK: case T.HEARTH: case T.CHEST:
        // wooden boards under everything indoors
        px(g, ox, oy, 16, 16, P.board);
        for (let k = 0; k < 4; k++) px(g, ox, oy + k * 4 + 3, 16, 1, P.board2);
        px(g, ox + ((x * 5 + y * 3) % 12) + 2, oy + 1, 1, 2, P.board3);
        if (v === T.RUG) { px(g, ox + 1, oy + 2, 14, 12, P.rug); px(g, ox + 3, oy + 4, 10, 8, P.rug2); px(g, ox + 5, oy + 6, 6, 4, P.rug); }
        if (v === T.EXIT) { px(g, ox + 3, oy + 8, 10, 7, P.straw); px(g, ox + 3, oy + 14, 10, 1, P.dirt2); }
        break;
      default:
        px(g, ox, oy, 16, 16, P.grass); speckle(g, ox, oy, s, [P.grass2, P.grass3, P.grass2], 14);
        if (v === T.FLOWERS) speckle(g, ox, oy, s + 999, [P.flowerA, P.flowerB, P.flowerC], 5);
    }
  };

  for (let y = 0; y < world.h; y++) for (let x = 0; x < world.w; x++) ground(x, y, at(x, y));

  const tree = (x, y, big) => {
    const ox = x * TILE, oy = y * TILE;
    px(g, ox + 7, oy + 9, 3, 6, P.trunk);
    px(g, ox + 3, oy + 14, 11, 2, P.shadow);
    const blob = [[2, 2, 12, 9], [1, 4, 14, 6], [4, 0, 8, 12], [3, 1, 10, 10]];
    for (const [bx, by, bw, bh] of blob) px(g, ox + bx, oy + by - 4, bw, bh, P.leaf);
    px(g, ox + 4, oy - 3, 5, 3, P.leaf2); px(g, ox + 3, oy - 1, 3, 2, P.leaf2);
    px(g, ox + 9, oy + 5, 5, 2, P.leaf3); px(g, ox + 2, oy + 4, 3, 2, P.leaf3);
    if (big) for (let i = 0; i < 4; i++) px(g, ox + 3 + i * 3, oy - 1 + (i % 2) * 5, 2, 2, P.apple);
  };

  const sprites = [], fires = [];
  // ---- furniture: drawn on top of the boards, back to front ----
  const furniture = (x, y, v) => {
    const ox = x * TILE, oy = y * TILE;
    if (v === T.BED) {
      const head = at(x, y - 1) !== T.BED;
      px(g, ox + 1, oy + (head ? 2 : 0), 14, head ? 14 : 14, P.plank2);
      px(g, ox + 2, oy + (head ? 3 : 0), 12, 12, P.straw);
      if (head) { px(g, ox + 3, oy + 4, 10, 4, P.flowerC); }
      else { px(g, ox + 2, oy, 12, 12, P.blanket); px(g, ox + 2, oy, 12, 1, shade(P.blanket, 1.2)); }
    } else if (v === T.STOVE) {
      px(g, ox + 2, oy + 3, 12, 12, P.iron); px(g, ox + 2, oy + 3, 12, 2, P.iron2); px(g, ox + 5, oy + 9, 6, 4, P.ink);
      px(g, ox + 5, oy, 6, 4, P.iron2); px(g, ox + 6, oy + 10, 4, 2, P.coal);
      fires.push({ x: ox + 8, y: oy + 11, r: 8 });
    } else if (v === T.OVEN) {
      const left = at(x - 1, y) !== T.OVEN;
      px(g, ox, oy + 2, 16, 14, P.brick); for (let k = 0; k < 3; k++) px(g, ox + (k % 2) * 4, oy + 5 + k * 4, 16, 1, P.brick2);
      if (left) { px(g, ox + 8, oy + 8, 8, 7, P.ink); px(g, ox + 9, oy + 11, 6, 3, P.coal); fires.push({ x: ox + 12, y: oy + 12, r: 10 }); }
      else px(g, ox, oy + 8, 6, 7, P.ink);
    } else if (v === T.COUNTER) {
      px(g, ox, oy + 4, 16, 11, P.plank2); px(g, ox, oy + 3, 16, 3, P.plank);
      if ((x + y) % 2) { px(g, ox + 3, oy, 5, 3, P.dirt3); px(g, ox + 9, oy + 1, 3, 2, P.dirt3); } else px(g, ox + 5, oy, 4, 3, P.dirt3);
    } else if (v === T.TABLE) {
      px(g, ox + 1, oy + 4, 14, 7, P.plank); px(g, ox + 1, oy + 4, 14, 1, P.board3);
      px(g, ox + 2, oy + 11, 2, 4, P.plank2); px(g, ox + 12, oy + 11, 2, 4, P.plank2); px(g, ox + 6, oy + 5, 3, 2, P.dirt3);
    } else if (v === T.CHAIR) {
      px(g, ox + 5, oy + 4, 6, 2, P.plank2); px(g, ox + 5, oy + 8, 6, 3, P.plank); px(g, ox + 5, oy + 11, 1, 3, P.plank2); px(g, ox + 10, oy + 11, 1, 3, P.plank2);
    } else if (v === T.ANVIL) {
      px(g, ox + 2, oy + 6, 12, 3, P.iron2); px(g, ox + 1, oy + 6, 3, 2, P.iron2); px(g, ox + 5, oy + 9, 6, 3, P.iron); px(g, ox + 3, oy + 12, 10, 3, P.plank2);
    } else if (v === T.FORGE) {
      const left = at(x - 1, y) !== T.FORGE;
      px(g, ox, oy + 4, 16, 12, P.stone2); px(g, ox, oy + 4, 16, 2, P.stone3);
      px(g, ox + 2, oy + 7, 12, 5, P.ink); px(g, ox + 3, oy + 8, 10, 3, P.coal);
      if (left) fires.push({ x: ox + 16, y: oy + 9, r: 14 });
    } else if (v === T.BARREL) {
      px(g, ox + 3, oy + 3, 10, 12, P.plank2); px(g, ox + 3, oy + 5, 10, 1, P.iron); px(g, ox + 3, oy + 12, 10, 1, P.iron); px(g, ox + 4, oy + 3, 8, 2, P.plank);
    } else if (v === T.SHELF) {
      px(g, ox, oy + 1, 16, 14, P.plank2); for (const r of [4, 9]) px(g, ox, oy + r, 16, 1, P.plank);
      const c = [P.book1, P.book2, P.book3, P.paper];
      for (let k = 0; k < 5; k++) { px(g, ox + 1 + k * 3, oy + 2, 2, 2, c[(x + k) % 4]); px(g, ox + 2 + k * 3, oy + 6, 2, 3, c[(y + k) % 4]); }
    } else if (v === T.DESK) {
      px(g, ox + 1, oy + 5, 14, 6, P.plank); px(g, ox + 2, oy + 11, 2, 4, P.plank2); px(g, ox + 12, oy + 11, 2, 4, P.plank2);
      px(g, ox + 4, oy + 6, 6, 3, P.paper); px(g, ox + 11, oy + 3, 2, 3, P.candle); px(g, ox + 11, oy + 2, 2, 1, P.flame);
    } else if (v === T.HEARTH) {
      px(g, ox, oy + 1, 16, 15, P.stone2); px(g, ox + 3, oy + 6, 10, 9, P.ink); px(g, ox + 4, oy + 10, 8, 4, P.coal);
      fires.push({ x: ox + 8, y: oy + 11, r: 12 });
    } else if (v === T.CHEST) {
      px(g, ox + 2, oy + 6, 12, 8, P.plank2); px(g, ox + 2, oy + 6, 12, 2, P.plank); px(g, ox + 7, oy + 8, 2, 2, P.flowerA);
    }
  };
  for (let y = 0; y < world.h; y++) for (let x = 0; x < world.w; x++) {
    const v = at(x, y);
    if (v === T.TREE || v === T.ORCHARD) sprites.push([y, () => tree(x, y, v === T.ORCHARD)]);
    if (v === T.FENCE) sprites.push([y, () => {
      const ox = x * TILE, oy = y * TILE;
      px(g, ox + 6, oy + 2, 3, 13, P.fence2); px(g, ox + 7, oy + 2, 1, 12, P.fence);
      if (at(x - 1, y) === T.FENCE) { px(g, ox, oy + 5, 8, 2, P.fence); px(g, ox, oy + 10, 8, 2, P.fence); }
      if (at(x + 1, y) === T.FENCE) { px(g, ox + 8, oy + 5, 8, 2, P.fence); px(g, ox + 8, oy + 10, 8, 2, P.fence); }
    }]);
    if (v === T.GRAVE) sprites.push([y, () => {
      const ox = x * TILE, oy = y * TILE, cross = hash2(x, y) > 0.5;
      px(g, ox + 3, oy + 13, 10, 2, P.shadow);
      if (cross) { px(g, ox + 7, oy + 3, 2, 11, P.grave); px(g, ox + 4, oy + 6, 8, 2, P.grave); }
      else { px(g, ox + 4, oy + 4, 8, 10, P.grave); px(g, ox + 5, oy + 3, 6, 1, P.grave); px(g, ox + 6, oy + 7, 4, 1, P.grave2); }
      px(g, ox + 3, oy + 14, 10, 1, P.dirt2);
    }]);
    if (v === T.STALL) sprites.push([y, () => {
      const ox = x * TILE - 4, oy = y * TILE;
      px(g, ox + 1, oy + 4, 2, 11, P.beam); px(g, ox + 21, oy + 4, 2, 11, P.beam);
      px(g, ox, oy + 9, 24, 4, P.table);
      for (let k = 0; k < 6; k++) px(g, ox + k * 4, oy - 2, 4, 7, k % 2 ? P.awningB : P.awningA);
      for (let k = 0; k < 6; k++) px(g, ox + k * 4 + 1, oy + 5, 2, 1, k % 2 ? P.awningB : P.awningA);
      px(g, ox + 4, oy + 8, 3, 2, P.apple); px(g, ox + 10, oy + 8, 3, 2, P.flowerA); px(g, ox + 16, oy + 8, 3, 2, P.sprout);
    }]);
    if (v === T.STONE) sprites.push([y, () => {
      const ox = x * TILE, oy = y * TILE;
      px(g, ox + 3, oy + 14, 10, 2, P.shadow);
      px(g, ox + 4, oy - 4, 8, 18, P.stone2); px(g, ox + 5, oy - 5, 6, 1, P.stone2); px(g, ox + 5, oy - 3, 2, 14, P.stone3);
      px(g, ox + 6, oy + 2, 4, 1, P.leaf3);
    }]);
    if (v === T.DOCK) sprites.push([y, () => {
      const ox = x * TILE, oy = y * TILE;
      px(g, ox, oy + 3, 16, 10, P.plank); for (let k = 0; k < 4; k++) px(g, ox + k * 4, oy + 3, 1, 10, P.plank2);
      px(g, ox + 1, oy + 12, 2, 4, P.plank2); px(g, ox + 13, oy + 12, 2, 4, P.plank2);
    }]);
  }

  // well (2 tiles), altar (2 tiles), oak (2x2)
  const well = [23, 15], altar = [23, 4], oak = [5, 4];
  sprites.push([well[1], () => {
    const ox = well[0] * TILE, oy = well[1] * TILE;
    px(g, ox + 2, oy + 3, 28, 13, P.stone2); px(g, ox + 4, oy + 5, 24, 8, P.ink); px(g, ox + 6, oy + 7, 20, 4, P.water3);
    px(g, ox + 2, oy + 3, 28, 2, P.stone3);
    px(g, ox + 3, oy - 10, 2, 14, P.beam); px(g, ox + 27, oy - 10, 2, 14, P.beam);
    px(g, ox, oy - 14, 32, 5, P.roofRed); px(g, ox + 2, oy - 15, 28, 1, P.roofRed);
    px(g, ox + 15, oy - 9, 1, 9, P.ink); px(g, ox + 13, oy - 1, 5, 3, P.plank2);
  }]);
  sprites.push([altar[1], () => {
    const ox = altar[0] * TILE, oy = altar[1] * TILE;
    px(g, ox + 1, oy + 4, 30, 11, P.stone2); px(g, ox + 1, oy + 4, 30, 2, P.stone3); px(g, ox + 3, oy + 8, 26, 1, P.mortar);
    for (const k of [4, 12, 19, 26]) { px(g, ox + k, oy, 2, 4, P.candle); }
    px(g, ox + 13, oy + 9, 6, 6, P.omenDeep);
  }]);
  [4, 12, 19, 26].forEach((k) => lights.push({ x: altar[0] * TILE + k + 1, y: altar[1] * TILE, r: 26, kind: "candle" }));
  sprites.push([oak[1] + 1, () => {
    const ox = oak[0] * TILE, oy = oak[1] * TILE;
    px(g, ox + 12, oy + 14, 8, 16, P.trunk); px(g, ox + 8, oy + 28, 16, 3, P.trunk); px(g, ox + 4, oy + 29, 26, 3, P.shadow);
    const blob = [[2, -6, 28, 22], [-2, 0, 36, 14], [6, -10, 20, 30], [0, -3, 32, 18]];
    for (const [bx, by, bw, bh] of blob) px(g, ox + bx, oy + by, bw, bh, P.leaf3);
    px(g, ox + 4, oy - 8, 14, 6, P.leaf); px(g, ox + 18, oy - 4, 10, 6, P.leaf); px(g, ox + 8, oy - 2, 6, 4, P.leaf2);
    px(g, ox + 0, oy + 6, 8, 4, P.leaf); px(g, ox + 22, oy + 8, 10, 4, P.leaf);
  }]);

  // buildings: front wall on the bottom row, pitched roof above
  for (const b of BUILDINGS) {
    sprites.push([b.y + b.h - 1, () => {
      const ox = b.x * TILE, oy = b.y * TILE, w = b.w * TILE, h = b.h * TILE;
      const wallTop = oy + h - 14;
      px(g, ox - 1, oy + h, w + 2, 3, P.shadow);
      px(g, ox, wallTop, w, 14, P.wall);
      px(g, ox, wallTop, w, 1, P.wall2); px(g, ox, oy + h - 1, w, 1, P.beam);
      for (let k = 0; k <= b.w; k++) px(g, ox + k * TILE - (k === b.w ? 2 : 0), wallTop, 2, 14, P.beam);
      // roof
      const roof = P[b.roof];
      for (let r = 0; r < h - 14; r++) {
        const inset = Math.max(0, 3 - r);
        px(g, ox - 2 + inset, oy + r - 6, w + 4 - inset * 2, 1, r % 4 === 3 ? shade(roof, 0.78) : roof);
      }
      px(g, ox - 2, oy + h - 20, w + 4, 6, roof); px(g, ox - 2, oy + h - 15, w + 4, 1, P.ink);
      for (let k = 2; k < w; k += 6) px(g, ox + k, oy - 3, 1, h - 14, "rgba(0,0,0,.12)");
      // chimney
      const cx = ox + w - 12;
      px(g, cx, oy - 12, 6, 10, P.stone2); px(g, cx, oy - 12, 6, 1, P.stone3);
      chimneys.push({ x: cx + 3, y: oy - 13, forge: !!b.forge });
      // door
      const dx = b.door[0] * TILE, top = b.door[1] === b.y;
      if (!top) { px(g, dx + 4, oy + h - 11, 8, 11, P.door); px(g, dx + 10, oy + h - 6, 1, 1, P.windowLit); }
      else { px(g, dx + 3, oy + h - 9, 10, 2, P.beam); }
      // windows
      for (let k = 0; k < b.w; k++) {
        const wx = ox + k * TILE + 5;
        if (wx >= dx && wx < dx + 14 && !top) continue;
        if ((k + b.x) % 2) continue;
        px(g, wx, oy + h - 10, 6, 5, P.window); px(g, wx + 2, oy + h - 10, 1, 5, P.beam);
        lights.push({ x: wx + 3, y: oy + h - 8, r: 40, kind: "window", wx, wy: oy + h - 10 });
      }
      if (b.lamp) lights.push({ x: dx + 8, y: oy + h + 2, r: 46, kind: "lamp" });
      if (b.forge) lights.push({ x: dx + 8, y: oy + h - 4, r: 60, kind: "forge" });
    }]);
  }

  for (let y = OUT_H; y < world.h; y++) for (let x = 0; x < world.w; x++) {
    const v = at(x, y);
    if (v >= T.BED && v !== T.RUG) sprites.push([y, () => furniture(x, y, v)]);
  }
  sprites.sort((a, b) => a[0] - b[0]).forEach(([, f]) => f());
  return { canvas: c, lights, chimneys, waters, fires };
}

// --- villagers ---------------------------------------------------------------

function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

export function drawVillager(g, ox, oy, look, dir, frame, opts = {}) {
  // A pose with a tool faces where the work is: facing left is the right-facing pose mirrored.
  if (opts.pose && dir === 3 && !opts.mirrored) {
    g.save(); g.translate(2 * ox + 16, 0); g.scale(-1, 1);
    drawVillager(g, ox, oy, look, 1, frame, { ...opts, mirrored: true });
    g.restore(); return;
  }
  const { skin, hair, cloth, hat, hatColor } = look;
  const pants = shade(cloth, 0.55), clothDark = shade(cloth, 0.8);
  const pose = frame ? null : opts.pose, t = opts.t ?? 0;
  // Kneeling and sitting lower the whole upper body; idle people breathe.
  const drop = pose === "pray" || pose === "tend" ? 2 : pose === "sit" ? 3 : 0;
  const bob = !frame && !pose && Math.floor(t / 900) % 2 ? 1 : 0;
  px(g, ox + 4, oy + 14, 8, 2, P.shadow);
  if (drop) {
    // folded legs instead of standing ones
    px(g, ox + 4, oy + 13, 8, 2, pants); px(g, ox + (pose === "sit" ? 11 : 4), oy + 14, 2, 1, P.ink);
    oy += drop;
  }
  // legs
  const lA = frame === 1 ? -1 : 0, lB = frame === 2 ? -1 : 0;
  if (!drop) {
    px(g, ox + 5, oy + 12 + lA, 2, 3 - lA, pants); px(g, ox + 9, oy + 12 + lB, 2, 3 - lB, pants);
    px(g, ox + 5, oy + 15, 2, 1, P.ink); px(g, ox + 9, oy + 15, 2, 1, P.ink);
  }
  oy += bob;
  // body + arms
  px(g, ox + 4, oy + 8, 8, 5, cloth); px(g, ox + 4, oy + 12, 8, 1, clothDark);
  const swing = frame ? (frame === 1 ? 1 : -1) : 0;
  if (pose) drawArms(g, ox, oy, skin, pose, opts.job, t);
  else { px(g, ox + 3, oy + 8 + swing, 1, 4, skin); px(g, ox + 12, oy + 8 - swing, 1, 4, skin); }
  // head
  px(g, ox + 5, oy + 2, 6, 6, skin);
  px(g, ox + 5, oy + 1, 6, 2, hair);
  if (dir === 2) px(g, ox + 5, oy + 2, 6, 5, hair);
  else if (dir === 1) { px(g, ox + 5, oy + 2, 2, 4, hair); px(g, ox + 9, oy + 4, 1, 1, P.ink); }
  else if (dir === 3) { px(g, ox + 9, oy + 2, 2, 4, hair); px(g, ox + 6, oy + 4, 1, 1, P.ink); }
  else { px(g, ox + 6, oy + 4, 1, 1, P.ink); px(g, ox + 9, oy + 4, 1, 1, P.ink); px(g, ox + 5, oy + 2, 1, 2, hair); px(g, ox + 10, oy + 2, 1, 2, hair); }
  // hats
  if (hat === "hood") { px(g, ox + 4, oy + 1, 8, 2, hatColor); px(g, ox + 4, oy + 2, 1, 6, hatColor); px(g, ox + 11, oy + 2, 1, 6, hatColor); }
  else if (hat === "cap") { px(g, ox + 5, oy, 6, 2, hatColor); px(g, ox + (dir === 3 ? 3 : 8), oy + 1, 4, 1, hatColor); }
  else if (hat === "straw") { px(g, ox + 2, oy + 1, 12, 1, P.flowerA); px(g, ox + 5, oy - 1, 6, 2, P.flowerA); px(g, ox + 5, oy + 0, 6, 1, P.dirt2); }
  else if (hat === "kerchief") { px(g, ox + 5, oy + 1, 6, 2, hatColor); px(g, ox + 10, oy + 3, 2, 2, hatColor); }
  if (opts.glow) { g.globalAlpha = 0.5; px(g, ox + 2, oy - 1, 12, 1, P.omen); g.globalAlpha = 1; }
}

// ---- animals ------------------------------------------------------------------
// Each is drawn in its own tile from code, facing left or right.

const FUR = { cat: "#2b2b33", dog: "#8a5a32", goat: "#e8e2d4", chicken: "#f4efe4", duck: "#8b6a44" };
function drawAnimal(g, ox, oy, a, moving, now, b) {
  const t = now + a.id.charCodeAt(a.id.length - 1) * 211, left = a.dir === 3, step = moving ? Math.floor(t / 150) % 2 : 0;
  const X = (x, w = 1) => (left ? ox + 16 - x - w : ox + x); // mirror for facing left
  const p = (x, y, w, h, c) => px(g, X(x, w), oy + y, w, h, c);
  const asleep = a.act === "sleep";
  if (a.kind !== "duck") p(3, 14, 10, 2, P.shadow);
  if (a.kind === "chicken") {
    const peck = a.act === "graze" && Math.floor(t / 300) % 2 ? 2 : 0;
    p(5, 9, 6, 4, FUR.chicken); p(4, 8, 2, 3, "#ddd6c8");              // body, tail
    p(10, 6 + peck, 3, 3, FUR.chicken); p(11, 5 + peck, 1, 1, "#c8352c"); // head, comb
    p(13, 7 + peck, 1, 1, "#e0a020"); if (!asleep) p(11, 7 + peck, 1, 1, P.ink);
    if (!asleep) { p(6, 13, 1, 2 - step, "#e0a020"); p(9, 13, 1, 1 + step, "#e0a020"); }
  } else if (a.kind === "duck") {
    const bob = Math.floor(t / 700) % 2;
    p(4, 10 + bob, 8, 3, FUR.duck); p(3, 10 + bob, 2, 2, "#6a5034");
    p(10, 7 + bob, 3, 3, "#2f6a3c"); p(13, 8 + bob, 2, 1, "#e0a020"); p(11, 8 + bob, 1, 1, P.ink);
    if (Math.floor(t / 1200) % 3 === 0) { g.globalAlpha = 0.5; px(g, ox + 2, oy + 13 + bob, 12, 1, P.foam); g.globalAlpha = 1; }
  } else if (a.kind === "goat") {
    const graze = a.act === "graze" ? 3 : 0;
    p(3, 7, 9, 5, FUR.goat); p(3, 12, 2, 3 - step, "#cfc8b8"); p(10, 12, 2, 2 + step, "#cfc8b8");
    p(11, 4 + graze, 4, 4, FUR.goat); p(11, 2 + graze, 1, 2, "#8a8273"); p(14, 3 + graze, 1, 1, "#8a8273");
    if (!asleep) p(13, 5 + graze, 1, 1, P.ink); p(12, 8 + graze, 2, 1, "#cfc8b8");
  } else if (a.kind === "cat") {
    if (asleep || a.act === "sit") { p(4, 10, 8, 4, FUR.cat); p(10, 8, 4, 4, FUR.cat); p(10, 7, 1, 1, FUR.cat); p(13, 7, 1, 1, FUR.cat); p(3, 12, 2, 2, FUR.cat); if (!asleep) { p(11, 9, 1, 1, "#e8d36a"); p(13, 9, 1, 1, "#e8d36a"); } }
    else {
      p(3, 9, 9, 3, FUR.cat); p(4, 12, 1, 2 - step, FUR.cat); p(10, 12, 1, 1 + step, FUR.cat);
      p(11, 6, 4, 4, FUR.cat); p(11, 5, 1, 1, FUR.cat); p(14, 5, 1, 1, FUR.cat); p(12, 7, 1, 1, "#e8d36a"); p(14, 7, 1, 1, "#e8d36a");
      const sway = Math.floor(t / 400) % 2; p(1, 6 + sway, 1, 4, FUR.cat); p(2, 9, 1, 1, FUR.cat);
    }
  } else if (a.kind === "dog") {
    const wag = (a.act === "happy" || a.follow) ? Math.floor(t / 120) % 2 : Math.floor(t / 600) % 2;
    p(3, 8, 9, 4, FUR.dog); p(4, 12, 2, 2 - step, "#6e4626"); p(10, 12, 2, 1 + step, "#6e4626");
    p(11, 5, 4, 5, FUR.dog); p(14, 8, 2, 2, "#6e4626"); p(11, 4, 2, 3, "#5a3a1e");
    if (!asleep) p(13, 6, 1, 1, P.ink);
    p(1, 6 + wag, 2, 2, FUR.dog);
  }
  // Tended: hearts float up, or a cross little huff from a cat not in the mood.
  if (b.reactAt && now - b.reactAt < 1800) {
    const k = (now - b.reactAt) / 1800, y = oy - 2 - k * 10;
    g.globalAlpha = 1 - k;
    if (b.react === "grumpy") { px(g, ox + 7, y, 1, 3, P.ink); px(g, ox + 10, y + 1, 1, 2, P.ink); }
    else { const c = "#e05a6a"; px(g, ox + 6, y, 2, 1, c); px(g, ox + 9, y, 2, 1, c); px(g, ox + 6, y + 1, 5, 1, c); px(g, ox + 7, y + 2, 3, 1, c); px(g, ox + 8, y + 3, 1, 1, c); }
    g.globalAlpha = 1;
  }
  if (asleep && a.kind !== "duck" && Math.floor(t / 900) % 3 === 0) { g.globalAlpha = 0.6; px(g, ox + 12, oy + 2, 2, 1, P.foam); px(g, ox + 13, oy + 3, 1, 1, P.foam); px(g, ox + 12, oy + 4, 2, 1, P.foam); g.globalAlpha = 1; }
}

// What each trade holds at work.
const TOOL = {
  blacksmith: "hammer", gravedigger: "shovel", "goat herder": "staff", fisher: "rod", herbalist: "basket", beekeeper: "basket",
  "tax collector": "quill", cartographer: "quill", "apprentice priest": "book", "candle maker": "candle", baker: "dough",
  "wandering bard": "lute", "widowed innkeeper": "mug", "village drunk": "mug", midwife: "basket", "retired soldier": "staff",
  "night watch": "lantern", "failed alchemist": "flask",
};

// Arms and props for a pose, animated from the clock. Two to four frames each.
function drawArms(g, ox, oy, skin, pose, job, t) {
  if (pose === "pray") { px(g, ox + 6, oy + 8, 4, 2, skin); px(g, ox + 7, oy + 6, 2, 2, skin); return; }
  if (pose === "cook") { const s = Math.floor(t / 300) % 3; px(g, ox + 3, oy + 8, 1, 4, skin); px(g, ox + 12, oy + 7, 2, 1, skin); px(g, ox + 13 + (s === 1 ? 1 : 0), oy + 5, 1, 3, P.plank2); if (s === 2) { g.globalAlpha = 0.5; px(g, ox + 13, oy + 1, 2, 2, P.foam); g.globalAlpha = 1; } return; }
  if (pose === "tend") { const s = Math.floor(t / 400) % 2; px(g, ox + 3, oy + 8, 1, 4, skin); px(g, ox + 12, oy + 10, 1, 2, skin); px(g, ox + 13 + s, oy + 12, 2, 1, skin); return; }
  if (pose === "sit") { px(g, ox + 3, oy + 10, 1, 3, skin); px(g, ox + 12, oy + 10, 1, 3, skin); return; }
  if (pose === "talk") {
    const up = Math.floor(t / 350) % 3 === 0;
    px(g, ox + 3, oy + 8, 1, 4, skin);
    if (up) { px(g, ox + 12, oy + 6, 1, 3, skin); px(g, ox + 13, oy + 5, 1, 1, skin); } else px(g, ox + 12, oy + 8, 1, 4, skin);
    return;
  }
  if (pose === "eat") {
    const bite = Math.floor(t / 600) % 2 === 0;
    px(g, ox + 3, oy + 8, 1, 4, skin);
    if (bite) { px(g, ox + 10, oy + 7, 2, 1, skin); px(g, ox + 8, oy + 6, 3, 2, P.dirt3); }
    else { px(g, ox + 12, oy + 8, 1, 3, skin); px(g, ox + 12, oy + 10, 3, 2, P.dirt3); }
    return;
  }
  // work: the trade's tool, swung or worked on a beat
  const tool = TOOL[job] ?? "hammer", beat = Math.floor(t / 320) % 4, up = beat < 2;
  px(g, ox + 3, oy + 8, 1, 4, skin);
  if (tool === "hammer" || tool === "shovel" || tool === "staff") {
    const head = tool === "hammer" ? P.stone2 : tool === "shovel" ? P.stone3 : P.trunk;
    if (up) { px(g, ox + 12, oy + 5, 1, 4, skin); px(g, ox + 13, oy + 1, 1, 5, P.trunk); px(g, ox + 12, oy, 3, 2, head); }
    else {
      px(g, ox + 12, oy + 9, 2, 1, skin); px(g, ox + 13, oy + 10, 4, 1, P.trunk); px(g, ox + 16, oy + 9, 2, 3, head);
      if (beat === 2 && tool === "hammer") { px(g, ox + 18, oy + 8, 1, 1, P.flame); px(g, ox + 17, oy + 7, 1, 1, P.candle); px(g, ox + 19, oy + 10, 1, 1, P.flame); }
      if (beat === 2 && tool === "shovel") { px(g, ox + 17, oy + 13, 2, 1, P.dirt2); px(g, ox + 19, oy + 12, 1, 1, P.dirt2); }
    }
  } else if (tool === "rod") {
    px(g, ox + 12, oy + 8, 1, 3, skin);
    for (let i = 0; i < 6; i++) px(g, ox + 13 + i, oy + 7 - i, 1, 1, P.trunk);
    const dip = Math.floor(t / 900) % 2;
    px(g, ox + 19, oy + 2, 1, 9 + dip, P.foam); px(g, ox + 19, oy + 11 + dip, 1, 1, P.apple);
  } else if (tool === "quill" || tool === "book") {
    px(g, ox + 5, oy + 10, 6, 3, P.flowerC); px(g, ox + 5, oy + 12, 6, 1, P.stone3);
    px(g, ox + 12, oy + 9, 1, 2, skin);
    const x = ox + 6 + (Math.floor(t / 250) % 4);
    if (tool === "quill") { px(g, x, oy + 9, 1, 2, P.ink); px(g, x + 1, oy + 7, 1, 2, P.flowerC); }
    else px(g, ox + 8, oy + 10, 1, 3, P.trunk);
  } else {
    const prop = { basket: P.plank, candle: P.candle, dough: P.flowerC, lute: P.plank2, mug: P.dirt3, lantern: P.windowLit, flask: P.foam }[tool] ?? P.plank;
    const lift = up ? 0 : 1;
    px(g, ox + 12, oy + 8 + lift, 1, 3, skin); px(g, ox + 11, oy + 10 + lift, 3, 3, prop);
    if (tool === "flask" && beat === 1) px(g, ox + 12, oy + 7, 1, 1, P.omen);
  }
}

// Lying down under a blanket in their own colour, eyes shut.
export function drawSleeper(g, ox, oy, look) {
  const { skin, hair, cloth } = look;
  px(g, ox + 1, oy + 13, 15, 2, P.shadow);
  px(g, ox + 1, oy + 10, 4, 4, P.plank);              // a bit of straw for a pillow
  px(g, ox + 2, oy + 8, 5, 5, skin);
  px(g, ox + 2, oy + 7, 5, 2, hair); px(g, ox + 2, oy + 8, 1, 4, hair);
  px(g, ox + 4, oy + 10, 2, 1, P.ink);                // closed eye
  px(g, ox + 6, oy + 9, 9, 5, cloth); px(g, ox + 6, oy + 9, 9, 1, shade(cloth, 1.15)); px(g, ox + 6, oy + 13, 9, 1, shade(cloth, 0.7));
}

// --- the frame ---------------------------------------------------------------

export class Renderer {
  constructor(canvas, world) {
    this.cv = canvas; this.g = canvas.getContext("2d");
    this.world = world; this.repaint();
    this.scale = 3; this.cam = { x: 24 * TILE, y: 18 * TILE }; this.follow = null;
    this.bodies = new Map(); this.smoke = []; this.motes = []; this.drops = []; this.wet = 0;
    this.light = document.createElement("canvas");
    this.reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.resize();
    addEventListener("resize", () => this.resize());
  }

  // Android drops a canvas's pixels under memory pressure or in the background.
  // The village is painted once, so paint it again when the canvas comes back.
  repaint() {
    this.paint = paintWorld(this.world);
    this.paint.canvas.addEventListener("contextrestored", () => this.repaint());
  }

  resize() {
    const r = this.cv.getBoundingClientRect(), d = devicePixelRatio || 1;
    this.cv.width = Math.round(r.width * d); this.cv.height = Math.round(r.height * d);
    this.dpr = d; this.vw = r.width; this.vh = r.height;
    this.light.width = this.cv.width; this.light.height = this.cv.height;
  }

  fitScale() {
    const s = Math.min(this.vw / (24 * TILE), this.vh / (15 * TILE));
    return Math.max(1.5, Math.min(5, Math.round(s * 2) / 2));
  }

  // Server state comes 5x a second; bodies glide between tiles locally.
  sync(agents) {
    const now = performance.now(), seen = new Set();
    for (const a of agents) {
      seen.add(a.id);
      let b = this.bodies.get(a.id);
      if (!b) { b = { x: a.x * TILE, y: a.y * TILE, fx: a.x * TILE, fy: a.y * TILE, tx: a.x * TILE, ty: a.y * TILE, t0: 0, step: 0 }; this.bodies.set(a.id, b); }
      if (a.x * TILE !== b.tx || a.y * TILE !== b.ty) {
        // stepping through a doorway is a jump across the grid: no sliding
        const jump = Math.abs(a.x * TILE - b.tx) + Math.abs(a.y * TILE - b.ty) > 2 * TILE;
        b.fx = jump ? a.x * TILE : b.x; b.fy = jump ? a.y * TILE : b.y; b.tx = a.x * TILE; b.ty = a.y * TILE; b.t0 = now; b.step++; this.onStep?.(a);
      }
      b.a = a;
    }
    for (const id of this.bodies.keys()) if (!seen.has(id)) this.bodies.delete(id);
  }

  // Animals glide between tiles like people do; `react` shows hearts or a huff.
  syncAnimals(list) {
    const now = performance.now(), seen = new Set();
    this.beasts ??= new Map();
    for (const a of list) {
      seen.add(a.id);
      let b = this.beasts.get(a.id);
      if (!b) { b = { x: a.x * TILE, y: a.y * TILE, fx: a.x * TILE, fy: a.y * TILE, tx: a.x * TILE, ty: a.y * TILE, t0: 0 }; this.beasts.set(a.id, b); }
      if (a.x * TILE !== b.tx || a.y * TILE !== b.ty) { b.fx = b.x; b.fy = b.y; b.tx = a.x * TILE; b.ty = a.y * TILE; b.t0 = now; }
      b.a = a;
    }
    for (const id of this.beasts.keys()) if (!seen.has(id)) this.beasts.delete(id);
  }
  react(id, act) { const b = this.beasts?.get(id); if (b) { b.react = act; b.reactAt = performance.now(); } }

  toScreen(wx, wy) {
    return [(wx - this.cam.x) * this.scale + this.vw / 2, (wy - this.cam.y) * this.scale + this.vh / 2];
  }
  toWorld(sx, sy) {
    return [(sx - this.vw / 2) / this.scale + this.cam.x, (sy - this.vh / 2) / this.scale + this.cam.y];
  }

  frame(gameNow, omenNow, weather = "clear") {
    const g = this.g, d = this.dpr, s = this.scale, now = performance.now();
    for (const b of this.bodies.values()) {
      const k = Math.min(1, (now - b.t0) / STEP_MS);
      b.x = b.fx + (b.tx - b.fx) * k; b.y = b.fy + (b.ty - b.fy) * k;
      b.moving = k < 1 || b.a.walking;
    }
    const f = this.follow && this.bodies.get(this.follow);
    if (f) { this.cam.x += (f.x + 8 - this.cam.x) * 0.12; this.cam.y += (f.y + 8 - this.cam.y) * 0.12; }
    // Inside: the camera shows the followed villager's room and nothing else.
    // Outside: the village, never the rooms laid out below it.
    const room = f ? roomAt(Math.round(f.x / TILE), Math.round(f.y / TILE)) : null;
    if (room !== this.viewRoom) { this.viewRoom = room; if (room) { this.cam.x = (room.x + room.w / 2) * TILE; this.cam.y = (room.y + room.h / 2) * TILE; } }
    const box = room ? [room.x * TILE, room.y * TILE, room.w * TILE, room.h * TILE] : [0, 0, this.world.w * TILE, OUT_H * TILE];
    const hw = this.vw / 2 / s, hh = this.vh / 2 / s;
    this.cam.x = box[2] <= hw * 2 ? box[0] + box[2] / 2 : Math.max(box[0] + hw, Math.min(box[0] + box[2] - hw, this.cam.x));
    this.cam.y = box[3] <= hh * 2 ? box[1] + box[3] / 2 : Math.max(box[1] + hh, Math.min(box[1] + box[3] - hh, this.cam.y));

    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = P.ink; g.fillRect(0, 0, this.cv.width, this.cv.height);
    g.imageSmoothingEnabled = false;
    const tx = Math.round((this.vw / 2 - this.cam.x * s) * d), ty = Math.round((this.vh / 2 - this.cam.y * s) * d);
    g.setTransform(s * d, 0, 0, s * d, tx, ty);
    g.drawImage(this.paint.canvas, 0, 0);

    const t = now / 1000;
    // water glints
    if (!this.reduced) for (const [x, y] of this.paint.waters) {
      const p = (Math.sin(t * 1.4 + x * 0.9 + y * 1.7) + 1) / 2;
      if (p > 0.82) px(g, x * TILE + ((x * 7 + y * 3) % 12) + 2, y * TILE + ((x * 5 + y * 11) % 10) + 3, 3, 1, P.foam);
    }
    // chimney smoke
    if (!this.reduced && Math.random() < 0.25) {
      const c = this.paint.chimneys[Math.floor(Math.random() * this.paint.chimneys.length)];
      this.smoke.push({ x: c.x, y: c.y, vx: 0.15 + Math.random() * 0.1, vy: -0.25, life: 1, forge: c.forge });
    }
    this.smoke = this.smoke.filter((p) => (p.life -= 0.006) > 0);
    for (const p of this.smoke) {
      p.x += p.vx; p.y += p.vy;
      g.globalAlpha = p.life * 0.55;
      const r = 1 + (1 - p.life) * 3;
      px(g, p.x - r / 2, p.y - r / 2, r, r, p.forge && p.life > 0.85 ? P.flame : "#cfcac0");
    }
    g.globalAlpha = 1;

    // animals and villagers together, back to front
    for (const b of this.beasts?.values() ?? []) {
      const k = Math.min(1, (now - b.t0) / 600);
      b.x = b.fx + (b.tx - b.fx) * k; b.y = b.fy + (b.ty - b.fy) * k; b.moving = k < 1;
    }
    const list = [...this.bodies.values()].sort((a, b) => a.y - b.y);
    const scene = [...list.map((b) => ({ b, y: b.y })), ...[...(this.beasts?.values() ?? [])].map((b) => ({ b, y: b.y - 4, beast: true }))].sort((p, q) => p.y - q.y);
    for (const { b, beast } of scene) {
      if (beast) { drawAnimal(g, Math.round(b.x), Math.round(b.y), b.a, b.moving, now, b); continue; }
      const frame = b.moving ? 1 + (Math.floor(now / 140) % 2) : 0;
      const omenAge = omenNow - (b.a.omenAt || -1e9);
      if (b.a.asleep) drawSleeper(g, Math.round(b.x), Math.round(b.y) - 1, b.a.look);
      else drawVillager(g, Math.round(b.x), Math.round(b.y) - 3, b.a.look, b.a.dir, frame, { glow: omenAge < 6000, pose: b.moving ? null : b.a.pose ?? (b.a.bubble ? "talk" : null), job: b.a.job, t: now + (b.a.id.charCodeAt(0) * 97) });
    }

    this.drawOmens(g, list, omenNow, t);
    if (this.viewRoom) {
      // fire glows, and darkness around the room
      g.globalCompositeOperation = "lighter";
      for (const fl of this.paint.fires) {
        if (roomAt(Math.floor(fl.x / TILE), Math.floor(fl.y / TILE)) !== this.viewRoom) continue;
        const r = fl.r * (this.reduced ? 1 : 0.85 + 0.15 * Math.sin(t * 9 + fl.x));
        const gr = g.createRadialGradient(fl.x, fl.y, 0, fl.x, fl.y, r * 3);
        gr.addColorStop(0, "rgba(255,150,60,.35)"); gr.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = gr; g.fillRect(fl.x - r * 3, fl.y - r * 3, r * 6, r * 6);
      }
      g.globalCompositeOperation = "source-over";
      const R0 = this.viewRoom, x0 = R0.x * TILE, y0 = R0.y * TILE, x1 = x0 + R0.w * TILE, y1 = y0 + R0.h * TILE, big = 1e5;
      g.fillStyle = P.ink;
      g.fillRect(x0 - big, y0 - big, big * 2 + x1 - x0, big); g.fillRect(x0 - big, y1, big * 2 + x1 - x0, big);
      g.fillRect(x0 - big, y0, big, y1 - y0); g.fillRect(x1, y0, big, y1 - y0);
    } else {
      this.drawNight(gameNow, tx, ty, t);
      this.drawWeather(weather);
    }
  }

  // Grey sky and rain, in screen space over everything. Eases in and out.
  drawWeather(weather) {
    const target = weather === "rain" ? 1 : weather === "cloudy" ? 0.45 : 0;
    this.wet += (target - this.wet) * 0.01;
    if (this.wet < 0.01) return;
    const g = this.g, W = this.cv.width, H = this.cv.height, d = this.dpr;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = `rgba(40,48,66,${0.22 * this.wet})`;
    g.fillRect(0, 0, W, H);
    const rain = Math.max(0, (this.wet - 0.45) / 0.55);
    if (rain <= 0 || this.reduced) return;
    const want = Math.floor(260 * rain * (W * H) / (1440 * 900 * d * d));
    while (this.drops.length < want) this.drops.push({ x: Math.random() * W, y: Math.random() * H, v: (9 + Math.random() * 6) * d, l: (8 + Math.random() * 10) * d });
    this.drops.length = Math.min(this.drops.length, want);
    g.strokeStyle = `rgba(190,205,230,${0.45 * rain})`;
    g.lineWidth = d;
    g.beginPath();
    for (const p of this.drops) {
      p.x += p.v * 0.18; p.y += p.v;
      if (p.y > H) { p.y = -p.l; p.x = Math.random() * W; }
      if (p.x > W) p.x -= W;
      g.moveTo(p.x, p.y); g.lineTo(p.x - p.l * 0.18, p.y - p.l);
    }
    g.stroke();
  }

  drawOmens(g, list, omenNow, t) {
    for (const b of list) {
      const age = omenNow - (b.a.omenAt || -1e9);
      if (age < 0 || age > 5000) continue;
      const k = age / 5000, fade = k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85;
      const cx = b.x + 8, cy = b.y + 8;
      // a column of wrong light falling from above
      const grd = g.createLinearGradient(0, cy - 220, 0, cy + 6);
      grd.addColorStop(0, "rgba(143,92,255,0)"); grd.addColorStop(1, `rgba(143,92,255,${0.55 * fade})`);
      g.fillStyle = grd;
      const w = 10 + Math.sin(t * 9) * (this.reduced ? 0 : 1.5);
      g.fillRect(cx - w / 2, cy - 220, w, 226);
      if (!this.reduced) for (let i = 0; i < 3; i++) {
        const r = ((age / 900 + i / 3) % 1) * 30;
        g.strokeStyle = `rgba(143,92,255,${(1 - r / 30) * 0.7 * fade})`;
        g.lineWidth = 1;
        g.beginPath(); g.ellipse(cx, cy + 6, r, r * 0.4, 0, 0, Math.PI * 2); g.stroke();
      }
    }
  }

  drawNight(gameNow, tx, ty, t) {
    const ph = dayPhase(gameNow), h = ph.hour;
    // darkness 0 at day, up to .72 at deep night, with dusk and dawn ramps
    let dark = 0;
    if (h < 5 || h >= 21) dark = 0.72;
    else if (h < 7.5) dark = 0.72 * (1 - (h - 5) / 2.5);
    else if (h >= 18) dark = 0.72 * ((h - 18) / 3);
    const warm = h >= 17 && h < 20 ? 1 - Math.abs(h - 18.5) / 1.5 : h >= 5 && h < 7.5 ? 0.6 * (1 - Math.abs(h - 6.2) / 1.3) : 0;
    const g = this.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (warm > 0) { g.globalCompositeOperation = "multiply"; g.fillStyle = `rgba(255,170,120,${0.35 * warm})`; g.fillRect(0, 0, this.cv.width, this.cv.height); g.globalCompositeOperation = "source-over"; }
    if (dark <= 0.02) return;
    const L = this.light.getContext("2d"), s = this.scale * this.dpr;
    L.globalCompositeOperation = "source-over";
    L.clearRect(0, 0, this.light.width, this.light.height);
    L.fillStyle = `rgba(14,18,46,${dark})`; L.fillRect(0, 0, this.light.width, this.light.height);
    L.globalCompositeOperation = "destination-out";
    const flick = (k) => (this.reduced ? 1 : 0.9 + 0.1 * Math.sin(t * 7 + k));
    const lights = this.paint.lights;
    for (let i = 0; i < lights.length; i++) {
      const l = lights[i], x = l.x * s + tx, y = l.y * s + ty, r = l.r * s * flick(i);
      const gr = L.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, "rgba(0,0,0,.95)"); gr.addColorStop(1, "rgba(0,0,0,0)");
      L.fillStyle = gr; L.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // every villager carries a little light so faces stay readable
    for (const b of this.bodies.values()) {
      const x = (b.x + 8) * s + tx, y = (b.y + 6) * s + ty, r = 26 * s;
      const gr = L.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, "rgba(0,0,0,.6)"); gr.addColorStop(1, "rgba(0,0,0,0)");
      L.fillStyle = gr; L.fillRect(x - r, y - r, r * 2, r * 2);
    }
    g.drawImage(this.light, 0, 0);
    // warm bloom and lit windows on top
    g.globalCompositeOperation = "lighter";
    for (let i = 0; i < lights.length; i++) {
      const l = lights[i], x = l.x * s + tx, y = l.y * s + ty, r = l.r * 0.6 * s * flick(i);
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, l.kind === "candle" ? `rgba(255,200,120,${0.35 * dark})` : `rgba(255,170,80,${0.28 * dark})`); gr.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    g.globalCompositeOperation = "source-over";
    g.setTransform(s, 0, 0, s, tx, ty);
    for (const l of lights) if (l.kind === "window") { g.globalAlpha = Math.min(1, dark * 1.4); px(g, l.wx, l.wy, 6, 5, P.windowLit); px(g, l.wx + 2, l.wy, 1, 5, P.beam); }
    g.globalAlpha = 1;
  }
}

export function portrait(canvas, look, dir = 0) {
  const g = canvas.getContext("2d");
  g.imageSmoothingEnabled = false;
  g.clearRect(0, 0, canvas.width, canvas.height);
  const k = Math.floor(Math.min(canvas.width, canvas.height) / 16);
  g.setTransform(k, 0, 0, k, (canvas.width - 16 * k) / 2, (canvas.height - 16 * k) / 2);
  drawVillager(g, 0, 0, look, dir, 0);
  g.setTransform(1, 0, 0, 1, 0, 0);
}

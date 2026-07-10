import {
  CHUNK_SIZE_X,
  CHUNK_SIZE_Z,
  CHUNK_HEIGHT,
  CHUNK_BLOCK_COUNT,
  blockIndex,
} from '../../../shared/constants';
import { BlockId } from './blockTypes';

const DIRT_DEPTH = 3;
const MIN_HEIGHT = 8;
// Mountain peaks saturate here, leaving building headroom below the chunk top.
const MAX_HEIGHT = CHUNK_HEIGHT - 6;
/** At/above this surface height the top becomes bare rock instead of grass. */
const ROCK_LEVEL = 46;
/** No trees grow above this surface height, so mountains stay bare. */
const TREE_LINE = 40;
/** Terrain below this height floods with water (lakes and oceans). */
const SEA_LEVEL = 14;
/** In beach regions the sandy shore extends this many blocks above sea level. */
const BEACH_HEIGHT = 2;
/** Perlin channels are independent noise generators seeded from these offsets. */
const SEED_MOUNTAIN = 0x1337c0de;
const SEED_RIDGE = 0x2a3b4c5d;
const SEED_FOREST = 0x5eed7011;
const SEED_BEACH = 0x0cea7011;
const SALT_ROCK = 0x165667b1;

// --- Trees (simple oaks) -------------------------------------------------
/** World is split into TREE_GRID×TREE_GRID cells; each holds at most one tree. */
const TREE_GRID = 5;
/** Peak tree probability in a dense forest; plains ramp down to zero. */
const FOREST_MAX_CHANCE = 0.7;
/** Forest-density below this is treeless plains. */
const FOREST_THRESHOLD = 0.52;
/** Horizontal reach of the leaf canopy (blocks). */
const CANOPY_RADIUS = 2;
const TRUNK_MIN = 4;
const TRUNK_VARIANCE = 3; // trunk height = TRUNK_MIN .. TRUNK_MIN+VARIANCE-1
// Independent hash salts so the four tree decisions don't correlate.
const SALT_TREE = 0x2f6b1a3d;
const SALT_JITTER_X = 0x85ebca6b;
const SALT_JITTER_Z = 0xc2b2ae35;
const SALT_TRUNK = 0x27d4eb2f;

interface Tree {
  ox: number;
  oz: number;
  trunkHeight: number;
}

// --- Ores (coal + iron veins in stone) -----------------------------------
/** Ore veins are seeded on a 3D cell grid, then stamped as small blobs. */
const ORE_CELL = 5;
const ORE_BLOB_RADIUS = 1;
const VEIN_CHANCE = 0.42;
/** Coal appears up to this height; iron only in the deeper band below IRON_MAX_Y. */
const COAL_MAX_Y = 48;
const IRON_MAX_Y = 28;
/** Fraction of deep veins that are iron rather than coal. */
const IRON_FRACTION = 0.4;
/** Extra blob cells beyond the origin, each included with ~55% chance. */
const BLOB_OFFSETS: Array<[number, number, number]> = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1], [1, 1, 0], [0, 1, 1],
];
const SALT_VEIN = 0x1b56c4e9;
const SALT_VX = 0x9e3779b1;
const SALT_VY = 0x7feb352d;
const SALT_VZ = 0x846ca68b;
const SALT_VTYPE = 0xd3a2646c;
const SALT_BLOB = 0xff51afd7;

interface Vein {
  ox: number;
  oy: number;
  oz: number;
  ore: BlockId;
}

/** Deterministic integer hash -> [0, 1). */
function hash2(seed: number, x: number, z: number): number {
  let h = seed ^ Math.imul(x, 374761393) ^ Math.imul(z, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Deterministic 3D hash -> [0, 1), for ore placement. */
function hash3(seed: number, x: number, y: number, z: number): number {
  let h = seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 2246822519) ^ Math.imul(z, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * Classic Perlin (gradient) noise with fractal octaves — the same family of
 * noise Minecraft uses for terrain. Smooth and grid-artifact-free, unlike value
 * noise. Seeded deterministically so chunks regenerate identically.
 */
class Perlin {
  private readonly perm = new Uint8Array(512);

  constructor(seed: number) {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    // Seeded Fisher–Yates shuffle (mulberry32 PRNG) of the permutation table.
    let s = seed >>> 0;
    const rand = (): number => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = p[i];
      p[i] = p[j];
      p[j] = tmp;
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  private static fade(t: number): number {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  private static grad(hash: number, x: number, y: number): number {
    const h = hash & 7;
    const u = h < 4 ? x : y;
    const v = h < 4 ? y : x;
    return (h & 1 ? -u : u) + (h & 2 ? -2 * v : 2 * v);
  }

  /** Single-octave gradient noise, range ≈ [-1, 1]. */
  noise2(x: number, y: number): number {
    const xi = Math.floor(x) & 255;
    const yi = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = Perlin.fade(xf);
    const v = Perlin.fade(yf);
    const p = this.perm;
    const aa = p[p[xi] + yi];
    const ab = p[p[xi] + yi + 1];
    const ba = p[p[xi + 1] + yi];
    const bb = p[p[xi + 1] + yi + 1];
    const lerp = (a: number, b: number, t: number): number => a + t * (b - a);
    return lerp(
      lerp(Perlin.grad(aa, xf, yf), Perlin.grad(ba, xf - 1, yf), u),
      lerp(Perlin.grad(ab, xf, yf - 1), Perlin.grad(bb, xf - 1, yf - 1), u),
      v,
    );
  }

  /** Fractal Brownian motion: octaves summed at the base frequency; range ≈ [-1, 1]. */
  fractal(x: number, y: number, octaves: number, frequency: number, persistence = 0.5, lacunarity = 2): number {
    let amp = 1;
    let freq = frequency;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * this.noise2(x * freq, y * freq);
      norm += amp;
      amp *= persistence;
      freq *= lacunarity;
    }
    return sum / norm;
  }
}

/**
 * Procedural terrain from fractal Perlin noise: rolling plains and hills, plus a
 * separate mountain mask that lifts scattered regions into ridged peaks (bare
 * stone above the tree line). Grass/dirt/stone layering below. Deterministic.
 */
export class WorldGenerator {
  private readonly heightNoise: Perlin;
  private readonly mountainNoise: Perlin;
  private readonly ridgeNoise: Perlin;
  private readonly forestNoise: Perlin;
  private readonly beachNoise: Perlin;

  constructor(readonly seed: number) {
    this.heightNoise = new Perlin(seed);
    this.mountainNoise = new Perlin(seed ^ SEED_MOUNTAIN);
    this.ridgeNoise = new Perlin(seed ^ SEED_RIDGE);
    this.forestNoise = new Perlin(seed ^ SEED_FOREST);
    this.beachNoise = new Perlin(seed ^ SEED_BEACH);
  }

  heightAt(x: number, z: number): number {
    // Base rolling terrain: fBm of Perlin noise (continents → hills → detail).
    const base = this.heightNoise.fractal(x, z, 4, 1 / 140);
    let h = 20 + base * 18; // gentle plains and hills

    // Mountains: a low-frequency mask lifts scattered regions high; ridged noise
    // (1 − |noise|) carves sharp ridgelines and peaks within them.
    const mask = (this.mountainNoise.fractal(x, z, 2, 1 / 260) + 1) / 2; // 0..1
    if (mask > 0.58) {
      const t = smoothstep((mask - 0.58) / 0.42);
      const ridge = 1 - Math.abs(this.ridgeNoise.fractal(x, z, 3, 1 / 80));
      h += t * (24 + ridge * 22);
    }
    return Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.floor(h)));
  }

  generateChunk(cx: number, cz: number): Uint8Array {
    const data = new Uint8Array(CHUNK_BLOCK_COUNT); // zero-filled = Air
    for (let lz = 0; lz < CHUNK_SIZE_Z; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE_X; lx++) {
        const wx = cx * CHUNK_SIZE_X + lx;
        const wz = cz * CHUNK_SIZE_Z + lz;
        const h = this.heightAt(wx, wz);
        // Jagged rock line: high peaks are bare stone instead of grass/dirt.
        const rockLine = ROCK_LEVEL + Math.floor((hash2(this.seed ^ SALT_ROCK, wx, wz) - 0.5) * 6);
        const bare = h >= rockLine;
        // Sandy shallows/beaches around sea level; some coasts are sandy, others grassy.
        const beachy = (this.beachNoise.fractal(wx, wz, 2, 1 / 150) + 1) / 2 > 0.55;
        const sandTop = SEA_LEVEL + (beachy ? BEACH_HEIGHT : 0);
        const sandy = !bare && h >= SEA_LEVEL - 4 && h <= sandTop;
        for (let y = 0; y <= h; y++) {
          let id: BlockId;
          const surface = bare ? BlockId.Stone : sandy ? BlockId.Sand : BlockId.Grass;
          const sub = bare ? BlockId.Stone : sandy ? BlockId.Sand : BlockId.Dirt;
          if (y === h) id = surface;
          else if (y >= h - DIRT_DEPTH) id = sub;
          else id = BlockId.Stone;
          data[blockIndex(lx, y, lz)] = id;
        }
        // Flood everything below sea level with water.
        for (let y = h + 1; y <= SEA_LEVEL; y++) {
          data[blockIndex(lx, y, lz)] = BlockId.Water;
        }
      }
    }
    this.placeOres(cx, cz, data);
    this.placeTrees(cx, cz, data);
    return data;
  }

  /** The ore vein seeded in a 3D grid cell, or null. Deterministic. */
  private veinInCell(cx3: number, cy3: number, cz3: number): Vein | null {
    if (hash3(this.seed ^ SALT_VEIN, cx3, cy3, cz3) > VEIN_CHANCE) return null;
    const ox = cx3 * ORE_CELL + Math.floor(hash3(this.seed ^ SALT_VX, cx3, cy3, cz3) * ORE_CELL);
    const oy = cy3 * ORE_CELL + Math.floor(hash3(this.seed ^ SALT_VY, cx3, cy3, cz3) * ORE_CELL);
    const oz = cz3 * ORE_CELL + Math.floor(hash3(this.seed ^ SALT_VZ, cx3, cy3, cz3) * ORE_CELL);
    let ore: BlockId;
    if (oy <= IRON_MAX_Y && hash3(this.seed ^ SALT_VTYPE, cx3, cy3, cz3) < IRON_FRACTION) {
      ore = BlockId.IronOre;
    } else if (oy <= COAL_MAX_Y) {
      ore = BlockId.CoalOre;
    } else {
      return null;
    }
    return { ox, oy, oz, ore };
  }

  /** Scatters ore veins through the stone. Seamless across chunks like trees. */
  private placeOres(cx: number, cz: number, data: Uint8Array): void {
    const baseX = cx * CHUNK_SIZE_X;
    const baseZ = cz * CHUNK_SIZE_Z;
    const r = ORE_BLOB_RADIUS;
    const cellMinX = Math.floor((baseX - r) / ORE_CELL);
    const cellMaxX = Math.floor((baseX + CHUNK_SIZE_X - 1 + r) / ORE_CELL);
    const cellMinZ = Math.floor((baseZ - r) / ORE_CELL);
    const cellMaxZ = Math.floor((baseZ + CHUNK_SIZE_Z - 1 + r) / ORE_CELL);
    const cellMaxY = Math.floor((COAL_MAX_Y + r) / ORE_CELL);
    for (let cx3 = cellMinX; cx3 <= cellMaxX; cx3++) {
      for (let cz3 = cellMinZ; cz3 <= cellMaxZ; cz3++) {
        for (let cy3 = 0; cy3 <= cellMaxY; cy3++) {
          const vein = this.veinInCell(cx3, cy3, cz3);
          if (vein) this.stampVein(baseX, baseZ, data, vein);
        }
      }
    }
  }

  private stampVein(baseX: number, baseZ: number, data: Uint8Array, vein: Vein): void {
    // Ore only replaces stone, so veins never surface or carve dirt/air.
    const put = (wx: number, wy: number, wz: number): void => {
      if (wy < 0 || wy >= CHUNK_HEIGHT) return;
      const lx = wx - baseX;
      const lz = wz - baseZ;
      if (lx < 0 || lx >= CHUNK_SIZE_X || lz < 0 || lz >= CHUNK_SIZE_Z) return;
      const idx = blockIndex(lx, wy, lz);
      if (data[idx] === BlockId.Stone) data[idx] = vein.ore;
    };
    put(vein.ox, vein.oy, vein.oz);
    for (let i = 0; i < BLOB_OFFSETS.length; i++) {
      const [dx, dy, dz] = BLOB_OFFSETS[i];
      if (hash3(this.seed ^ (SALT_BLOB + i), vein.ox, vein.oy, vein.oz) < 0.55) {
        put(vein.ox + dx, vein.oy + dy, vein.oz + dz);
      }
    }
  }

  /** The tree rooted in a grid cell, or null. Density varies by forest region. */
  private treeInCell(cellX: number, cellZ: number): Tree | null {
    // Smooth forest-density field: dense forests vs. treeless plains.
    const density = (this.forestNoise.fractal(cellX * TREE_GRID, cellZ * TREE_GRID, 2, 1 / 90) + 1) / 2;
    const localChance =
      Math.max(0, (density - FOREST_THRESHOLD) / (1 - FOREST_THRESHOLD)) * FOREST_MAX_CHANCE;
    if (hash2(this.seed ^ SALT_TREE, cellX, cellZ) >= localChance) return null;

    const jx = Math.floor(hash2(this.seed ^ SALT_JITTER_X, cellX, cellZ) * TREE_GRID);
    const jz = Math.floor(hash2(this.seed ^ SALT_JITTER_Z, cellX, cellZ) * TREE_GRID);
    const ox = cellX * TREE_GRID + jx;
    const oz = cellZ * TREE_GRID + jz;
    const surface = this.heightAt(ox, oz);
    if (surface > TREE_LINE || surface <= SEA_LEVEL) return null; // no trees on peaks or in water
    const trunkHeight = TRUNK_MIN + Math.floor(hash2(this.seed ^ SALT_TRUNK, ox, oz) * TRUNK_VARIANCE);
    return { ox, oz, trunkHeight };
  }

  /**
   * Stamps trees into a chunk. A tree can be rooted in a neighbouring cell/chunk
   * yet drop leaves into this one, so we scan every cell whose canopy could reach
   * this chunk. Because tree placement is a pure function of the seed and cell,
   * both chunks stamp the identical blocks and the tree is seamless across borders.
   */
  private placeTrees(cx: number, cz: number, data: Uint8Array): void {
    const baseX = cx * CHUNK_SIZE_X;
    const baseZ = cz * CHUNK_SIZE_Z;
    const cellMinX = Math.floor((baseX - CANOPY_RADIUS) / TREE_GRID);
    const cellMaxX = Math.floor((baseX + CHUNK_SIZE_X - 1 + CANOPY_RADIUS) / TREE_GRID);
    const cellMinZ = Math.floor((baseZ - CANOPY_RADIUS) / TREE_GRID);
    const cellMaxZ = Math.floor((baseZ + CHUNK_SIZE_Z - 1 + CANOPY_RADIUS) / TREE_GRID);
    for (let cellX = cellMinX; cellX <= cellMaxX; cellX++) {
      for (let cellZ = cellMinZ; cellZ <= cellMaxZ; cellZ++) {
        const tree = this.treeInCell(cellX, cellZ);
        if (tree) this.stampTree(baseX, baseZ, data, tree);
      }
    }
  }

  private stampTree(baseX: number, baseZ: number, data: Uint8Array, tree: Tree): void {
    const surfaceY = this.heightAt(tree.ox, tree.oz);
    const topY = surfaceY + tree.trunkHeight;

    // Placement rules keep trees order-independent across the chunk scan: leaves
    // only fill air, trunk overwrites air OR leaves — so the trunk always wins.
    const put = (wx: number, wy: number, wz: number, id: BlockId, overLeaves: boolean): void => {
      if (wy < 0 || wy >= CHUNK_HEIGHT) return;
      const lx = wx - baseX;
      const lz = wz - baseZ;
      if (lx < 0 || lx >= CHUNK_SIZE_X || lz < 0 || lz >= CHUNK_SIZE_Z) return;
      const idx = blockIndex(lx, wy, lz);
      const cur = data[idx];
      if (cur === BlockId.Air || (overLeaves && cur === BlockId.Leaves)) data[idx] = id;
    };

    // Canopy: two wide 5×5 layers (corners trimmed) then a 3×3 and a plus-shaped cap.
    for (let dy = -2; dy <= 1; dy++) {
      const y = topY + dy;
      const radius = dy <= -1 ? CANOPY_RADIUS : 1;
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dz = -radius; dz <= radius; dz++) {
          const isCorner = Math.abs(dx) === radius && Math.abs(dz) === radius;
          if (radius === CANOPY_RADIUS && isCorner) continue; // trim wide-layer corners
          if (dy === 1 && Math.abs(dx) + Math.abs(dz) > 1) continue; // top cap = plus
          put(tree.ox + dx, y, tree.oz + dz, BlockId.Leaves, false);
        }
      }
    }

    // Trunk from just above the surface up to the top (overwrites the leaf column).
    for (let y = surfaceY + 1; y <= topY; y++) {
      put(tree.ox, y, tree.oz, BlockId.Wood, true);
    }
  }
}

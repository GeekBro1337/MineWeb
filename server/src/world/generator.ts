import {
  CHUNK_SIZE_X,
  CHUNK_SIZE_Z,
  CHUNK_HEIGHT,
  CHUNK_BLOCK_COUNT,
  blockIndex,
} from '../../../shared/constants';
import { BlockId } from './blockTypes';

const DIRT_DEPTH = 3;
const MIN_HEIGHT = 4;
// Leave headroom above the terrain so the player can build upwards.
const MAX_HEIGHT = CHUNK_HEIGHT - 20;

/** Deterministic integer hash -> [0, 1). */
function hash2(seed: number, x: number, z: number): number {
  let h = seed ^ Math.imul(x, 374761393) ^ Math.imul(z, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/** 2D value noise: hash on grid corners + bilinear interpolation. */
function valueNoise(seed: number, x: number, z: number, scale: number): number {
  const fx = x / scale;
  const fz = z / scale;
  const x0 = Math.floor(fx);
  const z0 = Math.floor(fz);
  const tx = smoothstep(fx - x0);
  const tz = smoothstep(fz - z0);
  const a = hash2(seed, x0, z0);
  const b = hash2(seed, x0 + 1, z0);
  const c = hash2(seed, x0, z0 + 1);
  const d = hash2(seed, x0 + 1, z0 + 1);
  return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
}

/**
 * Procedural terrain: two octaves of value noise for the height map,
 * grass on top, a few dirt layers, stone below. Fully deterministic
 * for a given seed, so chunks can be regenerated at any time.
 */
export class WorldGenerator {
  constructor(readonly seed: number) {}

  heightAt(x: number, z: number): number {
    const base =
      18 +
      10 * valueNoise(this.seed, x, z, 24) +
      4 * valueNoise(this.seed ^ 0x9e3779b9, x, z, 7);
    return Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.floor(base)));
  }

  generateChunk(cx: number, cz: number): Uint8Array {
    const data = new Uint8Array(CHUNK_BLOCK_COUNT); // zero-filled = Air
    for (let lz = 0; lz < CHUNK_SIZE_Z; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE_X; lx++) {
        const h = this.heightAt(cx * CHUNK_SIZE_X + lx, cz * CHUNK_SIZE_Z + lz);
        for (let y = 0; y <= h; y++) {
          let id: BlockId;
          if (y === h) id = BlockId.Grass;
          else if (y >= h - DIRT_DEPTH) id = BlockId.Dirt;
          else id = BlockId.Stone;
          data[blockIndex(lx, y, lz)] = id;
        }
      }
    }
    return data;
  }
}

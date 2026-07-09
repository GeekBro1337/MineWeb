import fs from 'node:fs';
import path from 'node:path';
import {
  CHUNK_SIZE_X,
  CHUNK_SIZE_Z,
  CHUNK_HEIGHT,
  blockIndex,
  chunkKey,
  chunkCoord,
  localCoord,
} from '../../../shared/constants';
import type { WorldMeta } from '../../../shared/protocol';
import { BlockId, isValidBlockId, isSolid } from './blockTypes';
import { WorldGenerator } from './generator';
import { Chunk } from './chunk';

/** On-disk format. Kept flat and dumb so a DB migration later is trivial. */
interface WorldFileFormat {
  seed: number;
  /** chunkKey -> { blockIndexInChunk -> blockId } */
  edits: Record<string, Record<string, number>>;
}

const SAVE_DEBOUNCE_MS = 2000;
const DEFAULT_SEED = 1337;
const SPAWN_X = 8;
const SPAWN_Z = 8;

/**
 * World state = procedural base generation + player edits on top.
 * Only the edits are persisted; base terrain is regenerated from the seed.
 */
export class WorldStore {
  readonly generator: WorldGenerator;
  private edits = new Map<string, Map<number, BlockId>>();
  private saveTimer: NodeJS.Timeout | null = null;
  private dirty = false;

  constructor(private readonly filePath: string, defaultSeed = DEFAULT_SEED) {
    let seed = defaultSeed;
    if (fs.existsSync(filePath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as WorldFileFormat;
        if (typeof raw.seed === 'number') seed = raw.seed;
        for (const [key, blocks] of Object.entries(raw.edits ?? {})) {
          const chunkEdits = new Map<number, BlockId>();
          for (const [idx, id] of Object.entries(blocks)) {
            if (isValidBlockId(id)) chunkEdits.set(Number(idx), id);
          }
          if (chunkEdits.size > 0) this.edits.set(key, chunkEdits);
        }
        console.log(`[world] loaded edits for ${this.edits.size} chunk(s) from ${filePath}`);
      } catch (err) {
        console.error(`[world] failed to read ${filePath}, starting fresh:`, err);
      }
    }
    this.generator = new WorldGenerator(seed);
  }

  get seed(): number {
    return this.generator.seed;
  }

  /** Base generation with player edits applied. */
  getChunk(cx: number, cz: number): Chunk {
    const data = this.generator.generateChunk(cx, cz);
    const chunkEdits = this.edits.get(chunkKey(cx, cz));
    if (chunkEdits) {
      for (const [idx, id] of chunkEdits) data[idx] = id;
    }
    return new Chunk(cx, cz, data);
  }

  /** Apply a player edit in world coordinates. Returns false for invalid input. */
  setBlock(x: number, y: number, z: number, id: number): boolean {
    if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z)) return false;
    if (y < 0 || y >= CHUNK_HEIGHT) return false;
    if (!isValidBlockId(id)) return false;

    const cx = chunkCoord(x, CHUNK_SIZE_X);
    const cz = chunkCoord(z, CHUNK_SIZE_Z);
    const key = chunkKey(cx, cz);
    let chunkEdits = this.edits.get(key);
    if (!chunkEdits) {
      chunkEdits = new Map();
      this.edits.set(key, chunkEdits);
    }
    chunkEdits.set(blockIndex(localCoord(x, CHUNK_SIZE_X), y, localCoord(z, CHUNK_SIZE_Z)), id);
    this.dirty = true;
    this.scheduleSave();
    return true;
  }

  /** Highest solid block in the column, taking edits into account. -1 if empty. */
  surfaceHeight(x: number, z: number): number {
    const chunk = this.getChunk(chunkCoord(x, CHUNK_SIZE_X), chunkCoord(z, CHUNK_SIZE_Z));
    const lx = localCoord(x, CHUNK_SIZE_X);
    const lz = localCoord(z, CHUNK_SIZE_Z);
    for (let y = CHUNK_HEIGHT - 1; y >= 0; y--) {
      if (isSolid(chunk.getBlock(lx, y, lz))) return y;
    }
    return -1;
  }

  getMeta(): WorldMeta {
    return {
      seed: this.seed,
      chunkSizeX: CHUNK_SIZE_X,
      chunkSizeZ: CHUNK_SIZE_Z,
      chunkHeight: CHUNK_HEIGHT,
      spawn: {
        x: SPAWN_X + 0.5,
        y: this.surfaceHeight(SPAWN_X, SPAWN_Z) + 1,
        z: SPAWN_Z + 0.5,
      },
    };
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.save();
    }, SAVE_DEBOUNCE_MS);
  }

  save(): void {
    if (!this.dirty) return;
    const out: WorldFileFormat = { seed: this.seed, edits: {} };
    for (const [key, blocks] of this.edits) {
      const record: Record<string, number> = {};
      for (const [idx, id] of blocks) record[idx] = id;
      out.edits[key] = record;
    }
    // A transient FS error (ENOSPC, permissions) must not crash the server:
    // dirty stays true, so the next edit reschedules a retry.
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      // Write to a temp file first so a crash mid-write cannot corrupt the world.
      const tmpPath = this.filePath + '.tmp';
      fs.writeFileSync(tmpPath, JSON.stringify(out));
      fs.renameSync(tmpPath, this.filePath);
      this.dirty = false;
      console.log(`[world] saved to ${this.filePath}`);
    } catch (err) {
      console.error(`[world] save failed (will retry on next edit):`, err);
    }
  }

  /** Flush pending changes synchronously (used on shutdown). */
  close(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.save();
  }
}

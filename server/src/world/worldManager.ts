import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { WorldInfo } from '../../../shared/protocol';
import { WorldStore } from './worldStore';

interface IndexFile {
  worlds: WorldInfo[];
}

const MAX_NAME_LEN = 40;

/** FNV-1a hash so a text seed maps to a deterministic 32-bit number (like Minecraft). */
function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function resolveSeed(seedInput: unknown): number {
  if (seedInput === undefined || seedInput === null || seedInput === '') {
    return Math.floor(Math.random() * 0xffffffff) >>> 0;
  }
  if (typeof seedInput === 'number' && Number.isFinite(seedInput)) {
    return Math.floor(seedInput) >>> 0;
  }
  const s = String(seedInput).trim();
  // Blank (or whitespace-only) means "random", matching the "случайный" placeholder.
  if (s === '') return Math.floor(Math.random() * 0xffffffff) >>> 0;
  const asNum = Number(s);
  if (Number.isFinite(asNum)) return Math.floor(asNum) >>> 0;
  return hashSeed(s);
}

/**
 * Manages the set of saved worlds. Each world is a {@link WorldStore} backed by
 * its own JSON file under data/worlds/<id>.json; a data/worlds/index.json lists
 * their metadata (name, seed, timestamps). Stores are opened lazily and cached,
 * so only worlds that have been played hold memory.
 */
export class WorldManager {
  private index = new Map<string, WorldInfo>();
  private stores = new Map<string, WorldStore>();
  private readonly worldsDir: string;
  private readonly indexPath: string;

  constructor(dataDir: string) {
    this.worldsDir = path.join(dataDir, 'worlds');
    this.indexPath = path.join(this.worldsDir, 'index.json');
    fs.mkdirSync(this.worldsDir, { recursive: true });
    this.loadIndex();
  }

  private loadIndex(): void {
    if (!fs.existsSync(this.indexPath)) return;
    try {
      const raw = JSON.parse(fs.readFileSync(this.indexPath, 'utf-8')) as IndexFile;
      for (const w of raw.worlds ?? []) {
        if (w && typeof w.id === 'string' && typeof w.seed === 'number') {
          this.index.set(w.id, w);
        }
      }
      console.log(`[worlds] loaded ${this.index.size} world(s) from ${this.indexPath}`);
    } catch (err) {
      console.error(`[worlds] failed to read index, starting empty:`, err);
    }
  }

  private saveIndex(): void {
    const out: IndexFile = { worlds: [...this.index.values()] };
    try {
      const tmp = this.indexPath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(out, null, 2));
      fs.renameSync(tmp, this.indexPath);
    } catch (err) {
      console.error('[worlds] failed to write index:', err);
    }
  }

  private fileFor(id: string): string {
    return path.join(this.worldsDir, `${id}.json`);
  }

  /** Worlds ordered by most recently played first. */
  list(): WorldInfo[] {
    return [...this.index.values()].sort((a, b) => b.lastPlayed - a.lastPlayed);
  }

  has(id: string): boolean {
    return this.index.has(id);
  }

  create(name: unknown, seedInput?: unknown): WorldInfo {
    const cleanName =
      (typeof name === 'string' ? name : '').trim().slice(0, MAX_NAME_LEN) || 'New World';
    const seed = resolveSeed(seedInput);
    const id = crypto.randomUUID();
    const now = Date.now();
    const info: WorldInfo = { id, name: cleanName, seed, createdAt: now, lastPlayed: now };
    this.index.set(id, info);
    // Seed lives in index.json, so the world regenerates identically even before
    // any edit creates its own file.
    this.stores.set(id, new WorldStore(this.fileFor(id), seed));
    this.saveIndex();
    console.log(`[worlds] created "${cleanName}" (${id}) seed=${seed}`);
    return info;
  }

  /** Opens (and caches) the store for a world, or null if the world is unknown. */
  getStore(id: string): WorldStore | null {
    const info = this.index.get(id);
    if (!info) return null;
    let store = this.stores.get(id);
    if (!store) {
      store = new WorldStore(this.fileFor(id), info.seed);
      this.stores.set(id, store);
    }
    return store;
  }

  /** Marks a world as just played (updates ordering in the menu). */
  touch(id: string): void {
    const info = this.index.get(id);
    if (!info) return;
    info.lastPlayed = Date.now();
    this.saveIndex();
  }

  delete(id: string): boolean {
    if (!this.index.has(id)) return false;
    const store = this.stores.get(id);
    if (store) {
      store.close();
      this.stores.delete(id);
    }
    this.index.delete(id);
    try {
      fs.rmSync(this.fileFor(id), { force: true });
      fs.rmSync(this.fileFor(id) + '.tmp', { force: true });
    } catch (err) {
      console.error(`[worlds] failed to delete file for ${id}:`, err);
    }
    this.saveIndex();
    return true;
  }

  /** Flushes every open world (used on shutdown). */
  closeAll(): void {
    for (const store of this.stores.values()) store.close();
    this.saveIndex();
  }
}

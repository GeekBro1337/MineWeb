import * as THREE from 'three';
import {
  CHUNK_SIZE_X,
  CHUNK_SIZE_Z,
  CHUNK_HEIGHT,
  chunkKey,
  chunkCoord,
  localCoord,
} from '../../../shared/constants';
import { BlockId, isSolid } from './BlockRegistry';
import { Chunk } from './Chunk';
import { buildChunkGeometry } from './ChunkMesher';
import type { Network } from './Network';

/** Chunks are kept loaded within this Chebyshev radius around the player. */
const RENDER_DISTANCE = 3;
const UNLOAD_DISTANCE = RENDER_DISTANCE + 1;
/** Cap mesh rebuilds per frame so the initial load doesn't freeze one frame. */
const MAX_REBUILDS_PER_FRAME = 8;

const NEIGHBOR_OFFSETS: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * Client-side world: loaded chunks, block lookups for physics/raycasting,
 * chunk streaming around the player and mesh rebuild scheduling.
 */
export class World {
  private chunks = new Map<string, Chunk>();
  private pending = new Set<string>();
  private dirty = new Set<string>();
  /** Remote edits for chunks whose fetch is still in flight, replayed on arrival. */
  private pendingEdits = new Map<string, Array<{ x: number; y: number; z: number; id: BlockId }>>();
  private material = new THREE.MeshLambertMaterial({ vertexColors: true });

  constructor(
    private scene: THREE.Scene,
    private network: Network,
  ) {}

  getBlock(x: number, y: number, z: number): BlockId {
    if (y < 0 || y >= CHUNK_HEIGHT) return BlockId.Air;
    const chunk = this.chunks.get(chunkKey(chunkCoord(x, CHUNK_SIZE_X), chunkCoord(z, CHUNK_SIZE_Z)));
    if (!chunk) return BlockId.Air;
    return chunk.getBlock(localCoord(x, CHUNK_SIZE_X), y, localCoord(z, CHUNK_SIZE_Z));
  }

  /**
   * Collision variant of getBlock: unloaded chunks count as solid so the
   * player cannot walk or fall into terrain that has not arrived yet.
   */
  isSolidAt(x: number, y: number, z: number): boolean {
    if (y < 0 || y >= CHUNK_HEIGHT) return false;
    const chunk = this.chunks.get(chunkKey(chunkCoord(x, CHUNK_SIZE_X), chunkCoord(z, CHUNK_SIZE_Z)));
    if (!chunk) return true;
    return isSolid(chunk.getBlock(localCoord(x, CHUNK_SIZE_X), y, localCoord(z, CHUNK_SIZE_Z)));
  }

  /**
   * Applies a block change locally and marks affected chunk meshes dirty.
   * Returns true if the stored value actually changed.
   */
  setBlockLocal(x: number, y: number, z: number, id: BlockId): boolean {
    if (y < 0 || y >= CHUNK_HEIGHT) return false;
    const cx = chunkCoord(x, CHUNK_SIZE_X);
    const cz = chunkCoord(z, CHUNK_SIZE_Z);
    const chunk = this.chunks.get(chunkKey(cx, cz));
    if (!chunk) return false;

    const lx = localCoord(x, CHUNK_SIZE_X);
    const lz = localCoord(z, CHUNK_SIZE_Z);
    if (chunk.getBlock(lx, y, lz) === id) return false;
    chunk.setBlock(lx, y, lz, id);

    this.dirty.add(chunk.key);
    // A change on a chunk border also affects the neighbor's visible faces.
    if (lx === 0) this.dirty.add(chunkKey(cx - 1, cz));
    if (lx === CHUNK_SIZE_X - 1) this.dirty.add(chunkKey(cx + 1, cz));
    if (lz === 0) this.dirty.add(chunkKey(cx, cz - 1));
    if (lz === CHUNK_SIZE_Z - 1) this.dirty.add(chunkKey(cx, cz + 1));
    return true;
  }

  /** Player edit: apply locally and send to the server. */
  setBlock(x: number, y: number, z: number, id: BlockId): void {
    if (this.setBlockLocal(x, y, z, id)) {
      this.network.sendBlockSet({ x, y, z, id });
    }
  }

  /**
   * Applies a server-sent block change. If the target chunk's fetch is still
   * in flight, the edit is buffered and replayed once the chunk arrives —
   * otherwise the fetched snapshot (serialized before the edit) would
   * silently overwrite it. Updates for fully unloaded chunks are dropped:
   * a future fetch already includes them.
   */
  applyRemoteBlockUpdate(x: number, y: number, z: number, id: BlockId): void {
    const key = chunkKey(chunkCoord(x, CHUNK_SIZE_X), chunkCoord(z, CHUNK_SIZE_Z));
    if (!this.chunks.has(key) && this.pending.has(key)) {
      let queue = this.pendingEdits.get(key);
      if (!queue) {
        queue = [];
        this.pendingEdits.set(key, queue);
      }
      queue.push({ x, y, z, id });
      return;
    }
    this.setBlockLocal(x, y, z, id);
  }

  /** Loads every chunk around the spawn point before the game starts. */
  async loadInitial(centerX: number, centerZ: number): Promise<void> {
    await this.streamChunks(centerX, centerZ, true);
    this.rebuildDirty(Infinity);
  }

  /** Called every frame: stream chunks around the player, rebuild dirty meshes. */
  update(playerX: number, playerZ: number): void {
    void this.streamChunks(playerX, playerZ, false);
    this.rebuildDirty(MAX_REBUILDS_PER_FRAME);
  }

  private async streamChunks(x: number, z: number, waitAll: boolean): Promise<void> {
    const pcx = chunkCoord(Math.floor(x), CHUNK_SIZE_X);
    const pcz = chunkCoord(Math.floor(z), CHUNK_SIZE_Z);

    for (const chunk of [...this.chunks.values()]) {
      const dist = Math.max(Math.abs(chunk.cx - pcx), Math.abs(chunk.cz - pcz));
      if (dist > UNLOAD_DISTANCE) this.unloadChunk(chunk);
    }

    const loads: Promise<void>[] = [];
    for (let cx = pcx - RENDER_DISTANCE; cx <= pcx + RENDER_DISTANCE; cx++) {
      for (let cz = pcz - RENDER_DISTANCE; cz <= pcz + RENDER_DISTANCE; cz++) {
        const key = chunkKey(cx, cz);
        if (this.chunks.has(key) || this.pending.has(key)) continue;
        loads.push(this.loadChunk(cx, cz));
      }
    }
    if (waitAll) await Promise.all(loads);
  }

  private async loadChunk(cx: number, cz: number): Promise<void> {
    const key = chunkKey(cx, cz);
    this.pending.add(key);
    try {
      const data = await this.network.fetchChunk(cx, cz);
      const chunk = new Chunk(cx, cz, data);
      this.chunks.set(key, chunk);
      this.dirty.add(key);
      // Remote edits that raced this fetch: the snapshot was serialized
      // before them, so apply them on top now.
      const queued = this.pendingEdits.get(key);
      if (queued) {
        this.pendingEdits.delete(key);
        for (const e of queued) this.setBlockLocal(e.x, e.y, e.z, e.id);
      }
      // Fresh data can close previously open faces on already-built neighbors.
      for (const [dx, dz] of NEIGHBOR_OFFSETS) {
        const neighborKey = chunkKey(cx + dx, cz + dz);
        if (this.chunks.has(neighborKey)) this.dirty.add(neighborKey);
      }
    } catch (err) {
      console.error(`[world] failed to load chunk ${key}:`, err);
      this.pendingEdits.delete(key);
    } finally {
      this.pending.delete(key);
    }
  }

  private unloadChunk(chunk: Chunk): void {
    this.chunks.delete(chunk.key);
    this.dirty.delete(chunk.key);
    if (chunk.mesh) {
      this.scene.remove(chunk.mesh);
      chunk.mesh.geometry.dispose();
      chunk.mesh = null;
    }
    // Mirror of loadChunk: still-loaded neighbors had their border faces
    // culled against this chunk's blocks — rebuild them against Air, or the
    // boundary becomes a permanent see-through hole.
    for (const [dx, dz] of NEIGHBOR_OFFSETS) {
      const neighborKey = chunkKey(chunk.cx + dx, chunk.cz + dz);
      if (this.chunks.has(neighborKey)) this.dirty.add(neighborKey);
    }
  }

  private rebuildDirty(limit: number): void {
    let rebuilt = 0;
    for (const key of this.dirty) {
      if (rebuilt >= limit) break;
      this.dirty.delete(key);
      const chunk = this.chunks.get(key);
      if (!chunk) continue;
      this.rebuildChunkMesh(chunk);
      rebuilt++;
    }
  }

  private rebuildChunkMesh(chunk: Chunk): void {
    if (chunk.mesh) {
      this.scene.remove(chunk.mesh);
      chunk.mesh.geometry.dispose();
      chunk.mesh = null;
    }
    const geometry = buildChunkGeometry(chunk, (x, y, z) => this.getBlock(x, y, z));
    if (!geometry) return;
    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.position.set(chunk.cx * CHUNK_SIZE_X, 0, chunk.cz * CHUNK_SIZE_Z);
    this.scene.add(mesh);
    chunk.mesh = mesh;
  }
}

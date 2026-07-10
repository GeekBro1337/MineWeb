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
import type { BlockMaterials } from './Textures';

/** Solid core (radius, in chunks) fetched synchronously before the game starts. */
const INITIAL_LOAD_RADIUS = 3;
/** Cap mesh rebuilds per frame so streaming never freezes a frame. */
const MAX_REBUILDS_PER_FRAME = 6;
/** Cap new chunk fetches started per frame; nearest chunks are requested first. */
const MAX_LOADS_PER_FRAME = 8;

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
  /** Opaque block materials + the translucent water material; set before meshing. */
  private materials: THREE.Material[] = [];
  private waterMaterial: THREE.Material | null = null;

  /** Chebyshev radius (chunks) kept loaded around the player; from settings. */
  private renderDistance: number;

  constructor(
    private scene: THREE.Scene,
    private network: Network,
    renderDistance: number,
  ) {
    this.renderDistance = renderDistance;
  }

  private get unloadDistance(): number {
    // Small hysteresis so chunks at the edge don't thrash load/unload.
    return this.renderDistance + 2;
  }

  /** Live-update the render distance (from the settings slider). */
  setRenderDistance(distance: number): void {
    this.renderDistance = distance;
  }

  /** Must be called with the loaded block textures before loadInitial(). */
  setMaterials(materials: BlockMaterials): void {
    this.materials = materials.opaque;
    this.waterMaterial = materials.water;
  }

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

  /**
   * Fetches just the core of chunks around the spawn point so the player never
   * spawns into unloaded (solid) terrain. The rest of the render distance is
   * streamed in progressively by update() once the game loop is running.
   */
  async loadInitial(centerX: number, centerZ: number): Promise<void> {
    const pcx = chunkCoord(Math.floor(centerX), CHUNK_SIZE_X);
    const pcz = chunkCoord(Math.floor(centerZ), CHUNK_SIZE_Z);
    const coreRadius = Math.min(INITIAL_LOAD_RADIUS, this.renderDistance);
    const loads: Promise<void>[] = [];
    for (let cx = pcx - coreRadius; cx <= pcx + coreRadius; cx++) {
      for (let cz = pcz - coreRadius; cz <= pcz + coreRadius; cz++) {
        loads.push(this.loadChunk(cx, cz));
      }
    }
    await Promise.all(loads);
    this.rebuildDirty(Infinity);
  }

  /** Called every frame: stream chunks around the player, rebuild dirty meshes. */
  update(playerX: number, playerZ: number): void {
    this.streamChunks(playerX, playerZ);
    this.rebuildDirty(MAX_REBUILDS_PER_FRAME);
  }

  private streamChunks(x: number, z: number): void {
    const pcx = chunkCoord(Math.floor(x), CHUNK_SIZE_X);
    const pcz = chunkCoord(Math.floor(z), CHUNK_SIZE_Z);

    for (const chunk of [...this.chunks.values()]) {
      const dist = Math.max(Math.abs(chunk.cx - pcx), Math.abs(chunk.cz - pcz));
      if (dist > this.unloadDistance) this.unloadChunk(chunk);
    }

    // Collect the missing chunks in range, then fetch only the nearest few this
    // frame so a large render distance loads smoothly instead of all at once.
    const missing: Array<{ cx: number; cz: number; d: number }> = [];
    for (let cx = pcx - this.renderDistance; cx <= pcx + this.renderDistance; cx++) {
      for (let cz = pcz - this.renderDistance; cz <= pcz + this.renderDistance; cz++) {
        const key = chunkKey(cx, cz);
        if (this.chunks.has(key) || this.pending.has(key)) continue;
        missing.push({ cx, cz, d: Math.max(Math.abs(cx - pcx), Math.abs(cz - pcz)) });
      }
    }
    if (missing.length === 0) return;
    missing.sort((a, b) => a.d - b.d);
    for (let i = 0; i < Math.min(MAX_LOADS_PER_FRAME, missing.length); i++) {
      void this.loadChunk(missing[i].cx, missing[i].cz);
    }
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
    this.disposeMeshes(chunk);
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

  private disposeMeshes(chunk: Chunk): void {
    if (chunk.mesh) {
      this.scene.remove(chunk.mesh);
      chunk.mesh.geometry.dispose();
      chunk.mesh = null;
    }
    if (chunk.waterMesh) {
      this.scene.remove(chunk.waterMesh);
      chunk.waterMesh.geometry.dispose();
      chunk.waterMesh = null;
    }
  }

  private rebuildChunkMesh(chunk: Chunk): void {
    this.disposeMeshes(chunk);
    const { opaque, water } = buildChunkGeometry(chunk, (x, y, z) => this.getBlock(x, y, z));
    const ox = chunk.cx * CHUNK_SIZE_X;
    const oz = chunk.cz * CHUNK_SIZE_Z;
    if (opaque) {
      const mesh = new THREE.Mesh(opaque, this.materials);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.position.set(ox, 0, oz);
      this.scene.add(mesh);
      chunk.mesh = mesh;
    }
    if (water && this.waterMaterial) {
      const mesh = new THREE.Mesh(water, this.waterMaterial);
      mesh.position.set(ox, 0, oz);
      this.scene.add(mesh);
      chunk.waterMesh = mesh;
    }
  }

  /** Frees all chunk meshes and block textures/materials (on leaving the world). */
  dispose(): void {
    for (const chunk of this.chunks.values()) this.disposeMeshes(chunk);
    this.chunks.clear();
    this.dirty.clear();
    this.pendingEdits.clear();
    const all = this.waterMaterial ? [...this.materials, this.waterMaterial] : this.materials;
    for (const material of all) {
      const map = (material as THREE.MeshLambertMaterial).map;
      if (map) map.dispose();
      material.dispose();
    }
    this.materials = [];
    this.waterMaterial = null;
  }
}

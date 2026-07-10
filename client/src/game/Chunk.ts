import type * as THREE from 'three';
import { CHUNK_HEIGHT, blockIndex, chunkKey } from '../../../shared/constants';
import { BlockId } from './BlockRegistry';

/** Client-side chunk: block data plus its renderable meshes (opaque + water). */
export class Chunk {
  mesh: THREE.Mesh | null = null;
  waterMesh: THREE.Mesh | null = null;

  constructor(
    readonly cx: number,
    readonly cz: number,
    readonly data: Uint8Array,
  ) {}

  get key(): string {
    return chunkKey(this.cx, this.cz);
  }

  getBlock(lx: number, ly: number, lz: number): BlockId {
    if (ly < 0 || ly >= CHUNK_HEIGHT) return BlockId.Air;
    return this.data[blockIndex(lx, ly, lz)] as BlockId;
  }

  setBlock(lx: number, ly: number, lz: number, id: BlockId): void {
    if (ly < 0 || ly >= CHUNK_HEIGHT) return;
    this.data[blockIndex(lx, ly, lz)] = id;
  }
}

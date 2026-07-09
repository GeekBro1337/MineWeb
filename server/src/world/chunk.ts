import {
  CHUNK_SIZE_X,
  CHUNK_SIZE_Z,
  CHUNK_HEIGHT,
  blockIndex,
  chunkKey,
} from '../../../shared/constants';
import { BlockId } from './blockTypes';

/** Server-side chunk: chunk coords plus a flat array of block ids. */
export class Chunk {
  constructor(
    readonly cx: number,
    readonly cz: number,
    readonly data: Uint8Array,
  ) {}

  get key(): string {
    return chunkKey(this.cx, this.cz);
  }

  static isInBounds(lx: number, ly: number, lz: number): boolean {
    return (
      lx >= 0 && lx < CHUNK_SIZE_X &&
      ly >= 0 && ly < CHUNK_HEIGHT &&
      lz >= 0 && lz < CHUNK_SIZE_Z
    );
  }

  getBlock(lx: number, ly: number, lz: number): BlockId {
    return this.data[blockIndex(lx, ly, lz)] as BlockId;
  }

  setBlock(lx: number, ly: number, lz: number, id: BlockId): void {
    this.data[blockIndex(lx, ly, lz)] = id;
  }
}

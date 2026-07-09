export const CHUNK_SIZE_X = 16;
export const CHUNK_SIZE_Z = 16;
export const CHUNK_HEIGHT = 64;
export const CHUNK_BLOCK_COUNT = CHUNK_SIZE_X * CHUNK_SIZE_Z * CHUNK_HEIGHT;

/**
 * Index of a block inside the flat chunk array (local coords).
 * Layout: x fastest, then z, then y — must match on client and server.
 */
export function blockIndex(lx: number, ly: number, lz: number): number {
  return lx + lz * CHUNK_SIZE_X + ly * CHUNK_SIZE_X * CHUNK_SIZE_Z;
}

export function chunkKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

/** Chunk coordinate containing world coordinate v (works for negatives). */
export function chunkCoord(v: number, chunkSize: number): number {
  return Math.floor(v / chunkSize);
}

/** Local coordinate of world coordinate v inside its chunk. */
export function localCoord(v: number, chunkSize: number): number {
  return v - Math.floor(v / chunkSize) * chunkSize;
}

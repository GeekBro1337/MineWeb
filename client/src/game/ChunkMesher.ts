import * as THREE from 'three';
import { CHUNK_SIZE_X, CHUNK_SIZE_Z, CHUNK_HEIGHT } from '../../../shared/constants';
import { BlockId, blockColor, isSolid } from './BlockRegistry';
import type { Chunk } from './Chunk';

/** Neighbor lookup in world block coords, so faces on chunk borders are culled correctly. */
export type BlockLookup = (x: number, y: number, z: number) => BlockId;

interface FaceSpec {
  dir: [number, number, number];
  corners: [number, number, number][];
}

// Corner order gives counter-clockwise winding when the face is seen from outside.
const FACES: FaceSpec[] = [
  { dir: [-1, 0, 0], corners: [[0, 1, 0], [0, 0, 0], [0, 1, 1], [0, 0, 1]] },
  { dir: [1, 0, 0], corners: [[1, 1, 1], [1, 0, 1], [1, 1, 0], [1, 0, 0]] },
  { dir: [0, -1, 0], corners: [[1, 0, 1], [0, 0, 1], [1, 0, 0], [0, 0, 0]] },
  { dir: [0, 1, 0], corners: [[0, 1, 1], [1, 1, 1], [0, 1, 0], [1, 1, 0]] },
  { dir: [0, 0, -1], corners: [[1, 0, 0], [0, 0, 0], [1, 1, 0], [0, 1, 0]] },
  { dir: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]] },
];

/**
 * Builds a single BufferGeometry for a whole chunk. Air blocks produce no
 * geometry, and faces touching a solid neighbor are skipped, so only the
 * visible surface is uploaded to the GPU. Returns null for an empty chunk.
 */
export function buildChunkGeometry(chunk: Chunk, getWorldBlock: BlockLookup): THREE.BufferGeometry | null {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  const baseX = chunk.cx * CHUNK_SIZE_X;
  const baseZ = chunk.cz * CHUNK_SIZE_Z;

  for (let ly = 0; ly < CHUNK_HEIGHT; ly++) {
    for (let lz = 0; lz < CHUNK_SIZE_Z; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE_X; lx++) {
        const id = chunk.getBlock(lx, ly, lz);
        if (!isSolid(id)) continue;
        const color = blockColor(id);

        for (const face of FACES) {
          const [dx, dy, dz] = face.dir;
          const nx = lx + dx;
          const ny = ly + dy;
          const nz = lz + dz;
          // Neighbors inside this chunk are read directly; border neighbors
          // go through the world lookup so they see adjacent chunks.
          const neighbor =
            nx >= 0 && nx < CHUNK_SIZE_X && nz >= 0 && nz < CHUNK_SIZE_Z
              ? chunk.getBlock(nx, ny, nz)
              : getWorldBlock(baseX + nx, ny, baseZ + nz);
          if (isSolid(neighbor)) continue;

          const vertexBase = positions.length / 3;
          for (const [ox, oy, oz] of face.corners) {
            positions.push(lx + ox, ly + oy, lz + oz);
            normals.push(dx, dy, dz);
            colors.push(color.r, color.g, color.b);
          }
          indices.push(
            vertexBase, vertexBase + 1, vertexBase + 2,
            vertexBase + 2, vertexBase + 1, vertexBase + 3,
          );
        }
      }
    }
  }

  if (indices.length === 0) return null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

import * as THREE from 'three';
import { CHUNK_SIZE_X, CHUNK_SIZE_Z, CHUNK_HEIGHT } from '../../../shared/constants';
import { BlockId, isSolid } from './BlockRegistry';
import { MATERIAL_COUNT, materialIndexFor } from './Textures';
import type { Chunk } from './Chunk';

/** Neighbor lookup in world block coords, so faces on chunk borders are culled correctly. */
export type BlockLookup = (x: number, y: number, z: number) => BlockId;

interface FaceSpec {
  dir: [number, number, number];
  corners: [number, number, number][];
  /** UVs per corner; v points toward world +Y on side faces so texture "up" is up. */
  uv: [number, number][];
}

// Corner order gives counter-clockwise winding when the face is seen from outside.
const FACES: FaceSpec[] = [
  { dir: [-1, 0, 0], corners: [[0, 1, 0], [0, 0, 0], [0, 1, 1], [0, 0, 1]], uv: [[0, 1], [0, 0], [1, 1], [1, 0]] },
  { dir: [1, 0, 0], corners: [[1, 1, 1], [1, 0, 1], [1, 1, 0], [1, 0, 0]], uv: [[1, 1], [1, 0], [0, 1], [0, 0]] },
  { dir: [0, -1, 0], corners: [[1, 0, 1], [0, 0, 1], [1, 0, 0], [0, 0, 0]], uv: [[1, 1], [0, 1], [1, 0], [0, 0]] },
  { dir: [0, 1, 0], corners: [[0, 1, 1], [1, 1, 1], [0, 1, 0], [1, 1, 0]], uv: [[0, 1], [1, 1], [0, 0], [1, 0]] },
  { dir: [0, 0, -1], corners: [[1, 0, 0], [0, 0, 0], [1, 1, 0], [0, 1, 0]], uv: [[1, 0], [0, 0], [1, 1], [0, 1]] },
  { dir: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]], uv: [[0, 0], [1, 0], [0, 1], [1, 1]] },
];

/**
 * Builds a single BufferGeometry for a whole chunk. Air blocks produce no
 * geometry, and faces touching a solid neighbor are skipped, so only the
 * visible surface is uploaded to the GPU. Faces are grouped by material
 * (one per texture) so the whole chunk stays a single geometry rendered in a
 * few draw calls. Returns null for an empty chunk.
 */
export function buildChunkGeometry(chunk: Chunk, getWorldBlock: BlockLookup): THREE.BufferGeometry | null {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  // One index list per material; assembled into contiguous groups at the end.
  const buckets: number[][] = Array.from({ length: MATERIAL_COUNT }, () => []);

  const baseX = chunk.cx * CHUNK_SIZE_X;
  const baseZ = chunk.cz * CHUNK_SIZE_Z;

  for (let ly = 0; ly < CHUNK_HEIGHT; ly++) {
    for (let lz = 0; lz < CHUNK_SIZE_Z; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE_X; lx++) {
        const id = chunk.getBlock(lx, ly, lz);
        if (!isSolid(id)) continue;

        for (let faceIndex = 0; faceIndex < FACES.length; faceIndex++) {
          const face = FACES[faceIndex];
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
          for (let c = 0; c < 4; c++) {
            const [ox, oy, oz] = face.corners[c];
            positions.push(lx + ox, ly + oy, lz + oz);
            normals.push(dx, dy, dz);
            uvs.push(face.uv[c][0], face.uv[c][1]);
          }
          buckets[materialIndexFor(id, faceIndex)].push(
            vertexBase, vertexBase + 1, vertexBase + 2,
            vertexBase + 2, vertexBase + 1, vertexBase + 3,
          );
        }
      }
    }
  }

  if (positions.length === 0) return null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));

  // Flatten the per-material buckets into one index array with a group range
  // for each non-empty material, so `mesh.material[groupIndex]` textures it.
  const indices: number[] = [];
  for (let mi = 0; mi < buckets.length; mi++) {
    const bucket = buckets[mi];
    if (bucket.length === 0) continue;
    const start = indices.length;
    for (const idx of bucket) indices.push(idx);
    geometry.addGroup(start, bucket.length, mi);
  }

  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

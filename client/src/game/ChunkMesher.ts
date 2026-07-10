import * as THREE from 'three';
import { CHUNK_SIZE_X, CHUNK_SIZE_Z, CHUNK_HEIGHT } from '../../../shared/constants';
import { BlockId, isSolid, isWater } from './BlockRegistry';
import { MATERIAL_COUNT, materialIndexFor } from './Textures';
import type { Chunk } from './Chunk';

export interface ChunkGeometries {
  /** Opaque blocks, grouped by material. */
  opaque: THREE.BufferGeometry | null;
  /** Water surface (against air), one translucent material, rendered separately. */
  water: THREE.BufferGeometry | null;
}

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
 * Builds the chunk's geometry. Air produces nothing; opaque blocks emit only
 * faces not touching another opaque block, grouped by material into one mesh.
 * Water is emitted separately (only its surface against air) into a translucent
 * mesh so transparency sorts correctly. Either result may be null (empty).
 */
export function buildChunkGeometry(chunk: Chunk, getWorldBlock: BlockLookup): ChunkGeometries {
  // Opaque attributes + per-material index buckets.
  const oPos: number[] = [];
  const oNorm: number[] = [];
  const oUv: number[] = [];
  const buckets: number[][] = Array.from({ length: MATERIAL_COUNT }, () => []);
  // Water attributes (single material, no groups).
  const wPos: number[] = [];
  const wNorm: number[] = [];
  const wUv: number[] = [];
  const wIdx: number[] = [];

  const baseX = chunk.cx * CHUNK_SIZE_X;
  const baseZ = chunk.cz * CHUNK_SIZE_Z;

  for (let ly = 0; ly < CHUNK_HEIGHT; ly++) {
    for (let lz = 0; lz < CHUNK_SIZE_Z; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE_X; lx++) {
        const id = chunk.getBlock(lx, ly, lz);
        const water = isWater(id);
        if (!water && !isSolid(id)) continue; // air

        for (let faceIndex = 0; faceIndex < FACES.length; faceIndex++) {
          const face = FACES[faceIndex];
          const [dx, dy, dz] = face.dir;
          const nx = lx + dx;
          const ny = ly + dy;
          const nz = lz + dz;
          // Neighbors inside this chunk are read directly; border neighbors go
          // through the world lookup so they see adjacent chunks.
          const neighbor =
            nx >= 0 && nx < CHUNK_SIZE_X && nz >= 0 && nz < CHUNK_SIZE_Z
              ? chunk.getBlock(nx, ny, nz)
              : getWorldBlock(baseX + nx, ny, baseZ + nz);

          if (water) {
            // Only draw the water surface where it meets air (top and pool edges).
            if (neighbor !== BlockId.Air) continue;
            const vb = wPos.length / 3;
            for (let c = 0; c < 4; c++) {
              const [ox, oy, oz] = face.corners[c];
              wPos.push(lx + ox, ly + oy, lz + oz);
              wNorm.push(dx, dy, dz);
              wUv.push(face.uv[c][0], face.uv[c][1]);
            }
            wIdx.push(vb, vb + 1, vb + 2, vb + 2, vb + 1, vb + 3);
          } else {
            // Opaque: cull only against other opaque (solid) blocks; faces against
            // air OR water are drawn (so underwater terrain shows through).
            if (isSolid(neighbor)) continue;
            const vb = oPos.length / 3;
            for (let c = 0; c < 4; c++) {
              const [ox, oy, oz] = face.corners[c];
              oPos.push(lx + ox, ly + oy, lz + oz);
              oNorm.push(dx, dy, dz);
              oUv.push(face.uv[c][0], face.uv[c][1]);
            }
            buckets[materialIndexFor(id, faceIndex)].push(
              vb, vb + 1, vb + 2, vb + 2, vb + 1, vb + 3,
            );
          }
        }
      }
    }
  }

  return {
    opaque: buildGrouped(oPos, oNorm, oUv, buckets),
    water: buildSimple(wPos, wNorm, wUv, wIdx),
  };
}

function buildGrouped(
  positions: number[],
  normals: number[],
  uvs: number[],
  buckets: number[][],
): THREE.BufferGeometry | null {
  if (positions.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
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

function buildSimple(
  positions: number[],
  normals: number[],
  uvs: number[],
  indices: number[],
): THREE.BufferGeometry | null {
  if (positions.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

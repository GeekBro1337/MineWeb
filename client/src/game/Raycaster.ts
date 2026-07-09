import type * as THREE from 'three';

export interface VoxelRayHit {
  /** Coordinates of the hit block. */
  x: number;
  y: number;
  z: number;
  /** Unit normal of the hit face (points out of the block). */
  nx: number;
  ny: number;
  nz: number;
  distance: number;
}

/**
 * Voxel ray traversal (Amanatides & Woo). Walks the grid cell by cell, so it
 * returns the exact block and face the camera ray hits — no mesh intersection
 * tests needed.
 */
export function raycastVoxels(
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  maxDistance: number,
  isSolid: (x: number, y: number, z: number) => boolean,
): VoxelRayHit | null {
  let bx = Math.floor(origin.x);
  let by = Math.floor(origin.y);
  let bz = Math.floor(origin.z);

  // Camera inside a solid block — no meaningful target.
  if (isSolid(bx, by, bz)) return null;

  const stepX = direction.x > 0 ? 1 : direction.x < 0 ? -1 : 0;
  const stepY = direction.y > 0 ? 1 : direction.y < 0 ? -1 : 0;
  const stepZ = direction.z > 0 ? 1 : direction.z < 0 ? -1 : 0;

  const tDeltaX = stepX !== 0 ? Math.abs(1 / direction.x) : Infinity;
  const tDeltaY = stepY !== 0 ? Math.abs(1 / direction.y) : Infinity;
  const tDeltaZ = stepZ !== 0 ? Math.abs(1 / direction.z) : Infinity;

  // Distance along the ray to the first boundary on each axis.
  let tMaxX = stepX !== 0 ? (stepX > 0 ? bx + 1 - origin.x : origin.x - bx) * tDeltaX : Infinity;
  let tMaxY = stepY !== 0 ? (stepY > 0 ? by + 1 - origin.y : origin.y - by) * tDeltaY : Infinity;
  let tMaxZ = stepZ !== 0 ? (stepZ > 0 ? bz + 1 - origin.z : origin.z - bz) * tDeltaZ : Infinity;

  let t = 0;
  let nx = 0;
  let ny = 0;
  let nz = 0;

  while (t <= maxDistance) {
    if (tMaxX <= tMaxY && tMaxX <= tMaxZ) {
      bx += stepX;
      t = tMaxX;
      tMaxX += tDeltaX;
      nx = -stepX; ny = 0; nz = 0;
    } else if (tMaxY <= tMaxZ) {
      by += stepY;
      t = tMaxY;
      tMaxY += tDeltaY;
      nx = 0; ny = -stepY; nz = 0;
    } else {
      bz += stepZ;
      t = tMaxZ;
      tMaxZ += tDeltaZ;
      nx = 0; ny = 0; nz = -stepZ;
    }
    if (t > maxDistance) return null;
    if (isSolid(bx, by, bz)) {
      return { x: bx, y: by, z: bz, nx, ny, nz, distance: t };
    }
  }
  return null;
}

import * as THREE from 'three';
import { BLOCKS, BlockId, isSolid, isWater } from '../../../shared/blocks';

// Client-side entry point for block data; definitions live in /shared.
export { BLOCKS, BlockId, isSolid, isWater };

const colorCache = new Map<BlockId, THREE.Color>();

/** Block color as THREE.Color (converted to the renderer's working color space). */
export function blockColor(id: BlockId): THREE.Color {
  let color = colorCache.get(id);
  if (!color) {
    color = new THREE.Color(BLOCKS[id].color);
    colorCache.set(id, color);
  }
  return color;
}

export function blockCssColor(id: BlockId): string {
  return '#' + BLOCKS[id].color.toString(16).padStart(6, '0');
}

export function blockName(id: BlockId): string {
  return BLOCKS[id].name;
}

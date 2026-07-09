export enum BlockId {
  Air = 0,
  Grass = 1,
  Dirt = 2,
  Stone = 3,
  Wood = 4,
}

export interface BlockDef {
  id: BlockId;
  name: string;
  solid: boolean;
  /** Flat color 0xRRGGBB — MVP uses colors instead of textures. */
  color: number;
}

export const BLOCKS: Record<BlockId, BlockDef> = {
  [BlockId.Air]: { id: BlockId.Air, name: 'Air', solid: false, color: 0x000000 },
  [BlockId.Grass]: { id: BlockId.Grass, name: 'Grass', solid: true, color: 0x4f9d3f },
  [BlockId.Dirt]: { id: BlockId.Dirt, name: 'Dirt', solid: true, color: 0x7a5230 },
  [BlockId.Stone]: { id: BlockId.Stone, name: 'Stone', solid: true, color: 0x8d8d8d },
  [BlockId.Wood]: { id: BlockId.Wood, name: 'Wood', solid: true, color: 0xa2793d },
};

/** Blocks selectable with keys 1..4. */
export const HOTBAR_BLOCKS: BlockId[] = [BlockId.Grass, BlockId.Dirt, BlockId.Stone, BlockId.Wood];

export function isValidBlockId(id: unknown): id is BlockId {
  return typeof id === 'number' && Number.isInteger(id) && BLOCKS[id as BlockId] !== undefined;
}

export function isSolid(id: BlockId): boolean {
  const def = BLOCKS[id];
  return def !== undefined && def.solid;
}

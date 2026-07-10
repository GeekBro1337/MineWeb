export enum BlockId {
  Air = 0,
  Grass = 1,
  Dirt = 2,
  Stone = 3,
  Wood = 4,
  Leaves = 5,
  Planks = 6,
  CoalOre = 7,
  IronOre = 8,
  Furnace = 9,
  Water = 10,
  Sand = 11,
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
  [BlockId.Leaves]: { id: BlockId.Leaves, name: 'Leaves', solid: true, color: 0x3d7a2a },
  [BlockId.Planks]: { id: BlockId.Planks, name: 'Planks', solid: true, color: 0xb98a4b },
  [BlockId.CoalOre]: { id: BlockId.CoalOre, name: 'Coal Ore', solid: true, color: 0x4a4a52 },
  [BlockId.IronOre]: { id: BlockId.IronOre, name: 'Iron Ore', solid: true, color: 0xa89a86 },
  [BlockId.Furnace]: { id: BlockId.Furnace, name: 'Furnace', solid: true, color: 0x6f6f75 },
  // Water is non-solid (the player swims through it) and rendered translucent.
  [BlockId.Water]: { id: BlockId.Water, name: 'Water', solid: false, color: 0x3a6ea5 },
  [BlockId.Sand]: { id: BlockId.Sand, name: 'Sand', solid: true, color: 0xdccf9a },
};

/** True for water (used by the mesher for its translucent pass and by physics). */
export function isWater(id: BlockId): boolean {
  return id === BlockId.Water;
}

export function isValidBlockId(id: unknown): id is BlockId {
  return typeof id === 'number' && Number.isInteger(id) && BLOCKS[id as BlockId] !== undefined;
}

export function isSolid(id: BlockId): boolean {
  const def = BLOCKS[id];
  return def !== undefined && def.solid;
}

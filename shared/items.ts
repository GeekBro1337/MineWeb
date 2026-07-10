import { BlockId } from './blocks';

/** Everything that can sit in an inventory slot. Placeable ones back a block. */
export type ItemId =
  | 'grass'
  | 'dirt'
  | 'stone'
  | 'wood'
  | 'leaves'
  | 'planks'
  | 'coal_ore'
  | 'iron_ore'
  | 'furnace'
  | 'sand'
  | 'water'
  | 'coal'
  | 'stick'
  | 'iron_ingot';

export interface ItemDef {
  id: ItemId;
  name: string;
  /** If set, this item places this block. */
  block?: BlockId;
}

export const ITEMS: Record<ItemId, ItemDef> = {
  grass: { id: 'grass', name: 'Трава', block: BlockId.Grass },
  dirt: { id: 'dirt', name: 'Земля', block: BlockId.Dirt },
  stone: { id: 'stone', name: 'Камень', block: BlockId.Stone },
  wood: { id: 'wood', name: 'Дерево', block: BlockId.Wood },
  leaves: { id: 'leaves', name: 'Листва', block: BlockId.Leaves },
  planks: { id: 'planks', name: 'Доски', block: BlockId.Planks },
  coal_ore: { id: 'coal_ore', name: 'Угольная руда', block: BlockId.CoalOre },
  iron_ore: { id: 'iron_ore', name: 'Железная руда', block: BlockId.IronOre },
  furnace: { id: 'furnace', name: 'Печь', block: BlockId.Furnace },
  sand: { id: 'sand', name: 'Песок', block: BlockId.Sand },
  water: { id: 'water', name: 'Вода', block: BlockId.Water },
  coal: { id: 'coal', name: 'Уголь' },
  stick: { id: 'stick', name: 'Палка' },
  iron_ingot: { id: 'iron_ingot', name: 'Железный слиток' },
};

export const MAX_STACK = 64;

export type ItemStack = { item: ItemId; count: number };

export function isPlaceable(item: ItemId): boolean {
  return ITEMS[item].block !== undefined;
}

/** Placeable items; the first 9 form the creative hotbar. */
export const PLACEABLE_ITEMS: ItemId[] = [
  'grass',
  'dirt',
  'stone',
  'sand',
  'wood',
  'planks',
  'leaves',
  'water',
  'furnace',
  'coal_ore',
  'iron_ore',
];

/** The item a mined block yields (survival). null = no drop (air). */
export function blockDrop(block: BlockId): ItemId | null {
  switch (block) {
    case BlockId.Grass: return 'grass';
    case BlockId.Dirt: return 'dirt';
    case BlockId.Stone: return 'stone';
    case BlockId.Wood: return 'wood';
    case BlockId.Leaves: return 'leaves';
    case BlockId.Planks: return 'planks';
    case BlockId.CoalOre: return 'coal'; // ore drops the resource
    case BlockId.IronOre: return 'iron_ore'; // needs smelting to become an ingot
    case BlockId.Furnace: return 'furnace';
    case BlockId.Sand: return 'sand';
    // Water isn't mined (no bucket); it drops nothing.
    default: return null;
  }
}

/** Seconds a furnace needs to smelt one item. */
export const SMELT_TIME_SEC = 4;

/** What an input item smelts into, or null if it can't be smelted. */
export function smeltResult(item: ItemId): ItemId | null {
  switch (item) {
    case 'iron_ore': return 'iron_ingot';
    default: return null;
  }
}

/** Seconds of furnace burn a fuel item provides, or 0 if not a fuel. */
export function fuelBurnSeconds(item: ItemId): number {
  switch (item) {
    case 'coal': return SMELT_TIME_SEC * 8; // one coal smelts 8 items
    case 'wood': return SMELT_TIME_SEC * 4;
    case 'planks': return SMELT_TIME_SEC * 1.5;
    default: return 0;
  }
}

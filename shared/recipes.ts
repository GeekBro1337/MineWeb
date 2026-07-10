import type { ItemId, ItemStack } from './items';

/**
 * Crafting recipes for the 3×3 grid. Shaped recipes match a pattern anywhere in
 * the grid (the pattern is trimmed to its bounding box and compared); shapeless
 * recipes match the exact multiset of ingredients regardless of position.
 */
interface ShapedRecipe {
  kind: 'shaped';
  id: string;
  /** Rows of a small pattern; each char maps through `key`, ' ' = empty. */
  pattern: string[];
  key: Record<string, ItemId>;
  output: ItemStack;
}

interface ShapelessRecipe {
  kind: 'shapeless';
  id: string;
  ingredients: ItemId[];
  output: ItemStack;
}

export type Recipe = ShapedRecipe | ShapelessRecipe;

export const RECIPES: Recipe[] = [
  { kind: 'shapeless', id: 'planks', ingredients: ['wood'], output: { item: 'planks', count: 4 } },
  { kind: 'shaped', id: 'sticks', pattern: ['P', 'P'], key: { P: 'planks' }, output: { item: 'stick', count: 4 } },
  {
    kind: 'shaped',
    id: 'furnace',
    pattern: ['SSS', 'S S', 'SSS'],
    key: { S: 'stone' },
    output: { item: 'furnace', count: 1 },
  },
];

/** A 3×3 grid of item ids (row-major, length 9); null = empty cell. */
export type CraftGrid = (ItemId | null)[];

interface Bounds {
  minR: number;
  maxR: number;
  minC: number;
  maxC: number;
}

function boundsOf(grid: CraftGrid): Bounds | null {
  let minR = 3, maxR = -1, minC = 3, maxC = -1;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      if (grid[r * 3 + c] !== null) {
        minR = Math.min(minR, r);
        maxR = Math.max(maxR, r);
        minC = Math.min(minC, c);
        maxC = Math.max(maxC, c);
      }
    }
  }
  return maxR < 0 ? null : { minR, maxR, minC, maxC };
}

function matchShaped(grid: CraftGrid, recipe: ShapedRecipe): boolean {
  const b = boundsOf(grid);
  if (!b) return false;
  const gh = b.maxR - b.minR + 1;
  const gw = b.maxC - b.minC + 1;
  const ph = recipe.pattern.length;
  const pw = Math.max(...recipe.pattern.map((row) => row.length));
  if (gh !== ph || gw !== pw) return false;
  for (let r = 0; r < ph; r++) {
    for (let c = 0; c < pw; c++) {
      const ch = recipe.pattern[r][c] ?? ' ';
      const want = ch === ' ' ? null : recipe.key[ch];
      const got = grid[(b.minR + r) * 3 + (b.minC + c)];
      if (want !== got) return false;
    }
  }
  return true;
}

function matchShapeless(grid: CraftGrid, recipe: ShapelessRecipe): boolean {
  const items = grid.filter((x): x is ItemId => x !== null);
  if (items.length !== recipe.ingredients.length) return false;
  const remaining = [...recipe.ingredients];
  for (const it of items) {
    const idx = remaining.indexOf(it);
    if (idx < 0) return false;
    remaining.splice(idx, 1);
  }
  return remaining.length === 0;
}

/** The output for the current 3×3 grid, or null if nothing matches. */
export function matchRecipe(grid: CraftGrid): ItemStack | null {
  for (const recipe of RECIPES) {
    const ok = recipe.kind === 'shaped' ? matchShaped(grid, recipe) : matchShapeless(grid, recipe);
    if (ok) return { ...recipe.output };
  }
  return null;
}

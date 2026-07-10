import { MAX_STACK, type ItemId, type ItemStack } from '../../../shared/items';

export const HOTBAR_SIZE = 9;
export const MAIN_SIZE = 27;
export const INVENTORY_SIZE = HOTBAR_SIZE + MAIN_SIZE;

/**
 * The player's item storage: a flat array of stacks. Slots 0..8 are the hotbar
 * (shown on the HUD), 9..35 the main inventory (shown on the inventory screen).
 */
export class Inventory {
  readonly slots: (ItemStack | null)[] = new Array(INVENTORY_SIZE).fill(null);

  /**
   * Adds items, first topping up existing stacks of the same item, then filling
   * empty slots (hotbar first, so mined items land on the hotbar). Returns the
   * count that didn't fit.
   */
  add(item: ItemId, count: number): number {
    for (let i = 0; i < this.slots.length && count > 0; i++) {
      const s = this.slots[i];
      if (s && s.item === item && s.count < MAX_STACK) {
        const room = MAX_STACK - s.count;
        const put = Math.min(room, count);
        s.count += put;
        count -= put;
      }
    }
    for (let i = 0; i < this.slots.length && count > 0; i++) {
      if (this.slots[i] === null) {
        const put = Math.min(MAX_STACK, count);
        this.slots[i] = { item, count: put };
        count -= put;
      }
    }
    return count;
  }

  countOf(item: ItemId): number {
    let total = 0;
    for (const s of this.slots) if (s && s.item === item) total += s.count;
    return total;
  }

  /** Removes up to n of an item from anywhere; returns how many were removed. */
  remove(item: ItemId, n: number): number {
    let removed = 0;
    for (let i = 0; i < this.slots.length && removed < n; i++) {
      const s = this.slots[i];
      if (s && s.item === item) {
        const take = Math.min(s.count, n - removed);
        s.count -= take;
        removed += take;
        if (s.count <= 0) this.slots[i] = null;
      }
    }
    return removed;
  }

  /** Consumes one item from a specific slot (used when placing from the hotbar). */
  consumeSlot(index: number): void {
    const s = this.slots[index];
    if (!s) return;
    s.count -= 1;
    if (s.count <= 0) this.slots[index] = null;
  }
}

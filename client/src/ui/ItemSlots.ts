import { ITEMS, MAX_STACK, type ItemId, type ItemStack } from '../../../shared/items';
import type { Inventory } from '../game/Inventory';
import { itemIconUrl } from '../game/Textures';

type Stack = ItemStack | null;

/** A group of slots the drag system can read/write (inventory, craft grid, furnace…). */
export interface SlotContainer {
  get(i: number): Stack;
  set(i: number, s: Stack): void;
  /** Whether item may be dropped into slot i (fuel/input filters). Default: yes. */
  canPlace?(i: number, item: ItemId): boolean;
  /** Take-only slots (craft result, furnace output). Default: no. */
  isReadonly?(i: number): boolean;
  /** Called when the player takes from a take-only slot (consume ingredients). */
  onTake?(i: number, taken: ItemStack): void;
}

interface Binding {
  el: HTMLElement;
  c: SlotContainer;
  i: number;
}

/**
 * Shared cursor-stack drag&drop for a screen: left-click picks up / drops /
 * merges / swaps, right-click grabs half / drops one. One held stack is shared
 * across every slot group in the screen and follows the mouse.
 */
export class DragSession {
  private held: Stack = null;
  private bindings: Binding[] = [];
  private cursor: HTMLElement;
  private cursorCount: HTMLElement;

  constructor(root: HTMLElement) {
    this.cursor = document.createElement('div');
    this.cursor.className = 'drag-cursor';
    this.cursor.style.display = 'none';
    this.cursorCount = document.createElement('span');
    this.cursorCount.className = 'slot-count';
    this.cursor.appendChild(this.cursorCount);
    root.appendChild(this.cursor);
  }

  /** Creates a bound slot element the caller places into its layout. */
  createSlot(c: SlotContainer, i: number, extraClass = ''): HTMLElement {
    const el = document.createElement('div');
    el.className = 'slot' + (extraClass ? ' ' + extraClass : '');
    const count = document.createElement('span');
    count.className = 'slot-count';
    el.appendChild(count);
    el.addEventListener('click', (e) => {
      e.preventDefault();
      this.leftClick(c, i);
    });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.rightClick(c, i);
    });
    this.bindings.push({ el, c, i });
    return el;
  }

  activate(): void {
    this.held = null;
    document.addEventListener('mousemove', this.onMove);
    this.refresh();
  }

  /**
   * Tries to return the held stack to `dump`. Returns true if the cursor is now
   * empty; false (keeping the leftover on the cursor) if the inventory had no
   * room — so the caller can refuse to close instead of destroying items.
   */
  returnHeld(dump: Inventory): boolean {
    if (!this.held) return true;
    const leftover = dump.add(this.held.item, this.held.count);
    this.held = leftover > 0 ? { item: this.held.item, count: leftover } : null;
    this.refresh();
    return this.held === null;
  }

  /** Stops tracking the mouse and clears the cursor (once the screen fully closes). */
  deactivate(): void {
    document.removeEventListener('mousemove', this.onMove);
    this.held = null;
    this.cursor.style.display = 'none';
  }

  dispose(): void {
    this.deactivate();
    this.cursor.remove();
  }

  refresh(): void {
    for (const b of this.bindings) this.renderSlot(b);
    if (this.held) {
      this.cursor.style.display = 'block';
      this.cursor.style.backgroundImage = `url(${itemIconUrl(this.held.item)})`;
      this.cursorCount.textContent = this.held.count > 1 ? String(this.held.count) : '';
    } else {
      this.cursor.style.display = 'none';
    }
  }

  private renderSlot(b: Binding): void {
    const stack = b.c.get(b.i);
    b.el.style.backgroundImage = stack ? `url(${itemIconUrl(stack.item)})` : '';
    const count = b.el.querySelector('.slot-count')!;
    count.textContent = stack && stack.count > 1 ? String(stack.count) : '';
    b.el.title = stack ? ITEMS[stack.item].name : '';
  }

  private onMove = (e: MouseEvent): void => {
    this.cursor.style.left = `${e.clientX}px`;
    this.cursor.style.top = `${e.clientY}px`;
  };

  private canPlace(c: SlotContainer, i: number, item: ItemId): boolean {
    return c.canPlace ? c.canPlace(i, item) : true;
  }

  private leftClick(c: SlotContainer, i: number): void {
    const slot = c.get(i);
    if (c.isReadonly?.(i)) {
      if (!slot) return;
      if (!this.held) {
        this.held = slot;
        c.set(i, null);
        c.onTake?.(i, slot);
      } else if (this.held.item === slot.item && this.held.count + slot.count <= MAX_STACK) {
        this.held.count += slot.count;
        c.set(i, null);
        c.onTake?.(i, slot);
      }
      this.refresh();
      return;
    }

    if (!this.held) {
      if (slot) {
        this.held = slot;
        c.set(i, null);
      }
    } else if (!slot) {
      if (this.canPlace(c, i, this.held.item)) {
        c.set(i, this.held);
        this.held = null;
      }
    } else if (slot.item === this.held.item) {
      if (this.canPlace(c, i, this.held.item)) {
        const move = Math.min(MAX_STACK - slot.count, this.held.count);
        slot.count += move;
        this.held.count -= move;
        c.set(i, slot);
        if (this.held.count <= 0) this.held = null;
      }
    } else if (this.canPlace(c, i, this.held.item)) {
      c.set(i, this.held);
      this.held = slot;
    }
    this.refresh();
  }

  private rightClick(c: SlotContainer, i: number): void {
    if (c.isReadonly?.(i)) {
      this.leftClick(c, i); // taking a craft result: same as left
      return;
    }
    const slot = c.get(i);
    if (!this.held) {
      if (slot) {
        const half = Math.ceil(slot.count / 2);
        this.held = { item: slot.item, count: half };
        slot.count -= half;
        c.set(i, slot.count > 0 ? slot : null);
      }
    } else if (!slot) {
      if (this.canPlace(c, i, this.held.item)) {
        c.set(i, { item: this.held.item, count: 1 });
        this.held.count -= 1;
        if (this.held.count <= 0) this.held = null;
      }
    } else if (slot.item === this.held.item && slot.count < MAX_STACK) {
      if (this.canPlace(c, i, this.held.item)) {
        slot.count += 1;
        this.held.count -= 1;
        c.set(i, slot);
        if (this.held.count <= 0) this.held = null;
      }
    }
    this.refresh();
  }
}

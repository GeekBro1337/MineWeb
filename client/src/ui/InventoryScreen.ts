import { matchRecipe } from '../../../shared/recipes';
import type { ItemStack } from '../../../shared/items';
import type { Inventory } from '../game/Inventory';
import { DragSession, type SlotContainer } from './ItemSlots';

const HOTBAR_SIZE = 9;

/**
 * Full inventory + 3×3 crafting screen (opened with E). Uses the shared drag&drop
 * cursor. Closing returns the crafting grid and any held stack to the inventory.
 */
export class InventoryScreen {
  private el: HTMLElement;
  private drag: DragSession;
  private craftGrid: (ItemStack | null)[] = new Array(9).fill(null);
  private visible = false;

  onRequestClose: (() => void) | null = null;

  constructor(
    root: HTMLElement,
    private inventory: Inventory,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'screen inventory-screen';
    this.el.style.display = 'none';
    this.drag = new DragSession(this.el);

    const win = document.createElement('div');
    win.className = 'inv-window';

    const title = document.createElement('h2');
    title.className = 'inv-title';
    title.textContent = 'Инвентарь · Крафт';
    win.appendChild(title);

    win.appendChild(this.buildCraftArea());
    win.appendChild(this.buildInventoryArea());

    const close = document.createElement('button');
    close.className = 'menu-btn';
    close.textContent = 'Закрыть (E)';
    close.addEventListener('click', () => this.onRequestClose?.());
    win.appendChild(close);

    this.el.appendChild(win);
    root.appendChild(this.el);
  }

  private invContainer(): SlotContainer {
    return {
      get: (i) => this.inventory.slots[i],
      set: (i, s) => {
        this.inventory.slots[i] = s;
      },
    };
  }

  private buildCraftArea(): HTMLElement {
    const area = document.createElement('div');
    area.className = 'craft-area';

    const gridContainer: SlotContainer = {
      get: (i) => this.craftGrid[i],
      set: (i, s) => {
        this.craftGrid[i] = s;
      },
    };
    const grid = document.createElement('div');
    grid.className = 'craft-grid';
    for (let i = 0; i < 9; i++) grid.appendChild(this.drag.createSlot(gridContainer, i));

    const arrow = document.createElement('div');
    arrow.className = 'craft-arrow';
    arrow.textContent = '➜';

    const resultContainer: SlotContainer = {
      get: () => {
        const out = matchRecipe(this.craftGrid.map((s) => (s ? s.item : null)));
        return out ? { item: out.item, count: out.count } : null;
      },
      set: () => {},
      isReadonly: () => true,
      onTake: () => {
        for (let i = 0; i < 9; i++) {
          const s = this.craftGrid[i];
          if (s) {
            s.count -= 1;
            if (s.count <= 0) this.craftGrid[i] = null;
          }
        }
      },
    };
    const result = this.drag.createSlot(resultContainer, 0, 'result-slot');

    area.append(grid, arrow, result);
    return area;
  }

  private buildInventoryArea(): HTMLElement {
    const area = document.createElement('div');
    area.className = 'inv-area';
    const inv = this.invContainer();

    const main = document.createElement('div');
    main.className = 'inv-grid';
    for (let i = HOTBAR_SIZE; i < this.inventory.slots.length; i++) {
      main.appendChild(this.drag.createSlot(inv, i));
    }

    const hotbar = document.createElement('div');
    hotbar.className = 'inv-grid inv-hotbar-row';
    for (let i = 0; i < HOTBAR_SIZE; i++) hotbar.appendChild(this.drag.createSlot(inv, i));

    area.append(main, hotbar);
    return area;
  }

  show(): void {
    this.visible = true;
    this.el.style.display = 'flex';
    this.drag.activate();
    document.addEventListener('keydown', this.onKey);
  }

  /**
   * Returns the craft grid and held stack to the inventory, then hides. If the
   * inventory has no room, keeps the leftover in place and returns false so the
   * caller leaves the screen open instead of losing items.
   */
  tryClose(): boolean {
    if (!this.visible) return true;
    let allReturned = true;
    for (let i = 0; i < 9; i++) {
      const s = this.craftGrid[i];
      if (s) {
        const leftover = this.inventory.add(s.item, s.count);
        this.craftGrid[i] = leftover > 0 ? { item: s.item, count: leftover } : null;
        if (leftover > 0) allReturned = false;
      }
    }
    if (!this.drag.returnHeld(this.inventory)) allReturned = false;
    if (!allReturned) {
      this.drag.refresh();
      return false;
    }
    this.visible = false;
    this.drag.deactivate();
    document.removeEventListener('keydown', this.onKey);
    this.el.style.display = 'none';
    return true;
  }

  dispose(): void {
    document.removeEventListener('keydown', this.onKey);
    this.drag.dispose();
    this.el.remove();
  }

  private onKey = (e: KeyboardEvent): void => {
    if (e.code === 'Escape' || e.code === 'KeyE') {
      e.preventDefault();
      this.onRequestClose?.();
    }
  };
}

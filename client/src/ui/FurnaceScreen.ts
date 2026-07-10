import { SMELT_TIME_SEC, fuelBurnSeconds } from '../../../shared/items';
import type { FurnaceState } from '../game/Furnaces';
import type { Inventory } from '../game/Inventory';
import { DragSession, type SlotContainer } from './ItemSlots';

const HOTBAR_SIZE = 9;

/** Furnace UI: input + fuel + output slots, a smelt-progress arrow and a fuel flame. */
export class FurnaceScreen {
  private el: HTMLElement;
  private drag: DragSession;
  private state: FurnaceState | null = null;
  private visible = false;
  private progressEl!: HTMLElement;
  private flameEl!: HTMLElement;

  onRequestClose: (() => void) | null = null;

  constructor(
    root: HTMLElement,
    private inventory: Inventory,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'screen furnace-screen';
    this.el.style.display = 'none';
    this.drag = new DragSession(this.el);

    const win = document.createElement('div');
    win.className = 'inv-window';
    const title = document.createElement('h2');
    title.className = 'inv-title';
    title.textContent = 'Печь';
    win.appendChild(title);

    win.appendChild(this.buildFurnaceArea());
    win.appendChild(this.buildInventoryArea());

    const close = document.createElement('button');
    close.className = 'menu-btn';
    close.textContent = 'Закрыть (E)';
    close.addEventListener('click', () => this.onRequestClose?.());
    win.appendChild(close);

    this.el.appendChild(win);
    root.appendChild(this.el);
  }

  private furnaceContainer(): SlotContainer {
    return {
      get: (i) => {
        const st = this.state;
        if (!st) return null;
        return i === 0 ? st.input : i === 1 ? st.fuel : st.output;
      },
      set: (i, s) => {
        const st = this.state;
        if (!st) return;
        if (i === 0) st.input = s;
        else if (i === 1) st.fuel = s;
        else st.output = s;
      },
      canPlace: (i, item) => (i === 1 ? fuelBurnSeconds(item) > 0 : i === 0),
      isReadonly: (i) => i === 2,
    };
  }

  private buildFurnaceArea(): HTMLElement {
    const area = document.createElement('div');
    area.className = 'furnace-area';
    const fc = this.furnaceContainer();

    const left = document.createElement('div');
    left.className = 'furnace-col';
    const inputSlot = this.drag.createSlot(fc, 0);
    const flame = document.createElement('div');
    flame.className = 'furnace-flame';
    this.flameEl = document.createElement('div');
    this.flameEl.className = 'furnace-flame-fill';
    flame.appendChild(this.flameEl);
    const fuelSlot = this.drag.createSlot(fc, 1);
    left.append(inputSlot, flame, fuelSlot);

    const arrow = document.createElement('div');
    arrow.className = 'furnace-arrow';
    this.progressEl = document.createElement('div');
    this.progressEl.className = 'furnace-arrow-fill';
    arrow.appendChild(this.progressEl);

    const output = this.drag.createSlot(fc, 2, 'result-slot');

    area.append(left, arrow, output);
    return area;
  }

  private buildInventoryArea(): HTMLElement {
    const area = document.createElement('div');
    area.className = 'inv-area';
    const inv: SlotContainer = {
      get: (i) => this.inventory.slots[i],
      set: (i, s) => {
        this.inventory.slots[i] = s;
      },
    };
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

  open(state: FurnaceState): void {
    this.state = state;
    this.visible = true;
    this.el.style.display = 'flex';
    this.drag.activate();
    document.addEventListener('keydown', this.onKey);
    this.tick();
  }

  /** Called each frame while open to reflect smelting progress. */
  tick(): void {
    if (!this.visible || !this.state) return;
    const p = Math.min(1, this.state.progress / SMELT_TIME_SEC);
    this.progressEl.style.width = `${Math.round(p * 100)}%`;
    const flame = this.state.burnMax > 0 ? Math.max(0, this.state.burnLeft / this.state.burnMax) : 0;
    this.flameEl.style.height = `${Math.round(flame * 100)}%`;
    this.drag.refresh();
  }

  /**
   * Returns the held cursor stack to the inventory (furnace slots persist in the
   * furnace) and hides. Keeps the screen open (false) if there was no room.
   */
  tryClose(): boolean {
    if (!this.visible) return true;
    if (!this.drag.returnHeld(this.inventory)) {
      this.drag.refresh();
      return false;
    }
    this.visible = false;
    this.drag.deactivate();
    document.removeEventListener('keydown', this.onKey);
    this.el.style.display = 'none';
    this.state = null;
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

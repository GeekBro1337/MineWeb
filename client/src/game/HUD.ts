import { ITEMS, type ItemId } from '../../../shared/items';
import { itemIconUrl } from './Textures';

const FPS_UPDATE_INTERVAL_MS = 500;
const HOTBAR_SLOTS = 9;
const HEARTS = 10;

export interface HotbarSlotView {
  item: ItemId | null;
  /** null = infinite (creative). */
  count: number | null;
}

/** In-game DOM overlay: crosshair, readout, hearts, item hotbar, transient status. */
export class HUD {
  private root: HTMLElement;
  private fpsEl: HTMLElement;
  private coordsEl: HTMLElement;
  private timeEl: HTMLElement;
  private statusEl: HTMLElement;
  private heartsEl: HTMLElement;
  private hotbarEl: HTMLElement;
  private hotbarSlots: HTMLElement[] = [];
  private heartFills: HTMLElement[] = [];

  private frames = 0;
  private lastFpsUpdate: number | null = null;

  constructor(root: HTMLElement) {
    const hud = document.createElement('div');
    hud.className = 'hud';
    this.root = hud;
    hud.innerHTML = `
      <div class="crosshair"></div>
      <div class="hud-info">
        <div data-id="fps">FPS: —</div>
        <div data-id="time">— —:—</div>
        <div data-id="coords">X — Y — Z —</div>
      </div>
      <div class="hearts" data-id="hearts"></div>
      <div class="hotbar" data-id="hotbar"></div>
      <div class="status" data-id="status"></div>
    `;
    root.appendChild(hud);

    this.fpsEl = hud.querySelector('[data-id="fps"]')!;
    this.coordsEl = hud.querySelector('[data-id="coords"]')!;
    this.timeEl = hud.querySelector('[data-id="time"]')!;
    this.statusEl = hud.querySelector('[data-id="status"]')!;
    this.heartsEl = hud.querySelector('[data-id="hearts"]')!;
    this.hotbarEl = hud.querySelector('[data-id="hotbar"]')!;

    for (let i = 0; i < HOTBAR_SLOTS; i++) {
      const slot = document.createElement('div');
      slot.className = 'hotbar-slot';
      slot.innerHTML = `
        <span class="hotbar-key">${i + 1}</span>
        <span class="hotbar-swatch"></span>
        <span class="hotbar-count"></span>
      `;
      this.hotbarEl.appendChild(slot);
      this.hotbarSlots.push(slot);
    }

    for (let i = 0; i < HEARTS; i++) {
      const heart = document.createElement('span');
      heart.className = 'heart';
      const bg = document.createElement('span');
      bg.className = 'heart-bg';
      bg.textContent = '♥';
      const fg = document.createElement('span');
      fg.className = 'heart-fg';
      fg.textContent = '♥';
      heart.append(bg, fg);
      this.heartsEl.appendChild(heart);
      this.heartFills.push(fg);
    }
  }

  setStatus(text: string | null): void {
    this.statusEl.textContent = text ?? '';
    this.statusEl.style.display = text ? 'block' : 'none';
  }

  setClock(text: string): void {
    this.timeEl.textContent = text;
  }

  setHealthVisible(visible: boolean): void {
    this.heartsEl.style.display = visible ? 'flex' : 'none';
  }

  setHealth(health: number, max: number): void {
    const hpPerHeart = max / HEARTS;
    for (let i = 0; i < HEARTS; i++) {
      const fill = Math.max(0, Math.min(1, (health - i * hpPerHeart) / hpPerHeart));
      this.heartFills[i].style.width = `${fill * 100}%`;
    }
  }

  setHotbar(view: HotbarSlotView[], selected: number): void {
    for (let i = 0; i < HOTBAR_SLOTS; i++) {
      const slot = this.hotbarSlots[i];
      const cell = view[i];
      const swatch = slot.querySelector('.hotbar-swatch') as HTMLElement;
      const count = slot.querySelector('.hotbar-count') as HTMLElement;
      if (cell && cell.item) {
        swatch.style.backgroundImage = `url(${itemIconUrl(cell.item)})`;
        slot.title = ITEMS[cell.item].name;
        count.textContent = cell.count !== null && cell.count > 1 ? String(cell.count) : '';
      } else {
        swatch.style.backgroundImage = '';
        slot.title = '';
        count.textContent = '';
      }
      slot.classList.toggle('active', i === selected);
    }
  }

  /** Call once per frame. */
  update(x: number, y: number, z: number): void {
    const now = performance.now();
    if (this.lastFpsUpdate === null) this.lastFpsUpdate = now;
    this.frames++;
    const elapsed = now - this.lastFpsUpdate;
    if (elapsed >= FPS_UPDATE_INTERVAL_MS) {
      this.fpsEl.textContent = `FPS: ${Math.round((this.frames * 1000) / elapsed)}`;
      this.frames = 0;
      this.lastFpsUpdate = now;
    }
    this.coordsEl.textContent = `X ${x.toFixed(1)}  Y ${y.toFixed(1)}  Z ${z.toFixed(1)}`;
  }

  dispose(): void {
    this.root.remove();
  }
}

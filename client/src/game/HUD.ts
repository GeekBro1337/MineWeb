import { blockName, HOTBAR_BLOCKS } from './BlockRegistry';
import { blockIconUrl } from './Textures';

const FPS_UPDATE_INTERVAL_MS = 500;

/** In-game DOM overlay: crosshair, FPS/time/coords readout, hotbar, transient status. */
export class HUD {
  private root: HTMLElement;
  private fpsEl: HTMLElement;
  private coordsEl: HTMLElement;
  private blockEl: HTMLElement;
  private timeEl: HTMLElement;
  private statusEl: HTMLElement;
  private hotbarSlots: HTMLElement[] = [];

  private frames = 0;
  /** Set on the first update() call — the HUD is built before the game loop starts. */
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
        <div data-id="block">Block: —</div>
      </div>
      <div class="hotbar"></div>
      <div class="status" data-id="status"></div>
    `;
    root.appendChild(hud);

    this.fpsEl = hud.querySelector('[data-id="fps"]')!;
    this.coordsEl = hud.querySelector('[data-id="coords"]')!;
    this.blockEl = hud.querySelector('[data-id="block"]')!;
    this.timeEl = hud.querySelector('[data-id="time"]')!;
    this.statusEl = hud.querySelector('[data-id="status"]')!;

    const hotbar = hud.querySelector('.hotbar')!;
    HOTBAR_BLOCKS.forEach((id, i) => {
      const slot = document.createElement('div');
      slot.className = 'hotbar-slot';
      slot.innerHTML = `
        <span class="hotbar-key">${i + 1}</span>
        <span class="hotbar-swatch" style="background-image:url(${blockIconUrl(id)})"></span>
      `;
      slot.title = blockName(id);
      hotbar.appendChild(slot);
      this.hotbarSlots.push(slot);
    });
  }

  setStatus(text: string | null): void {
    this.statusEl.textContent = text ?? '';
    this.statusEl.style.display = text ? 'block' : 'none';
  }

  setClock(text: string): void {
    this.timeEl.textContent = text;
  }

  setSelectedSlot(index: number): void {
    this.hotbarSlots.forEach((slot, i) => slot.classList.toggle('active', i === index));
    this.blockEl.textContent = `Block: ${blockName(HOTBAR_BLOCKS[index])}`;
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

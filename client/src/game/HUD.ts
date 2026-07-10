import { blockName, HOTBAR_BLOCKS } from './BlockRegistry';
import { blockIconUrl } from './Textures';

const FPS_UPDATE_INTERVAL_MS = 500;

/** DOM overlay: crosshair, FPS, coordinates, hotbar and the pointer-lock screen. */
export class HUD {
  onOverlayClick: (() => void) | null = null;

  private fpsEl: HTMLElement;
  private coordsEl: HTMLElement;
  private blockEl: HTMLElement;
  private statusEl: HTMLElement;
  private overlayEl: HTMLElement;
  private hotbarSlots: HTMLElement[] = [];

  private frames = 0;
  /** Set on the first update() call — the HUD is built before the game loop starts. */
  private lastFpsUpdate: number | null = null;

  constructor(root: HTMLElement) {
    const hud = document.createElement('div');
    hud.className = 'hud';
    hud.innerHTML = `
      <div class="crosshair"></div>
      <div class="hud-info">
        <div data-id="fps">FPS: —</div>
        <div data-id="coords">X — Y — Z —</div>
        <div data-id="block">Block: —</div>
      </div>
      <div class="hotbar"></div>
      <div class="status" data-id="status"></div>
      <div class="overlay" data-id="overlay">
        <h1>WebVoxel 3D</h1>
        <p class="overlay-hint">Click to play</p>
        <ul class="overlay-controls">
          <li><b>W A S D</b> — move</li>
          <li><b>Space</b> — jump</li>
          <li><b>Mouse</b> — look around</li>
          <li><b>LMB</b> — break block</li>
          <li><b>RMB</b> — place block</li>
          <li><b>1–4</b> — select block</li>
          <li><b>Esc</b> — release mouse</li>
        </ul>
      </div>
    `;
    root.appendChild(hud);

    this.fpsEl = hud.querySelector('[data-id="fps"]')!;
    this.coordsEl = hud.querySelector('[data-id="coords"]')!;
    this.blockEl = hud.querySelector('[data-id="block"]')!;
    this.statusEl = hud.querySelector('[data-id="status"]')!;
    this.overlayEl = hud.querySelector('[data-id="overlay"]')!;
    this.overlayEl.addEventListener('click', () => this.onOverlayClick?.());

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

  setOverlayVisible(visible: boolean): void {
    this.overlayEl.style.display = visible ? 'flex' : 'none';
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
}

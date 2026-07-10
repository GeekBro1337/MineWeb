import * as THREE from 'three';
import { CHUNK_HEIGHT } from '../../../shared/constants';
import type { GameMode } from '../../../shared/protocol';
import {
  ITEMS,
  PLACEABLE_ITEMS,
  blockDrop,
  isPlaceable,
  type ItemId,
} from '../../../shared/items';
import { FurnaceScreen } from '../ui/FurnaceScreen';
import { InventoryScreen } from '../ui/InventoryScreen';
import { PauseOverlay } from '../ui/PauseOverlay';
import { BlockId, isSolid } from './BlockRegistry';
import { CameraController } from './CameraController';
import { Furnaces } from './Furnaces';
import { HUD, type HotbarSlotView } from './HUD';
import { Input } from './Input';
import { Inventory } from './Inventory';
import { Network } from './Network';
import { MAX_HEALTH, Player } from './Player';
import { raycastVoxels, type VoxelRayHit } from './Raycaster';
import { Renderer } from './Renderer';
import type { GameSettings, Settings } from './Settings';
import { Sky } from './Sky';
import { loadBlockMaterials } from './Textures';
import { WaterSim } from './WaterSim';
import { setWorldMode } from './WorldsApi';
import { World } from './World';

/** How far (in blocks) the player can break/place/interact. */
const REACH = 6;
/** Below this Y survival players take void damage. */
const VOID_DAMAGE_Y = -16;
/** Hard floor: below this, teleport back to spawn (both modes). */
const VOID_FLOOR_Y = -48;
const VOID_DPS = 8;

type OpenScreen = 'none' | 'inventory' | 'furnace';

export interface GameCallbacks {
  /** The player quit to the title screen (or the world became unavailable). */
  onQuit: () => void;
}

/** Wires all subsystems together and runs the main loop for one world session. */
export class Game {
  private renderer: Renderer;
  private hud: HUD;
  private input: Input;
  private network: Network;
  private world: World;
  private player: Player;
  private cameraController: CameraController;
  private sky: Sky;
  private pause: PauseOverlay;
  private waterSim: WaterSim;
  private inventory = new Inventory();
  private furnaces = new Furnaces();
  private invScreen: InventoryScreen;
  private furnaceScreen: FurnaceScreen;

  private mode: GameMode = 'survival';
  private openScreen: OpenScreen = 'none';
  private spawn = new THREE.Vector3(8.5, CHUNK_HEIGHT, 8.5);
  private selectedSlot = 0;
  private highlight: THREE.LineSegments;
  private lastClockText = '';
  private lastTime = performance.now();
  private rafId = 0;
  private disposed = false;

  private eyePos = new THREE.Vector3();
  private lookDir = new THREE.Vector3();

  constructor(
    container: HTMLElement,
    private worldId: string,
    private settings: Settings,
    private callbacks: GameCallbacks,
  ) {
    this.renderer = new Renderer(container, settings.get('fov'));
    this.hud = new HUD(document.body);
    this.network = new Network(worldId);
    this.world = new World(this.renderer.scene, this.network, settings.get('renderDistance'));
    this.waterSim = new WaterSim(this.world);
    this.sky = new Sky(this.renderer.scene, settings.get('dayLengthMinutes'));
    this.cameraController = new CameraController(this.renderer.camera, settings);
    this.player = new Player(this.spawn, this.world);

    this.input = new Input(this.renderer.canvas, {
      onBreakBlock: () => this.breakBlock(),
      onPlaceBlock: () => this.useOrPlace(),
      onSelectSlot: (slot) => this.selectSlot(slot),
      onToggleInventory: () => this.openInventory(),
      onToggleFly: () => this.player.toggleFly(),
    });
    // Releasing the pointer opens the pause menu — unless an inventory/furnace
    // screen is what freed the cursor.
    this.input.onPointerLockChange = (locked) => {
      if (locked) this.pause.hide();
      else if (this.openScreen === 'none') this.pause.show();
    };

    this.pause = new PauseOverlay(document.body, settings, {
      onResume: () => this.input.requestPointerLock(),
      onQuit: () => this.callbacks.onQuit(),
      onSettingChange: (key) => this.applySetting(key),
      onToggleMode: () => this.toggleMode(),
    });

    this.invScreen = new InventoryScreen(document.body, this.inventory);
    this.invScreen.onRequestClose = () => this.closeScreen();
    this.furnaceScreen = new FurnaceScreen(document.body, this.inventory);
    this.furnaceScreen.onRequestClose = () => this.closeScreen();

    this.highlight = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002)),
      new THREE.LineBasicMaterial({ color: 0x111111 }),
    );
    this.highlight.visible = false;
    this.renderer.scene.add(this.highlight);

    this.network.onBlockUpdate = (msg) => {
      this.world.applyRemoteBlockUpdate(msg.x, msg.y, msg.z, msg.id);
      this.waterSim.onBlockChanged(msg.x, msg.y, msg.z);
    };
    this.network.onServerError = (message) => {
      console.error('[game] server error:', message);
      this.callbacks.onQuit();
    };

    (window as unknown as { voxelSky?: Sky }).voxelSky = this.sky;
    (window as unknown as { voxelGame?: Game }).voxelGame = this;
  }

  async start(): Promise<void> {
    this.hud.setStatus('Загрузка текстур…');
    this.world.setMaterials(await loadBlockMaterials(this.renderer.webgl));
    if (this.disposed) return;

    this.hud.setStatus('Загрузка мира…');
    const meta = await this.network.fetchMeta();
    if (this.disposed) return;
    this.setMode(meta.mode);
    this.spawn.set(meta.spawn.x, meta.spawn.y, meta.spawn.z);
    await this.world.loadInitial(this.spawn.x, this.spawn.z);
    if (this.disposed) return;

    this.player.respawn(this.spawn);
    this.hud.setStatus(null);
    this.refreshHotbar();
    this.pause.show();

    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this.loop);
  }

  private setMode(mode: GameMode): void {
    this.mode = mode;
    this.player.setMode(mode);
    this.hud.setHealthVisible(mode === 'survival');
    this.pause.setMode(mode);
    this.refreshHotbar();
  }

  private toggleMode(): void {
    const next: GameMode = this.mode === 'creative' ? 'survival' : 'creative';
    if (next === 'survival') this.player.health = MAX_HEALTH;
    this.setMode(next);
    void setWorldMode(this.worldId, next).catch((err) => console.error('[game] set mode failed:', err));
  }

  private applySetting(key: keyof GameSettings): void {
    switch (key) {
      case 'fov': this.renderer.setFov(this.settings.get('fov')); break;
      case 'renderDistance': this.world.setRenderDistance(this.settings.get('renderDistance')); break;
      case 'dayLengthMinutes': this.sky.setDayLength(this.settings.get('dayLengthMinutes')); break;
      // 'sensitivity' is read live by the camera controller.
    }
  }

  private loop = (now: number): void => {
    if (this.disposed) return;
    const dt = (now - this.lastTime) / 1000;
    this.lastTime = now;

    const { dx, dy } = this.input.consumeMouseDelta();
    this.cameraController.applyMouseDelta(dx, dy);

    this.player.update(dt, {
      forward: this.input.forward,
      strafe: this.input.strafe,
      jump: this.input.jump,
      sneak: this.input.sneak,
      yaw: this.cameraController.yaw,
    });
    this.applyVoidAndDeath(Math.min(dt, 0.1));

    this.cameraController.syncToEye(this.player.getEyePosition(this.eyePos));
    this.world.update(this.player.position.x, this.player.position.z);
    this.waterSim.tick(Math.min(dt, 0.1));
    this.sky.update(dt, this.player.position);
    this.furnaces.tick(Math.min(dt, 0.1));
    if (this.openScreen === 'furnace') this.furnaceScreen.tick();
    this.updateHighlight();

    this.network.sendPlayerMove({
      x: this.player.position.x,
      y: this.player.position.y,
      z: this.player.position.z,
      yaw: this.cameraController.yaw,
      pitch: this.cameraController.pitch,
    });

    this.hud.update(this.player.position.x, this.player.position.y, this.player.position.z);
    if (this.mode === 'survival') this.hud.setHealth(this.player.health, MAX_HEALTH);
    this.refreshHotbar();

    const clock = this.sky.getClock();
    const clockText = `${clock.isDay ? '☀' : '☾'} ${String(clock.hours).padStart(2, '0')}:${String(clock.minutes).padStart(2, '0')}`;
    if (clockText !== this.lastClockText) {
      this.lastClockText = clockText;
      this.hud.setClock(clockText);
    }

    this.renderer.render();
    this.rafId = requestAnimationFrame(this.loop);
  };

  private applyVoidAndDeath(dt: number): void {
    const y = this.player.position.y;
    if (y < VOID_DAMAGE_Y && this.mode === 'survival') this.player.takeDamage(VOID_DPS * dt);
    if (y < VOID_FLOOR_Y) this.player.teleport(this.spawn);
    if (this.player.isDead) this.player.respawn(this.spawn);
  }

  // --- Hotbar --------------------------------------------------------------

  private hotbarView(): HotbarSlotView[] {
    const view: HotbarSlotView[] = [];
    for (let i = 0; i < 9; i++) {
      if (this.mode === 'creative') {
        view.push({ item: PLACEABLE_ITEMS[i] ?? null, count: null });
      } else {
        const s = this.inventory.slots[i];
        view.push({ item: s ? s.item : null, count: s ? s.count : null });
      }
    }
    return view;
  }

  private selectedItem(): ItemId | null {
    if (this.mode === 'creative') return PLACEABLE_ITEMS[this.selectedSlot] ?? null;
    return this.inventory.slots[this.selectedSlot]?.item ?? null;
  }

  private refreshHotbar(): void {
    this.hud.setHotbar(this.hotbarView(), this.selectedSlot);
  }

  private selectSlot(slot: number): void {
    if (slot < 0 || slot > 8) return;
    this.selectedSlot = slot;
    this.refreshHotbar();
  }

  // --- Screens -------------------------------------------------------------

  private openInventory(): void {
    if (this.openScreen !== 'none') return;
    this.openScreen = 'inventory';
    this.invScreen.show();
    document.exitPointerLock();
    // The game no longer wants the pointer locked — drop any pending re-lock retry.
    this.input.cancelPendingLock();
  }

  private openFurnace(x: number, y: number, z: number): void {
    if (this.openScreen !== 'none') return;
    this.openScreen = 'furnace';
    this.furnaceScreen.open(this.furnaces.get(x, y, z));
    document.exitPointerLock();
    this.input.cancelPendingLock();
  }

  private closeScreen(): void {
    // tryClose returns false if the inventory had no room for held/grid items —
    // keep the screen open in that case so nothing is destroyed.
    const closed =
      this.openScreen === 'inventory'
        ? this.invScreen.tryClose()
        : this.openScreen === 'furnace'
          ? this.furnaceScreen.tryClose()
          : true;
    if (!closed) return;
    this.openScreen = 'none';
    this.input.requestPointerLock();
  }

  // --- World interaction ---------------------------------------------------

  private raycast(): VoxelRayHit | null {
    this.renderer.camera.getWorldDirection(this.lookDir);
    return raycastVoxels(
      this.renderer.camera.position,
      this.lookDir,
      REACH,
      (x, y, z) => isSolid(this.world.getBlock(x, y, z)),
    );
  }

  private updateHighlight(): void {
    const hit = this.raycast();
    if (hit) {
      this.highlight.visible = true;
      this.highlight.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
    } else {
      this.highlight.visible = false;
    }
  }

  private breakBlock(): void {
    const hit = this.raycast();
    if (!hit) return;
    const id = this.world.getBlock(hit.x, hit.y, hit.z);
    if (id === BlockId.Air) return;
    // Survival: try to pocket the drop first; if the inventory is full, leave the
    // block in place rather than mining it into oblivion.
    if (this.mode === 'survival') {
      const drop = blockDrop(id);
      if (drop && this.inventory.add(drop, 1) > 0) return;
    }
    if (id === BlockId.Furnace) this.furnaces.remove(hit.x, hit.y, hit.z);
    this.world.setBlock(hit.x, hit.y, hit.z, BlockId.Air);
    this.waterSim.onBlockChanged(hit.x, hit.y, hit.z);
  }

  /** Right-click: interact with a furnace, otherwise place the selected block. */
  private useOrPlace(): void {
    const hit = this.raycast();
    if (!hit) return;
    const target = this.world.getBlock(hit.x, hit.y, hit.z);
    if (target === BlockId.Furnace && !this.input.sneak) {
      this.openFurnace(hit.x, hit.y, hit.z);
      return;
    }

    const item = this.selectedItem();
    if (!item || !isPlaceable(item)) return;
    const block = ITEMS[item].block!;
    const x = hit.x + hit.nx;
    const y = hit.y + hit.ny;
    const z = hit.z + hit.nz;
    if (y < 0 || y >= CHUNK_HEIGHT) return;
    if (this.world.getBlock(x, y, z) !== BlockId.Air) return;
    if (this.player.intersectsBlock(x, y, z)) return;

    this.world.setBlock(x, y, z, block);
    this.waterSim.onBlockChanged(x, y, z);
    if (this.mode === 'survival') this.inventory.consumeSlot(this.selectedSlot);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.rafId);

    this.input.dispose();
    this.network.dispose();
    this.world.dispose();
    this.sky.dispose();
    this.hud.dispose();
    this.pause.dispose();
    this.invScreen.dispose();
    this.furnaceScreen.dispose();

    this.renderer.scene.remove(this.highlight);
    this.highlight.geometry.dispose();
    (this.highlight.material as THREE.Material).dispose();
    this.renderer.dispose();

    const w = window as unknown as { voxelSky?: Sky; voxelGame?: Game };
    if (w.voxelSky === this.sky) delete w.voxelSky;
    if (w.voxelGame === this) delete w.voxelGame;
  }
}

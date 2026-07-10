import * as THREE from 'three';
import { CHUNK_HEIGHT } from '../../../shared/constants';
import { PauseOverlay } from '../ui/PauseOverlay';
import { BlockId, HOTBAR_BLOCKS, isSolid } from './BlockRegistry';
import { CameraController } from './CameraController';
import { HUD } from './HUD';
import { Input } from './Input';
import { Network } from './Network';
import { Player } from './Player';
import { raycastVoxels, type VoxelRayHit } from './Raycaster';
import { Renderer } from './Renderer';
import type { GameSettings, Settings } from './Settings';
import { Sky } from './Sky';
import { loadBlockMaterials } from './Textures';
import { World } from './World';

/** How far (in blocks) the player can break/place. */
const REACH = 6;
/** Falling below this Y teleports the player back to spawn. */
const VOID_RESPAWN_Y = -10;

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
    private container: HTMLElement,
    worldId: string,
    private settings: Settings,
    private callbacks: GameCallbacks,
  ) {
    this.renderer = new Renderer(container, settings.get('fov'));
    this.hud = new HUD(document.body);
    this.network = new Network(worldId);
    this.world = new World(this.renderer.scene, this.network, settings.get('renderDistance'));
    this.sky = new Sky(this.renderer.scene, settings.get('dayLengthMinutes'));
    this.cameraController = new CameraController(this.renderer.camera, settings);
    this.player = new Player(this.spawn, this.world);

    this.input = new Input(this.renderer.canvas, {
      onBreakBlock: () => this.breakBlock(),
      onPlaceBlock: () => this.placeBlock(),
      onSelectSlot: (slot) => this.selectSlot(slot),
    });
    // Releasing the pointer (Esc) opens the pause menu; locking it resumes play.
    this.input.onPointerLockChange = (locked) => {
      if (locked) this.pause.hide();
      else this.pause.show();
    };

    this.pause = new PauseOverlay(document.body, settings, {
      onResume: () => this.input.requestPointerLock(),
      onQuit: () => this.callbacks.onQuit(),
      onSettingChange: (key) => this.applySetting(key),
    });

    this.highlight = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002)),
      new THREE.LineBasicMaterial({ color: 0x111111 }),
    );
    this.highlight.visible = false;
    this.renderer.scene.add(this.highlight);

    // Server echo of our own edits is an idempotent no-op; edits from other
    // players (future multiplayer) apply the same way.
    this.network.onBlockUpdate = (msg) => {
      this.world.applyRemoteBlockUpdate(msg.x, msg.y, msg.z, msg.id);
    };
    this.network.onServerError = (message) => {
      console.error('[game] server error:', message);
      this.callbacks.onQuit();
    };

    // Debug handle for driving the day/night cycle from the console, e.g.
    //   voxelSky.setPhase(0.5)  // 0 sunrise · 0.25 noon · 0.5 sunset · 0.75 midnight
    (window as unknown as { voxelSky?: Sky }).voxelSky = this.sky;
  }

  async start(): Promise<void> {
    this.hud.setStatus('Загрузка текстур…');
    this.world.setMaterials(await loadBlockMaterials(this.renderer.webgl));
    if (this.disposed) return;

    this.hud.setStatus('Загрузка мира…');
    const meta = await this.network.fetchMeta();
    if (this.disposed) return;
    this.spawn.set(meta.spawn.x, meta.spawn.y, meta.spawn.z);
    await this.world.loadInitial(this.spawn.x, this.spawn.z);
    if (this.disposed) return;

    this.player.teleport(this.spawn);
    this.hud.setStatus(null);
    this.hud.setSelectedSlot(this.selectedSlot);
    this.pause.show();

    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this.loop);
  }

  private applySetting(key: keyof GameSettings): void {
    switch (key) {
      case 'fov':
        this.renderer.setFov(this.settings.get('fov'));
        break;
      case 'renderDistance':
        this.world.setRenderDistance(this.settings.get('renderDistance'));
        break;
      case 'dayLengthMinutes':
        this.sky.setDayLength(this.settings.get('dayLengthMinutes'));
        break;
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
      yaw: this.cameraController.yaw,
    });
    if (this.player.position.y < VOID_RESPAWN_Y) this.player.teleport(this.spawn);

    this.cameraController.syncToEye(this.player.getEyePosition(this.eyePos));
    this.world.update(this.player.position.x, this.player.position.z);
    this.sky.update(dt, this.player.position);
    this.updateHighlight();

    this.network.sendPlayerMove({
      x: this.player.position.x,
      y: this.player.position.y,
      z: this.player.position.z,
      yaw: this.cameraController.yaw,
      pitch: this.cameraController.pitch,
    });

    this.hud.update(this.player.position.x, this.player.position.y, this.player.position.z);

    const clock = this.sky.getClock();
    const clockText = `${clock.isDay ? '☀' : '☾'} ${String(clock.hours).padStart(2, '0')}:${String(clock.minutes).padStart(2, '0')}`;
    if (clockText !== this.lastClockText) {
      this.lastClockText = clockText;
      this.hud.setClock(clockText);
    }

    this.renderer.render();
    this.rafId = requestAnimationFrame(this.loop);
  };

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
    this.world.setBlock(hit.x, hit.y, hit.z, BlockId.Air);
  }

  private placeBlock(): void {
    const hit = this.raycast();
    if (!hit) return;
    const x = hit.x + hit.nx;
    const y = hit.y + hit.ny;
    const z = hit.z + hit.nz;
    if (y < 0 || y >= CHUNK_HEIGHT) return;
    if (this.world.getBlock(x, y, z) !== BlockId.Air) return;
    if (this.player.intersectsBlock(x, y, z)) return;
    this.world.setBlock(x, y, z, HOTBAR_BLOCKS[this.selectedSlot]);
  }

  private selectSlot(slot: number): void {
    if (slot < 0 || slot >= HOTBAR_BLOCKS.length) return;
    this.selectedSlot = slot;
    this.hud.setSelectedSlot(slot);
  }

  /** Tears down the whole session and frees all resources (on quit to menu). */
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

    this.renderer.scene.remove(this.highlight);
    this.highlight.geometry.dispose();
    (this.highlight.material as THREE.Material).dispose();
    this.renderer.dispose();

    const w = window as unknown as { voxelSky?: Sky };
    if (w.voxelSky === this.sky) delete w.voxelSky;
  }
}

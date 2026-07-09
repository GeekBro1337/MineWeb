import * as THREE from 'three';
import { CHUNK_HEIGHT } from '../../../shared/constants';
import { BlockId, HOTBAR_BLOCKS, isSolid } from './BlockRegistry';
import { CameraController } from './CameraController';
import { HUD } from './HUD';
import { Input } from './Input';
import { Network } from './Network';
import { Player } from './Player';
import { raycastVoxels, type VoxelRayHit } from './Raycaster';
import { Renderer } from './Renderer';
import { World } from './World';

/** How far (in blocks) the player can break/place. */
const REACH = 6;
/** Falling below this Y teleports the player back to spawn. */
const VOID_RESPAWN_Y = -10;

/** Wires all subsystems together and runs the main loop. */
export class Game {
  private renderer: Renderer;
  private hud: HUD;
  private input: Input;
  private network: Network;
  private world: World;
  private player: Player;
  private cameraController: CameraController;

  private spawn = new THREE.Vector3(8.5, CHUNK_HEIGHT, 8.5);
  private selectedSlot = 0;
  private highlight: THREE.LineSegments;
  private hit: VoxelRayHit | null = null;
  private lastTime = performance.now();

  private eyePos = new THREE.Vector3();
  private lookDir = new THREE.Vector3();

  constructor(container: HTMLElement) {
    this.renderer = new Renderer(container);
    this.hud = new HUD(document.body);
    this.network = new Network();
    this.world = new World(this.renderer.scene, this.network);
    this.cameraController = new CameraController(this.renderer.camera);
    this.player = new Player(this.spawn, this.world);

    this.input = new Input(this.renderer.canvas, {
      onBreakBlock: () => this.breakBlock(),
      onPlaceBlock: () => this.placeBlock(),
      onSelectSlot: (slot) => this.selectSlot(slot),
    });
    this.input.onPointerLockChange = (locked) => this.hud.setOverlayVisible(!locked);
    this.hud.onOverlayClick = () => this.input.requestPointerLock();

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
  }

  async start(): Promise<void> {
    this.hud.setStatus('Loading world…');
    const meta = await this.network.fetchMeta();
    this.spawn.set(meta.spawn.x, meta.spawn.y, meta.spawn.z);
    await this.world.loadInitial(this.spawn.x, this.spawn.z);
    this.player.teleport(this.spawn);
    this.hud.setStatus(null);
    this.hud.setSelectedSlot(this.selectedSlot);
    this.hud.setOverlayVisible(true);

    this.lastTime = performance.now();
    requestAnimationFrame(this.loop);
  }

  private loop = (now: number): void => {
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
    this.updateHighlight();

    this.network.sendPlayerMove({
      x: this.player.position.x,
      y: this.player.position.y,
      z: this.player.position.z,
      yaw: this.cameraController.yaw,
      pitch: this.cameraController.pitch,
    });

    this.hud.update(this.player.position.x, this.player.position.y, this.player.position.z);
    this.renderer.render();
    requestAnimationFrame(this.loop);
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
    this.hit = this.raycast();
    if (this.hit) {
      this.highlight.visible = true;
      this.highlight.position.set(this.hit.x + 0.5, this.hit.y + 0.5, this.hit.z + 0.5);
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
}

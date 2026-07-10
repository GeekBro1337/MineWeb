import * as THREE from 'three';
import { BlockId } from './BlockRegistry';
import type { World } from './World';

const WIDTH = 0.6;
const HEIGHT = 1.8;
const EYE_HEIGHT = 1.62;
const HALF_W = WIDTH / 2;

const WALK_SPEED = 5.5;
const FLY_SPEED = 9;
const FLY_VERTICAL_SPEED = 8;
const SWIM_SPEED = 4;
const GRAVITY = 26;
const JUMP_SPEED = 8.5;
const MAX_FALL_SPEED = 50;
// In water: buoyant (slow sink), Space swims up. No fall damage while submerged.
const WATER_GRAVITY = 7;
const WATER_SINK_MAX = 3;
const SWIM_UP_SPEED = 4.5;
/** Max movement per physics substep (blocks) — keeps fast falls from tunneling. */
const MAX_STEP = 0.4;
/** Skin gap left between the player and a block face after a collision. */
const EPS = 1e-3;
/** Shrinks AABB->block overlap tests to ignore exact face contact. */
const CONTACT_EPS = 1e-8;

export const MAX_HEALTH = 20;
/** Fall damage kicks in past this many blocks; 1 HP per block beyond. */
const SAFE_FALL = 3;
/** Passive health regen per second (survival). */
const REGEN_PER_SEC = 0.5;

export interface MoveIntent {
  /** -1..1, +1 = forward */
  forward: number;
  /** -1..1, +1 = right */
  strafe: number;
  /** Space held — jump, or ascend while flying. */
  jump: boolean;
  /** Shift held — descend while flying. */
  sneak: boolean;
  /** Camera yaw in radians — horizontal movement is camera-relative. */
  yaw: number;
}

/**
 * First-person character with simple AABB voxel physics: gravity, jumping and
 * per-axis collision resolution against the block grid. `position` is the
 * center of the feet.
 */
export class Player {
  readonly position: THREE.Vector3;
  readonly velocity = new THREE.Vector3();
  onGround = false;

  health = MAX_HEALTH;
  /** Creative players fly; survival players take fall/void damage. */
  canFly = false;
  flying = false;
  private damageEnabled = false;
  /** Whether the player's chest is submerged (buoyancy, no fall damage). */
  private inWater = false;
  /** Highest Y reached since last touching ground, for fall-damage. */
  private airPeakY = 0;
  private wasOnGround = true;

  constructor(spawn: THREE.Vector3, private world: World) {
    this.position = spawn.clone();
    this.airPeakY = spawn.y;
  }

  /** Applies the world's game mode to physics (fly / fall damage). */
  setMode(mode: 'survival' | 'creative'): void {
    this.canFly = mode === 'creative';
    this.damageEnabled = mode === 'survival';
    if (!this.canFly) this.flying = false;
  }

  toggleFly(): void {
    if (!this.canFly) return;
    this.flying = !this.flying;
    this.velocity.y = 0;
  }

  takeDamage(amount: number): void {
    if (!this.damageEnabled || this.flying) return;
    this.health = Math.max(0, this.health - amount);
  }

  get isDead(): boolean {
    return this.damageEnabled && this.health <= 0;
  }

  getEyePosition(target: THREE.Vector3): THREE.Vector3 {
    return target.set(this.position.x, this.position.y + EYE_HEIGHT, this.position.z);
  }

  /** True if the given block cell overlaps the player's AABB (blocks placement inside the player). */
  intersectsBlock(bx: number, by: number, bz: number): boolean {
    return (
      bx + 1 > this.position.x - HALF_W && bx < this.position.x + HALF_W &&
      by + 1 > this.position.y && by < this.position.y + HEIGHT &&
      bz + 1 > this.position.z - HALF_W && bz < this.position.z + HALF_W
    );
  }

  teleport(pos: THREE.Vector3): void {
    this.position.copy(pos);
    this.velocity.set(0, 0, 0);
    this.airPeakY = pos.y;
    this.wasOnGround = true;
  }

  /** Respawn after death: back to spawn with full health. */
  respawn(spawn: THREE.Vector3): void {
    this.teleport(spawn);
    this.health = MAX_HEALTH;
    this.flying = false;
  }

  update(dt: number, intent: MoveIntent): void {
    dt = Math.min(dt, 0.1);

    this.inWater = !this.flying && this.isInWater();
    const speed = this.flying ? FLY_SPEED : this.inWater ? SWIM_SPEED : WALK_SPEED;
    const sin = Math.sin(intent.yaw);
    const cos = Math.cos(intent.yaw);
    let f = intent.forward;
    let s = intent.strafe;
    if (f !== 0 && s !== 0) {
      f *= Math.SQRT1_2;
      s *= Math.SQRT1_2;
    }
    // Camera looks along -Z at yaw=0: forward = (-sin, -cos), right = (cos, -sin).
    this.velocity.x = (-sin * f + cos * s) * speed;
    this.velocity.z = (-cos * f - sin * s) * speed;

    if (this.flying) {
      // Free vertical control, no gravity.
      this.velocity.y = (intent.jump ? 1 : 0) * FLY_VERTICAL_SPEED - (intent.sneak ? 1 : 0) * FLY_VERTICAL_SPEED;
    } else if (this.inWater) {
      // Buoyant: Space swims up, otherwise sink slowly.
      if (intent.jump) this.velocity.y = SWIM_UP_SPEED;
      else this.velocity.y = Math.max(this.velocity.y - WATER_GRAVITY * dt, -WATER_SINK_MAX);
    } else {
      if (intent.jump && this.onGround) this.velocity.y = JUMP_SPEED;
      this.velocity.y = Math.max(this.velocity.y - GRAVITY * dt, -MAX_FALL_SPEED);
    }

    this.onGround = false;
    const maxSpeed = Math.max(
      Math.abs(this.velocity.x),
      Math.abs(this.velocity.y),
      Math.abs(this.velocity.z),
    );
    const steps = Math.max(1, Math.ceil((maxSpeed * dt) / MAX_STEP));
    const stepDt = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.moveAxis(this.velocity.x * stepDt, 'x');
      this.moveAxis(this.velocity.z * stepDt, 'z');
      this.moveAxis(this.velocity.y * stepDt, 'y');
    }

    this.updateVitals(dt);
  }

  private isInWater(): boolean {
    return (
      this.world.getBlock(
        Math.floor(this.position.x),
        Math.floor(this.position.y + 0.9),
        Math.floor(this.position.z),
      ) === BlockId.Water
    );
  }

  /** Fall damage on landing + passive regen (survival only). */
  private updateVitals(dt: number): void {
    // Flying or swimming: no fall damage, keep the fall reference at the feet.
    if (this.flying || this.inWater) {
      this.airPeakY = this.position.y;
      this.wasOnGround = this.onGround;
      return;
    }
    if (this.onGround) {
      if (!this.wasOnGround) {
        const fell = this.airPeakY - this.position.y;
        if (fell > SAFE_FALL) this.takeDamage(Math.floor(fell - SAFE_FALL));
      }
      this.airPeakY = this.position.y;
    } else {
      this.airPeakY = Math.max(this.airPeakY, this.position.y);
    }
    this.wasOnGround = this.onGround;

    if (this.damageEnabled && this.health < MAX_HEALTH) {
      this.health = Math.min(MAX_HEALTH, this.health + REGEN_PER_SEC * dt);
    }
  }

  /** Move along one axis, then push back out of any solid block we entered. */
  private moveAxis(delta: number, axis: 'x' | 'y' | 'z'): void {
    if (delta === 0) return;
    this.position[axis] += delta;

    const minX = this.position.x - HALF_W;
    const maxX = this.position.x + HALF_W;
    const minY = this.position.y;
    const maxY = this.position.y + HEIGHT;
    const minZ = this.position.z - HALF_W;
    const maxZ = this.position.z + HALF_W;

    const x0 = Math.floor(minX + CONTACT_EPS);
    const x1 = Math.floor(maxX - CONTACT_EPS);
    const y0 = Math.floor(minY + CONTACT_EPS);
    const y1 = Math.floor(maxY - CONTACT_EPS);
    const z0 = Math.floor(minZ + CONTACT_EPS);
    const z1 = Math.floor(maxZ - CONTACT_EPS);

    for (let by = y0; by <= y1; by++) {
      for (let bz = z0; bz <= z1; bz++) {
        for (let bx = x0; bx <= x1; bx++) {
          if (!this.world.isSolidAt(bx, by, bz)) continue;
          // Push back to the block face opposite to the movement direction.
          // One clamp resolves the whole plane of blocks we ran into.
          if (axis === 'y') {
            if (delta < 0) {
              this.position.y = by + 1;
              this.onGround = true;
            } else {
              this.position.y = by - HEIGHT - EPS;
            }
            this.velocity.y = 0;
          } else if (axis === 'x') {
            this.position.x = delta > 0 ? bx - HALF_W - EPS : bx + 1 + HALF_W + EPS;
            this.velocity.x = 0;
          } else {
            this.position.z = delta > 0 ? bz - HALF_W - EPS : bz + 1 + HALF_W + EPS;
            this.velocity.z = 0;
          }
          return;
        }
      }
    }
  }
}

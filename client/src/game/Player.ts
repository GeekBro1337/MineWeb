import * as THREE from 'three';
import type { World } from './World';

const WIDTH = 0.6;
const HEIGHT = 1.8;
const EYE_HEIGHT = 1.62;
const HALF_W = WIDTH / 2;

const WALK_SPEED = 5.5;
const GRAVITY = 26;
const JUMP_SPEED = 8.5;
const MAX_FALL_SPEED = 50;
/** Max movement per physics substep (blocks) — keeps fast falls from tunneling. */
const MAX_STEP = 0.4;
/** Skin gap left between the player and a block face after a collision. */
const EPS = 1e-3;
/** Shrinks AABB->block overlap tests to ignore exact face contact. */
const CONTACT_EPS = 1e-8;

export interface MoveIntent {
  /** -1..1, +1 = forward */
  forward: number;
  /** -1..1, +1 = right */
  strafe: number;
  jump: boolean;
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

  constructor(spawn: THREE.Vector3, private world: World) {
    this.position = spawn.clone();
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
  }

  update(dt: number, intent: MoveIntent): void {
    dt = Math.min(dt, 0.1);

    // Horizontal velocity straight from input — responsive, no inertia (fine for MVP).
    const sin = Math.sin(intent.yaw);
    const cos = Math.cos(intent.yaw);
    let f = intent.forward;
    let s = intent.strafe;
    if (f !== 0 && s !== 0) {
      f *= Math.SQRT1_2;
      s *= Math.SQRT1_2;
    }
    // Camera looks along -Z at yaw=0: forward = (-sin, -cos), right = (cos, -sin).
    this.velocity.x = (-sin * f + cos * s) * WALK_SPEED;
    this.velocity.z = (-cos * f - sin * s) * WALK_SPEED;

    if (intent.jump && this.onGround) {
      this.velocity.y = JUMP_SPEED;
    }
    this.velocity.y = Math.max(this.velocity.y - GRAVITY * dt, -MAX_FALL_SPEED);

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

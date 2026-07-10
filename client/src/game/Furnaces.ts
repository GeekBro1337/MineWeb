import {
  MAX_STACK,
  SMELT_TIME_SEC,
  fuelBurnSeconds,
  smeltResult,
  type ItemStack,
} from '../../../shared/items';

export interface FurnaceState {
  input: ItemStack | null;
  fuel: ItemStack | null;
  output: ItemStack | null;
  /** Seconds smelted on the current input item (0..SMELT_TIME_SEC). */
  progress: number;
  /** Seconds of burn left from the currently-lit fuel unit. */
  burnLeft: number;
  /** Burn seconds the current fuel unit started with (for the flame gauge). */
  burnMax: number;
}

function newFurnace(): FurnaceState {
  return { input: null, fuel: null, output: null, progress: 0, burnLeft: 0, burnMax: 0 };
}

/**
 * Smelting state for placed furnaces, keyed by block position. State lives for
 * the session only (the furnace block itself persists, its contents reset on
 * reload) — a deliberate MVP simplification.
 */
export class Furnaces {
  private map = new Map<string, FurnaceState>();

  private key(x: number, y: number, z: number): string {
    return `${x},${y},${z}`;
  }

  /** Furnace state at a position, created empty on first access. */
  get(x: number, y: number, z: number): FurnaceState {
    const k = this.key(x, y, z);
    let f = this.map.get(k);
    if (!f) {
      f = newFurnace();
      this.map.set(k, f);
    }
    return f;
  }

  remove(x: number, y: number, z: number): void {
    this.map.delete(this.key(x, y, z));
  }

  /** Advances every furnace's smelting by dt seconds. */
  tick(dt: number): void {
    for (const f of this.map.values()) this.tickOne(f, dt);
  }

  private tickOne(f: FurnaceState, dt: number): void {
    const result = f.input ? smeltResult(f.input.item) : null;
    const outputHasRoom =
      result !== null &&
      (f.output === null || (f.output.item === result && f.output.count < MAX_STACK));
    const wantsSmelt = result !== null && outputHasRoom;

    // Light a fresh fuel unit only when there's something to smelt.
    if (f.burnLeft <= 0 && wantsSmelt && f.fuel && fuelBurnSeconds(f.fuel.item) > 0) {
      const burn = fuelBurnSeconds(f.fuel.item);
      f.burnLeft = burn;
      f.burnMax = burn;
      f.fuel.count -= 1;
      if (f.fuel.count <= 0) f.fuel = null;
    }

    if (f.burnLeft > 0) {
      f.burnLeft -= dt;
      if (wantsSmelt) {
        f.progress += dt;
        if (f.progress >= SMELT_TIME_SEC) {
          f.progress -= SMELT_TIME_SEC;
          f.input!.count -= 1;
          if (f.input!.count <= 0) f.input = null;
          if (f.output) f.output.count += 1;
          else f.output = { item: result!, count: 1 };
        }
      } else {
        f.progress = Math.max(0, f.progress - dt);
      }
    } else {
      f.progress = Math.max(0, f.progress - dt);
    }
  }
}

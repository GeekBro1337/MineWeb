import { BlockId, isSolid } from './BlockRegistry';
import type { World } from './World';

const FLOW_INTERVAL = 0.18;
const MAX_UPDATES_PER_TICK = 500;
/** Flowing water thins one level per horizontal step; at MAX_LEVEL it can't spread further. */
const MAX_LEVEL = 4;

const HORIZONTAL: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * Minecraft-style flowing water as a bounded cellular automaton.
 *
 * Generated/placed water blocks are permanent **sources** (level 0). Flowing
 * water is tracked in `levels` (1..7, or 0 when fed from directly above) and is
 * client-side only — it is derived from the sources, never sent to the server,
 * and re-simulated after a reload. Water flows down freely and spreads sideways
 * with a per-step decay; when a source is removed its dependent flow recedes.
 *
 * Only cells scheduled by a nearby block change are processed, so idle lakes
 * cost nothing.
 */
export class WaterSim {
  private levels = new Map<string, number>();
  private active = new Set<string>();
  private accum = 0;

  constructor(private world: World) {}

  private static key(x: number, y: number, z: number): string {
    return `${x},${y},${z}`;
  }

  /** Schedule a cell and its 6 neighbors after a block change (dig/place/flow). */
  onBlockChanged(x: number, y: number, z: number): void {
    this.active.add(WaterSim.key(x, y, z));
    this.scheduleNeighbors(x, y, z);
  }

  private scheduleNeighbors(x: number, y: number, z: number): void {
    this.active.add(WaterSim.key(x, y + 1, z));
    this.active.add(WaterSim.key(x, y - 1, z));
    for (const [dx, dz] of HORIZONTAL) this.active.add(WaterSim.key(x + dx, y, z + dz));
  }

  private levelAt(x: number, y: number, z: number): number {
    if (this.world.getBlock(x, y, z) !== BlockId.Water) return 8; // no water
    const lvl = this.levels.get(WaterSim.key(x, y, z));
    return lvl === undefined ? 0 : lvl; // absent = generated/placed source
  }

  /**
   * Level this air/flow cell would receive from its feeders (8 = none). Water
   * directly above carries its level straight down WITHOUT resetting to a full
   * source — that decay is what stops cascades from flooding a whole slope.
   * Horizontal flow thins by one level per step.
   */
  private incomingLevel(x: number, y: number, z: number): number {
    let best = 8;
    if (this.world.getBlock(x, y + 1, z) === BlockId.Water) {
      best = this.levelAt(x, y + 1, z); // fall carries the level down, no boost
    }
    for (const [dx, dz] of HORIZONTAL) {
      if (this.world.getBlock(x + dx, y, z + dz) === BlockId.Water) {
        best = Math.min(best, this.levelAt(x + dx, y, z + dz) + 1);
      }
    }
    return best;
  }

  tick(dt: number): void {
    this.accum += dt;
    if (this.accum < FLOW_INTERVAL) return;
    this.accum = 0;
    if (this.active.size === 0) return;

    const batch = [...this.active];
    this.active.clear();
    let budget = MAX_UPDATES_PER_TICK;
    for (const k of batch) {
      if (budget-- <= 0) {
        this.active.add(k); // process the rest next tick
        continue;
      }
      const [x, y, z] = k.split(',').map(Number);
      this.processCell(x, y, z);
    }
  }

  private processCell(x: number, y: number, z: number): void {
    const block = this.world.getBlock(x, y, z);

    if (block === BlockId.Water) {
      const isSource = !this.levels.has(WaterSim.key(x, y, z));
      let level = 0;
      if (!isSource) {
        const incoming = this.incomingLevel(x, y, z);
        if (incoming > MAX_LEVEL) {
          // Lost its feeder — recede.
          if (this.world.setBlockLocal(x, y, z, BlockId.Air)) {
            this.levels.delete(WaterSim.key(x, y, z));
            this.scheduleNeighbors(x, y, z);
          }
          return;
        }
        if (this.levels.get(WaterSim.key(x, y, z)) !== incoming) {
          this.levels.set(WaterSim.key(x, y, z), incoming);
          this.scheduleNeighbors(x, y, z);
        }
        level = incoming;
      }
      this.propagate(x, y, z, level);
    } else if (block === BlockId.Air) {
      const incoming = this.incomingLevel(x, y, z);
      if (incoming <= MAX_LEVEL && this.world.setBlockLocal(x, y, z, BlockId.Water)) {
        this.levels.set(WaterSim.key(x, y, z), incoming);
        this.scheduleNeighbors(x, y, z);
      }
    }
    // Solid cells: nothing to do.
  }

  /** Schedule where this water cell can flow: straight down, else sideways. */
  private propagate(x: number, y: number, z: number, level: number): void {
    const below = this.world.getBlock(x, y - 1, z);
    if (below === BlockId.Air) {
      this.active.add(WaterSim.key(x, y - 1, z));
      return;
    }
    if ((isSolid(below) || below === BlockId.Water) && level < MAX_LEVEL) {
      for (const [dx, dz] of HORIZONTAL) {
        if (this.world.getBlock(x + dx, y, z + dz) === BlockId.Air) {
          this.active.add(WaterSim.key(x + dx, y, z + dz));
        }
      }
    }
  }
}

export interface InputActions {
  onBreakBlock: () => void;
  onPlaceBlock: () => void;
  onSelectSlot: (slot: number) => void;
}

/**
 * Keyboard + mouse state. Movement keys and mouse look are only active while
 * pointer lock is engaged, so typing in devtools doesn't move the player.
 */
export class Input {
  pointerLocked = false;
  onPointerLockChange: ((locked: boolean) => void) | null = null;

  private keys = new Set<string>();
  private mouseDeltaX = 0;
  private mouseDeltaY = 0;
  private lockRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(
    private element: HTMLElement,
    private actions: InputActions,
  ) {
    document.addEventListener('pointerlockchange', this.handleLockChange);
    document.addEventListener('mousemove', this.handleMouseMove);
    document.addEventListener('mousedown', this.handleMouseDown);
    document.addEventListener('contextmenu', this.handleContextMenu);
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleBlur);
  }

  /** Removes all listeners and releases pointer lock (on leaving the world). */
  dispose(): void {
    this.disposed = true;
    if (this.lockRetryTimer !== null) {
      clearTimeout(this.lockRetryTimer);
      this.lockRetryTimer = null;
    }
    document.removeEventListener('pointerlockchange', this.handleLockChange);
    document.removeEventListener('mousemove', this.handleMouseMove);
    document.removeEventListener('mousedown', this.handleMouseDown);
    document.removeEventListener('contextmenu', this.handleContextMenu);
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleBlur);
    if (this.pointerLocked) document.exitPointerLock();
    this.onPointerLockChange = null;
  }

  requestPointerLock(): void {
    // Browsers reject the request for ~1.25s after the user exits with Esc.
    // Swallow the rejection and retry once after the cooldown, so clicking
    // "Click to play" right after Esc still ends up locking.
    const result = this.element.requestPointerLock() as unknown;
    if (result instanceof Promise) {
      result.catch(() => {
        this.lockRetryTimer = setTimeout(() => {
          this.lockRetryTimer = null;
          if (this.disposed || this.pointerLocked) return;
          const retry = this.element.requestPointerLock() as unknown;
          if (retry instanceof Promise) retry.catch(() => {});
        }, 1300);
      });
    }
  }

  /** -1..1: W forward, S back. */
  get forward(): number {
    return (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
  }

  /** -1..1: D right, A left. */
  get strafe(): number {
    return (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
  }

  get jump(): boolean {
    return this.keys.has('Space');
  }

  /** Returns the accumulated mouse movement since the last call and resets it. */
  consumeMouseDelta(): { dx: number; dy: number } {
    const delta = { dx: this.mouseDeltaX, dy: this.mouseDeltaY };
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
    return delta;
  }

  private handleLockChange = (): void => {
    this.pointerLocked = document.pointerLockElement === this.element;
    if (!this.pointerLocked) this.keys.clear();
    this.onPointerLockChange?.(this.pointerLocked);
  };

  private handleMouseMove = (e: MouseEvent): void => {
    if (!this.pointerLocked) return;
    this.mouseDeltaX += e.movementX;
    this.mouseDeltaY += e.movementY;
  };

  private handleMouseDown = (e: MouseEvent): void => {
    if (!this.pointerLocked) return;
    if (e.button === 0) this.actions.onBreakBlock();
    else if (e.button === 2) this.actions.onPlaceBlock();
  };

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (!this.pointerLocked) return;
    if (e.code === 'Space') e.preventDefault();
    this.keys.add(e.code);

    const digit = e.code.match(/^Digit([1-9])$/);
    if (digit) this.actions.onSelectSlot(Number(digit[1]) - 1);
  };

  private handleKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private handleContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
  };

  private handleBlur = (): void => {
    this.keys.clear();
  };
}

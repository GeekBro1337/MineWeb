import type * as THREE from 'three';
import type { Settings } from './Settings';

/** Radians of look rotation per pixel of mouse movement at sensitivity 1.0. */
const BASE_SENSITIVITY = 0.0022;
const MAX_PITCH = Math.PI / 2 - 0.01;

/** First-person look: yaw around Y, pitch clamped just short of vertical, no roll. */
export class CameraController {
  yaw = 0;
  pitch = 0;

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    private settings: Settings,
  ) {
    // YXZ applies yaw before pitch — the standard FPS rotation order.
    camera.rotation.order = 'YXZ';
  }

  applyMouseDelta(dx: number, dy: number): void {
    const s = BASE_SENSITIVITY * this.settings.get('sensitivity');
    this.yaw -= dx * s;
    this.pitch -= dy * s;
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch));
  }

  /** Put the camera at the player's eye point with the current look angles. */
  syncToEye(eyePosition: THREE.Vector3): void {
    this.camera.position.copy(eyePosition);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }
}

import * as THREE from 'three';

/** Start a little after sunrise so the world opens in daylight. */
const START_PHASE = 0.08;

/** Orbital-plane tilt so the sun is never exactly overhead — gives angled shadows. */
const ORBIT_TILT = 0.32;
/** Distance of the shadow-casting light from the player (must be < shadow.camera.far). */
const LIGHT_DISTANCE = 110;
/** Distance of the sun/moon sprites (must be < camera.far, but they ignore fog). */
const SKY_DISTANCE = 240;

const DAY_SKY = new THREE.Color(0x87ceeb);
const TWILIGHT_SKY = new THREE.Color(0xf1884c);
const NIGHT_SKY = new THREE.Color(0x070b1a);

const SUN_HIGH = new THREE.Color(0xfff4d6);
const SUN_HORIZON = new THREE.Color(0xff7a2f);
const MOON_LIGHT = new THREE.Color(0x8fa6cc);

const AMBIENT_DAY = new THREE.Color(0xffffff);
const AMBIENT_NIGHT = new THREE.Color(0x33405e);

const SUN_TINT_HIGH = new THREE.Color(0xfff6d0);
const SUN_TINT_HORIZON = new THREE.Color(0xff7326);
const MOON_TINT = new THREE.Color(0xdfe6f4);

export interface Clock {
  hours: number;
  minutes: number;
  isDay: boolean;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function makeGlowTexture(coreRgba: string, edgeRgba: string): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0.0, coreRgba);
  g.addColorStop(0.45, edgeRgba);
  g.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Owns everything that changes with the time of day: the sun/moon sprites,
 * the single shadow-casting directional light (sun by day, moon by night),
 * ambient fill, and the sky/fog colors. The directional light's shadow camera
 * follows the player so shadows stay sharp within the render distance.
 */
export class Sky {
  /** 0..1 through the full cycle; 0 = sunrise, 0.25 = noon, 0.5 = sunset, 0.75 = midnight. */
  phase = START_PHASE;

  private readonly light: THREE.DirectionalLight;
  private readonly target: THREE.Object3D;
  private readonly ambient: THREE.AmbientLight;
  private readonly sun: THREE.Sprite;
  private readonly moon: THREE.Sprite;

  private readonly sunDir = new THREE.Vector3();
  private readonly moonDir = new THREE.Vector3();
  private readonly skyColor = new THREE.Color();

  /** Seconds for one full day+night cycle; day and night each take half. */
  private cycleSeconds: number;

  constructor(private readonly scene: THREE.Scene, dayLengthMinutes: number) {
    this.cycleSeconds = dayLengthMinutes * 2 * 60;
    this.light = new THREE.DirectionalLight(0xffffff, 1.4);
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(2048, 2048);
    const cam = this.light.shadow.camera as THREE.OrthographicCamera;
    cam.left = -72;
    cam.right = 72;
    cam.top = 72;
    cam.bottom = -72;
    cam.near = 1;
    cam.far = 300;
    cam.updateProjectionMatrix();
    // Voxel chunks are closed solids, so shadows are cast from their back faces
    // (three's default shadowSide) — that already kills acne on the lit tops.
    // A large normalBias would detach the shadow from the block base
    // (peter-panning), so keep it ~0 and use only a tiny depth bias.
    this.light.shadow.bias = -0.0006;
    this.light.shadow.normalBias = 0.0;
    scene.add(this.light);

    this.target = new THREE.Object3D();
    scene.add(this.target);
    this.light.target = this.target;

    this.ambient = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(this.ambient);

    const sunTex = makeGlowTexture('rgba(255,252,240,1)', 'rgba(255,226,150,0.95)');
    const moonTex = makeGlowTexture('rgba(246,249,255,1)', 'rgba(196,212,244,0.75)');
    this.sun = this.makeSprite(sunTex, 26);
    this.moon = this.makeSprite(moonTex, 20);
    scene.add(this.sun);
    scene.add(this.moon);
  }

  private makeSprite(map: THREE.Texture, scale: number): THREE.Sprite {
    // fog:false keeps the disc visible past the fog distance; depthWrite:false so
    // it never occludes terrain, while the default depthTest lets terrain occlude it.
    const material = new THREE.SpriteMaterial({
      map,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.setScalar(scale);
    return sprite;
  }

  /** Directly set the cycle position (used for testing/debug). */
  setPhase(phase: number): void {
    this.phase = ((phase % 1) + 1) % 1;
  }

  /** Live-update the day length (from the settings slider). */
  setDayLength(dayLengthMinutes: number): void {
    this.cycleSeconds = dayLengthMinutes * 2 * 60;
  }

  /** Current sun elevation in [-1, 1]; > 0 means daytime. */
  get sunElevation(): number {
    return Math.sin(this.phase * Math.PI * 2);
  }

  getClock(): Clock {
    // phase 0 = sunrise = 06:00, so hour = phase*24 + 6.
    const dayHour = (this.phase * 24 + 6) % 24;
    const hours = Math.floor(dayHour);
    const minutes = Math.floor((dayHour - hours) * 60);
    return { hours, minutes, isDay: this.sunElevation >= 0 };
  }

  update(dt: number, playerPos: THREE.Vector3): void {
    this.phase = (this.phase + dt / this.cycleSeconds) % 1;

    const a = this.phase * Math.PI * 2;
    const sunElev = Math.sin(a);
    this.sunDir.set(Math.cos(a), sunElev, ORBIT_TILT).normalize();
    this.moonDir.set(-Math.cos(a), -sunElev, -ORBIT_TILT).normalize();

    const dayFactor = smoothstep(-0.06, 0.22, sunElev);
    const nightFactor = smoothstep(-0.06, 0.22, -sunElev);
    const isDay = sunElev >= 0;

    // One directional light plays both roles: bright warm sun by day, dim cool
    // moon by night. Both fade to zero near the horizon, so the swap is seamless.
    const dir = isDay ? this.sunDir : this.moonDir;
    this.light.position.copy(playerPos).addScaledVector(dir, LIGHT_DISTANCE);
    if (isDay) {
      this.light.color.copy(SUN_HORIZON).lerp(SUN_HIGH, dayFactor);
      this.light.intensity = dayFactor * 1.5;
    } else {
      this.light.color.copy(MOON_LIGHT);
      this.light.intensity = nightFactor * 0.35;
    }
    this.target.position.copy(playerPos);
    this.target.updateMatrixWorld();
    this.light.updateMatrixWorld();

    this.ambient.color.copy(AMBIENT_NIGHT).lerp(AMBIENT_DAY, dayFactor);
    this.ambient.intensity = 0.12 + 0.45 * dayFactor;

    this.computeSkyColor(sunElev, this.skyColor);
    (this.scene.background as THREE.Color).copy(this.skyColor);
    if (this.scene.fog) this.scene.fog.color.copy(this.skyColor);

    // Position the celestial sprites far along their directions, following the
    // player so they read as infinitely distant.
    this.sun.position.copy(playerPos).addScaledVector(this.sunDir, SKY_DISTANCE);
    this.moon.position.copy(playerPos).addScaledVector(this.moonDir, SKY_DISTANCE);
    this.sun.visible = sunElev > -0.15;
    this.moon.visible = sunElev < 0.15;
    this.sun.material.color.copy(SUN_TINT_HORIZON).lerp(SUN_TINT_HIGH, dayFactor);
    this.moon.material.color.copy(MOON_TINT);
  }

  private computeSkyColor(sunElev: number, out: THREE.Color): void {
    if (sunElev > 0.2) {
      out.copy(DAY_SKY);
    } else if (sunElev > 0) {
      out.copy(TWILIGHT_SKY).lerp(DAY_SKY, sunElev / 0.2);
    } else if (sunElev > -0.2) {
      out.copy(NIGHT_SKY).lerp(TWILIGHT_SKY, (sunElev + 0.2) / 0.2);
    } else {
      out.copy(NIGHT_SKY);
    }
  }

  /** Removes the lights/sprites from the scene and frees their resources. */
  dispose(): void {
    this.scene.remove(this.light, this.target, this.ambient, this.sun, this.moon);
    this.light.dispose();
    this.light.shadow.map?.dispose();
    for (const sprite of [this.sun, this.moon]) {
      sprite.material.map?.dispose();
      sprite.material.dispose();
    }
  }
}

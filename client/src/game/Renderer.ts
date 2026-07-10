import * as THREE from 'three';

const SKY_COLOR = 0x87ceeb;
// Fixed fog band that fades distant terrain into the sky. Independent of the
// settings-driven render distance (World owns that); tuned to hide the world
// edge at the default/typical render distance.
const FOG_NEAR = 150;
const FOG_FAR = 245;

/** Owns the WebGL renderer, scene, camera and lights. */
export class Renderer {
  readonly webgl: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;

  constructor(
    private container: HTMLElement,
    fov: number,
  ) {
    this.webgl = new THREE.WebGLRenderer({ antialias: true });
    this.webgl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.webgl.setSize(window.innerWidth, window.innerHeight);
    // Soft shadow maps for block shadows; the light itself lives in Sky.
    this.webgl.shadowMap.enabled = true;
    this.webgl.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.webgl.domElement);

    this.camera = new THREE.PerspectiveCamera(
      fov,
      window.innerWidth / window.innerHeight,
      0.1,
      700,
    );

    this.scene.background = new THREE.Color(SKY_COLOR);
    // Fog hides chunk pop-in at the edge of the render distance.
    this.scene.fog = new THREE.Fog(SKY_COLOR, FOG_NEAR, FOG_FAR);

    // Lights (sun, moon, ambient) are owned by Sky and change with time of day.

    window.addEventListener('resize', this.handleResize);
  }

  get canvas(): HTMLCanvasElement {
    return this.webgl.domElement;
  }

  render(): void {
    this.webgl.render(this.scene, this.camera);
  }

  setFov(fov: number): void {
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  /** Releases GPU resources and detaches the canvas (on returning to the menu). */
  dispose(): void {
    window.removeEventListener('resize', this.handleResize);
    this.webgl.dispose();
    this.webgl.forceContextLoss();
    this.canvas.remove();
  }

  private handleResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.webgl.setSize(window.innerWidth, window.innerHeight);
  };
}

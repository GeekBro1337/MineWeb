import * as THREE from 'three';

const SKY_COLOR = 0x87ceeb;
const FOG_NEAR = 40;
const FOG_FAR = 90;

/** Owns the WebGL renderer, scene, camera and lights. */
export class Renderer {
  readonly webgl: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;

  constructor(container: HTMLElement) {
    this.webgl = new THREE.WebGLRenderer({ antialias: true });
    this.webgl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.webgl.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(this.webgl.domElement);

    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      300,
    );

    this.scene.background = new THREE.Color(SKY_COLOR);
    // Fog hides chunk pop-in at the edge of the render distance.
    this.scene.fog = new THREE.Fog(SKY_COLOR, FOG_NEAR, FOG_FAR);

    const sun = new THREE.DirectionalLight(0xffffff, 1.25);
    sun.position.set(0.6, 1, 0.4);
    this.scene.add(sun);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));

    window.addEventListener('resize', this.handleResize);
  }

  get canvas(): HTMLCanvasElement {
    return this.webgl.domElement;
  }

  render(): void {
    this.webgl.render(this.scene, this.camera);
  }

  private handleResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.webgl.setSize(window.innerWidth, window.innerHeight);
  };
}

import * as THREE from 'three';
import { BlockId } from './BlockRegistry';

/**
 * Texture atlas by material index. Each block face is drawn with one of these
 * textures; the chunk mesher groups faces per material so a chunk is still a
 * single geometry rendered in a handful of draw calls (one per used texture).
 */
export const TEXTURE_KEYS = [
  'grass_top',
  'grass_side',
  'dirt',
  'stone',
  'wood_top',
  'wood_side',
] as const;

type TextureKey = (typeof TEXTURE_KEYS)[number];

const KEY_INDEX: Record<TextureKey, number> = TEXTURE_KEYS.reduce(
  (acc, key, i) => {
    acc[key] = i;
    return acc;
  },
  {} as Record<TextureKey, number>,
);

/** Face index in ChunkMesher.FACES: 2 = bottom (-Y), 3 = top (+Y), rest = side. */
const FACE_BOTTOM = 2;
const FACE_TOP = 3;

/**
 * Texture key for a given block face. Grass has a grassy top, dirt bottom and
 * grass-fringed sides; wood shows rings on the caps and grain on the sides.
 */
function textureKeyFor(id: BlockId, faceIndex: number): TextureKey {
  switch (id) {
    case BlockId.Grass:
      if (faceIndex === FACE_TOP) return 'grass_top';
      if (faceIndex === FACE_BOTTOM) return 'dirt';
      return 'grass_side';
    case BlockId.Wood:
      return faceIndex === FACE_TOP || faceIndex === FACE_BOTTOM ? 'wood_top' : 'wood_side';
    case BlockId.Stone:
      return 'stone';
    case BlockId.Dirt:
    default:
      return 'dirt';
  }
}

/** Material index (into the mesh's materials array) for a block face. */
export function materialIndexFor(id: BlockId, faceIndex: number): number {
  return KEY_INDEX[textureKeyFor(id, faceIndex)];
}

export const MATERIAL_COUNT = TEXTURE_KEYS.length;

/** Representative texture URL for a block, used for the HUD hotbar icons. */
export function blockIconUrl(id: BlockId): string {
  const key: TextureKey =
    id === BlockId.Grass ? 'grass_side'
    : id === BlockId.Wood ? 'wood_side'
    : id === BlockId.Stone ? 'stone'
    : 'dirt';
  return `textures/${key}.png`;
}

function configureTexture(tex: THREE.Texture, maxAnisotropy: number): void {
  // Crisp block look up close (NearestFilter), mipmaps to kill shimmer far away.
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = maxAnisotropy;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
}

/**
 * Loads every block texture and returns one MeshLambertMaterial per texture,
 * indexed to line up with materialIndexFor(). Resolves once all images have
 * decoded so the first chunk mesh is never drawn untextured.
 */
export async function loadBlockMaterials(renderer: THREE.WebGLRenderer): Promise<THREE.Material[]> {
  const loader = new THREE.TextureLoader();
  const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();

  const materials = await Promise.all(
    TEXTURE_KEYS.map(
      (key) =>
        new Promise<THREE.Material>((resolve, reject) => {
          loader.load(
            `textures/${key}.png`,
            (tex) => {
              configureTexture(tex, maxAnisotropy);
              resolve(new THREE.MeshLambertMaterial({ map: tex }));
            },
            undefined,
            () => reject(new Error(`failed to load texture ${key}.png`)),
          );
        }),
    ),
  );
  return materials;
}

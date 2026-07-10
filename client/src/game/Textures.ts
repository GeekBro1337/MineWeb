import * as THREE from 'three';
import { BlockId } from './BlockRegistry';
import type { ItemId } from '../../../shared/items';
import { ITEMS } from '../../../shared/items';

/** Block faces textured from PNG files (material indices 0..5). */
const FILE_TEXTURE_KEYS = ['grass_top', 'grass_side', 'dirt', 'stone', 'wood_top', 'wood_side'] as const;
type FileKey = (typeof FILE_TEXTURE_KEYS)[number];
const FILE_INDEX: Record<FileKey, number> = FILE_TEXTURE_KEYS.reduce(
  (acc, key, i) => {
    acc[key] = i;
    return acc;
  },
  {} as Record<FileKey, number>,
);

/** Procedurally-textured opaque blocks get material indices after the file textures. */
const PROC_INDEX = {
  leaves: 6,
  planks: 7,
  coal_ore: 8,
  iron_ore: 9,
  furnace: 10,
  sand: 11,
} as const;

/** Number of opaque materials. Water is a separate translucent material (own mesh). */
export const MATERIAL_COUNT = 12;

const FACE_BOTTOM = 2;
const FACE_TOP = 3;

function fileKeyFor(id: BlockId, faceIndex: number): FileKey {
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
  switch (id) {
    case BlockId.Leaves: return PROC_INDEX.leaves;
    case BlockId.Planks: return PROC_INDEX.planks;
    case BlockId.CoalOre: return PROC_INDEX.coal_ore;
    case BlockId.IronOre: return PROC_INDEX.iron_ore;
    case BlockId.Furnace: return PROC_INDEX.furnace;
    case BlockId.Sand: return PROC_INDEX.sand;
    default: return FILE_INDEX[fileKeyFor(id, faceIndex)];
  }
}

// --- Procedural canvas textures ------------------------------------------

function newCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return [canvas, canvas.getContext('2d')!];
}

/** Stable per-pixel hash → deterministic organic noise. */
function pixelHash(x: number, y: number): number {
  let h = (Math.imul(x, 374761393) ^ Math.imul(y, 668265263)) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  return h;
}

function fillNoise(ctx: CanvasRenderingContext2D, size: number, palette: string[]): void {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      ctx.fillStyle = palette[pixelHash(x, y) % palette.length];
      ctx.fillRect(x, y, 1, 1);
    }
  }
}

function makeLeavesCanvas(size = 16): HTMLCanvasElement {
  const [canvas, ctx] = newCanvas(size);
  fillNoise(ctx, size, ['#2f6b23', '#357d28', '#3d8a2c', '#296019', '#43932f']);
  return canvas;
}

function makePlanksCanvas(size = 16): HTMLCanvasElement {
  const [canvas, ctx] = newCanvas(size);
  fillNoise(ctx, size, ['#a9783c', '#b3813f', '#9e6f36', '#ab7b3d']);
  ctx.fillStyle = '#7a5628';
  for (const y of [3, 7, 11, 15]) ctx.fillRect(0, y, size, 1); // plank seams
  ctx.fillStyle = '#8a6230';
  ctx.fillRect(7, 0, 1, 3);
  ctx.fillRect(3, 4, 1, 3);
  ctx.fillRect(11, 8, 1, 3);
  ctx.fillRect(6, 12, 1, 3);
  return canvas;
}

const SPECK_POSITIONS: Array<[number, number]> = [[2, 3], [9, 2], [5, 8], [11, 10], [3, 12], [13, 5]];

function makeOreCanvas(speckColor: string, size = 16): HTMLCanvasElement {
  const [canvas, ctx] = newCanvas(size);
  fillNoise(ctx, size, ['#8a8a8a', '#7f7f7f', '#949494', '#767676']);
  ctx.fillStyle = speckColor;
  for (const [x, y] of SPECK_POSITIONS) ctx.fillRect(x, y, 2, 2);
  return canvas;
}

function makeFurnaceCanvas(size = 16): HTMLCanvasElement {
  const [canvas, ctx] = newCanvas(size);
  fillNoise(ctx, size, ['#6f6f75', '#66666c', '#77777d', '#5e5e64']);
  ctx.fillStyle = '#2a2a2e'; // dark opening
  ctx.fillRect(4, 8, 8, 5);
  ctx.fillStyle = '#3a3a40';
  ctx.fillRect(4, 3, 8, 2); // top band
  return canvas;
}

function makeSandCanvas(size = 16): HTMLCanvasElement {
  const [canvas, ctx] = newCanvas(size);
  fillNoise(ctx, size, ['#e0d39c', '#d8ca90', '#e6daa6', '#d0c186']);
  return canvas;
}

function makeWaterCanvas(size = 16): HTMLCanvasElement {
  const [canvas, ctx] = newCanvas(size);
  fillNoise(ctx, size, ['#2f6ea8', '#356fae', '#2c66a0', '#3a78b6']);
  return canvas;
}

// --- Item icons (for inventory/hotbar) -----------------------------------

function makeCoalIcon(): HTMLCanvasElement {
  const [canvas, ctx] = newCanvas(16);
  ctx.fillStyle = '#26262b';
  ctx.fillRect(3, 5, 10, 8);
  ctx.fillRect(4, 4, 8, 10);
  ctx.fillStyle = '#45454e';
  ctx.fillRect(5, 6, 2, 2);
  ctx.fillRect(9, 9, 2, 2);
  return canvas;
}

function makeStickIcon(): HTMLCanvasElement {
  const [canvas, ctx] = newCanvas(16);
  ctx.strokeStyle = '#8a5a2b';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(4, 13);
  ctx.lineTo(12, 3);
  ctx.stroke();
  return canvas;
}

function makeIngotIcon(): HTMLCanvasElement {
  const [canvas, ctx] = newCanvas(16);
  ctx.fillStyle = '#cfd2d8';
  ctx.beginPath();
  ctx.moveTo(4, 6);
  ctx.lineTo(12, 6);
  ctx.lineTo(13, 11);
  ctx.lineTo(3, 11);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#a7abb3';
  ctx.fillRect(3, 10, 10, 1);
  return canvas;
}

const STATIC_ICON: Partial<Record<ItemId, string>> = {
  grass: 'textures/grass_side.png',
  dirt: 'textures/dirt.png',
  stone: 'textures/stone.png',
  wood: 'textures/wood_side.png',
};

const ICON_CANVAS: Partial<Record<ItemId, () => HTMLCanvasElement>> = {
  leaves: makeLeavesCanvas,
  planks: makePlanksCanvas,
  coal_ore: () => makeOreCanvas('#26262b'),
  iron_ore: () => makeOreCanvas('#c9a06a'),
  furnace: makeFurnaceCanvas,
  sand: makeSandCanvas,
  water: makeWaterCanvas,
  coal: makeCoalIcon,
  stick: makeStickIcon,
  iron_ingot: makeIngotIcon,
};

const iconCache = new Map<ItemId, string>();

/** A CSS-usable image URL (file path or data URL) for an item's icon. */
export function itemIconUrl(item: ItemId): string {
  const staticUrl = STATIC_ICON[item];
  if (staticUrl) return staticUrl;
  let url = iconCache.get(item);
  if (!url) {
    const make = ICON_CANVAS[item];
    url = make ? make().toDataURL() : '';
    iconCache.set(item, url);
  }
  return url;
}

/** Icon for a block (used for the hovered-block hint etc.). */
export function blockIconUrl(id: BlockId): string {
  const item = (Object.keys(ITEMS) as ItemId[]).find((k) => ITEMS[k].block === id);
  return item ? itemIconUrl(item) : '';
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

function canvasMaterial(canvas: HTMLCanvasElement, maxAnisotropy: number): THREE.Material {
  const tex = new THREE.CanvasTexture(canvas);
  configureTexture(tex, maxAnisotropy);
  return new THREE.MeshLambertMaterial({ map: tex });
}

export interface BlockMaterials {
  /** Opaque materials indexed by materialIndexFor(). */
  opaque: THREE.Material[];
  /** Single translucent water material (rendered in its own chunk mesh). */
  water: THREE.Material;
}

/**
 * Loads every block material (6 from PNG files + generated on canvas), indexed
 * to line up with materialIndexFor(), plus a translucent water material.
 * Resolves once the images have decoded.
 */
export async function loadBlockMaterials(renderer: THREE.WebGLRenderer): Promise<BlockMaterials> {
  const loader = new THREE.TextureLoader();
  const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();

  const opaque = await Promise.all(
    FILE_TEXTURE_KEYS.map(
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

  opaque[PROC_INDEX.leaves] = canvasMaterial(makeLeavesCanvas(), maxAnisotropy);
  opaque[PROC_INDEX.planks] = canvasMaterial(makePlanksCanvas(), maxAnisotropy);
  opaque[PROC_INDEX.coal_ore] = canvasMaterial(makeOreCanvas('#26262b'), maxAnisotropy);
  opaque[PROC_INDEX.iron_ore] = canvasMaterial(makeOreCanvas('#c9a06a'), maxAnisotropy);
  opaque[PROC_INDEX.furnace] = canvasMaterial(makeFurnaceCanvas(), maxAnisotropy);
  opaque[PROC_INDEX.sand] = canvasMaterial(makeSandCanvas(), maxAnisotropy);

  const waterTex = new THREE.CanvasTexture(makeWaterCanvas());
  configureTexture(waterTex, maxAnisotropy);
  const water = new THREE.MeshLambertMaterial({
    map: waterTex,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  return { opaque, water };
}

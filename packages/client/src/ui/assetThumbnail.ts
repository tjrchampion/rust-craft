import * as THREE from "three";
import { SkeletonUtils } from "three/examples/jsm/Addons.js";
import type { RegionAssetCategory } from "@rustcraft/shared";
import { load } from "../render/gltf";
import { regionAssetUrl } from "../render/regionPropPalette";

const isBrowser = typeof window !== "undefined";
const RENDER_SIZE = 128;
const MAX_CONCURRENT = 2;

const cache = new Map<string, string>();
const pending = new Map<string, Promise<string>>();
const queue: Array<() => void> = [];
let activeJobs = 0;

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;

function cacheKey(category: RegionAssetCategory, model: string): string {
  return `${category}:${model}`;
}

function initOffscreen(): void {
  if (!isBrowser || renderer) return;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = RENDER_SIZE;
    canvas.height = RENDER_SIZE;
    renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(1);
    renderer.setSize(RENDER_SIZE, RENDER_SIZE);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(35, 1, 0.01, 80);
    camera.position.set(1.1, 0.95, 1.85);
    camera.lookAt(0, 0.1, 0);

    scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const key = new THREE.DirectionalLight(0xfff2da, 1.2);
    key.position.set(2.4, 3, 2);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xaaccff, 0.5);
    fill.position.set(-2.2, 0.8, -1.6);
    scene.add(fill);
  } catch (e) {
    console.error("Failed to init asset thumbnail renderer", e);
  }
}

function pumpQueue(): void {
  while (activeJobs < MAX_CONCURRENT && queue.length > 0) {
    const next = queue.shift();
    next?.();
  }
}

async function renderThumbnail(category: RegionAssetCategory, model: string): Promise<string> {
  initOffscreen();
  if (!renderer || !scene || !camera) return "";

  const gltf = await load(regionAssetUrl(category, model));
  const root = SkeletonUtils.clone(gltf.scene);
  root.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) return "";

  const center = new THREE.Vector3();
  box.getCenter(center);
  root.position.sub(center);

  const size = new THREE.Vector3();
  box.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z, 0.001);
  root.scale.setScalar(1.65 / maxDim);
  root.rotation.y = Math.PI / 4.2;
  root.rotation.x = Math.PI / 12;
  root.updateMatrixWorld(true);

  const framed = new THREE.Box3().setFromObject(root);
  const framedCenter = new THREE.Vector3();
  framed.getCenter(framedCenter);
  root.position.sub(framedCenter);

  scene.add(root);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(scene, camera);
  const dataUrl = renderer.domElement.toDataURL("image/png");
  scene.remove(root);
  return dataUrl;
}

/** Transparent PNG preview of a region palette asset (cached). */
export function getRegionAssetThumbnail(
  category: RegionAssetCategory,
  model: string,
): Promise<string> {
  if (!isBrowser) return Promise.resolve("");
  const key = cacheKey(category, model);
  const cached = cache.get(key);
  if (cached) return Promise.resolve(cached);
  const active = pending.get(key);
  if (active) return active;

  const promise = new Promise<string>((resolve) => {
    const run = () => {
      activeJobs++;
      void renderThumbnail(category, model)
        .then((url) => {
          if (url) cache.set(key, url);
          resolve(url);
        })
        .catch((e) => {
          console.warn(`[assetThumbnail] ${key}`, e);
          resolve("");
        })
        .finally(() => {
          pending.delete(key);
          activeJobs--;
          pumpQueue();
        });
    };
    queue.push(run);
    pumpQueue();
  });

  pending.set(key, promise);
  return promise;
}

export function regionAssetThumbnailCached(
  category: RegionAssetCategory,
  model: string,
): string | null {
  return cache.get(cacheKey(category, model)) ?? null;
}

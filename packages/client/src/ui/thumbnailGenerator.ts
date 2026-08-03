import * as THREE from "three";
import { SkeletonUtils } from "three/examples/jsm/Addons.js";
import { itemDef } from "@rustcraft/shared";
import { load } from "../render/gltf";
import { resolveModularUrl } from "../render/classModels";

const isBrowser = typeof window !== "undefined";

/** Fixed offscreen render size -- UI scales the PNG via CSS. */
const RENDER_SIZE = 128;

const cache = new Map<string, string>();
const pending = new Map<string, Promise<string>>();

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;

function initOffscreen() {
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
    camera = new THREE.PerspectiveCamera(35, 1, 0.01, 50);
    camera.position.set(0.9, 0.75, 1.7);
    camera.lookAt(0, 0, 0);

    scene.add(new THREE.AmbientLight(0xffffff, 0.85));

    const key = new THREE.DirectionalLight(0xfff2da, 1.15);
    key.position.set(2.2, 2.4, 2);
    scene.add(key);

    const fill = new THREE.DirectionalLight(0xaaccff, 0.55);
    fill.position.set(-2, 0.5, -1.5);
    scene.add(fill);

    const rim = new THREE.DirectionalLight(0xffffff, 0.35);
    rim.position.set(0, 1.5, -2.5);
    scene.add(rim);
  } catch (e) {
    console.error("Failed to initialize offscreen WebGL renderer", e);
  }
}

/** Prefer weapon/armor props; otherwise first modular outfit URL (male preview). */
function resolveItemModelUrl(itemId: string): string | null {
  const def = itemDef(itemId);
  if (!def) return null;
  if (def.weaponProp?.url) return def.weaponProp.url;
  if (def.armorProp?.url) return def.armorProp.url;
  const modular = def.modularModel;
  if (!modular) return null;
  const partOrder = ["head", "shoulders", "neck", "chest", "arms", "legs", "feet"] as const;
  for (const part of partOrder) {
    const raw = modular[part];
    if (!raw) continue;
    return resolveModularUrl("male", raw);
  }
  return null;
}

export function itemHas3DThumbnail(itemId: string): boolean {
  try {
    return !!resolveItemModelUrl(itemId);
  } catch {
    return false;
  }
}

/** Render a transparent PNG preview of an item's 3D asset (weapon, armor prop, or modular gear). */
export function getItemThumbnail(itemId: string, _size = RENDER_SIZE): Promise<string> {
  if (!isBrowser) return Promise.resolve("");

  const cached = cache.get(itemId);
  if (cached) return Promise.resolve(cached);

  const active = pending.get(itemId);
  if (active) return active;

  const promise = (async () => {
    try {
      initOffscreen();
      if (!renderer || !scene || !camera) return "";

      const url = resolveItemModelUrl(itemId);
      if (!url) throw new Error("No 3D model for item: " + itemId);

      const gltf = await load(url);
      const model = SkeletonUtils.clone(gltf.scene);

      // Skinned modular parts need their skeleton updated once so bind-pose
      // meshes have valid world matrices for framing.
      model.updateMatrixWorld(true);
      model.traverse((o) => {
        const skinned = o as THREE.SkinnedMesh;
        if (skinned.isSkinnedMesh) skinned.skeleton?.update();
      });

      const box = new THREE.Box3().setFromObject(model);
      if (box.isEmpty()) {
        scene.remove(model);
        return "";
      }

      const center = new THREE.Vector3();
      box.getCenter(center);
      model.position.sub(center);

      const sizeVec = new THREE.Vector3();
      box.getSize(sizeVec);
      const maxDim = Math.max(sizeVec.x, sizeVec.y, sizeVec.z, 0.001);
      const scale = 1.55 / maxDim;
      model.scale.setScalar(scale);

      // Slight turn so silhouette reads clearly in a square icon.
      model.rotation.y = Math.PI / 4.5;
      model.rotation.x = Math.PI / 10;

      model.updateMatrixWorld(true);
      const framed = new THREE.Box3().setFromObject(model);
      const framedCenter = new THREE.Vector3();
      framed.getCenter(framedCenter);
      model.position.sub(framedCenter);

      scene.add(model);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.render(scene, camera);

      const dataUrl = renderer.domElement.toDataURL("image/png");

      scene.remove(model);
      // Do not dispose geometry/materials -- load() caches the source GLTF and
      // SkeletonUtils.clone may share buffers with it.
      cache.set(itemId, dataUrl);
      return dataUrl;
    } catch (e) {
      console.error("Failed to generate item thumbnail for " + itemId, e);
      return "";
    } finally {
      pending.delete(itemId);
    }
  })();

  pending.set(itemId, promise);
  return promise;
}

/** @deprecated Use getItemThumbnail -- kept for any older call sites. */
export function getWeaponThumbnail(itemId: string, size = 64): Promise<string> {
  return getItemThumbnail(itemId, size);
}

import * as THREE from "three";
import { SkeletonUtils } from "three/examples/jsm/Addons.js";
import { itemDef } from "@rustcraft/shared";
import { load } from "../render/gltf";

const isBrowser = typeof window !== "undefined";

const cache = new Map<string, string>();
const pending = new Map<string, Promise<string>>();

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;

function initOffscreen(size: number) {
  if (!isBrowser || renderer) return;

  try {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;

    renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.setSize(size, size);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10);
    // Tilted angle for dynamic 3D projection
    camera.position.set(0.7, 0.6, 1.6);
    camera.lookAt(0, 0, 0);

    const ambient = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambient);

    const dir1 = new THREE.DirectionalLight(0xffffff, 1.0);
    dir1.position.set(2, 2, 2);
    scene.add(dir1);

    const dir2 = new THREE.DirectionalLight(0xaaccff, 0.5);
    dir2.position.set(-2, -1, -2);
    scene.add(dir2);
  } catch (e) {
    console.error("Failed to initialize offscreen WebGL renderer", e);
  }
}

export function getWeaponThumbnail(itemId: string, size = 64): Promise<string> {
  if (!isBrowser) return Promise.resolve("");

  const cached = cache.get(itemId);
  if (cached) return Promise.resolve(cached);

  const active = pending.get(itemId);
  if (active) return active;

  const promise = (async () => {
    try {
      initOffscreen(size);
      if (!renderer || !scene || !camera) return "";

      const def = itemDef(itemId);
      const url = def?.weaponProp?.url;
      if (!url) throw new Error("No weaponProp for item: " + itemId);

      const gltf = await load(url);
      const model = SkeletonUtils.clone(gltf.scene);

      // Center and scale the model automatically
      const box = new THREE.Box3().setFromObject(model);
      const center = new THREE.Vector3();
      box.getCenter(center);
      model.position.sub(center);

      const sizeVec = new THREE.Vector3();
      box.getSize(sizeVec);
      const maxDim = Math.max(sizeVec.x, sizeVec.y, sizeVec.z);
      const scale = maxDim > 0 ? 1.45 / maxDim : 1;
      model.scale.setScalar(scale);

      // Rotate model to display its details dynamically
      model.rotation.y = Math.PI / 4.5;
      model.rotation.x = Math.PI / 8;

      scene.add(model);
      renderer.render(scene, camera);

      const dataUrl = renderer.domElement.toDataURL("image/png");

      scene.remove(model);
      cache.set(itemId, dataUrl);
      return dataUrl;
    } catch (e) {
      console.error("Failed to generate weapon thumbnail for " + itemId, e);
      return "";
    }
  })();

  pending.set(itemId, promise);
  return promise;
}

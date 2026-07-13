import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";

const loader = new GLTFLoader();

export type TreeKey =
  | "tree_single_A"
  | "tree_single_B"
  | "trees_A_small"
  | "trees_A_medium"
  | "trees_B_small"
  | "trees_B_medium"
  | "tree_dead_small"
  | "tree_dead_medium"
  | "tree_dead_large"
  | "tree_pine_orange_small"
  | "tree_pine_orange_medium";

const TREE_URLS: Record<TreeKey, string> = {
  tree_single_A: "/assets/models/nature/tree_single_A.gltf",
  tree_single_B: "/assets/models/nature/tree_single_B.gltf",
  trees_A_small: "/assets/models/nature/trees_A_small.gltf",
  trees_A_medium: "/assets/models/nature/trees_A_medium.gltf",
  trees_B_small: "/assets/models/nature/trees_B_small.gltf",
  trees_B_medium: "/assets/models/nature/trees_B_medium.gltf",
  tree_dead_small: "/assets/models/nature/tree_dead_small.gltf",
  tree_dead_medium: "/assets/models/nature/tree_dead_medium.gltf",
  tree_dead_large: "/assets/models/nature/tree_dead_large.gltf",
  tree_pine_orange_small: "/assets/models/nature/tree_pine_orange_small.gltf",
  tree_pine_orange_medium: "/assets/models/nature/tree_pine_orange_medium.gltf",
};

/** Target real-world height (m) after normalization, tuned per source model. */
const TREE_HEIGHTS: Record<TreeKey, number> = {
  tree_single_A: 4.5,
  tree_single_B: 5.5,
  trees_A_small: 4.5,
  trees_A_medium: 5.5,
  trees_B_small: 5,
  trees_B_medium: 6.5,
  tree_dead_small: 3.5,
  tree_dead_medium: 4.5,
  tree_dead_large: 5.5,
  tree_pine_orange_small: 4.5,
  tree_pine_orange_medium: 6,
};

const templates = new Map<TreeKey, THREE.Group>();

function normalize(gltf: GLTF, targetHeight: number): THREE.Group {
  const model = gltf.scene;
  const bbox = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3();
  bbox.getSize(size);
  const scale = size.y > 0.001 ? targetHeight / size.y : 1;
  model.scale.setScalar(scale);
  model.position.y = -bbox.min.y * scale;
  model.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  // Wrap so instances can be repositioned/rescaled independently of the
  // normalization transform baked into the inner model.
  const wrapper = new THREE.Group();
  wrapper.add(model);
  return wrapper;
}

/**
 * Kick off loading every known tree template immediately at module load, so
 * by the time a game session actually starts (after a real network
 * round-trip to connect) most templates are already cached and ready to
 * clone synchronously — no per-node async loading needed.
 */
function preload(): void {
  for (const key of Object.keys(TREE_URLS) as TreeKey[]) {
    loader.load(TREE_URLS[key], (gltf) => {
      templates.set(key, normalize(gltf, TREE_HEIGHTS[key]));
    });
  }
}
preload();

/**
 * A ready-to-place clone of a real imported tree model, with deterministic
 * per-node scale/rotation variation. Returns null if the template hasn't
 * finished loading yet — callers should fall back to a procedural model.
 */
export function buildGltfTree(key: TreeKey, variant: number): THREE.Group | null {
  const template = templates.get(key);
  if (!template) return null;
  const instance = template.clone(true);
  instance.scale.setScalar(0.85 + variant * 0.4);
  instance.rotation.y = variant * Math.PI * 2;
  return instance;
}

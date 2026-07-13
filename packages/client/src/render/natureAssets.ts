import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

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
  | "tree_pine_orange_medium"
  | "oak_1"
  | "oak_2"
  | "oak_3"
  | "oak_4"
  | "oak_5"
  | "pine_1"
  | "pine_2"
  | "pine_3"
  | "pine_4"
  | "pine_5"
  | "dead_1"
  | "dead_2"
  | "dead_3"
  | "twisted_1"
  | "twisted_2"
  | "twisted_3"
  | "bush"
  | "bush_flowers"
  | "fern"
  | "mushroom"
  | "rock_1"
  | "rock_2"
  | "rock_3";

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
  oak_1: "/assets/models/foliage/oak_1.glb",
  oak_2: "/assets/models/foliage/oak_2.glb",
  oak_3: "/assets/models/foliage/oak_3.glb",
  oak_4: "/assets/models/foliage/oak_4.glb",
  oak_5: "/assets/models/foliage/oak_5.glb",
  pine_1: "/assets/models/foliage/pine_1.glb",
  pine_2: "/assets/models/foliage/pine_2.glb",
  pine_3: "/assets/models/foliage/pine_3.glb",
  pine_4: "/assets/models/foliage/pine_4.glb",
  pine_5: "/assets/models/foliage/pine_5.glb",
  dead_1: "/assets/models/foliage/dead_1.glb",
  dead_2: "/assets/models/foliage/dead_2.glb",
  dead_3: "/assets/models/foliage/dead_3.glb",
  twisted_1: "/assets/models/foliage/twisted_1.glb",
  twisted_2: "/assets/models/foliage/twisted_2.glb",
  twisted_3: "/assets/models/foliage/twisted_3.glb",
  bush: "/assets/models/foliage/bush.glb",
  bush_flowers: "/assets/models/foliage/bush_flowers.glb",
  fern: "/assets/models/foliage/fern.glb",
  mushroom: "/assets/models/foliage/mushroom.glb",
  rock_1: "/assets/models/foliage/rock_1.glb",
  rock_2: "/assets/models/foliage/rock_2.glb",
  rock_3: "/assets/models/foliage/rock_3.glb",
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
  oak_1: 5.5,
  oak_2: 6,
  oak_3: 5,
  oak_4: 6.5,
  oak_5: 5.5,
  pine_1: 7,
  pine_2: 8,
  pine_3: 6.5,
  pine_4: 7.5,
  pine_5: 5.5,
  dead_1: 4.5,
  dead_2: 5,
  dead_3: 4,
  twisted_1: 5,
  twisted_2: 4.5,
  twisted_3: 5.5,
  bush: 1.1,
  bush_flowers: 1.2,
  fern: 0.6,
  mushroom: 0.35,
  rock_1: 0.9,
  rock_2: 1.1,
  rock_3: 0.7,
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

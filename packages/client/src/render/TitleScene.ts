import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { buildRock, buildBerryBush, buildBiomeTree } from "./models";

/**
 * Curated (non-gameplay) backdrop for the title / character-select screens:
 * a held cinematic shot of a moonlit village overlook, not a fly-over of the
 * real, playable zone terrain (that's what this replaced -- see git history
 * for the old procedural-terrain flyover if it's ever worth reviving). Every
 * element here is hand-placed for the one framing this camera holds, not
 * generated from world data.
 */

const BUILDING_DIR = "/assets/models/buildings";
const BUILDING_HEIGHTS: Record<string, number> = {
  church: 11,
  tower_A: 15,
  home_A: 6.2,
  home_B: 6.6,
};

const loader = new GLTFLoader();
const gltfCache = new Map<string, Promise<GLTF>>();
function loadGltf(url: string): Promise<GLTF> {
  let p = gltfCache.get(url);
  if (!p) {
    p = loader.loadAsync(url);
    gltfCache.set(url, p);
  }
  return p;
}

async function placeBuilding(
  scene: THREE.Object3D,
  type: string,
  x: number,
  z: number,
  yaw: number,
): Promise<THREE.Object3D | null> {
  try {
    const gltf = await loadGltf(`${BUILDING_DIR}/building_${type}.gltf`);
    const model = gltf.scene.clone(true);
    const bbox = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3();
    bbox.getSize(size);
    const scale = size.y > 0.01 ? (BUILDING_HEIGHTS[type] ?? 6) / size.y : 1;
    model.scale.setScalar(scale);
    model.position.set(x, -bbox.min.y * scale, z);
    model.rotation.y = yaw;
    model.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    scene.add(model);
    return model;
  } catch (err) {
    console.warn(`[TitleScene] failed to load building '${type}'`, err);
    return null;
  }
}

/** Cheap hash-based bump so the ground isn't a dead-flat plane, without
 *  pulling in the real terrain heightmap this scene deliberately avoids. */
function groundHeight(x: number, z: number): number {
  const n = Math.sin(x * 0.08) * Math.cos(z * 0.11) + Math.sin(x * 0.21 + z * 0.17) * 0.4;
  return n * 1.1;
}

function buildGround(): THREE.Mesh {
  const size = 260;
  const segments = 96;
  const geo = new THREE.PlaneGeometry(size, size, segments, segments);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position!;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, groundHeight(x, z));
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({ color: 0x2c3a24 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

function buildMoon(): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(9, 24, 24),
    new THREE.MeshBasicMaterial({ color: 0xfbf3d8 }),
  );
  mesh.position.set(-70, 78, -160);
  return mesh;
}

/** Soft glow disc behind the moon -- a plain emissive sphere alone reads as
 *  a flat cutout against the fog; this fakes the atmospheric halo cheaply. */
function buildMoonGlow(): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(16, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0xfbf3d8, transparent: true, opacity: 0.12, depthWrite: false }),
  );
  mesh.position.set(-70, 78, -160);
  return mesh;
}

interface EmberField {
  points: THREE.Points;
  update(dt: number): void;
}

/** Slow-drifting warm motes rising past the village -- the one bit of
 *  motion in an otherwise held, static-camera shot. */
function buildEmbers(): EmberField {
  const count = 140;
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const speeds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 90;
    positions[i * 3 + 1] = Math.random() * 22;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 70 - 10;
    speeds[i] = 0.4 + Math.random() * 0.8;
  }
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: 0xffb84d,
    size: 0.22,
    transparent: true,
    opacity: 0.75,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, material);
  return {
    points,
    update(dt: number) {
      const arr = geo.attributes.position!.array as Float32Array;
      for (let i = 0; i < count; i++) {
        const yi = i * 3 + 1;
        arr[yi] = (arr[yi] ?? 0) + speeds[i]! * dt;
        if (arr[yi]! > 24) arr[yi] = 0;
      }
      geo.attributes.position!.needsUpdate = true;
    },
  };
}

export class TitleScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private running = true;
  private start = performance.now();
  private lastFrame = performance.now();
  private embers: EmberField;
  private windowLights: THREE.PointLight[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 500);

    const fogColor = 0x141a2e;
    this.scene.fog = new THREE.Fog(fogColor, 60, 240);
    this.scene.background = new THREE.Color(fogColor);

    // Cool moonlight key + a dim indigo ambient fill -- the only warmth in
    // the shot comes from the village windows/embers, not the sky.
    const moonlight = new THREE.DirectionalLight(0x9fb4ff, 1.1);
    moonlight.position.set(-70, 78, -160);
    moonlight.castShadow = true;
    moonlight.shadow.mapSize.set(2048, 2048);
    moonlight.shadow.camera.left = -70;
    moonlight.shadow.camera.right = 70;
    moonlight.shadow.camera.top = 70;
    moonlight.shadow.camera.bottom = -70;
    moonlight.shadow.camera.near = 1;
    moonlight.shadow.camera.far = 300;
    moonlight.shadow.bias = -0.0015;
    this.scene.add(moonlight, moonlight.target, new THREE.AmbientLight(0x33406e, 0.65));

    this.scene.add(buildGround());
    this.scene.add(buildMoon());
    this.scene.add(buildMoonGlow());

    // Village cluster, mid-ground -- church as the tall focal silhouette,
    // tower behind/beside it, two homes filling out the base.
    void placeBuilding(this.scene, "church", 6, -38, Math.PI * 0.15);
    void placeBuilding(this.scene, "tower_A", -14, -46, -Math.PI * 0.1);
    void placeBuilding(this.scene, "home_A", 20, -30, -Math.PI * 0.35);
    void placeBuilding(this.scene, "home_B", -2, -24, Math.PI * 0.6);

    // Warm window-glow -- the building models have no emissive windows of
    // their own, so a few small point lights at roughly window height fake it.
    for (const [x, z] of [
      [6, -38],
      [-2, -24],
      [20, -30],
    ] as const) {
      const light = new THREE.PointLight(0xffb454, 3.5, 14, 2);
      light.position.set(x, 3, z);
      this.scene.add(light);
      this.windowLights.push(light);
    }

    // Forest framing the village and, closer in, a few large trees flanking
    // the camera itself for foreground silhouette depth.
    const forestSpots: Array<[number, number, "forest" | "mountain"]> = [
      [-35, -55, "forest"],
      [-48, -30, "mountain"],
      [35, -60, "forest"],
      [45, -35, "mountain"],
      [-25, -70, "mountain"],
      [15, -75, "forest"],
      [-55, -10, "forest"],
      [50, -5, "mountain"],
    ];
    for (const [x, z, biome] of forestSpots) {
      const tree = buildBiomeTree(biome, Math.random());
      tree.position.set(x, 0, z);
      tree.rotation.y = Math.random() * Math.PI * 2;
      const s = 0.85 + Math.random() * 0.4;
      tree.scale.setScalar(s);
      tree.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.castShadow = true;
      });
      this.scene.add(tree);
    }
    const foregroundFrame: Array<[number, number]> = [
      [-16, 14],
      [17, 16],
    ];
    for (const [x, z] of foregroundFrame) {
      const tree = buildBiomeTree("mountain", Math.random());
      tree.position.set(x, 0, z);
      tree.scale.setScalar(2.2);
      this.scene.add(tree);
    }

    for (let i = 0; i < 10; i++) {
      const rock = buildRock(Math.random());
      rock.position.set((Math.random() - 0.5) * 70, 0, -10 - Math.random() * 50);
      rock.rotation.y = Math.random() * Math.PI * 2;
      this.scene.add(rock);
    }
    for (let i = 0; i < 8; i++) {
      const bush = buildBerryBush(Math.random());
      bush.position.set((Math.random() - 0.5) * 60, 0, -5 - Math.random() * 45);
      this.scene.add(bush);
    }

    this.embers = buildEmbers();
    this.scene.add(this.embers.points);

    window.addEventListener("resize", this.onResize);
    requestAnimationFrame(this.frame);
  }

  private frame = (): void => {
    if (!this.running) return;
    requestAnimationFrame(this.frame);
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    const t = (now - this.start) / 1000;

    this.embers.update(dt);
    for (const light of this.windowLights) {
      light.intensity = 3.2 + Math.sin(t * 2.3 + light.position.x) * 0.4;
    }

    // A held shot, not a flyover -- just enough drift (slow sway + a barely
    // perceptible breathing zoom) to keep it from looking like a screenshot.
    const swayX = Math.sin(t * 0.05) * 3;
    const swayY = Math.sin(t * 0.037) * 1.1;
    this.camera.position.set(swayX, 9 + swayY, 34 + Math.sin(t * 0.02) * 2);
    this.camera.lookAt(4, 6, -35);
    this.renderer.render(this.scene, this.camera);
  };

  private onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  dispose(): void {
    this.running = false;
    window.removeEventListener("resize", this.onResize);
    this.renderer.dispose();
  }
}

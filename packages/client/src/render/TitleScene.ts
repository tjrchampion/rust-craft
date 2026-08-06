import * as THREE from "three";
import { type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { RegionBlueprint } from "@rustcraft/shared";
import { buildRock, buildBerryBush, buildBiomeTree } from "./models";
import { load as loadGltf } from "./gltf";
import { getSharedKtx2Loader } from "./sharedGltf";

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
  church: 14,
  tower_A: 17,
  home_A: 7.0,
  home_B: 7.5,
  tavern: 9.5,
  blacksmith: 7.5,
  windmill: 18.0,
  lumbermill: 8.5,
  market: 5.5,
  well: 4.0,
  bridge_A: 4.5,
};

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

/** Cheap hash-based bump so the ground isn't a dead-flat plane */
function groundHeight(x: number, z: number): number {
  const n = Math.sin(x * 0.08) * Math.cos(z * 0.11) + Math.sin(x * 0.21 + z * 0.17) * 0.4;
  return n * 1.1;
}

function buildGround(): THREE.Mesh {
  const size = 320;
  const segments = 120;
  const geo = new THREE.PlaneGeometry(size, size, segments, segments);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position!;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, groundHeight(x, z));
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({ color: 0x273420 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

/** Cobblestone Village Road connecting houses, tavern, market, and church */
function buildRoads(): THREE.Mesh {
  const points = [
    new THREE.Vector3(-45, 0.15, -60),
    new THREE.Vector3(-25, 0.15, -45),
    new THREE.Vector3(-10, 0.15, -30),
    new THREE.Vector3(0, 0.15, -25),
    new THREE.Vector3(15, 0.15, -28),
    new THREE.Vector3(30, 0.15, -40),
    new THREE.Vector3(48, 0.15, -55),
  ];
  const curve = new THREE.CatmullRomCurve3(points);
  const roadGeo = new THREE.TubeGeometry(curve, 64, 3.8, 8, false);
  const roadMat = new THREE.MeshStandardMaterial({
    color: 0x4d3e2e,
    roughness: 0.85,
    metalness: 0.1,
  });
  const roadMesh = new THREE.Mesh(roadGeo, roadMat);
  roadMesh.scale.set(1, 0.05, 1);
  roadMesh.receiveShadow = true;
  return roadMesh;
}

function buildMoon(): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(10, 24, 24),
    new THREE.MeshBasicMaterial({ color: 0xfbf3d8 }),
  );
  mesh.position.set(-80, 85, -180);
  return mesh;
}

function buildMoonGlow(): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(18, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0xfbf3d8, transparent: true, opacity: 0.12, depthWrite: false }),
  );
  mesh.position.set(-80, 85, -180);
  return mesh;
}

interface EmberField {
  points: THREE.Points;
  update(dt: number): void;
}

function buildEmbers(): EmberField {
  const count = 180;
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const speeds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 120;
    positions[i * 3 + 1] = Math.random() * 28;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 100 - 20;
    speeds[i] = 0.4 + Math.random() * 0.8;
  }
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: 0xffb84d,
    size: 0.25,
    transparent: true,
    opacity: 0.8,
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
        if (arr[yi]! > 30) arr[yi] = 0;
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

  private titleCamConfig?: { x: number; y: number; z: number; pitch: number; yaw: number };

  constructor(canvas: HTMLCanvasElement, titleCamera?: { x: number; y: number; z: number; pitch: number; yaw: number }) {
    this.titleCamConfig = titleCamera;
    void this.loadRegionTitleCamera();
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // The title backdrop loads real building/tree GLTFs, which now carry KTX2
    // (Basis) textures -- prime the shared KTX2 transcoder with this renderer's
    // GPU-format support so those textures decode here too, not just in-game.
    getSharedKtx2Loader(this.renderer);

    this.camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 600);

    const fogColor = 0x141a2e;
    this.scene.fog = new THREE.Fog(fogColor, 70, 280);
    this.scene.background = new THREE.Color(fogColor);

    const moonlight = new THREE.DirectionalLight(0x9fb4ff, 1.25);
    moonlight.position.set(-80, 85, -180);
    moonlight.castShadow = true;
    moonlight.shadow.mapSize.set(2048, 2048);
    moonlight.shadow.camera.left = -90;
    moonlight.shadow.camera.right = 90;
    moonlight.shadow.camera.top = 90;
    moonlight.shadow.camera.bottom = -90;
    moonlight.shadow.camera.near = 1;
    moonlight.shadow.camera.far = 350;
    moonlight.shadow.bias = -0.0015;
    this.scene.add(moonlight, moonlight.target, new THREE.AmbientLight(0x384878, 0.7));

    this.scene.add(buildGround());
    this.scene.add(buildRoads());
    this.scene.add(buildMoon());
    this.scene.add(buildMoonGlow());

    // Fantastic Village Pack: Tavern, Blacksmith, Windmill, Market, Lumbermill, Church, Well & Homes
    void placeBuilding(this.scene, "church", 0, -32, Math.PI * 0.15);
    void placeBuilding(this.scene, "tavern", -22, -26, Math.PI * 0.4);
    void placeBuilding(this.scene, "blacksmith", 24, -28, -Math.PI * 0.3);
    void placeBuilding(this.scene, "windmill", -42, -58, Math.PI * 0.1);
    void placeBuilding(this.scene, "lumbermill", 42, -62, -Math.PI * 0.2);
    void placeBuilding(this.scene, "market", 10, -18, Math.PI * 0.05);
    void placeBuilding(this.scene, "well", 0, -16, 0);
    void placeBuilding(this.scene, "tower_A", -28, -48, -Math.PI * 0.1);
    void placeBuilding(this.scene, "home_A", 28, -44, -Math.PI * 0.35);
    void placeBuilding(this.scene, "home_B", -16, -42, Math.PI * 0.6);
    void placeBuilding(this.scene, "home_A", -36, -20, Math.PI * 0.25);
    void placeBuilding(this.scene, "home_B", 36, -20, -Math.PI * 0.5);

    // Warm glowing windows & flickering village lanterns
    for (const [x, z] of [
      [0, -32],
      [-22, -26],
      [24, -28],
      [10, -18],
      [0, -16],
      [-42, -58],
      [42, -62],
      [-28, -48],
      [28, -44],
    ] as const) {
      const light = new THREE.PointLight(0xffb454, 4.0, 18, 2);
      light.position.set(x, 3.8, z);
      this.scene.add(light);
      this.windowLights.push(light);
    }

    // Towering Giant Trees framing the region (scales 3.5x to 5.5x)
    const giantTreeSpots: Array<[number, number, "forest" | "mountain", number]> = [
      [-52, -70, "forest", 4.8],
      [52, -75, "forest", 5.2],
      [-65, -35, "mountain", 4.5],
      [65, -40, "mountain", 4.9],
      [-45, 15, "forest", 5.5],
      [45, 20, "forest", 5.0],
      [-15, -90, "forest", 4.6],
      [20, -95, "mountain", 4.7],
      [-30, 35, "mountain", 5.2],
      [32, 35, "forest", 5.1],
    ];
    for (const [x, z, biome, scaleMult] of giantTreeSpots) {
      const tree = buildBiomeTree(biome, Math.random());
      tree.position.set(x, groundHeight(x, z), z);
      tree.rotation.y = Math.random() * Math.PI * 2;
      tree.scale.setScalar(scaleMult);
      tree.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.castShadow = true;
      });
      this.scene.add(tree);
    }

    // Medium Forest Tree canopy framing roads & outskirts
    const forestSpots: Array<[number, number, "forest" | "mountain"]> = [
      [-35, -55, "forest"],
      [-48, -30, "mountain"],
      [35, -60, "forest"],
      [45, -35, "mountain"],
      [-25, -70, "mountain"],
      [15, -75, "forest"],
      [-55, -10, "forest"],
      [50, -5, "mountain"],
      [-38, 10, "forest"],
      [38, 15, "forest"],
    ];
    for (const [x, z, biome] of forestSpots) {
      const tree = buildBiomeTree(biome, Math.random());
      tree.position.set(x, groundHeight(x, z), z);
      tree.rotation.y = Math.random() * Math.PI * 2;
      tree.scale.setScalar(2.2 + Math.random() * 0.8);
      tree.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.castShadow = true;
      });
      this.scene.add(tree);
    }

    // Rocks, foliage & berry bushes
    for (let i = 0; i < 24; i++) {
      const rock = buildRock(Math.random());
      const rx = (Math.random() - 0.5) * 140;
      const rz = (Math.random() - 0.5) * 140 - 20;
      rock.position.set(rx, groundHeight(rx, rz), rz);
      rock.rotation.y = Math.random() * Math.PI * 2;
      rock.scale.setScalar(1.5 + Math.random() * 1.2);
      this.scene.add(rock);
    }
    for (let i = 0; i < 20; i++) {
      const bush = buildBerryBush(Math.random());
      const bx = (Math.random() - 0.5) * 120;
      const bz = (Math.random() - 0.5) * 120 - 15;
      bush.position.set(bx, groundHeight(bx, bz), bz);
      bush.scale.setScalar(1.3 + Math.random() * 0.6);
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
      light.intensity = 3.6 + Math.sin(t * 2.3 + light.position.x) * 0.6;
    }

    if (this.titleCamConfig) {
      // Use the author-set camera location & orientation from the region blueprint
      const breathX = Math.sin(t * 0.04) * 0.15;
      const breathY = Math.cos(t * 0.032) * 0.1;
      this.camera.position.set(
        this.titleCamConfig.x + breathX,
        this.titleCamConfig.y + breathY,
        this.titleCamConfig.z,
      );
      this.camera.rotation.set(this.titleCamConfig.pitch, this.titleCamConfig.yaw, 0);
    } else {
      // Fixed cinematic shot facing key region assets (houses, well, tavern, trees) -- no rotation
      const swayX = Math.sin(t * 0.04) * 2.2;
      const swayY = Math.cos(t * 0.03) * 0.8;
      this.camera.position.set(swayX, 14 + swayY, 28 + Math.sin(t * 0.02) * 1.5);
      this.camera.lookAt(0, 5, -28);
    }

    this.renderer.render(this.scene, this.camera);
  };

  private async loadRegionTitleCamera(): Promise<void> {
    try {
      const lastRegionId = localStorage.getItem("rustcraft_last_region_id");
      let bp: RegionBlueprint | undefined;
      if (lastRegionId) {
        const res = await fetch(`/api/regions/${lastRegionId}`);
        if (res.ok) {
          const data = (await res.json()) as { blueprint?: RegionBlueprint };
          bp = data.blueprint;
        }
      }
      if (!bp) {
        const res = await fetch("/api/regions");
        if (res.ok) {
          const data = (await res.json()) as { regions?: Array<{ id: string }> };
          const firstId = data.regions?.[0]?.id;
          if (firstId) {
            const rRes = await fetch(`/api/regions/${firstId}`);
            if (rRes.ok) {
              const rData = (await rRes.json()) as { blueprint?: RegionBlueprint };
              bp = rData.blueprint;
            }
          }
        }
      }
      if (bp) {
        if (bp.titleCamera) {
          this.titleCamConfig = bp.titleCamera;
        }
        if (bp.assets && bp.assets.length > 0) {
          void this.loadRegionAssets(bp);
        }
      }
    } catch (err) {
      console.warn("[TitleScene] Failed to load region titleCamera", err);
    }
  }

  private async loadRegionAssets(bp: RegionBlueprint): Promise<void> {
    const ASSET_DIR: Record<string, string> = {
      building: "buildings",
      foliage: "foliage",
      prop: "props",
    };
    for (const a of bp.assets) {
      const dir = ASSET_DIR[a.category] || "props";
      const url = `/assets/models/${dir}/${a.model}`;
      try {
        const gltf = await loadGltf(url);
        const model = gltf.scene.clone(true);
        model.position.set(a.localX, a.localY, a.localZ);
        model.rotation.y = a.yaw;
        if (a.scaleX !== undefined) {
          model.scale.set(a.scaleX, a.scaleY, a.scaleZ);
        } else {
          model.scale.setScalar(a.scale ?? 1);
        }
        model.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
          }
        });
        this.scene.add(model);
      } catch {
        // Skip unavailable models
      }
    }
  }

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

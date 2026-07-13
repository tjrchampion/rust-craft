import * as THREE from "three";
import { generateNodes, terrainHeight } from "@rustcraft/shared";
import { buildTerrain, buildWater, buildRivers } from "./terrain";
import { buildRock, buildBerryBush, buildBiomeTree } from "./models";
import { buildSettlements } from "./settlements";
import { buildHorizonMountains } from "./horizon";
import { buildClouds, type CloudField } from "./clouds";

/**
 * Lightweight animated backdrop for the title / character screens:
 * a golden-hour fly-over of the real zone terrain.
 */
export class TitleScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private running = true;
  private start = performance.now();
  private lastFrame = performance.now();
  private clouds: CloudField;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 900);

    this.scene.fog = new THREE.Fog(0xe8b27a, 120, 500);
    this.scene.background = new THREE.Color(0xe8b27a);

    const sun = new THREE.DirectionalLight(0xffd9a0, 2.2);
    sun.position.set(-80, 40, 60);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -110;
    sun.shadow.camera.right = 110;
    sun.shadow.camera.top = 110;
    sun.shadow.camera.bottom = -110;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 260;
    sun.shadow.bias = -0.0015;
    this.scene.add(sun, sun.target, new THREE.AmbientLight(0xb08a6a, 0.85));

    this.scene.add(buildTerrain());
    this.scene.add(buildWater());
    this.scene.add(buildRivers());
    this.scene.add(buildHorizonMountains());
    this.clouds = buildClouds();
    this.scene.add(this.clouds.group);

    // Scatter a subset of world nodes near the orbit path for depth.
    for (const node of generateNodes()) {
      if (Math.hypot(node.x, node.z) > 220) continue;
      let mesh;
      if (node.type === "tree") {
        mesh = buildBiomeTree(node.biome, node.variant);
      } else if (node.type === "rock") {
        mesh = buildRock(node.variant);
      } else {
        mesh = buildBerryBush(node.variant);
      }
      mesh.position.set(node.x, node.y, node.z);
      this.scene.add(mesh);
    }

    // Villages + landmarks make the fly-over feel inhabited.
    buildSettlements(this.scene, false);

    window.addEventListener("resize", this.onResize);
    requestAnimationFrame(this.frame);
  }

  private frame = (): void => {
    if (!this.running) return;
    requestAnimationFrame(this.frame);
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.clouds.update(dt);
    const t = (now - this.start) / 1000;
    const angle = t * 0.045;
    const radius = 85;
    const x = Math.sin(angle) * radius;
    const z = Math.cos(angle) * radius;
    const y = Math.max(terrainHeight(x, z) + 16, 18);
    this.camera.position.set(x, y, z);
    this.camera.lookAt(0, 6, 0);
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

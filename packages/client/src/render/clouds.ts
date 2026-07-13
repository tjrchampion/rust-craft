import * as THREE from "three";
import { mulberry32 } from "@rustcraft/shared";

const CLOUD_SEED = 90210;
const CLOUD_ALT = 95;
const AREA = 760; // spread across and beyond the play area
const DRIFT_SPEED = 1.4; // m/s

function buildCloudPuff(rng: () => number, scale: number): THREE.Group {
  const group = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0xf4f6fa, transparent: true, opacity: 0.92, fog: true });
  const puffCount = 4 + Math.floor(rng() * 4);
  for (let i = 0; i < puffCount; i++) {
    const r = 6 + rng() * 8;
    const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), mat);
    puff.position.set((rng() - 0.5) * 22, (rng() - 0.5) * 4, (rng() - 0.5) * 15);
    group.add(puff);
  }
  group.scale.setScalar(scale);
  return group;
}

export interface CloudField {
  group: THREE.Group;
  /** Drift clouds slowly across the sky; call once per rendered frame. */
  update(dt: number): void;
}

/** A field of slow-drifting low-poly cloud puffs high above the zone. */
export function buildClouds(): CloudField {
  const group = new THREE.Group();
  group.name = "clouds";
  const rng = mulberry32(CLOUD_SEED);
  const clouds: THREE.Group[] = [];
  const count = 22;
  for (let i = 0; i < count; i++) {
    const cloud = buildCloudPuff(rng, 1.1 + rng() * 2.1);
    cloud.position.set((rng() - 0.5) * AREA, CLOUD_ALT + (rng() - 0.5) * 22, (rng() - 0.5) * AREA);
    clouds.push(cloud);
    group.add(cloud);
  }

  const wrap = AREA / 2;
  function update(dt: number): void {
    for (const c of clouds) {
      c.position.x += dt * DRIFT_SPEED;
      if (c.position.x > wrap) c.position.x -= AREA;
    }
  }

  return { group, update };
}

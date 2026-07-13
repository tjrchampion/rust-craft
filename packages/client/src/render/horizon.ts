import * as THREE from "three";
import { mulberry32, ZONE_SIZE } from "@rustcraft/shared";

const HORIZON_SEED = 424242;
const HAZE_COLOR = 0x5f6d82;
const SNOW_COLOR = 0xd9e3ec;

/** A jagged little massif of overlapping faceted cones, snow-capped if tall. */
function buildPeakCluster(rng: () => number, baseHeight: number): THREE.Group {
  const group = new THREE.Group();
  const haze = new THREE.MeshBasicMaterial({ color: HAZE_COLOR, fog: true });
  const snow = new THREE.MeshBasicMaterial({ color: SNOW_COLOR, fog: true });
  const peakCount = 3 + Math.floor(rng() * 3);
  for (let i = 0; i < peakCount; i++) {
    const h = baseHeight * (0.55 + rng() * 0.7);
    const r = h * (0.45 + rng() * 0.3);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(r, h, 5 + Math.floor(rng() * 3)), haze);
    const px = (rng() - 0.5) * baseHeight * 0.9;
    const pz = (rng() - 0.5) * baseHeight * 0.5;
    cone.position.set(px, h / 2, pz);
    cone.rotation.y = rng() * Math.PI * 2;
    group.add(cone);
    if (h > baseHeight * 0.8) {
      const cap = new THREE.Mesh(new THREE.ConeGeometry(r * 0.4, h * 0.28, 5), snow);
      cap.position.set(px, h * 0.88, pz);
      group.add(cap);
    }
  }
  return group;
}

/**
 * A distant, non-collidable ring of jagged peaks beyond the playable zone,
 * for a grander sense of scale — pure backdrop, never interactive.
 */
export function buildHorizonMountains(): THREE.Group {
  const group = new THREE.Group();
  const rng = mulberry32(HORIZON_SEED);
  const ringRadius = ZONE_SIZE * 0.78;
  const clusterCount = 16;
  for (let i = 0; i < clusterCount; i++) {
    const angle = (i / clusterCount) * Math.PI * 2 + (rng() - 0.5) * 0.3;
    const radius = ringRadius + (rng() - 0.5) * 90;
    const baseHeight = 70 + rng() * 100;
    const cluster = buildPeakCluster(rng, baseHeight);
    cluster.position.set(Math.sin(angle) * radius, -15, Math.cos(angle) * radius);
    group.add(cluster);
  }
  group.name = "horizon-mountains";
  return group;
}

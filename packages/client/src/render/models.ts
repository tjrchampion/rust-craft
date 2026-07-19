import * as THREE from "three";
import type { Biome } from "@rustcraft/shared";
import { barkTexture, foliageTexture } from "./textures";
import { buildGltfTree } from "./natureAssets";

/**
 * Procedural low-poly models. Each builder returns a Group whose origin sits
 * at the entity's feet. Structured so GLTF replacements can swap in later:
 * callers only rely on the group + named child conventions.
 */

function lambert(color: number): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color });
}

function barkMat(color: number): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color, map: barkTexture() });
}

function foliageMat(color: number): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color, map: foliageTexture() });
}

function box(w: number, h: number, d: number, color: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lambert(color));
  m.castShadow = true;
  return m;
}

export interface HumanoidParts {
  group: THREE.Group;
  leftArm: THREE.Object3D;
  rightArm: THREE.Object3D;
  leftLeg: THREE.Object3D;
  rightLeg: THREE.Object3D;
  torso: THREE.Object3D;
}

const SKIN = 0xd9a877;
const SHIRT_COLORS = [0x7a4f8f, 0x4f6f8f, 0x8f5f4f, 0x4f8f6a, 0x8f8a4f, 0xa05a6e];

export function buildHumanoid(tint: number): HumanoidParts {
  const shirt = SHIRT_COLORS[Math.abs(tint) % SHIRT_COLORS.length]!;
  const pants = 0x3d4653;

  const group = new THREE.Group();

  const torso = new THREE.Group();
  const chest = box(0.62, 0.72, 0.34, shirt);
  chest.position.y = 0.36;
  torso.add(chest);
  const head = box(0.36, 0.36, 0.36, SKIN);
  head.position.y = 0.92;
  torso.add(head);
  torso.position.y = 0.78;
  group.add(torso);

  const mkArm = (side: number) => {
    const pivot = new THREE.Group();
    const arm = box(0.16, 0.62, 0.16, shirt);
    arm.position.y = -0.28;
    pivot.add(arm);
    pivot.position.set(side * 0.4, 1.46, 0);
    group.add(pivot);
    return pivot;
  };
  const mkLeg = (side: number) => {
    const pivot = new THREE.Group();
    const leg = box(0.2, 0.78, 0.2, pants);
    leg.position.y = -0.38;
    pivot.add(leg);
    pivot.position.set(side * 0.16, 0.78, 0);
    group.add(pivot);
    return pivot;
  };

  return {
    group,
    leftArm: mkArm(-1),
    rightArm: mkArm(1),
    leftLeg: mkLeg(-1),
    rightLeg: mkLeg(1),
    torso,
  };
}

export interface WolfParts {
  group: THREE.Group;
  legs: THREE.Object3D[];
  head: THREE.Object3D;
}

export function buildWolf(): WolfParts {
  const fur = 0x6f6a63;
  const group = new THREE.Group();

  const body = box(0.45, 0.42, 1.05, fur);
  body.position.y = 0.62;
  group.add(body);

  const head = new THREE.Group();
  const skull = box(0.32, 0.3, 0.42, fur);
  head.add(skull);
  const snout = box(0.16, 0.14, 0.22, 0x57534d);
  snout.position.set(0, -0.05, 0.28);
  head.add(snout);
  const earL = box(0.08, 0.14, 0.05, fur);
  earL.position.set(-0.1, 0.2, -0.08);
  head.add(earL);
  const earR = earL.clone();
  earR.position.x = 0.1;
  head.add(earR);
  head.position.set(0, 0.85, 0.6);
  group.add(head);

  const tail = box(0.1, 0.1, 0.4, fur);
  tail.position.set(0, 0.72, -0.65);
  tail.rotation.x = -0.5;
  group.add(tail);

  const legs: THREE.Object3D[] = [];
  for (const [sx, sz] of [
    [-0.16, 0.38],
    [0.16, 0.38],
    [-0.16, -0.38],
    [0.16, -0.38],
  ] as const) {
    const pivot = new THREE.Group();
    const leg = box(0.11, 0.45, 0.11, 0x57534d);
    leg.position.y = -0.2;
    pivot.add(leg);
    pivot.position.set(sx, 0.42, sz);
    group.add(pivot);
    legs.push(pivot);
  }

  return { group, legs, head };
}

export function buildTree(variant: number): THREE.Group {
  const group = new THREE.Group();
  const scale = 0.85 + variant * 0.5;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, 2.6, 6), barkMat(0x6b4a2f));
  trunk.position.y = 1.3;
  trunk.castShadow = true;
  group.add(trunk);
  const foliageColor = variant < 0.5 ? 0x2f5d33 : 0x3b6b2e;
  let y = 2.4;
  let r = 1.7;
  for (let i = 0; i < 3; i++) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(r, 1.9, 7), foliageMat(foliageColor));
    cone.position.y = y;
    cone.castShadow = true;
    group.add(cone);
    y += 1.15;
    r *= 0.68;
  }
  group.scale.setScalar(scale);
  group.rotation.y = variant * Math.PI * 2;
  return group;
}

export function buildOak(variant: number): THREE.Group {
  const group = new THREE.Group();
  const scale = 0.8 + variant * 0.5;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.38, 2.2, 6), barkMat(0x7a5533));
  trunk.position.y = 1.1;
  trunk.castShadow = true;
  group.add(trunk);
  const canopyColor = variant < 0.5 ? 0x4d7a35 : 0x5c8a3a;
  const canopyLight = variant < 0.5 ? 0x5f9142 : 0x6ea047;
  // Dense, overlapping puffs read as one full rounded canopy rather than
  // a sparse cluster, matching lush reference-zone tree silhouettes.
  for (const [dx, dy, dz, r, light] of [
    [0, 3.0, 0, 1.6, false],
    [0.95, 2.5, 0.3, 1.05, false],
    [-0.85, 2.6, -0.4, 1.15, false],
    [0.2, 3.6, -0.6, 1.05, true],
    [-0.5, 3.3, 0.7, 0.95, true],
    [0.7, 2.1, -0.9, 0.85, false],
  ] as const) {
    const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), foliageMat(light ? canopyLight : canopyColor));
    puff.position.set(dx, dy, dz);
    puff.castShadow = true;
    group.add(puff);
  }
  group.scale.setScalar(scale);
  group.rotation.y = variant * Math.PI * 2;
  return group;
}

export function buildDeadTree(variant: number): THREE.Group {
  const group = new THREE.Group();
  const scale = 0.9 + variant * 0.4;
  const bark = 0x6e6152;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.26, 3.2, 5), lambert(bark));
  trunk.position.y = 1.6;
  trunk.rotation.z = (variant - 0.5) * 0.15;
  trunk.castShadow = true;
  group.add(trunk);
  for (let i = 0; i < 3; i++) {
    const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.09, 1.3, 4), lambert(bark));
    const a = variant * 6 + i * 2.1;
    branch.position.set(Math.sin(a) * 0.3, 1.9 + i * 0.5, Math.cos(a) * 0.3);
    branch.rotation.set(Math.sin(a) * 0.9, 0, Math.cos(a) * 0.9);
    branch.castShadow = true;
    group.add(branch);
  }
  group.scale.setScalar(scale);
  group.rotation.y = variant * Math.PI * 2;
  return group;
}

/** Saguaro-style desert cactus for the dunes biome — no good CC0 GLTF asset
 *  was found, so this stays procedural like the other low-poly flora. */
export function buildCactus(variant: number): THREE.Group {
  const group = new THREE.Group();
  const scale = 0.8 + variant * 0.5;
  const green = 0x4a7a4f;
  const trunkH = 2.1 + variant * 0.8;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, trunkH, 8), lambert(green));
  trunk.position.y = trunkH / 2;
  trunk.castShadow = true;
  group.add(trunk);

  const armCount = variant < 0.35 ? 0 : variant < 0.75 ? 1 : 2;
  for (let i = 0; i < armCount; i++) {
    const side = i === 0 ? 1 : -1;
    const armY = trunkH * (0.45 + i * 0.2);
    const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.19, 1.0, 6), lambert(green));
    const elbow = new THREE.Group();
    elbow.position.set(0, armY, 0);
    elbow.rotation.z = side * 1.15;
    upper.position.y = 0.5;
    upper.castShadow = true;
    elbow.add(upper);
    const riser = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.17, 0.9, 6), lambert(green));
    riser.position.y = 1.0;
    riser.rotation.z = -side * 1.15;
    riser.castShadow = true;
    upper.add(riser);
    group.add(elbow);
  }

  group.scale.setScalar(scale);
  group.rotation.y = variant * Math.PI * 2;
  return group;
}

/**
 * Per-biome tree selection: prefers a real imported GLTF model (with a bit
 * of the procedural roster mixed in for density/perf and variety), falling
 * back to a procedural builder while the GLTF template is still loading.
 */
export function buildBiomeTree(biome: Biome, variant: number): THREE.Group {
  switch (biome) {
    case "forest":
      if (variant < 0.2) return buildGltfTree("oak_1", variant) ?? buildOak(variant);
      if (variant < 0.4) return buildGltfTree("oak_2", variant) ?? buildOak(variant);
      if (variant < 0.6) return buildGltfTree("oak_3", variant) ?? buildOak(variant);
      if (variant < 0.8) return buildGltfTree("oak_4", variant) ?? buildTree(variant);
      return buildGltfTree("oak_5", variant) ?? buildTree(variant);
    case "hills":
      if (variant < 0.35) return buildGltfTree("oak_3", variant) ?? buildTree(variant);
      if (variant < 0.7) return buildGltfTree("oak_5", variant) ?? buildTree(variant);
      return buildGltfTree("pine_5", variant) ?? buildTree(variant);
    case "mountain":
      if (variant < 0.35) return buildGltfTree("pine_1", variant) ?? buildDeadTree(variant);
      if (variant < 0.55) return buildGltfTree("pine_2", variant) ?? buildDeadTree(variant);
      if (variant < 0.75) return buildGltfTree("pine_3", variant) ?? buildTree(variant);
      if (variant < 0.9) return buildGltfTree("pine_4", variant) ?? buildTree(variant);
      return buildDeadTree(variant);
    case "swamp":
      if (variant < 0.3) return buildGltfTree("twisted_1", variant) ?? buildDeadTree(variant);
      if (variant < 0.55) return buildGltfTree("twisted_2", variant) ?? buildDeadTree(variant);
      if (variant < 0.75) return buildGltfTree("twisted_3", variant) ?? buildDeadTree(variant);
      if (variant < 0.9) return buildGltfTree("dead_1", variant) ?? buildDeadTree(variant);
      return buildGltfTree("dead_2", variant) ?? buildDeadTree(variant);
    case "dunes":
      return buildCactus(variant);
    case "meadow":
    default:
      if (variant < 0.3) return buildGltfTree("oak_1", variant) ?? buildOak(variant);
      if (variant < 0.6) return buildGltfTree("oak_4", variant) ?? buildOak(variant);
      return buildOak(variant);
  }
}

/** Small glowing octahedron, tinted per-use -- the shrine's crystal and the
 *  ice-theme dungeon decoration both reuse this same shape. */
export function buildCrystal(color = 0x9fd8ff, radius = 0.45): THREE.Mesh {
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(radius, 0), new THREE.MeshBasicMaterial({ color }));
  crystal.name = "crystal";
  return crystal;
}

export function buildShrine(): THREE.Group {
  const group = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const stone = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.4 + (i % 2) * 0.5, 0.7), lambert(0x8d94a3));
    stone.position.set(Math.sin(a) * 2.4, 1.1, Math.cos(a) * 2.4);
    stone.rotation.y = a;
    stone.rotation.z = 0.05;
    stone.castShadow = true;
    group.add(stone);
  }
  const crystal = buildCrystal();
  crystal.position.y = 1.1;
  group.add(crystal);
  const light = new THREE.PointLight(0x9fd8ff, 10, 14, 1.6);
  light.position.y = 2;
  group.add(light);
  return group;
}

/** Wall-mounted torch: a stone bracket, an emissive flame, and a small
 *  PointLight -- lighter-weight than buildCampfire since dungeon interiors
 *  need several of these around the wall ring. */
export function buildTorch(color = 0xff9a3e): THREE.Group {
  const group = new THREE.Group();
  const bracket = box(0.14, 0.5, 0.14, 0x4a4640);
  bracket.position.y = 0.25;
  group.add(bracket);
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.36, 6), new THREE.MeshBasicMaterial({ color }));
  flame.name = "flame";
  flame.position.y = 0.62;
  group.add(flame);
  const light = new THREE.PointLight(color, 6, 16, 1.8);
  light.position.y = 0.7;
  group.add(light);
  return group;
}

/** Simple tapered stone column for dungeon interiors. */
export function buildPillar(height: number, color = 0x8a867e): THREE.Mesh {
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.75, height, 8), lambert(color));
  pillar.position.y = height / 2;
  pillar.castShadow = true;
  return pillar;
}

export function buildStump(variant: number): THREE.Group {
  const group = new THREE.Group();
  const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.4, 0.5, 7), lambert(0x7a5533));
  stump.position.y = 0.25;
  stump.castShadow = true;
  group.add(stump);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.03, 7), lambert(0xc9b088));
  top.position.y = 0.51;
  group.add(top);
  group.rotation.y = variant * Math.PI * 2;
  return group;
}

export function buildRock(variant: number, tint = 0x8a867e): THREE.Group {
  const group = new THREE.Group();
  const geo = new THREE.DodecahedronGeometry(0.9 + variant * 0.5, 0);
  const rock = new THREE.Mesh(geo, lambert(tint));
  rock.position.y = 0.55;
  rock.scale.y = 0.72;
  rock.castShadow = true;
  group.add(rock);
  const small = new THREE.Mesh(
    new THREE.DodecahedronGeometry(0.4, 0),
    lambert(new THREE.Color(tint).multiplyScalar(0.82).getHex()),
  );
  small.position.set(0.8, 0.22, 0.3 - variant * 0.6);
  small.castShadow = true;
  group.add(small);
  group.rotation.y = variant * Math.PI * 2;
  return group;
}

/** An ore vein: buildRock tinted per ore type, with a small glowing crystal
 *  accent for the precious tiers (mithril/thorium). */
export function buildOreRock(variant: number, tint: number, glow?: number): THREE.Group {
  const group = buildRock(variant, tint);
  if (glow !== undefined) {
    const crystal = buildCrystal(glow, 0.22);
    crystal.position.set(-0.3, 0.95, 0.2);
    group.add(crystal);
    const light = new THREE.PointLight(glow, 3, 6, 2);
    light.position.set(-0.3, 1.1, 0.2);
    group.add(light);
  }
  return group;
}

export function buildBerryBush(variant: number): THREE.Group {
  const group = new THREE.Group();
  const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(0.75, 0), lambert(0x3e6e35));
  bush.position.y = 0.55;
  bush.scale.y = 0.8;
  bush.castShadow = true;
  group.add(bush);
  for (let i = 0; i < 6; i++) {
    const berry = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), lambert(0xc23b4e));
    const a = (i / 6) * Math.PI * 2 + variant * 3;
    berry.position.set(Math.sin(a) * 0.55, 0.5 + (i % 3) * 0.18, Math.cos(a) * 0.55);
    group.add(berry);
  }
  group.rotation.y = variant * Math.PI * 2;
  return group;
}

export function buildCampfire(): THREE.Group {
  const group = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(0.14, 0), lambert(0x8a867e));
    const a = (i / 5) * Math.PI * 2;
    stone.position.set(Math.sin(a) * 0.45, 0.08, Math.cos(a) * 0.45);
    group.add(stone);
  }
  const log1 = box(0.12, 0.12, 0.6, 0x5c3d24);
  log1.position.y = 0.1;
  log1.rotation.y = 0.6;
  group.add(log1);
  const log2 = log1.clone();
  log2.rotation.y = -0.8;
  group.add(log2);
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.22, 0.55, 6),
    new THREE.MeshBasicMaterial({ color: 0xff8c2e }),
  );
  flame.name = "flame";
  flame.position.y = 0.42;
  group.add(flame);
  const light = new THREE.PointLight(0xff9a3e, 8, 12, 1.6);
  light.position.y = 0.8;
  group.add(light);
  return group;
}

export interface MountParts {
  group: THREE.Group;
  /** Height (m) the rider sits above the mount's origin. */
  riderY: number;
  legs?: THREE.Object3D[];
}

export function buildHorse(): MountParts {
  const group = new THREE.Group();
  const coat = 0x6e4a2f;
  const mane = 0x3a271a;

  const body = box(0.7, 0.8, 1.7, coat);
  body.position.y = 1.15;
  group.add(body);

  const neck = box(0.4, 0.7, 0.4, coat);
  neck.position.set(0, 1.55, 0.85);
  neck.rotation.x = -0.5;
  group.add(neck);
  const head = box(0.34, 0.4, 0.7, coat);
  head.position.set(0, 1.85, 1.15);
  head.rotation.x = 0.3;
  group.add(head);
  const maneMesh = box(0.14, 0.6, 0.5, mane);
  maneMesh.position.set(0, 1.7, 0.7);
  maneMesh.rotation.x = -0.5;
  group.add(maneMesh);

  const tail = box(0.14, 0.7, 0.14, mane);
  tail.position.set(0, 1.2, -0.9);
  tail.rotation.x = 0.6;
  group.add(tail);

  const legs: THREE.Object3D[] = [];
  for (const [sx, sz] of [
    [-0.24, 0.6],
    [0.24, 0.6],
    [-0.24, -0.6],
    [0.24, -0.6],
  ] as const) {
    const pivot = new THREE.Group();
    const leg = box(0.18, 1.1, 0.18, 0x4a3220);
    leg.position.y = -0.55;
    pivot.add(leg);
    pivot.position.set(sx, 1.0, sz);
    group.add(pivot);
    legs.push(pivot);
  }
  // Simple leather saddle.
  const saddle = box(0.55, 0.16, 0.7, 0x3a2416);
  saddle.position.y = 1.6;
  group.add(saddle);

  return { group, riderY: 1.7, legs };
}

export function buildRaft(): MountParts {
  const group = new THREE.Group();
  const wood = 0x8a6a3f;
  for (let i = 0; i < 5; i++) {
    const plank = box(0.34, 0.16, 2.2, i % 2 ? wood : 0x7a5a34);
    plank.position.set(-0.7 + i * 0.35, 0.1, 0);
    group.add(plank);
  }
  // Cross beams.
  for (const z of [-0.85, 0.85]) {
    const beam = box(2.0, 0.14, 0.24, 0x5c4326);
    beam.position.set(0, 0.22, z);
    group.add(beam);
  }
  // A steering pole.
  const pole = box(0.08, 1.6, 0.08, 0x5c4326);
  pole.position.set(0.7, 0.9, -0.6);
  pole.rotation.z = 0.3;
  group.add(pole);
  return { group, riderY: 0.4 };
}

/** Canvas-based floating nameplate sprite. */
export function buildNameplate(name: string, color = "#ffffff"): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  // Cinzel matches the display font used for the player's own name in the
  // top-left vitals frame (see theme.css's --rc-display) for consistency.
  ctx.font = "700 24px Cinzel, Georgia, serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0,0,0,0.9)";
  ctx.shadowBlur = 6;
  ctx.fillStyle = color;
  ctx.fillText(name, 128, 32);
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }),
  );
  sprite.scale.set(1.85, 0.46, 1);
  return sprite;
}

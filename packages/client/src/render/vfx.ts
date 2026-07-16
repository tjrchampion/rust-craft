import * as THREE from "three";
import type { DamageType } from "@rustcraft/shared";
import { spellDef } from "@rustcraft/shared";

/** Which visual "school" a spell belongs to -- one more than DamageType to
 *  cover heals and pure buff/utility spells that have no damage effect. */
export type School = DamageType | "heal" | "buff";

export function spellSchool(spellId: string): School {
  const effects = spellDef(spellId).effects;
  const damageType = effects.find((e) => e.type === "damage")?.damageType;
  if (damageType) return damageType;
  if (effects.some((e) => e.type === "heal")) return "heal";
  return "buff";
}

type Spread = "radial" | "rising" | "falling" | "hover" | "implode";
type ParticleGeo = "orb" | "shard" | "leaf" | "torus";

export interface SchoolProfile {
  color: number;
  geo: ParticleGeo;
  spread: Spread;
  count: number;
  gravity: number; // units/s^2, negative drifts upward
  drag: number; // fraction of velocity lost per second (0 = none)
  spin: number; // rad/s tumble, shard/leaf only
  particleSize: number;
  lifeMs: number;
  ringColor: number;
  ringDuration: number;
}

const DEFAULT_PROFILE: SchoolProfile = {
  color: 0xffb347,
  geo: "orb",
  spread: "radial",
  count: 14,
  gravity: 4,
  drag: 0,
  spin: 0,
  particleSize: 0.07,
  lifeMs: 420,
  ringColor: 0xffb347,
  ringDuration: 500,
};

/** One signature look per magic school -- shape, motion, and color are all
 *  distinct so a Fire burst never reads like a Frost or Arcane one, even
 *  before you notice the damage number's color. */
export const SCHOOL_VFX: Record<School, SchoolProfile> = {
  fire: {
    color: 0xff6a2b,
    geo: "orb",
    spread: "rising",
    count: 20,
    gravity: -2.6, // embers drift upward
    drag: 0.6,
    spin: 0,
    particleSize: 0.075,
    lifeMs: 520,
    ringColor: 0xff6a2b,
    ringDuration: 450,
  },
  frost: {
    color: 0x6fd0ff,
    geo: "shard",
    spread: "falling",
    count: 10,
    gravity: 7.5, // shards shatter and drop fast
    drag: 0.2,
    spin: 6,
    particleSize: 0.11,
    lifeMs: 520,
    ringColor: 0x6fd0ff,
    ringDuration: 650,
  },
  arcane: {
    color: 0xd48fff,
    geo: "orb",
    spread: "hover",
    count: 22,
    gravity: 0,
    drag: 2.2, // glitters hang and spin rather than arcing away
    spin: 10,
    particleSize: 0.06,
    lifeMs: 560,
    ringColor: 0xd48fff,
    ringDuration: 500,
  },
  shadow: {
    color: 0x8a4fd6,
    geo: "orb",
    spread: "implode",
    count: 16,
    gravity: 0,
    drag: 3.2,
    spin: 0,
    particleSize: 0.09,
    lifeMs: 480,
    ringColor: 0x3a1f52,
    ringDuration: 550,
  },
  nature: {
    color: 0x7be07b,
    geo: "leaf",
    spread: "falling",
    count: 14,
    gravity: 2.4,
    drag: 0.5,
    spin: 4.5,
    particleSize: 0.1,
    lifeMs: 600,
    ringColor: 0x7be07b,
    ringDuration: 500,
  },
  holy: {
    color: 0xffe9a8,
    geo: "orb",
    spread: "rising",
    count: 20,
    gravity: -3.5,
    drag: 0.3,
    spin: 0,
    particleSize: 0.07,
    lifeMs: 620,
    ringColor: 0xffe9a8,
    ringDuration: 600,
  },
  physical: {
    color: 0xd8d8d8,
    geo: "orb",
    spread: "radial",
    count: 10,
    gravity: 9,
    drag: 0.1,
    spin: 0,
    particleSize: 0.06,
    lifeMs: 300,
    ringColor: 0xd8d8d8,
    ringDuration: 350,
  },
  heal: {
    color: 0x7be07b,
    geo: "orb",
    spread: "rising",
    count: 16,
    gravity: -2.8,
    drag: 0.4,
    spin: 0,
    particleSize: 0.07,
    lifeMs: 560,
    ringColor: 0x7be07b,
    ringDuration: 500,
  },
  buff: DEFAULT_PROFILE,
};

export function schoolProfile(school: School): SchoolProfile {
  return SCHOOL_VFX[school] ?? DEFAULT_PROFILE;
}

const geoCache = new Map<ParticleGeo, THREE.BufferGeometry>();
const glowMaterialCache = new Map<number, THREE.MeshBasicMaterial>();
function particleGeometry(shape: ParticleGeo): THREE.BufferGeometry {
  let geo = geoCache.get(shape);
  if (!geo) {
    geo =
      shape === "shard"
        ? new THREE.OctahedronGeometry(1, 0)
        : shape === "leaf"
          ? new THREE.PlaneGeometry(1, 1.5)
          : shape === "torus"
            ? new THREE.TorusGeometry(1, 0.3, 6, 12)
            : new THREE.SphereGeometry(1, 6, 5);
    geoCache.set(shape, geo);
  }
  return geo;
}

function buildGlowMaterial(color: number): THREE.MeshBasicMaterial {
  const cached = glowMaterialCache.get(color);
  if (cached) return cached.clone();
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  glowMaterialCache.set(color, material);
  return material.clone();
}

/** A single glowing particle mesh sized for `profile`, ready to be positioned
 *  and animated by the caller (EntityManager owns the scene + animation
 *  loop; this module only builds materials/geometry). */
export function buildSchoolParticle(profile: SchoolProfile): THREE.Mesh {
  const geo = particleGeometry(profile.geo);
  const mesh = new THREE.Mesh(geo, buildGlowMaterial(profile.color));
  mesh.scale.setScalar(profile.particleSize);
  return mesh;
}

/** School-flavored projectile core: shape + glow vary (Frost = tumbling
 *  shard, Arcane = spinning ring/sigil, others = a glowing orb) so bolts in
 *  flight already read as their school before they land. */
export function buildSchoolProjectile(school: School): THREE.Group {
  const profile = schoolProfile(school);
  const group = new THREE.Group();
  const geo =
    school === "frost"
      ? new THREE.OctahedronGeometry(0.22, 0)
      : school === "arcane"
        ? new THREE.TorusGeometry(0.18, 0.06, 6, 14)
        : new THREE.SphereGeometry(0.18, 8, 6);
  const core = new THREE.Mesh(geo, buildGlowMaterial(profile.color));
  group.add(core);
  const light = new THREE.PointLight(profile.color, 6, 8, 1.8);
  group.add(light);
  group.userData.spinSpeed = school === "arcane" ? 6 : school === "frost" ? 3 : 0;
  return group;
}

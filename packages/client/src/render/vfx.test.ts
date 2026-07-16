import { describe, expect, it, vi, beforeEach } from "vitest";
import * as THREE from "three";
import { EntityManager } from "./entities";
import { buildSchoolParticle, schoolProfile, type School, buildSchoolProjectile, recycleSchoolProjectile, projectilePools } from "./vfx";

vi.mock("three/examples/jsm/loaders/GLTFLoader.js", () => {
  return {
    GLTFLoader: class {
      load() {}
      setMeshoptDecoder() {}
    }
  };
});
vi.mock("three/examples/jsm/libs/meshopt_decoder.module.js", () => ({
  MeshoptDecoder: {}
}));
vi.mock("three/examples/jsm/Addons.js", () => ({
  SkeletonUtils: {
    clone: (obj: any) => obj.clone()
  }
}));

describe("spell VFX", () => {
  beforeEach(() => {
    projectilePools.clear();
  });

  it("builds particles with lightweight basic materials", () => {
    const mesh = buildSchoolParticle(schoolProfile("fire"));
    expect(mesh.material).toBeInstanceOf(THREE.MeshBasicMaterial);
  });

  it("prewarms reusable projectile groups for spell bursts", () => {
    const scene = new THREE.Scene();
    const manager = new EntityManager(scene);
    manager.prewarmVfx();
    expect(projectilePools.get("fire")?.length).toBeGreaterThan(0);
  });

  it("does not allocate a fresh group during first cast of firebolt", () => {
    const scene = new THREE.Scene();
    const manager = new EntityManager(scene);
    manager.prewarmVfx();

    const initialLen = projectilePools.get("fire")?.length ?? 0;
    expect(initialLen).toBe(2);

    manager.applyProjectiles([{ id: "proj-1", spellId: "firebolt", x: 0, y: 0, z: 0 }]);
    
    const postLen = projectilePools.get("fire")?.length ?? 0;
    expect(postLen).toBe(1);
  });

  it("reuses the same group reference when recycled", () => {
    const group1 = buildSchoolProjectile("fire");
    recycleSchoolProjectile("fire", group1);

    const group2 = buildSchoolProjectile("fire");
    expect(group2).toBe(group1);
  });

  it("prewarms and reuses damage number sprites from the pool", () => {
    const scene = new THREE.Scene();
    const manager = new EntityManager(scene);
    manager.prewarmVfx();

    const pool = (manager as unknown as { damageNumberPool: THREE.Sprite[] }).damageNumberPool;
    expect(pool.length).toBe(6);

    manager.spawnDamageNumber(0, 0, 0, 15);
    
    expect(pool.length).toBe(5);
  });
});

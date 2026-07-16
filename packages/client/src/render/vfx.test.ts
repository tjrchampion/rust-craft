import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildSchoolParticle, schoolProfile } from "./vfx";

describe("spell VFX", () => {
  it("builds particles with lightweight basic materials", () => {
    const mesh = buildSchoolParticle(schoolProfile("fire"));
    expect(mesh.material).toBeInstanceOf(THREE.MeshBasicMaterial);
  });
});

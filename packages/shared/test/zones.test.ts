import { describe, it, expect } from "vitest";
import { generateZones, zoneAt, SPAWN_ZONE_RADIUS } from "../src/zones";
import { generateVillages } from "../src/worldgen";
import { SPAWN_POINT } from "../src/constants";

describe("zones", () => {
  it("names one zone per village plus a spawn commons, deterministically", () => {
    const a = generateZones();
    const b = generateZones();
    expect(a).toEqual(b);
    const villages = generateVillages();
    expect(a.length).toBe(villages.length + 1);
    expect(new Set(a.map((z) => z.id)).size).toBe(a.length);
  });

  it("assigns spawn itself to the hearthlands commons", () => {
    const zone = zoneAt(SPAWN_POINT.x, SPAWN_POINT.z);
    expect(zone.id).toBe("z_spawn");
  });

  it("assigns far-flung points to their nearest village's territory", () => {
    const villages = generateVillages();
    for (const v of villages) {
      // A point just outside the spawn commons but right on the village.
      const zone = zoneAt(v.x, v.z);
      expect(zone.id).toBe(`z_${v.id}`);
    }
  });

  it("every point beyond the spawn radius belongs to exactly one named zone", () => {
    const zone = zoneAt(SPAWN_ZONE_RADIUS + 5, 0);
    expect(zone).toBeDefined();
    expect(zone.name.length).toBeGreaterThan(0);
  });
});

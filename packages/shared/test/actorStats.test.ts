import { describe, it, expect } from "vitest";
import { computeActorStats, armorMitigation, type BaseStats } from "../src/sim/actorStats";
import { CLASSES, CLASS_IDS } from "../src/content/classes";

const base: BaseStats = { power: 10, armor: 5, agility: 5, vitality: 5 };

describe("computeActorStats", () => {
  it("grows with level even with no gear or auras", () => {
    const lvl1 = computeActorStats(base, 1, [], []);
    const lvl10 = computeActorStats(base, 10, [], []);
    expect(lvl10.power).toBeGreaterThan(lvl1.power);
    expect(lvl10.maxHp).toBeGreaterThan(lvl1.maxHp);
    expect(lvl10.armor).toBeGreaterThan(lvl1.armor);
  });

  it("never persists -- gear/aura modifiers are additive and fully recomputed", () => {
    const noGear = computeActorStats(base, 5, [], []);
    const withGear = computeActorStats(base, 5, [{ power: 4, armor: 2 }], []);
    expect(withGear.power).toBeCloseTo(noGear.power + 4);
    expect(withGear.armor).toBeCloseTo(noGear.armor + 2);
    // Removing the gear (calling again with no mods) must return to the original value.
    const removed = computeActorStats(base, 5, [], []);
    expect(removed.power).toBeCloseTo(noGear.power);
  });

  it("combines gear and aura modifiers together", () => {
    const stats = computeActorStats(base, 1, [{ power: 2 }], [{ power: 3, moveSpeedMult: -0.2 }]);
    expect(stats.power).toBeCloseTo(base.power + 2 + 3);
    expect(stats.moveSpeedMult).toBeCloseTo(0.8);
  });

  it("clamps crit chance to a sane range", () => {
    const stats = computeActorStats(base, 1, [], [{ critChance: 5 }]);
    expect(stats.critChance).toBeLessThanOrEqual(0.75);
  });

  it("every class template has distinct, sane base stats", () => {
    expect(CLASS_IDS.length).toBe(5);
    for (const id of CLASS_IDS) {
      const stats = CLASSES[id].baseStats;
      expect(stats.power).toBeGreaterThan(0);
      expect(stats.armor).toBeGreaterThanOrEqual(0);
      expect(CLASSES[id].startingSpells.length).toBeGreaterThan(0);
      expect(CLASSES[id].startingGear.length).toBeGreaterThan(0);
    }
  });
});

describe("armorMitigation", () => {
  it("100 armor halves damage (classic diminishing-returns curve)", () => {
    expect(armorMitigation(100)).toBeCloseTo(0.5);
  });

  it("0 armor mitigates nothing", () => {
    expect(armorMitigation(0)).toBeCloseTo(1);
  });

  it("never amplifies damage for negative armor", () => {
    expect(armorMitigation(-50)).toBeLessThanOrEqual(1);
  });
});

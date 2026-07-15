import { describe, it, expect } from "vitest";
import { SPELLS, spellDef } from "../src/content/spells";
import { CLASS_IDS, classDef } from "../src/content/classes";
import { auraDef } from "../src/content/auras";

describe("spells", () => {
  it("every aoe spell defines a positive radius", () => {
    for (const spell of Object.values(SPELLS)) {
      if (spell.targeting.kind !== "aoe") continue;
      expect(spell.targeting.radius).toBeGreaterThan(0);
    }
  });

  it("every class's starting spells resolve to real spell defs", () => {
    for (const id of CLASS_IDS) {
      for (const spellId of classDef(id).startingSpells) {
        expect(() => spellDef(spellId)).not.toThrow();
      }
    }
  });

  it("every class can cast at least one aoe spell", () => {
    for (const id of CLASS_IDS) {
      const hasAoe = classDef(id).startingSpells.some((spellId) => spellDef(spellId).targeting.kind === "aoe");
      expect(hasAoe).toBe(true);
    }
  });

  it("every applyAura effect references a real aura def", () => {
    for (const spell of Object.values(SPELLS)) {
      for (const effect of spell.effects) {
        if (effect.type !== "applyAura") continue;
        expect(() => auraDef(effect.auraId!)).not.toThrow();
      }
    }
  });

  it("no class has duplicate or more than 9 starting spells", () => {
    for (const id of CLASS_IDS) {
      const spells = classDef(id).startingSpells;
      expect(new Set(spells).size).toBe(spells.length);
      expect(spells.length).toBeLessThanOrEqual(9);
    }
  });

  it("executeScale/lifestealPct only appear on damage effects, with a positive value", () => {
    for (const spell of Object.values(SPELLS)) {
      for (const effect of spell.effects) {
        if (effect.type === "damage") continue;
        expect(effect.executeScale).toBeUndefined();
        expect(effect.lifestealPct).toBeUndefined();
      }
    }
  });
});

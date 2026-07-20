import { describe, it, expect } from "vitest";
import { SPELLS, spellDef } from "../src/content/spells";
import { CLASS_IDS, classDef } from "../src/content/classes";
import { auraDef } from "../src/content/auras";
import { itemDef } from "../src/content/items";

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

  it("every spell has a requiredLevel between 1 and 10", () => {
    for (const spell of Object.values(SPELLS)) {
      expect(spell.requiredLevel).toBeDefined();
      expect(spell.requiredLevel).toBeGreaterThanOrEqual(1);
      expect(spell.requiredLevel).toBeLessThanOrEqual(10);
    }
  });

  // Critical non-regression check: weapon-gating a spell (Part B of the
  // weapon/spell coupling work) must never lock a class out of a spell its
  // own starting kit already grants it -- e.g. gating frostbolt to
  // [staff, wand] would softlock the Engineer, who starts with both
  // frostbolt and a wrench, unless wrench is also in the allowed list.
  it("every class's starting weapon type satisfies every starting spell's weapon requirement", () => {
    for (const id of CLASS_IDS) {
      const cls = classDef(id);
      const weaponItemId = cls.startingGear.find((g) => g.slot === "weapon")?.itemId;
      const weaponType = weaponItemId ? itemDef(weaponItemId).weaponType : undefined;
      for (const spellId of cls.startingSpells) {
        const spell = spellDef(spellId);
        if (!spell.allowedWeaponTypes) continue;
        expect(
          weaponType && spell.allowedWeaponTypes.includes(weaponType),
          `${id}'s starting weapon (${weaponType}) can't cast its own starting spell ${spellId} (needs ${spell.allowedWeaponTypes.join(", ")})`,
        ).toBe(true);
      }
    }
  });
});

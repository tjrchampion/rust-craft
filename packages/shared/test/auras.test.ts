import { describe, it, expect } from "vitest";
import { applyAura, expireAuras, aggregateAuraModifiers, collectDueTicks } from "../src/sim/auras";
import { AURAS } from "../src/content/auras";

describe("aura engine", () => {
  it("applying an aura sets duration and expiry from its definition", () => {
    const now = 1000;
    const actives = applyAura([], "chilled", "caster1", now);
    expect(actives).toHaveLength(1);
    expect(actives[0]!.expiresAt).toBe(now + AURAS.chilled!.durationS * 1000);
  });

  it("reapplying the same aura refreshes rather than stacking", () => {
    let actives = applyAura([], "bleeding", "caster1", 0);
    actives = applyAura(actives, "bleeding", "caster1", 5000);
    expect(actives).toHaveLength(1);
    expect(actives[0]!.appliedAt).toBe(5000);
  });

  it("expireAuras drops anything past its expiresAt", () => {
    const actives = applyAura([], "chilled", "c1", 0);
    const stillActive = expireAuras(actives, 1000);
    const expired = expireAuras(actives, AURAS.chilled!.durationS * 1000 + 1);
    expect(stillActive).toHaveLength(1);
    expect(expired).toHaveLength(0);
  });

  it("aggregateAuraModifiers sums passive stat contributions", () => {
    const actives = applyAura([], "battle_fury", "c1", 0);
    const mods = aggregateAuraModifiers(actives);
    expect(mods[0]!.power).toBe(AURAS.battle_fury!.statModifiers!.power);
  });

  it("collectDueTicks only fires once the interval has elapsed, then advances", () => {
    const actives = applyAura([], "poisoned", "c1", 0);
    expect(collectDueTicks(actives, 500)).toHaveLength(0); // interval is 2s
    const due = collectDueTicks(actives, 2000);
    expect(due).toHaveLength(1);
    expect(due[0]!.tick.type).toBe("damage");
    // Immediately after, the next tick shouldn't be due again until another interval passes.
    expect(collectDueTicks(actives, 2001)).toHaveLength(0);
    expect(collectDueTicks(actives, 4000)).toHaveLength(1);
  });

  it("auras without a tick (pure buffs/debuffs) never produce due ticks", () => {
    const actives = applyAura([], "chilled", "c1", 0);
    expect(collectDueTicks(actives, 999999)).toHaveLength(0);
  });
});

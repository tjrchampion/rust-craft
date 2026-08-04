import { describe, it, expect } from "vitest";
import {
  GCD_BASE_S,
  GCD_MIN_S,
  SPELL_MISS_BASE,
  SPELL_MISS_FLOOR,
  SPELL_CRIT_MULT,
  MELEE_CRIT_MULT,
  applySecondaryStatDR,
  ratingConversionFactor,
  ratingToPercent,
  gcdDurationS,
  hasteTimeMult,
  spellHitChance,
  rollSpellHit,
  rollMeleeHit,
  isInSpellQueueWindow,
  shouldSwitchThreat,
  SPELL_QUEUE_WINDOW_MS,
} from "../src/sim/combat";

describe("ratingConversionFactor", () => {
  it("grows with level so early gear softens", () => {
    expect(ratingConversionFactor(1)).toBeLessThan(ratingConversionFactor(60));
    expect(ratingConversionFactor(0)).toBe(ratingConversionFactor(1));
    expect(ratingConversionFactor(99)).toBe(ratingConversionFactor(60));
  });
});

describe("applySecondaryStatDR", () => {
  it("is identity under the first soft-cap bracket", () => {
    expect(applySecondaryStatDR(0.2)).toBeCloseTo(0.2);
  });

  it("diminishes past 30%", () => {
    const raw = 0.5;
    const post = applySecondaryStatDR(raw);
    expect(post).toBeLessThan(raw);
    expect(post).toBeGreaterThan(0.3);
  });

  it("never returns negative", () => {
    expect(applySecondaryStatDR(-1)).toBe(0);
  });
});

describe("ratingToPercent", () => {
  it("converts rating through level factor + DR", () => {
    // 12 rating at L1 ≈ 1% before DR.
    const onePct = ratingToPercent(12, 1);
    expect(onePct).toBeCloseTo(0.01, 3);
    const hundred = ratingToPercent(100, 1);
    expect(hundred).toBeGreaterThan(onePct);
    expect(hundred).toBeLessThan(0.2);
  });

  it("treats zero rating as zero", () => {
    expect(ratingToPercent(0, 10)).toBe(0);
  });
});

describe("gcd / haste", () => {
  it("starts at the baseline with no haste", () => {
    expect(gcdDurationS(0)).toBeCloseTo(GCD_BASE_S);
  });

  it("shrinks with haste but never below the floor", () => {
    expect(gcdDurationS(0.5)).toBeCloseTo(GCD_BASE_S / 1.5);
    expect(gcdDurationS(10)).toBeCloseTo(GCD_MIN_S);
  });

  it("hasteTimeMult shortens casts", () => {
    expect(hasteTimeMult(0)).toBeCloseTo(1);
    expect(hasteTimeMult(1)).toBeCloseTo(0.5);
  });
});

describe("spellHitChance", () => {
  it("starts near 1 - miss base with no hit rating", () => {
    expect(spellHitChance(0)).toBeCloseTo(1 - SPELL_MISS_BASE);
  });

  it("never exceeds the miss floor ceiling", () => {
    expect(spellHitChance(1)).toBeCloseTo(1 - SPELL_MISS_FLOOR);
  });
});

describe("rollSpellHit", () => {
  it("misses when the first roll fails", () => {
    const seq = [0.99, 0];
    let i = 0;
    const result = rollSpellHit(0.5, 0.5, () => seq[i++]!);
    expect(result).toEqual({ outcome: "miss", mult: 0 });
  });

  it("crits on the second roll", () => {
    const seq = [0.1, 0.05];
    let i = 0;
    const result = rollSpellHit(0.95, 0.2, () => seq[i++]!);
    expect(result.outcome).toBe("crit");
    expect(result.mult).toBe(SPELL_CRIT_MULT);
  });

  it("hits when neither miss nor crit", () => {
    const seq = [0.1, 0.9];
    let i = 0;
    const result = rollSpellHit(0.95, 0.2, () => seq[i++]!);
    expect(result).toEqual({ outcome: "hit", mult: 1 });
  });
});

describe("rollMeleeHit", () => {
  it("can miss and dodge from the single-roll table", () => {
    expect(rollMeleeHit(0.2, () => 0.01).outcome).toBe("miss");
    expect(rollMeleeHit(0.2, () => 0.06).outcome).toBe("dodge");
  });

  it("crits inside the crit slice", () => {
    const result = rollMeleeHit(0.2, () => 0.11);
    expect(result.outcome).toBe("crit");
    expect(result.mult).toBe(MELEE_CRIT_MULT);
  });

  it("falls through to a normal hit", () => {
    expect(rollMeleeHit(0.1, () => 0.5)).toEqual({ outcome: "hit", mult: 1 });
  });
});

describe("isInSpellQueueWindow", () => {
  it("accepts presses near the ready time", () => {
    const ready = 1000;
    expect(isInSpellQueueWindow(ready, ready - SPELL_QUEUE_WINDOW_MS + 10)).toBe(true);
    expect(isInSpellQueueWindow(ready, ready - SPELL_QUEUE_WINDOW_MS - 50)).toBe(false);
  });
});

describe("shouldSwitchThreat", () => {
  it("always switches when there is no current target", () => {
    expect(shouldSwitchThreat(null, 0, "a", 1, false)).toBe(true);
  });

  it("requires the melee lock ratio to steal aggro", () => {
    expect(shouldSwitchThreat("tank", 100, "dps", 109, false)).toBe(false);
    expect(shouldSwitchThreat("tank", 100, "dps", 111, false)).toBe(true);
  });

  it("uses a higher lock for ranged", () => {
    expect(shouldSwitchThreat("tank", 100, "dps", 120, true)).toBe(false);
    expect(shouldSwitchThreat("tank", 100, "dps", 131, true)).toBe(true);
  });
});

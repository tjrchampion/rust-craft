export interface DungeonTierDef {
  /** 0-4, reuses the TIER_NAMES scale from content/quests.ts. */
  tier: number;
  minLevel: number;
  /** Weighted pick table for populating a layout's (tier-agnostic) mob spawn
   *  points at instance-creation time -- see generateDungeonLayout in
   *  worldgen.ts and GameServer's startDungeonInstance. */
  mobTable: { type: string; weight: number }[];
  /** Base XP for a full clear, split evenly across the party (not
   *  per-player, not per-kill -- see distributeDungeonRewards). */
  rewardXp: number;
  rewardItems: { itemId: string; min: number; max: number; chance?: number }[];
}

export const DUNGEON_TIERS: DungeonTierDef[] = [
  {
    // Greenlands -- a short walk from spawn, open to any fresh character.
    tier: 0,
    minLevel: 1,
    mobTable: [
      { type: "skeleton_minion", weight: 0.7 },
      { type: "goblin", weight: 0.3 },
    ],
    rewardXp: 150,
    rewardItems: [
      { itemId: "ancient_dust", min: 2, max: 4 },
      { itemId: "bandage", min: 1, max: 3, chance: 0.6 },
    ],
  },
  {
    // Ashenpeak -- reuses the region's own tier-3/4 roster, gated behind a
    // real level requirement so it can't be stumbled into early.
    tier: 3,
    minLevel: 10,
    mobTable: [
      { type: "yeti", weight: 0.24 },
      { type: "yetialt", weight: 0.2 },
      { type: "golem", weight: 0.22 },
      { type: "giant", weight: 0.18 },
      { type: "demon", weight: 0.12 },
      { type: "demonalt", weight: 0.04 },
    ],
    rewardXp: 600,
    rewardItems: [
      { itemId: "ancient_dust", min: 4, max: 8 },
      { itemId: "hide", min: 3, max: 6 },
      { itemId: "runic_healing_potion", min: 1, max: 2, chance: 0.7 },
    ],
  },
];

export function dungeonTierDef(tier: number): DungeonTierDef {
  const def = DUNGEON_TIERS.find((d) => d.tier === tier);
  if (!def) throw new Error(`Unknown dungeon tier: ${tier}`);
  return def;
}

/** Weighted pick from a DungeonTierDef.mobTable -- deliberately not seeded/
 *  deterministic (unlike the overworld's scatter, which must reproduce
 *  identically across client/server): dungeon mob composition is decided
 *  server-side at instance-creation time and can vary run to run. */
export function pickDungeonMob(mobTable: { type: string; weight: number }[]): string {
  const total = mobTable.reduce((sum, m) => sum + m.weight, 0);
  let roll = Math.random() * total;
  for (const m of mobTable) {
    roll -= m.weight;
    if (roll <= 0) return m.type;
  }
  return mobTable[mobTable.length - 1]!.type;
}

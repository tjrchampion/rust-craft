export type QuestObjectiveKind = "kill" | "gather";

export interface QuestDef {
  id: string;
  /** Which village's giver offers this (index into generateVillages()). */
  villageIndex: number;
  name: string;
  description: string;
  /** Difficulty tier 0 (trivial) .. 4 (elite). */
  tier: number;
  minLevel: number;
  objectiveKind: QuestObjectiveKind;
  /** Mob type id (kill) or item id (gather). */
  objectiveTarget: string;
  objectiveCount: number;
  rewardXp: number;
  rewardItems: { itemId: string; qty: number }[];
}

export const TIER_NAMES = ["Trivial", "Easy", "Medium", "Hard", "Elite"];

export const QUESTS: Record<string, QuestDef> = {
  q_v0_wolves: {
    id: "q_v0_wolves",
    villageIndex: 0,
    name: "Cull the Wolves",
    description: "Gray wolves have been harrying the flocks. Thin their numbers.",
    tier: 0,
    minLevel: 1,
    objectiveKind: "kill",
    objectiveTarget: "wolf",
    objectiveCount: 5,
    rewardXp: 40,
    rewardItems: [{ itemId: "bandage", qty: 2 }],
  },
  q_v0_wood: {
    id: "q_v0_wood",
    villageIndex: 0,
    name: "Timber for the Mill",
    description: "The mill's stores are low. Bring back cut wood.",
    tier: 0,
    minLevel: 1,
    objectiveKind: "gather",
    objectiveTarget: "wood",
    objectiveCount: 40,
    rewardXp: 30,
    rewardItems: [{ itemId: "stone", qty: 10 }],
  },
  q_v0_dire: {
    id: "q_v0_dire",
    villageIndex: 0,
    name: "The Bigger Threat",
    description: "Something larger than a wolf stalks the wilds. Bring proof of the kill.",
    tier: 2,
    minLevel: 3,
    objectiveKind: "kill",
    objectiveTarget: "dire_wolf",
    objectiveCount: 2,
    rewardXp: 120,
    rewardItems: [{ itemId: "hide", qty: 6 }],
  },

  q_v1_stone: {
    id: "q_v1_stone",
    villageIndex: 1,
    name: "Quarry Duty",
    description: "The blacksmith needs stone for the forge.",
    tier: 0,
    minLevel: 1,
    objectiveKind: "gather",
    objectiveTarget: "stone",
    objectiveCount: 40,
    rewardXp: 30,
    rewardItems: [{ itemId: "wood", qty: 15 }],
  },
  q_v1_skele: {
    id: "q_v1_skele",
    villageIndex: 1,
    name: "Bone Pile",
    description: "The ruins nearby stir with restless dead. Put them down.",
    tier: 1,
    minLevel: 2,
    objectiveKind: "kill",
    objectiveTarget: "skeleton_minion",
    objectiveCount: 6,
    rewardXp: 70,
    rewardItems: [{ itemId: "hide", qty: 5 }],
  },
  q_v1_warrior: {
    id: "q_v1_warrior",
    villageIndex: 1,
    name: "The Warlord's Bones",
    description: "An armored warrior commands the dead here. End its command.",
    tier: 3,
    minLevel: 5,
    objectiveKind: "kill",
    objectiveTarget: "skeleton_warrior",
    objectiveCount: 1,
    rewardXp: 150,
    rewardItems: [{ itemId: "tome_firebolt", qty: 1 }],
  },

  q_v2_berries: {
    id: "q_v2_berries",
    villageIndex: 2,
    name: "Forager's Request",
    description: "A cook here would love some fresh berries.",
    tier: 0,
    minLevel: 1,
    objectiveKind: "gather",
    objectiveTarget: "berries",
    objectiveCount: 30,
    rewardXp: 25,
    rewardItems: [{ itemId: "cooked_meat", qty: 3 }],
  },
  q_v2_dire: {
    id: "q_v2_dire",
    villageIndex: 2,
    name: "Highland Hunter",
    description: "Dire wolves have grown bold in the highlands. Drive them back.",
    tier: 2,
    minLevel: 4,
    objectiveKind: "kill",
    objectiveTarget: "dire_wolf",
    objectiveCount: 3,
    rewardXp: 110,
    rewardItems: [{ itemId: "hide", qty: 8 }],
  },
  q_v2_rogue: {
    id: "q_v2_rogue",
    villageIndex: 2,
    name: "Silent Stalkers",
    description: "Quick, quiet skeletal stalkers pick off travelers on the road. Hunt them.",
    tier: 3,
    minLevel: 5,
    objectiveKind: "kill",
    objectiveTarget: "skeleton_rogue",
    objectiveCount: 4,
    rewardXp: 140,
    rewardItems: [{ itemId: "hide", qty: 8 }],
  },

  q_v3_meat: {
    id: "q_v3_meat",
    villageIndex: 3,
    name: "Fresh Meat",
    description: "Bring raw meat back for the pot.",
    tier: 0,
    minLevel: 1,
    objectiveKind: "gather",
    objectiveTarget: "raw_meat",
    objectiveCount: 10,
    rewardXp: 25,
    rewardItems: [{ itemId: "bandage", qty: 2 }],
  },
  q_v3_wolfpack: {
    id: "q_v3_wolfpack",
    villageIndex: 3,
    name: "Wolf Pack",
    description: "An entire pack has moved in too close. Break it up.",
    tier: 1,
    minLevel: 2,
    objectiveKind: "kill",
    objectiveTarget: "wolf",
    objectiveCount: 10,
    rewardXp: 90,
    rewardItems: [{ itemId: "hide", qty: 5 }],
  },
  q_v3_elite: {
    id: "q_v3_elite",
    villageIndex: 3,
    name: "Ancient Guardian",
    description: "A second warrior-bound spirit refuses to rest. Finish what others could not.",
    tier: 4,
    minLevel: 6,
    objectiveKind: "kill",
    objectiveTarget: "skeleton_warrior",
    objectiveCount: 2,
    rewardXp: 200,
    rewardItems: [
      { itemId: "tome_firebolt", qty: 1 },
      { itemId: "ancient_dust", qty: 5 },
    ],
  },
};

export function questDef(id: string): QuestDef {
  const def = QUESTS[id];
  if (!def) throw new Error(`Unknown quest: ${id}`);
  return def;
}

export const QUEST_IDS = Object.keys(QUESTS);

export function questsForVillage(villageIndex: number): QuestDef[] {
  return QUEST_IDS.map(questDef).filter((q) => q.villageIndex === villageIndex);
}

/** How an achievement is unlocked. Progress counters live on the player. */
export type AchievementCriteria =
  | { kind: "quest_complete"; questId: string }
  | { kind: "quest_complete_any"; count: number }
  | { kind: "world_event"; /** Any world event, or a specific def id. */ eventId?: string; count: number }
  | { kind: "kill"; mobType: string; count: number }
  | { kind: "gather"; itemId: string; count: number }
  | { kind: "level"; level: number }
  | { kind: "dungeon_complete"; count: number };

export type AchievementCategory = "quests" | "combat" | "exploration" | "gathering" | "general";

export interface AchievementDef {
  id: string;
  name: string;
  description: string;
  /** Shown under the name — what the player must do. */
  requirement: string;
  category: AchievementCategory;
  criteria: AchievementCriteria;
  rewardXp: number;
  rewardItems: { itemId: string; qty: number }[];
}

export const ACHIEVEMENTS: Record<string, AchievementDef> = {
  ach_first_quest: {
    id: "ach_first_quest",
    name: "First Steps",
    description: "Complete your first quest for a village giver.",
    requirement: "Turn in any quest",
    category: "quests",
    criteria: { kind: "quest_complete_any", count: 1 },
    rewardXp: 25,
    rewardItems: [{ itemId: "bandage", qty: 3 }],
  },
  ach_wolves_culled: {
    id: "ach_wolves_culled",
    name: "Shepherd's Friend",
    description: "The flocks sleep easier with you around.",
    requirement: 'Complete "Cull the Wolves"',
    category: "quests",
    criteria: { kind: "quest_complete", questId: "q_v0_wolves" },
    rewardXp: 40,
    rewardItems: [{ itemId: "hide", qty: 4 }],
  },
  ach_quest_veteran: {
    id: "ach_quest_veteran",
    name: "Errand Runner",
    description: "You've made a habit of helping the realm.",
    requirement: "Complete 5 quests",
    category: "quests",
    criteria: { kind: "quest_complete_any", count: 5 },
    rewardXp: 120,
    rewardItems: [{ itemId: "minor_healing_potion", qty: 2 }],
  },
  ach_first_blood: {
    id: "ach_first_blood",
    name: "First Blood",
    description: "Draw steel and survive the encounter.",
    requirement: "Defeat 1 wolf",
    category: "combat",
    criteria: { kind: "kill", mobType: "wolf", count: 1 },
    rewardXp: 15,
    rewardItems: [{ itemId: "raw_meat", qty: 2 }],
  },
  ach_wolf_slayer: {
    id: "ach_wolf_slayer",
    name: "Wolf Slayer",
    description: "The pack has learned your scent — and fled.",
    requirement: "Defeat 25 wolves",
    category: "combat",
    criteria: { kind: "kill", mobType: "wolf", count: 25 },
    rewardXp: 100,
    rewardItems: [{ itemId: "hide", qty: 10 }],
  },
  ach_lumberjack: {
    id: "ach_lumberjack",
    name: "Lumberjack",
    description: "Axes swing, timber falls.",
    requirement: "Gather 100 wood",
    category: "gathering",
    criteria: { kind: "gather", itemId: "wood", count: 100 },
    rewardXp: 60,
    rewardItems: [{ itemId: "wood", qty: 20 }],
  },
  ach_stonecutter: {
    id: "ach_stonecutter",
    name: "Stonecutter",
    description: "The quarry remembers your hammer.",
    requirement: "Gather 100 stone",
    category: "gathering",
    criteria: { kind: "gather", itemId: "stone", count: 100 },
    rewardXp: 60,
    rewardItems: [{ itemId: "stone", qty: 20 }],
  },
  ach_level_5: {
    id: "ach_level_5",
    name: "Rising Adventurer",
    description: "You've left the greenest trails behind.",
    requirement: "Reach level 5",
    category: "general",
    criteria: { kind: "level", level: 5 },
    rewardXp: 80,
    rewardItems: [{ itemId: "minor_mana_potion", qty: 2 }],
  },
  ach_level_10: {
    id: "ach_level_10",
    name: "Seasoned Traveler",
    description: "Double digits. The road stretches on.",
    requirement: "Reach level 10",
    category: "general",
    criteria: { kind: "level", level: 10 },
    rewardXp: 200,
    rewardItems: [{ itemId: "runic_healing_potion", qty: 1 }],
  },
  ach_world_event: {
    id: "ach_world_event",
    name: "Call to Arms",
    description: "When the realm cried out, you answered.",
    requirement: "Complete 1 world event",
    category: "exploration",
    criteria: { kind: "world_event", count: 1 },
    rewardXp: 75,
    rewardItems: [{ itemId: "bandage", qty: 5 }],
  },
  ach_world_event_veteran: {
    id: "ach_world_event_veteran",
    name: "Event Veteran",
    description: "You've stood in more than one storm.",
    requirement: "Complete 5 world events",
    category: "exploration",
    criteria: { kind: "world_event", count: 5 },
    rewardXp: 180,
    rewardItems: [{ itemId: "minor_healing_potion", qty: 3 }],
  },
  ach_dungeon_delver: {
    id: "ach_dungeon_delver",
    name: "Dungeon Delver",
    description: "Torchlight and stone — and something waiting below.",
    requirement: "Complete 1 dungeon",
    category: "exploration",
    criteria: { kind: "dungeon_complete", count: 1 },
    rewardXp: 100,
    rewardItems: [{ itemId: "ancient_dust", qty: 2 }],
  },
};

export const ACHIEVEMENT_IDS = Object.keys(ACHIEVEMENTS);

export function achievementDef(id: string): AchievementDef {
  const def = ACHIEVEMENTS[id];
  if (!def) throw new Error(`Unknown achievement: ${id}`);
  return def;
}

/** Target progress value for UI bars (1 for boolean-style criteria). */
export function achievementTarget(def: AchievementDef): number {
  const c = def.criteria;
  switch (c.kind) {
    case "quest_complete":
    case "level":
      return 1;
    case "quest_complete_any":
    case "world_event":
    case "kill":
    case "gather":
    case "dungeon_complete":
      return c.count;
  }
}

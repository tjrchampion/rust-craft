export type NodeClass = "wood" | "stone" | "pick" | "ore";

export interface NodeTypeDef {
  id: string;
  name: string;
  /** Which gatherPower key applies ('pick' nodes need no tool, e.g. berries). */
  nodeClass: NodeClass;
  hits: number; // effective hits at gather power 1
  yieldItem: string;
  yieldPerHit: number; // at gather power 1, scales with tool power
  respawnS: number;
  /** Ore tiers only: minimum gatherPower.ore required to gather at all --
   *  unlike wood/stone, an under-tier pickaxe can't touch this node (not
   *  just gather it slowly). See handleGather in GameServer.ts. */
  minPower?: number;
  /** A small chance of an extra, rarer item alongside the normal yield
   *  (e.g. Silver Ore sometimes found in a Copper Vein). */
  bonusYield?: { itemId: string; chance: number };
}

export const NODE_TYPES: Record<string, NodeTypeDef> = {
  tree: {
    id: "tree",
    name: "Pine Tree",
    nodeClass: "wood",
    hits: 12,
    yieldItem: "wood",
    yieldPerHit: 2,
    respawnS: 180,
  },
  rock: {
    id: "rock",
    name: "Stone Outcrop",
    nodeClass: "stone",
    hits: 12,
    yieldItem: "stone",
    yieldPerHit: 2,
    respawnS: 240,
  },
  berry_bush: {
    id: "berry_bush",
    name: "Berry Bush",
    nodeClass: "pick",
    hits: 4,
    yieldItem: "berries",
    yieldPerHit: 3,
    respawnS: 120,
  },
  // Ore tiers -- mirrors the game's Trivial..Elite (0-4) tier scale. minPower
  // hard-gates the two higher tiers so a starter Pickaxe can mine everything
  // up through Iron but genuinely cannot touch Mithril/Thorium at all.
  copper_vein: {
    id: "copper_vein",
    name: "Copper Vein",
    nodeClass: "ore",
    hits: 10,
    yieldItem: "copper_ore",
    yieldPerHit: 2,
    respawnS: 200,
    minPower: 1,
    bonusYield: { itemId: "silver_ore", chance: 0.1 },
  },
  tin_vein: {
    id: "tin_vein",
    name: "Tin Vein",
    nodeClass: "ore",
    hits: 10,
    yieldItem: "tin_ore",
    yieldPerHit: 2,
    respawnS: 220,
    minPower: 1,
  },
  iron_deposit: {
    id: "iron_deposit",
    name: "Iron Deposit",
    nodeClass: "ore",
    hits: 14,
    yieldItem: "iron_ore",
    yieldPerHit: 2,
    respawnS: 260,
    minPower: 1,
    bonusYield: { itemId: "gold_ore", chance: 0.08 },
  },
  mithril_deposit: {
    id: "mithril_deposit",
    name: "Mithril Deposit",
    nodeClass: "ore",
    hits: 16,
    yieldItem: "mithril_ore",
    yieldPerHit: 2,
    respawnS: 320,
    minPower: 2,
  },
  thorium_vein: {
    id: "thorium_vein",
    name: "Thorium Vein",
    nodeClass: "ore",
    hits: 18,
    yieldItem: "thorium_ore",
    yieldPerHit: 2,
    respawnS: 400,
    minPower: 3,
  },
  dungeon_chest_common: {
    id: "dungeon_chest_common",
    name: "Treasure Chest",
    nodeClass: "pick",
    hits: 1,
    yieldItem: "ancient_dust",
    yieldPerHit: 3,
    respawnS: 9999999, // practically never respawn during instance
    bonusYield: { itemId: "bandage", chance: 0.5 },
  },
  dungeon_chest_rare: {
    id: "dungeon_chest_rare",
    name: "Ornate Chest",
    nodeClass: "pick",
    hits: 1,
    yieldItem: "ancient_dust",
    yieldPerHit: 8,
    respawnS: 9999999,
    bonusYield: { itemId: "runic_healing_potion", chance: 0.8 },
  },
};

export function nodeTypeDef(id: string): NodeTypeDef {
  const def = NODE_TYPES[id];
  if (!def) throw new Error(`Unknown node type: ${id}`);
  return def;
}

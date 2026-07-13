export type NodeClass = "wood" | "stone" | "pick";

export interface NodeTypeDef {
  id: string;
  name: string;
  /** Which gatherPower key applies ('pick' nodes need no tool, e.g. berries). */
  nodeClass: NodeClass;
  hits: number; // effective hits at gather power 1
  yieldItem: string;
  yieldPerHit: number; // at gather power 1, scales with tool power
  respawnS: number;
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
};

export function nodeTypeDef(id: string): NodeTypeDef {
  const def = NODE_TYPES[id];
  if (!def) throw new Error(`Unknown node type: ${id}`);
  return def;
}

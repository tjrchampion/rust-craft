import type { DungeonBlueprint } from "../worldgen";
import tier0 from "./dungeonBlueprints/0.json";
import tier3 from "./dungeonBlueprints/3.json";

/** Hand-authored dungeon interiors, keyed by DungeonTierDef.tier (see
 *  content/dungeons.ts). Add a new entry here (new JSON file + one import
 *  line) whenever a new dungeon tier is authored in the dungeon editor
 *  (packages/client/src/ui/DungeonEditor.svelte). A tier absent from this
 *  map, or present with zero assets (the placeholder state before it's
 *  been authored), falls back to generateDungeonLayout's procedural path --
 *  see hasDungeonBlueprint below. */
export const DUNGEON_BLUEPRINTS: Record<number, DungeonBlueprint> = {
  0: tier0 as DungeonBlueprint,
  3: tier3 as DungeonBlueprint,
};

export function hasDungeonBlueprint(tier: number): boolean {
  const bp = DUNGEON_BLUEPRINTS[tier];
  return !!bp && bp.assets.length > 0;
}

import { DUNGEON_MOB_MULT_PER_EXTRA_PLAYER } from "@rustcraft/shared";

/** A live dungeon run. Every concurrent instance of the same portal reuses
 *  the identical layout/coordinates (see generateDungeonLayout) -- what
 *  makes them separate "instances" is purely that every mob/player tagged
 *  with this id is invisible to anyone tagged with a different one (or
 *  none), enforced at every distance-based visibility/targeting site in
 *  GameServer (see its `sameInstance` helper). */
export interface DungeonInstance {
  id: string;
  portalId: string;
  tier: number;
  memberIds: Set<string>;
  mobIds: Set<string>;
  createdAt: number;
  lastActivityAt: number;
  cleared: boolean;
  /** Set when the last living member dies; null while someone's alive.
   *  A revive before DUNGEON_WIPE_EJECT_MS clears it back to null. */
  wipedAt: number | null;
}

/** +DUNGEON_MOB_MULT_PER_EXTRA_PLAYER per player beyond the first, applied
 *  to both a dungeon mob's spawn HP and its per-hit damage. */
export function computeMobMultiplier(partySize: number): number {
  return 1 + Math.max(0, partySize - 1) * DUNGEON_MOB_MULT_PER_EXTRA_PLAYER;
}

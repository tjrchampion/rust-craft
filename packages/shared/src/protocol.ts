import { z } from "zod";

// ============ Client -> Server (zod-validated on the server) ============

export const InputMsg = z.object({
  t: z.literal("input"),
  seq: z.number().int().nonnegative(),
  // Client sends camera-relative input already rotated into world space
  // (Game.stepLocal), so a single diagonal key combo (e.g. forward+strafe)
  // can legitimately land its full magnitude on ONE axis depending on
  // camera yaw -- these are not the raw per-axis [-1,1] key states. Bounded
  // generously above the worst case (keyboard + gamepad stick combined,
  // ~2.83) rather than clamped to 1, which silently dropped every diagonal
  // input at certain camera angles and froze the player mid-stride.
  moveX: z.number().min(-3).max(3),
  moveZ: z.number().min(-3).max(3),
  jump: z.boolean(),
  sprint: z.boolean(),
  block: z.boolean(),
  yaw: z.number(),
  /** Character id being revived while E is held over a dead player, or null.
   *  Re-sent every tick alongside movement -- releasing E (or the client's
   *  interact target changing) naturally stops it, which is what lets the
   *  server treat "stopped arriving" as "channel canceled" with no separate
   *  cancel message needed. */
  revivingId: z.string().max(64).nullable(),
});

export const InteractMsg = z.object({
  t: z.literal("interact"),
  nodeId: z.string().max(32),
});

export const DrinkMsg = z.object({ t: z.literal("drink") });

export const AttackMsg = z.object({ t: z.literal("attack") });

export const CastMsg = z.object({
  t: z.literal("cast"),
  spellId: z.string().max(32),
});

export const CraftMsg = z.object({
  t: z.literal("craft"),
  recipeId: z.string().max(32),
});

export const ConsumeMsg = z.object({
  t: z.literal("consume"),
  container: z.enum(["inventory", "hotbar", "equip", "crafting"]),
  slot: z.number().int().min(0).max(31),
});

export const MoveItemMsg = z.object({
  t: z.literal("moveItem"),
  fromContainer: z.enum(["inventory", "hotbar", "equip", "crafting"]),
  fromSlot: z.number().int().min(0).max(31),
  toContainer: z.enum(["inventory", "hotbar", "equip", "crafting"]),
  toSlot: z.number().int().min(0).max(31),
});

export const SelectSlotMsg = z.object({
  t: z.literal("selectSlot"),
  slot: z.number().int().min(0).max(9),
});

/** Puts a learned spell into a hotbar slot (or clears it with spellId: null).
 *  Rearranging a spell already in the hotbar reuses MoveItemMsg instead --
 *  this is only for pulling a *new* spell in from the spellbook. */
export const AssignSpellMsg = z.object({
  t: z.literal("assignSpell"),
  spellId: z.string().max(32).nullable(),
  slot: z.number().int().min(0).max(9),
});

export const PlaceMsg = z.object({
  t: z.literal("place"),
  container: z.enum(["inventory", "hotbar", "equip", "crafting"]),
  slot: z.number().int().min(0).max(31),
});

export const ChatMsg = z.object({
  t: z.literal("chat"),
  channel: z.enum(["realm", "party"]).default("realm"),
  text: z.string().min(1).max(240),
});

export const RespawnMsg = z.object({ t: z.literal("respawn") });

export const PvpMsg = z.object({
  t: z.literal("pvp"),
  enabled: z.boolean(),
});

export const PartyMsg = z.object({
  t: z.literal("party"),
  action: z.enum(["invite", "accept", "decline", "leave", "disband"]),
  /** Target character name for invite. */
  name: z.string().max(24).optional(),
});

export const MountMsg = z.object({ t: z.literal("mount") });

export const SitMsg = z.object({ t: z.literal("sit") });

export const QuestMsg = z.object({
  t: z.literal("quest"),
  action: z.enum(["accept", "decline", "turnin"]),
  questId: z.string().max(32),
});

export const ShareQuestMsg = z.object({
  t: z.literal("shareQuest"),
  questId: z.string().max(32),
});

/** A quick directional burst -- dirX/dirZ is a world-space direction (not
 *  necessarily unit length; the server normalizes it) computed the same way
 *  regular movement input already is, so it lines up with the same forward/
 *  right basis as everything else instead of needing its own convention. */
export const DodgeMsg = z
  .object({
    t: z.literal("dodge"),
    dirX: z.number().min(-1.5).max(1.5),
    dirZ: z.number().min(-1.5).max(1.5),
  })
  .strict();

export const SelectTargetMsg = z
  .object({
    t: z.literal("selectTarget"),
    targetId: z.string().max(64).nullable(),
  })
  .strict();

/** Activating a portal reuses InteractMsg (nodeId starting with
 *  "poi_dungeon") -- this message is only for a manual early exit. */
export const DungeonMsg = z
  .object({
    t: z.literal("dungeon"),
    action: z.literal("leave"),
  })
  .strict();

export const ClientMsg = z.discriminatedUnion("t", [
  InputMsg,
  InteractMsg,
  DrinkMsg,
  AttackMsg,
  CastMsg,
  CraftMsg,
  ConsumeMsg,
  MoveItemMsg,
  SelectSlotMsg,
  PlaceMsg,
  ChatMsg,
  RespawnMsg,
  PvpMsg,
  PartyMsg,
  MountMsg,
  QuestMsg,
  ShareQuestMsg,
  SitMsg,
  AssignSpellMsg,
  DodgeMsg,
  SelectTargetMsg,
  DungeonMsg,
]);
export type ClientMsg = z.infer<typeof ClientMsg>;

// ============ Server -> Client (plain types; server is trusted) ============

export type AnimState =
  | "idle"
  | "run"
  | "swim"
  | "attack"
  | "gather"
  | "cast"
  | "dead"
  | "block"
  | "sit"
  | "cheer"
  | "jump";

export interface PlayerSnap {
  id: string; // character id
  name: string;
  classId: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  hp: number;
  maxHp: number;
  anim: AnimState;
  pvp: boolean;
  mount: "horse" | "raft" | null;
  weaponId: string | null;
  /** Aura ids for currently-ticking damage-over-time effects only (not
   *  buffs/HoTs/silence) -- drives the floating debuff icon over their head. */
  debuffs: string[];
}

export interface PartyMemberSnap {
  id: string;
  name: string;
  level: number;
  hp: number;
  maxHp: number;
  online: boolean;
  leader: boolean;
  x?: number;
  z?: number;
}

/** One entry in the realm-wide online roster (Party tab's invite list) --
 *  deliberately lighter than PartyMemberSnap (no hp/maxHp) since it covers
 *  every connected player, not just party members currently in view. */
export interface RosterEntry {
  id: string;
  name: string;
  level: number;
  classId: string;
}

export interface MobSnap {
  id: string;
  type: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  hp: number;
  maxHp: number;
  anim: AnimState;
  /** Aura ids for currently-ticking damage-over-time effects only. */
  debuffs: string[];
}

export interface PetSnap {
  id: string;
  ownerId: string;
  /** mobDef key used for the pet's model/render (e.g. "wolf") -- pets reuse
   *  the same wild-mob visuals rather than needing their own asset. */
  type: string;
  name: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  hp: number;
  maxHp: number;
  anim: AnimState;
}

export interface StructureSnap {
  id: string;
  type: string;
  ownerId: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface ProjectileSnap {
  id: string;
  spellId: string;
  x: number;
  y: number;
  z: number;
}

export type QuestStatus = "locked" | "available" | "active" | "complete" | "turnedin";

export interface NpcSnap {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Marker to show above the NPC's head for this viewer specifically. */
  marker: "none" | "available" | "complete" | "active";
}

export interface QuestOfferInfo {
  id: string;
  name: string;
  description: string;
  tier: number;
  minLevel: number;
  objectiveKind: "kill" | "gather";
  objectiveTarget: string;
  objectiveCount: number;
  rewardXp: number;
  rewardItems: { itemId: string; qty: number }[];
  status: QuestStatus;
  progress: number;
}

export interface QuestLogEntry {
  id: string;
  name: string;
  tier: number;
  objectiveKind: "kill" | "gather";
  objectiveTarget: string;
  objectiveCount: number;
  progress: number;
  status: "active" | "complete";
}

export interface ItemSnap {
  container: "inventory" | "hotbar" | "equip" | "crafting";
  slot: number;
  itemId: string;
  qty: number;
  durability: number | null;
}

export interface SelfState {
  x: number;
  y: number;
  z: number;
  vy: number;
  grounded: boolean;
  hp: number;
  maxHp: number;
  mana: number;
  maxMana: number;
  hunger: number;
  thirst: number;
  xp: number;
  xpNext: number;
  level: number;
  dead: boolean;
  ackSeq: number;
  castingSpell: string | null;
  castEndsAt: number | null; // server time ms
  /** Someone is channeling a revive on you, or you're channeling one on
   *  someone else -- either way this is *your own* SelfState, so it always
   *  reflects a revive *you* are performing, mirroring castingSpell/
   *  castEndsAt's shape so the client can reuse the same countdown math. */
  revivingTargetId: string | null;
  revivingEndsAt: number | null; // server time ms
  mount: "horse" | "raft" | null;
  sitting: boolean;
  auras: { auraId: string; expiresAt: number }[];
  spellCooldowns: { spellId: string; readyAt: number }[];
  dodgeCharges: number;
  /** When the *next* charge refills (server time ms) -- null while already
   *  at DODGE_MAX_CHARGES, since there's nothing left to count down to. */
  dodgeNextChargeAt: number | null;
}

export type ServerMsg =
  | {
      t: "welcome";
      selfId: string;
      name: string;
      classId: string;
      self: SelfState;
      inventory: ItemSnap[];
      learnedSpells: string[];
      selectedSlot: number;
      depletedNodes: string[];
      structures: StructureSnap[];
      npcs: NpcSnap[];
      questLog: QuestLogEntry[];
      serverTime: number;
      dayLengthS: number;
      timeOfDay: number; // 0..1
    }
  | {
      t: "snapshot";
      tick: number;
      timeOfDay: number;
      players: PlayerSnap[];
      mobs: MobSnap[];
      pets: PetSnap[];
      projectiles: ProjectileSnap[];
      npcs: NpcSnap[];
      removedPlayers?: string[];
      removedMobs?: string[];
    }
  | { t: "self"; self: SelfState }
  | { t: "inventory"; items: ItemSnap[]; learnedSpells: string[]; selectedSlot: number }
  | { t: "nodeUpdate"; nodeId: string; depleted: boolean }
  | { t: "structureAdd"; structure: StructureSnap }
  | { t: "structureRemove"; id: string }
  | {
      t: "event";
      kind:
        | "damage" // amount dealt to target
        | "heal"
        | "gather" // itemId + qty gained
        | "xp"
        | "levelup"
        | "death"
        | "revive" // sourceId revived targetId
        | "dodge" // sourceId dodged in world-space direction dirX/dirZ
        | "castStart"
        | "spellHit"
        | "learnSpell"
        | "error";
      sourceId?: string;
      targetId?: string;
      itemId?: string;
      spellId?: string;
      amount?: number;
      message?: string;
      x?: number;
      y?: number;
      z?: number;
      dirX?: number;
      dirZ?: number;
    }
  | { t: "chat"; channel: "realm" | "party" | "system"; from: string; text: string }
  | {
      t: "party";
      /** Current party members (including self), or null when not in a party. */
      members: PartyMemberSnap[] | null;
      /** Pending invite, if any. */
      inviteFrom?: string;
    }
  | { t: "pvp"; enabled: boolean }
  | { t: "roster"; players: RosterEntry[] }
  | { t: "questOffer"; npcId: string; npcName: string; offers: QuestOfferInfo[] }
  | { t: "questLog"; quests: QuestLogEntry[] }
  | { t: "questComplete"; questId: string; questName: string; xp: number; items: { itemId: string; qty: number }[] }
  | {
      t: "dungeonState";
      inDungeon: boolean;
      tier: number | null;
      partySize: number;
      mobsRemaining: number | null;
    }
  | { t: "dungeonComplete"; tier: number; xp: number; items: { itemId: string; qty: number }[] }
  | { t: "error"; message: string };

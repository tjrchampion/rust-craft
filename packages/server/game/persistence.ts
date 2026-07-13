import { eq, inArray } from "drizzle-orm";
import { db, schema } from "../db/client";
import type { InvItem } from "./inventory";

export interface QuestProgressEntry {
  questId: string;
  status: "active" | "completed";
  progress: number;
}

export interface PersistedPlayer {
  id: string;
  accountId: string;
  name: string;
  classId: string;
  level: number;
  xp: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  hp: number;
  mana: number;
  hunger: number;
  thirst: number;
  learnedSpells: string[];
  inventory: InvItem[];
  questProgress: QuestProgressEntry[];
}

export async function loadPlayer(characterId: string): Promise<PersistedPlayer | null> {
  const character = await db.query.characters.findFirst({
    where: eq(schema.characters.id, characterId),
  });
  if (!character) return null;
  const items = await db.query.inventoryItems.findMany({
    where: eq(schema.inventoryItems.characterId, characterId),
  });
  const quests = await db.query.questProgress.findMany({
    where: eq(schema.questProgress.characterId, characterId),
  });
  return {
    id: character.id,
    accountId: character.accountId,
    name: character.name,
    classId: character.classId,
    level: character.level,
    xp: character.xp,
    x: character.x,
    y: character.y,
    z: character.z,
    yaw: character.yaw,
    hp: character.hp,
    mana: character.mana,
    hunger: character.hunger,
    thirst: character.thirst,
    learnedSpells: character.learnedSpells,
    inventory: items.map((i) => ({
      container: i.container as InvItem["container"],
      slot: i.slot,
      itemId: i.itemId,
      qty: i.qty,
      durability: i.durability,
    })),
    questProgress: quests.map((q) => ({
      questId: q.questId,
      status: q.status as "active" | "completed",
      progress: q.progress,
    })),
  };
}

export async function savePlayer(p: PersistedPlayer): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(schema.characters)
      .set({
        level: p.level,
        xp: p.xp,
        x: p.x,
        y: p.y,
        z: p.z,
        yaw: p.yaw,
        hp: p.hp,
        mana: p.mana,
        hunger: p.hunger,
        thirst: p.thirst,
        learnedSpells: p.learnedSpells,
        lastSeen: new Date(),
      })
      .where(eq(schema.characters.id, p.id));
    await tx.delete(schema.inventoryItems).where(eq(schema.inventoryItems.characterId, p.id));
    if (p.inventory.length > 0) {
      await tx.insert(schema.inventoryItems).values(
        p.inventory.map((i) => ({
          characterId: p.id,
          container: i.container,
          slot: i.slot,
          itemId: i.itemId,
          qty: i.qty,
          durability: i.durability,
        })),
      );
    }
    await tx.delete(schema.questProgress).where(eq(schema.questProgress.characterId, p.id));
    if (p.questProgress.length > 0) {
      await tx.insert(schema.questProgress).values(
        p.questProgress.map((q) => ({
          characterId: p.id,
          questId: q.questId,
          status: q.status,
          progress: q.progress,
        })),
      );
    }
  });
}

export async function loadDepletedNodes(): Promise<Map<string, number>> {
  const rows = await db.select().from(schema.harvestedNodes);
  return new Map(rows.map((r) => [r.nodeId, r.respawnAt.getTime()]));
}

export async function upsertDepletedNode(nodeId: string, respawnAtMs: number): Promise<void> {
  await db
    .insert(schema.harvestedNodes)
    .values({ nodeId, respawnAt: new Date(respawnAtMs) })
    .onConflictDoUpdate({
      target: schema.harvestedNodes.nodeId,
      set: { respawnAt: new Date(respawnAtMs) },
    });
}

export async function deleteDepletedNodes(nodeIds: string[]): Promise<void> {
  if (nodeIds.length === 0) return;
  await db.delete(schema.harvestedNodes).where(inArray(schema.harvestedNodes.nodeId, nodeIds));
}

export interface PersistedStructure {
  id: string;
  ownerId: string;
  type: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export async function loadStructures(): Promise<PersistedStructure[]> {
  const rows = await db.select().from(schema.structures);
  return rows.map((r) => ({ id: r.id, ownerId: r.ownerId, type: r.type, x: r.x, y: r.y, z: r.z, yaw: r.yaw }));
}

export async function insertStructure(s: Omit<PersistedStructure, "id">): Promise<string> {
  const [row] = await db
    .insert(schema.structures)
    .values({ ownerId: s.ownerId, type: s.type, x: s.x, y: s.y, z: s.z, yaw: s.yaw })
    .returning({ id: schema.structures.id });
  return row!.id;
}

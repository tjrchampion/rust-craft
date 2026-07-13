import { defineEventHandler, readBody, createError } from "h3";
import { eq } from "drizzle-orm";
import { requireAccount } from "../../utils/auth";
import { db, schema } from "../../db/client";
import { CLASS_IDS, classDef, itemDef, type ClassId } from "@rustcraft/shared";

const MAX_CHARACTERS_PER_ACCOUNT = 4;
const EQUIP_SLOT_INDEX: Record<string, number> = { weapon: 0, head: 1, chest: 2 };

export default defineEventHandler(async (event) => {
  const account = await requireAccount(event);
  const body = await readBody<{ name?: string; classId?: string }>(event);
  const name = body?.name?.trim();
  if (!name || !/^[A-Za-z][A-Za-z0-9]{2,15}$/.test(name)) {
    throw createError({
      statusCode: 400,
      statusMessage: "Name must be 3-16 letters/numbers, starting with a letter",
    });
  }
  const classId = body?.classId;
  if (!classId || !CLASS_IDS.includes(classId as ClassId)) {
    throw createError({ statusCode: 400, statusMessage: "A valid class must be chosen" });
  }

  const existing = await db.query.characters.findMany({
    where: eq(schema.characters.accountId, account.id),
    columns: { id: true },
  });
  if (existing.length >= MAX_CHARACTERS_PER_ACCOUNT) {
    throw createError({ statusCode: 400, statusMessage: "Character limit reached" });
  }

  const template = classDef(classId);
  try {
    const [character] = await db
      .insert(schema.characters)
      .values({ accountId: account.id, name, classId, learnedSpells: template.startingSpells })
      .returning({ id: schema.characters.id, name: schema.characters.name });
    if (character) {
      await db.insert(schema.inventoryItems).values(
        template.startingGear.map((g) => ({
          characterId: character.id,
          container: "equip" as const,
          slot: EQUIP_SLOT_INDEX[g.slot]!,
          itemId: g.itemId,
          qty: 1,
          durability: itemDef(g.itemId).maxDurability ?? null,
        })),
      );
    }
    return { character };
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && err.code === "23505") {
      throw createError({ statusCode: 409, statusMessage: "That name is taken" });
    }
    throw err;
  }
});

import { defineEventHandler, readBody, createError } from "h3";
import { eq } from "drizzle-orm";
import { requireAccount } from "../../utils/auth";
import { db, schema } from "../../db/client";
import {
  CLASS_IDS,
  classDef,
  startingHotbarLoadout,
  itemDef,
  EQUIP_SLOTS,
  isCharacterGender,
  isHairStyleId,
  isFacialHairId,
  isColor24,
  type ClassId,
} from "@rustcraft/shared";

const MAX_CHARACTERS_PER_ACCOUNT = 4;
const EQUIP_SLOT_INDEX: Record<string, number> = Object.fromEntries(
  EQUIP_SLOTS.map((slot, i) => [slot, i]),
);

interface CreateCharacterBody {
  name?: string;
  classId?: string;
  gender?: string;
  hairStyle?: string;
  facialHair?: string;
  hairColor?: number;
  eyeColor?: number;
  outfitHue?: number;
}

export default defineEventHandler(async (event) => {
  const account = await requireAccount(event);
  const body = await readBody<CreateCharacterBody>(event);
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
  // Appearance fields all have sane schema defaults, so unlike name/classId
  // above these are optional in the request body -- only reject a field
  // that's actually present but invalid, rather than requiring the client
  // send all of them.
  if (body?.gender !== undefined && !isCharacterGender(body.gender)) {
    throw createError({ statusCode: 400, statusMessage: "Invalid gender" });
  }
  if (body?.hairStyle !== undefined && !isHairStyleId(body.hairStyle)) {
    throw createError({ statusCode: 400, statusMessage: "Invalid hair style" });
  }
  if (body?.facialHair !== undefined && !isFacialHairId(body.facialHair)) {
    throw createError({ statusCode: 400, statusMessage: "Invalid facial hair" });
  }
  for (const [field, value] of [
    ["hairColor", body?.hairColor],
    ["eyeColor", body?.eyeColor],
    ["outfitHue", body?.outfitHue],
  ] as const) {
    if (value !== undefined && !isColor24(value)) {
      throw createError({ statusCode: 400, statusMessage: `Invalid ${field}` });
    }
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
      .values({
        accountId: account.id,
        name,
        classId,
        learnedSpells: template.startingSpells,
        ...(body?.gender !== undefined && { gender: body.gender }),
        ...(body?.hairStyle !== undefined && { hairStyle: body.hairStyle }),
        ...(body?.facialHair !== undefined && { facialHair: body.facialHair }),
        ...(body?.hairColor !== undefined && { hairColor: body.hairColor }),
        ...(body?.eyeColor !== undefined && { eyeColor: body.eyeColor }),
        ...(body?.outfitHue !== undefined && { outfitHue: body.outfitHue }),
      })
      .returning({ id: schema.characters.id, name: schema.characters.name });
    if (character) {
      const equipRows = template.startingGear.map((g) => ({
        characterId: character.id,
        container: "equip" as const,
        slot: EQUIP_SLOT_INDEX[g.slot]!,
        itemId: g.itemId,
        qty: 1,
        durability: itemDef(g.itemId).maxDurability ?? null,
      }));
      const hotbarRows = startingHotbarLoadout(template).map((h) => ({
        characterId: character.id,
        container: "hotbar" as const,
        slot: h.slot,
        itemId: `spell:${h.spellId}`,
        qty: 1,
        durability: null,
      }));
      await db.insert(schema.inventoryItems).values([...equipRows, ...hotbarRows]);
    }
    return { character };
  } catch (err: unknown) {
    // drizzle-orm wraps every driver error in a DrizzleQueryError, so the
    // real pg error (and its .code) lives at err.cause, not on err itself.
    const pgErr = err && typeof err === "object" && "cause" in err ? err.cause : err;
    if (pgErr && typeof pgErr === "object" && "code" in pgErr && pgErr.code === "23505") {
      throw createError({ statusCode: 409, statusMessage: "That name is taken" });
    }
    throw err;
  }
});

import { defineEventHandler } from "h3";
import { eq, and, inArray } from "drizzle-orm";
import { getAccount } from "../../utils/auth";
import { db, schema } from "../../db/client";
import { env, IS_DEV } from "../../utils/env";
import { EQUIP_SLOTS } from "@rustcraft/shared";

export default defineEventHandler(async (event) => {
  const providers = {
    discord: Boolean(env("DISCORD_CLIENT_ID")),
    google: Boolean(env("GOOGLE_CLIENT_ID")),
    dev: IS_DEV,
    password: true,
  };
  const account = await getAccount(event);
  if (!account) return { account: null, characters: [], providers };

  const characters = await db.query.characters.findMany({
    where: eq(schema.characters.accountId, account.id),
    columns: { id: true, name: true, level: true, classId: true, lastSeen: true },
  });

  // Fetch each character's equipped gear too, so the character-select
  // screen's preview model can show what they're actually wearing instead
  // of just the class's generic starting weapon.
  const characterIds = characters.map((c) => c.id);
  const equipRows = characterIds.length
    ? await db.query.inventoryItems.findMany({
        where: and(inArray(schema.inventoryItems.characterId, characterIds), eq(schema.inventoryItems.container, "equip")),
        columns: { characterId: true, slot: true, itemId: true },
      })
    : [];
  const equipByCharacter = new Map<string, Record<string, string>>();
  for (const row of equipRows) {
    const slotName = EQUIP_SLOTS[row.slot];
    if (!slotName) continue;
    const rec = equipByCharacter.get(row.characterId) ?? {};
    rec[slotName] = row.itemId;
    equipByCharacter.set(row.characterId, rec);
  }

  return {
    account: { id: account.id, displayName: account.displayName, provider: account.provider },
    characters: characters.map((c) => ({ ...c, equip: equipByCharacter.get(c.id) ?? {} })),
    providers,
  };
});

import { defineEventHandler } from "h3";
import { eq } from "drizzle-orm";
import { getAccount } from "../../utils/auth";
import { db, schema } from "../../db/client";
import { env, IS_DEV } from "../../utils/env";

export default defineEventHandler(async (event) => {
  const providers = {
    discord: Boolean(env("DISCORD_CLIENT_ID")),
    google: Boolean(env("GOOGLE_CLIENT_ID")),
    dev: IS_DEV,
  };
  const account = await getAccount(event);
  if (!account) return { account: null, characters: [], providers };

  const characters = await db.query.characters.findMany({
    where: eq(schema.characters.accountId, account.id),
    columns: { id: true, name: true, level: true, classId: true, lastSeen: true },
  });
  return {
    account: { id: account.id, displayName: account.displayName, provider: account.provider },
    characters,
    providers,
  };
});

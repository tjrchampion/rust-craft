import { defineEventHandler, readBody, createError } from "h3";
import { eq } from "drizzle-orm";
import { requireAccount } from "../../utils/auth";
import { db, schema } from "../../db/client";

const MAX_CHARACTERS_PER_ACCOUNT = 4;

export default defineEventHandler(async (event) => {
  const account = await requireAccount(event);
  const body = await readBody<{ name?: string }>(event);
  const name = body?.name?.trim();
  if (!name || !/^[A-Za-z][A-Za-z0-9]{2,15}$/.test(name)) {
    throw createError({
      statusCode: 400,
      statusMessage: "Name must be 3-16 letters/numbers, starting with a letter",
    });
  }

  const existing = await db.query.characters.findMany({
    where: eq(schema.characters.accountId, account.id),
    columns: { id: true },
  });
  if (existing.length >= MAX_CHARACTERS_PER_ACCOUNT) {
    throw createError({ statusCode: 400, statusMessage: "Character limit reached" });
  }

  try {
    const [character] = await db
      .insert(schema.characters)
      .values({ accountId: account.id, name })
      .returning({ id: schema.characters.id, name: schema.characters.name });
    return { character };
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && err.code === "23505") {
      throw createError({ statusCode: 409, statusMessage: "That name is taken" });
    }
    throw err;
  }
});

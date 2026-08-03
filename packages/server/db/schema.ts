import {
  pgTable,
  uuid,
  text,
  integer,
  real,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(), // 'discord' | 'google' | 'dev' | 'password'
    providerId: text("provider_id").notNull(), // for 'password': the lowercased email
    email: text("email"),
    displayName: text("display_name"),
    // Only set for provider = 'password'; `scrypt` salt:hash, see utils/password.ts.
    passwordHash: text("password_hash"),
    /** Client prefs (graphics, …) — see AccountSettings in shared. */
    settings: jsonb("settings").notNull().default({}).$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("accounts_provider_idx").on(t.provider, t.providerId)],
);

export const sessions = pgTable("sessions", {
  token: text("token").primaryKey(),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const characters = pgTable(
  "characters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    classId: text("class_id").notNull().default("warrior"),
    // Appearance -- chosen at creation (see routes/api/characters.post.ts),
    // independent of class (CLASS_GENDER used to hardcode gender per class;
    // this is what replaced that). Colors are stored as 0xRRGGBB ints,
    // multiplied onto the base mesh color the same way item gearTint works
    // (see AnimatedModel.setGearTint) -- outfitHue defaults to white
    // (0xffffff) so a fresh character's gear renders at its own natural
    // color until the player picks a tint.
    gender: text("gender").notNull().default("male"),
    hairStyle: text("hair_style").notNull().default("none"),
    facialHair: text("facial_hair").notNull().default("none"),
    hairColor: integer("hair_color").notNull().default(0x2b1a12),
    eyeColor: integer("eye_color").notNull().default(0x6b4423),
    outfitHue: integer("outfit_hue").notNull().default(0xffffff),
    level: integer("level").notNull().default(1),
    xp: integer("xp").notNull().default(0),
    x: real("x").notNull().default(0),
    y: real("y").notNull().default(0),
    z: real("z").notNull().default(0),
    yaw: real("yaw").notNull().default(0),
    hp: real("hp").notNull().default(100),
    mana: real("mana").notNull().default(100),
    hunger: real("hunger").notNull().default(100),
    thirst: real("thirst").notNull().default(100),
    learnedSpells: jsonb("learned_spells").notNull().default([]).$type<string[]>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeen: timestamp("last_seen", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("characters_name_idx").on(t.name),
    index("characters_account_idx").on(t.accountId),
  ],
);

export const inventoryItems = pgTable(
  "inventory_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    characterId: uuid("character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "cascade" }),
    container: text("container").notNull(), // 'inventory' | 'hotbar'
    slot: integer("slot").notNull(),
    itemId: text("item_id").notNull(),
    qty: integer("qty").notNull().default(1),
    durability: real("durability"),
  },
  (t) => [uniqueIndex("inventory_slot_idx").on(t.characterId, t.container, t.slot)],
);

// Resource nodes are deterministic from the zone seed; only depletion persists.
export const harvestedNodes = pgTable("harvested_nodes", {
  nodeId: text("node_id").primaryKey(),
  respawnAt: timestamp("respawn_at", { withTimezone: true }).notNull(),
});

export const questProgress = pgTable(
  "quest_progress",
  {
    characterId: uuid("character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "cascade" }),
    questId: text("quest_id").notNull(),
    status: text("status").notNull(), // 'active' | 'completed'
    progress: integer("progress").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.characterId, t.questId] })],
);

export const characterAchievements = pgTable(
  "character_achievements",
  {
    characterId: uuid("character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "cascade" }),
    achievementId: text("achievement_id").notNull(),
    /** Counter toward unlock (mirrors criteria target when complete). */
    progress: integer("progress").notNull().default(0),
    unlockedAt: timestamp("unlocked_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.characterId, t.achievementId] })],
);

// Base building lands in Milestone 2; schema exists now so saves survive it.
export const structures = pgTable(
  "structures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => characters.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    x: real("x").notNull(),
    y: real("y").notNull(),
    z: real("z").notNull(),
    yaw: real("yaw").notNull().default(0),
    health: real("health").notNull().default(100),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("structures_owner_idx").on(t.ownerId)],
);

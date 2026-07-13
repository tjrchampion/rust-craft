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
    provider: text("provider").notNull(), // 'discord' | 'google' | 'dev'
    providerId: text("provider_id").notNull(),
    email: text("email"),
    displayName: text("display_name"),
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

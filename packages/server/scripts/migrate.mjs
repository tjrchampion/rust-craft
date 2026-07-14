import { config } from "dotenv";
import { resolve } from "node:path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

// Same env-loading convention as utils/env.ts (this script is always invoked
// with cwd = packages/server, via `pnpm --filter @rustcraft/server start`).
config({ path: resolve(process.cwd(), "../../.env") });
config({ path: resolve(process.cwd(), ".env"), override: false });

const isDev = process.env.NODE_ENV !== "production";
const databaseUrl = process.env.DATABASE_URL ?? "postgres://rustcraft:rustcraft@localhost:5433/rustcraft";

// Managed Postgres bakes `sslmode=require` into its connection string, which
// newer pg-connection-string versions treat as full certificate verification
// and fail against an untrusted cert chain — strip it and pass `ssl`
// explicitly instead (mirrors db/client.ts and drizzle.config.ts).
const url = new URL(databaseUrl);
for (const key of [...url.searchParams.keys()]) {
  if (key.toLowerCase().startsWith("ssl")) url.searchParams.delete(key);
}

const pool = new Pool({
  connectionString: url.toString(),
  ssl: isDev ? false : { rejectUnauthorized: false },
});
const db = drizzle(pool);

try {
  await migrate(db, {
    migrationsFolder: "./db/migrations",
    // Managed Postgres (production) commonly restricts the app's own DB
    // user from CREATE SCHEMA, so migration tracking lives in `public`
    // there. Local dev already has its tracking history under the default
    // `drizzle` schema (created with full privileges) — leave that as-is.
    ...(isDev ? {} : { migrationsSchema: "public" }),
  });
  console.log("[migrate] database schema up to date");
} catch (err) {
  console.error("[migrate] FAILED:", err.message);
  console.error("[migrate] CAUSE:", err.cause?.message ?? err.cause);
  process.exitCode = 1;
} finally {
  await pool.end();
}

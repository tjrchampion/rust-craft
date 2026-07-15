import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

// Resolve paths relative to this script's own location, not process.cwd() —
// deploy platforms (e.g. DigitalOcean App Platform's run_command) may invoke
// this directly from the repo root rather than via `pnpm --filter
// @rustcraft/server start`, which would otherwise silently break both the
// .env lookup and the migrations folder path below.
const serverDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: resolve(serverDir, "../../.env") });
config({ path: resolve(serverDir, ".env"), override: false });

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
    migrationsFolder: resolve(serverDir, "db/migrations"),
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

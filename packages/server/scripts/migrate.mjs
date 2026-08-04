import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readdir, readFile } from "node:fs/promises";
import { Pool } from "pg";

// Resolve paths relative to this script's own location, not process.cwd() —
// deploy platforms (e.g. DigitalOcean App Platform's run_command) may invoke
// this directly from the repo root rather than via `pnpm --filter
// @rustcraft/server start`, which would otherwise silently break both the
// .env lookup and the migrations folder path below.
const serverDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: resolve(serverDir, "../../.env") });
config({ path: resolve(serverDir, ".env"), override: false });

const isDev = process.env.NODE_ENV !== "production";
const databaseUrl =
  process.env.DATABASE_URL ?? "postgres://rustcraft:rustcraft@localhost:5433/rustcraft";

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

// ---------------------------------------------------------------------------
// Migration tracking schema: dev uses 'drizzle', production uses 'public'
// so that managed Postgres (which restricts CREATE SCHEMA) never needs to
// create a new schema.
// ---------------------------------------------------------------------------
const trackingSchema = isDev ? "drizzle" : "public";
const trackingTable = `"${trackingSchema}"."__drizzle_migrations"`;

async function ensureTrackingTable(client) {
  if (isDev) {
    await client.query(`CREATE SCHEMA IF NOT EXISTS drizzle`);
  }
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${trackingTable} (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);
}

async function appliedHashes(client) {
  const r = await client.query(`SELECT hash FROM ${trackingTable}`);
  return new Set(r.rows.map((row) => row.hash));
}

async function markApplied(client, hash) {
  await client.query(
    `INSERT INTO ${trackingTable} (hash, created_at)
     SELECT $1, $2
     WHERE NOT EXISTS (SELECT 1 FROM ${trackingTable} WHERE hash = $1)`,
    [hash, Date.now()]
  );
}


// ---------------------------------------------------------------------------
// PG error codes that mean "the object already exists" — safe to skip.
// ---------------------------------------------------------------------------
const TOLERATED_CODES = new Set([
  "42P07", // relation already exists
  "42701", // column already exists
  "42710", // duplicate object (constraint, index, …)
  "42P16", // invalid table definition (PK already defined)
]);

// ---------------------------------------------------------------------------
// Execute one SQL statement using a savepoint so a tolerated error doesn't
// abort the outer transaction.
// ---------------------------------------------------------------------------
let savepointIdx = 0;
async function execStatement(client, sql, migrationTag) {
  const trimmed = sql.trim();
  if (!trimmed) return;

  const sp = `sp_${++savepointIdx}`;
  await client.query(`SAVEPOINT ${sp}`);
  try {
    await client.query(trimmed);
    await client.query(`RELEASE SAVEPOINT ${sp}`);
  } catch (err) {
    await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
    await client.query(`RELEASE SAVEPOINT ${sp}`);
    if (TOLERATED_CODES.has(err.code)) {
      console.warn(
        `[migrate] [${migrationTag}] skipping (${err.code}): ${err.message.split("\n")[0]}`
      );
    } else {
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const client = await pool.connect();
try {
  await ensureTrackingTable(client);
  const applied = await appliedHashes(client);

  const migrationsDir = resolve(serverDir, "db/migrations");
  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  let ran = 0;
  for (const file of files) {
    const hash = file.replace(".sql", "");
    if (applied.has(hash)) {
      continue; // already tracked — skip
    }

    const sql = await readFile(resolve(migrationsDir, file), "utf8");
    // Drizzle uses --> statement-breakpoint to separate independent statements
    const statements = sql.split("--> statement-breakpoint");

    console.log(`[migrate] applying ${file} (${statements.length} statement(s))…`);

    await client.query("BEGIN");
    try {
      for (const stmt of statements) {
        await execStatement(client, stmt, file);
      }
      await markApplied(client, hash);
      await client.query("COMMIT");
      ran++;
      console.log(`[migrate] ✓ ${file}`);
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(`[migrate] FAILED on ${file}:`, err.message);
      if (err.cause) console.error(`[migrate] CAUSE:`, err.cause?.message ?? err.cause);
      process.exitCode = 1;
      break;
    }
  }

  if (process.exitCode !== 1) {
    console.log(
      ran === 0
        ? "[migrate] database schema up to date"
        : `[migrate] applied ${ran} migration(s) successfully`
    );
  }
} finally {
  client.release();
  await pool.end();
}

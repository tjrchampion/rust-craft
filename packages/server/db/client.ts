import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { DATABASE_URL, IS_DEV } from "../utils/env";
import * as schema from "./schema";

// pg merges the connection string's own parsed config OVER any explicit
// options passed to Pool() — so a bare `ssl` option below is silently
// overridden whenever the URL carries an sslmode param (managed providers
// like DigitalOcean bake `sslmode=require` into it, and newer pg-connection-
// string versions treat that as full certificate verification, which fails
// against a cert chain Node doesn't trust). Stripping ssl-related params
// here guarantees our explicit `ssl` option below is what actually applies.
function stripSslParams(url: string): string {
  const parsed = new URL(url);
  for (const key of [...parsed.searchParams.keys()]) {
    if (key.toLowerCase().startsWith("ssl")) parsed.searchParams.delete(key);
  }
  return parsed.toString();
}

const pool = new pg.Pool({
  connectionString: stripSslParams(DATABASE_URL),
  max: 10,
  // Encrypt but skip certificate-chain verification in production.
  ssl: IS_DEV ? false : { rejectUnauthorized: false },
});

export const db = drizzle(pool, { schema });
export { schema };

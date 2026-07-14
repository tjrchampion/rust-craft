import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { DATABASE_URL, IS_DEV } from "../utils/env";
import * as schema from "./schema";

const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  max: 10,
  // Managed Postgres (e.g. DigitalOcean) presents a cert chain Node doesn't
  // trust by default; encrypt but skip verification rather than depend on
  // sslmode query-string parsing, whose semantics vary across pg versions.
  ssl: IS_DEV ? false : { rejectUnauthorized: false },
});

export const db = drizzle(pool, { schema });
export { schema };

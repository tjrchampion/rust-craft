import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { DATABASE_URL } from "../utils/env";
import * as schema from "./schema";

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 10 });

export const db = drizzle(pool, { schema });
export { schema };

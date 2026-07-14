import { defineConfig } from "drizzle-kit";
import { DATABASE_URL, IS_DEV } from "./utils/env";

// Same fix as db/client.ts: managed Postgres bakes `sslmode=require` into its
// connection string, which newer pg-connection-string versions treat as full
// certificate verification and fail against an untrusted cert chain. Strip
// it and pass `ssl` explicitly instead.
function stripSslParams(url: string): string {
  const parsed = new URL(url);
  for (const key of [...parsed.searchParams.keys()]) {
    if (key.toLowerCase().startsWith("ssl")) parsed.searchParams.delete(key);
  }
  return parsed.toString();
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dbCredentials: {
    url: stripSslParams(DATABASE_URL),
    ssl: IS_DEV ? false : { rejectUnauthorized: false },
  },
});

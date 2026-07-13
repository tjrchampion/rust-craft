import { defineConfig } from "drizzle-kit";
import { DATABASE_URL } from "./utils/env";

export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dbCredentials: {
    url: DATABASE_URL,
  },
});

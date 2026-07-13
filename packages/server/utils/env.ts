import { config } from "dotenv";
import { resolve } from "node:path";

// Single .env lives at the repo root; server processes (nitro dev, drizzle-kit)
// run with cwd = packages/server.
config({ path: resolve(process.cwd(), "../../.env") });
config({ path: resolve(process.cwd(), ".env"), override: false });

export function env(key: string): string | undefined {
  return process.env[key];
}

export function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

export const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://rustcraft:rustcraft@localhost:5433/rustcraft";

export const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN ?? "http://localhost:3000";

export const IS_DEV = process.env.NODE_ENV !== "production";

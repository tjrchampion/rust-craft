import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { RegionBlueprint } from "@rustcraft/shared";

// Unlike dungeon blueprints (a couple of hand-curated tiers, statically
// bundled at build time via content/dungeonBlueprints.ts), regions are
// freely creatable from the in-browser editor and must go live with no
// rebuild -- so this reads the JSON files off disk at request time, not
// import time. A simple in-memory cache avoids re-reading on every request;
// it's invalidated by saveRegionBlueprint, the only write path.
const REGIONS_DIR = resolve(process.cwd(), "../shared/src/content/regionBlueprints");

let cache: Map<string, RegionBlueprint> | null = null;

function ensureDir(): void {
  if (!existsSync(REGIONS_DIR)) mkdirSync(REGIONS_DIR, { recursive: true });
}

function loadAll(): Map<string, RegionBlueprint> {
  if (cache) return cache;
  ensureDir();
  const map = new Map<string, RegionBlueprint>();
  for (const file of readdirSync(REGIONS_DIR)) {
    if (!file.endsWith(".json")) continue;
    try {
      const blueprint = JSON.parse(readFileSync(resolve(REGIONS_DIR, file), "utf-8")) as RegionBlueprint;
      map.set(blueprint.id, blueprint);
    } catch {
      // Skip unreadable/corrupt files rather than failing every region lookup.
    }
  }
  cache = map;
  return map;
}

export function listRegionBlueprints(): RegionBlueprint[] {
  return [...loadAll().values()];
}

export function loadRegionBlueprint(id: string): RegionBlueprint | null {
  return loadAll().get(id) ?? null;
}

export function saveRegionBlueprint(id: string, blueprint: RegionBlueprint): void {
  ensureDir();
  writeFileSync(resolve(REGIONS_DIR, `${id}.json`), JSON.stringify(blueprint, null, 2) + "\n", "utf-8");
  cache = null;
}

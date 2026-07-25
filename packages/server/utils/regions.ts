import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { RegionBlueprint } from "@rustcraft/shared";

// Unlike dungeon blueprints (a couple of hand-curated tiers, statically
// bundled at build time via content/dungeonBlueprints.ts), regions are
// freely creatable from the in-browser editor and must go live with no
// rebuild -- so this reads the JSON files off disk at request time, not
// import time. A simple in-memory cache avoids re-reading on every request;
// it's invalidated by saveRegionBlueprint, the only write path.
function getRegionsDir(): string {
  const cwd = process.cwd();
  const candidates = [
    resolve(cwd, "packages/shared/src/content/regionBlueprints"),
    resolve(cwd, "../shared/src/content/regionBlueprints"),
    resolve(cwd, "shared/src/content/regionBlueprints"),
  ];
  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  return candidates[0]!;
}

let cache: Map<string, RegionBlueprint> | null = null;

function ensureDir(): void {
  const dir = getRegionsDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function loadAll(): Map<string, RegionBlueprint> {
  if (cache) return cache;
  ensureDir();
  const dir = getRegionsDir();
  const map = new Map<string, RegionBlueprint>();
  if (existsSync(dir)) {
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".json")) continue;
      try {
        const blueprint = JSON.parse(readFileSync(resolve(dir, file), "utf-8")) as RegionBlueprint;
        map.set(blueprint.id, blueprint);
      } catch {
        // Skip unreadable/corrupt files rather than failing every region lookup.
      }
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
  const dir = getRegionsDir();
  writeFileSync(resolve(dir, `${id}.json`), JSON.stringify(blueprint, null, 2) + "\n", "utf-8");
  cache = null;
}

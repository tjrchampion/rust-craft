import { generateVillages } from "./worldgen";
import { SPAWN_POINT } from "./constants";
import { dist2D } from "./math";

export interface ZoneInfo {
  id: string;
  name: string;
  subtitle: string;
}

/** Radius of the safe starter zone ringing spawn, before village territories take over. */
export const SPAWN_ZONE_RADIUS = 70;

const SPAWN_ZONE: ZoneInfo = {
  id: "z_spawn",
  name: "The Hearthlands",
  subtitle: "A peaceful starting ground",
};

/** Flavor subtitles cycle deterministically by village index. */
const TERRITORY_SUBTITLES = [
  "Rolling fields and quiet farmsteads",
  "Shadowed groves and old timber roads",
  "Windswept cliffs and craggy peaks",
  "Winding streams and river crossings",
];

let zonesCache: ZoneInfo[] | null = null;

/** One named zone per village territory, plus the central spawn commons. */
export function generateZones(): ZoneInfo[] {
  if (zonesCache) return zonesCache;
  const villages = generateVillages();
  zonesCache = [
    SPAWN_ZONE,
    ...villages.map((v, i) => ({
      id: `z_${v.id}`,
      name: `${v.name} Reach`,
      subtitle: TERRITORY_SUBTITLES[i % TERRITORY_SUBTITLES.length]!,
    })),
  ];
  return zonesCache;
}

/**
 * Which named zone a world position belongs to. The spawn commons is a
 * flat-radius safe zone; beyond it, territory is assigned to the nearest
 * village (a simple Voronoi split) so every point in the world has a name.
 */
export function zoneAt(x: number, z: number): ZoneInfo {
  const zones = generateZones();
  if (dist2D(x, z, SPAWN_POINT.x, SPAWN_POINT.z) < SPAWN_ZONE_RADIUS) return zones[0]!;

  const villages = generateVillages();
  let bestIdx = 0;
  let bestDist = Infinity;
  villages.forEach((v, i) => {
    const d = dist2D(x, z, v.x, v.z);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  });
  return zones[bestIdx + 1] ?? zones[0]!;
}

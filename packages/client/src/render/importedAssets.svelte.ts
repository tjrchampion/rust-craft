/** Session-local registry of assets uploaded via the Region Editor's asset
 *  importer (see AssetExplorer.svelte). REGION_PROP_PALETTE is a static array
 *  compiled into the app bundle, so a freshly imported model can't be spliced
 *  into it at runtime -- this sits alongside it instead, and AssetExplorer
 *  concatenates both when listing cards. Persisted to localStorage only so a
 *  page refresh mid-session doesn't hide cards for models that already made
 *  it to disk; it is not the source of truth (the filesystem is). */
import type { RegionAssetCategory } from "@rustcraft/shared";
import type { RegionPaletteAsset } from "./regionPropPalette";

const STORAGE_KEY = "rc:importedAssets";

function loadInitial(): RegionPaletteAsset[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as RegionPaletteAsset[]) : [];
  } catch {
    return [];
  }
}

let imported = $state<RegionPaletteAsset[]>(loadInitial());

function persist(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(imported));
  } catch {
    /* storage full/unavailable -- session-only fallback */
  }
}

export function importedPaletteAssets(): RegionPaletteAsset[] {
  return imported;
}

export function registerImportedAsset(model: string, category: RegionAssetCategory): void {
  if (imported.some((a) => a.model === model && a.category === category)) return;
  imported = [{ model, category, group: "Imported", pack: "Imported" }, ...imported];
  persist();
}

export function unregisterImportedAsset(model: string, category: RegionAssetCategory): void {
  imported = imported.filter((a) => !(a.model === model && a.category === category));
  persist();
}

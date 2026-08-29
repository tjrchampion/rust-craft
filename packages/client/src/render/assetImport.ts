import type { RegionAssetCategory } from "@rustcraft/shared";
import { app } from "../ui/appState.svelte";

export interface AssetImportResponse {
  ok: true;
  model: string;
  category: RegionAssetCategory;
  url: string;
  collision: { ok: boolean; tris?: number; verts?: number; reason?: string };
  compression: { ok: boolean; skipped?: boolean; beforeBytes?: number; afterBytes?: number; reason?: string };
}

export interface AssetImportError {
  ok: false;
  message: string;
}

export type AssetImportResult = AssetImportResponse | AssetImportError;

/** Upload one .glb to the Region Editor's asset importer (IS_DEV-gated
 *  server route) -- saves it under assets/models/<category>/imported/,
 *  extracts collision, and best-effort KTX2-compresses it server-side. */
export async function importGlbAsset(
  file: File,
  category: RegionAssetCategory,
  overwrite = false,
): Promise<AssetImportResult> {
  const form = new FormData();
  form.append("category", category);
  if (overwrite) form.append("overwrite", "true");
  form.append("file", file, file.name);

  let res: Response;
  try {
    res = await fetch(app.apiUrl("/api/debug/asset-import"), {
      method: "POST",
      credentials: "include",
      body: form,
    });
  } catch {
    return { ok: false, message: "Could not reach the server." };
  }

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    return { ok: false, message: body?.statusMessage ?? body?.message ?? `Import failed (${res.status}).` };
  }
  return body as AssetImportResponse;
}

export interface AssetDeleteResult {
  ok: boolean;
  message?: string;
}

/** Remove a previously imported .glb (and its collision data) from the
 *  server. Only ever targets assets/models/<category>/imported/ -- the
 *  server route refuses anything else. */
export async function deleteGlbAsset(model: string, category: RegionAssetCategory): Promise<AssetDeleteResult> {
  let res: Response;
  try {
    res = await fetch(app.apiUrl("/api/debug/asset-import-delete"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ model, category }),
    });
  } catch {
    return { ok: false, message: "Could not reach the server." };
  }
  if (res.ok) return { ok: true };
  const body = await res.json().catch(() => null);
  return { ok: false, message: body?.statusMessage ?? body?.message ?? `Delete failed (${res.status}).` };
}

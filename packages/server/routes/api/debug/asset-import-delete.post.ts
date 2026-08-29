import { defineEventHandler, readBody, createError } from "h3";
import { IS_DEV } from "../../../utils/env";
import { deleteUploadedModel, isValidCategory } from "../../../utils/assetImport";

// POST /api/debug/asset-import-delete { category, model }
// Removes an asset previously uploaded via asset-import.post.ts (and its
// collision data) -- lets the editor clear a name collision without needing
// filesystem access. Same posture/naming as region-blueprint-delete.post.ts.
export default defineEventHandler(async (event) => {
  if (!IS_DEV) throw createError({ statusCode: 404 });
  const body = await readBody(event);
  const category = body?.category;
  const model = typeof body?.model === "string" ? body.model.trim() : "";
  if (!isValidCategory(category)) {
    throw createError({ statusCode: 400, statusMessage: "category must be building, foliage, or prop" });
  }
  if (!model) throw createError({ statusCode: 400, statusMessage: "model required" });

  try {
    deleteUploadedModel(category, model);
  } catch (e) {
    const code = e instanceof Error ? (e as { code?: string }).code : undefined;
    if (code === "NOT_FOUND") throw createError({ statusCode: 404, statusMessage: (e as Error).message });
    if (code === "NOT_IMPORTED") throw createError({ statusCode: 400, statusMessage: (e as Error).message });
    throw createError({ statusCode: 500, statusMessage: "Failed to delete asset" });
  }

  return { ok: true, category, model };
});

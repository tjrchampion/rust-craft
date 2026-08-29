import { defineEventHandler, readMultipartFormData, createError } from "h3";
import { IS_DEV } from "../../../utils/env";
import {
  compressModelKtx2,
  extractCollisionForModel,
  isBinaryGlb,
  isValidCategory,
  sanitizeAssetFilename,
  saveUploadedModel,
} from "../../../utils/assetImport";

// POST /api/debug/asset-import (multipart/form-data: file, category, overwrite?)
// Region Editor's drag-and-drop asset importer -- IS_DEV-gated editor
// endpoint, same posture as region-blueprint.post.ts. Saves the uploaded
// .glb under assets/models/<category>/imported/, extracts its BVH collision
// soup, and best-effort KTX2-compresses its textures, all synchronously so
// the response tells the editor exactly what succeeded.
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

export default defineEventHandler(async (event) => {
  if (!IS_DEV) throw createError({ statusCode: 404 });

  const parts = await readMultipartFormData(event);
  if (!parts) throw createError({ statusCode: 400, statusMessage: "Expected multipart/form-data" });

  const filePart = parts.find((p) => p.name === "file" && p.filename);
  const categoryPart = parts.find((p) => p.name === "category");
  const overwrite = parts.find((p) => p.name === "overwrite")?.data.toString("utf-8") === "true";

  if (!filePart) throw createError({ statusCode: 400, statusMessage: "Missing file" });
  const category = categoryPart?.data.toString("utf-8");
  if (!isValidCategory(category)) {
    throw createError({ statusCode: 400, statusMessage: "category must be building, foliage, or prop" });
  }
  if (filePart.data.length === 0) throw createError({ statusCode: 400, statusMessage: "File is empty" });
  if (filePart.data.length > MAX_UPLOAD_BYTES) {
    throw createError({ statusCode: 400, statusMessage: `File exceeds ${MAX_UPLOAD_BYTES / 1024 / 1024}MB limit` });
  }
  if (!isBinaryGlb(filePart.data)) {
    throw createError({ statusCode: 400, statusMessage: "Not a valid binary .glb file" });
  }

  const filename = sanitizeAssetFilename(filePart.filename ?? "asset.glb");

  let saved;
  try {
    saved = saveUploadedModel(category, filename, filePart.data, overwrite);
  } catch (e) {
    if (e instanceof Error && (e as { code?: string }).code === "EXISTS") {
      throw createError({ statusCode: 409, statusMessage: e.message });
    }
    throw createError({ statusCode: 500, statusMessage: "Failed to save uploaded file" });
  }

  // Sequential, not Promise.all: collision extraction reads the file with a
  // plain NodeIO that has no KTX2 extension registered, so it must run
  // against the pristine upload -- if it raced compression and read after
  // compressModelKtx2 renamed a KHR_texture_basisu-using file over the same
  // path, NodeIO would throw ("Missing required extension") on a file it can
  // read fine either before or after, just not concurrently mid-swap.
  const collision = await extractCollisionForModel(category, saved.relPath, saved.absPath);
  const compression = await compressModelKtx2(saved.absPath);

  return {
    ok: true,
    model: saved.relPath,
    category,
    url: saved.url,
    collision,
    compression,
  };
});

/**
 * Client Asset Pack Engine (.rcpack)
 *
 * Downloads assets_index.json on app boot and streams/slices .glb model
 * ArrayBuffers directly from memory, eliminating hundreds of individual
 * HTTP network roundtrips during loading screens and scene updates.
 */

interface AssetIndexEntry {
  offset: number;
  size: number;
}

type AssetIndexMap = Record<string, AssetIndexEntry>;

let indexPromise: Promise<AssetIndexMap | null> | null = null;
let packPromise: Promise<ArrayBuffer | null> | null = null;
let assetIndex: AssetIndexMap | null = null;
let packBuffer: ArrayBuffer | null = null;

/** Fetch index on boot or first asset request. */
export async function initAssetPack(): Promise<AssetIndexMap | null> {
  if (assetIndex) return assetIndex;
  if (!indexPromise) {
    indexPromise = fetch("/assets/assets_index.json")
      .then((r) => {
        if (!r.ok) return null;
        return r.json() as Promise<AssetIndexMap>;
      })
      .then((data) => {
        assetIndex = data;
        return data;
      })
      .catch((err) => {
        console.warn("[assetPack] Could not load assets_index.json, falling back to network GET:", err);
        return null;
      });
  }
  return indexPromise;
}

/** Pre-fetch the master .rcpack file into memory asynchronously. */
export function preloadAssetPack(): Promise<ArrayBuffer | null> {
  if (packBuffer) return Promise.resolve(packBuffer);
  if (!packPromise) {
    packPromise = fetch("/assets/assets.rcpack")
      .then((r) => {
        if (!r.ok) return null;
        return r.arrayBuffer();
      })
      .then((buf) => {
        packBuffer = buf;
        return buf;
      })
      .catch((err) => {
        console.warn("[assetPack] Could not load assets.rcpack, falling back to network GET:", err);
        return null;
      });
  }
  return packPromise;
}

/**
 * Returns an ArrayBuffer slice for the given asset URL if packed, or null
 * if unpacked / missing from index (falling back to standard GLTFLoader.loadAsync).
 */
export async function getAssetBuffer(url: string): Promise<ArrayBuffer | null> {
  const index = await initAssetPack();
  if (!index) return null;

  // Clean and normalize URL string (strip query params, ensure leading slash)
  let cleanUrl = url.split("?")[0]!;
  if (!cleanUrl.startsWith("/")) cleanUrl = "/" + cleanUrl;
  cleanUrl = cleanUrl.replace(/^\/\.\//, "/");

  const entry = index[cleanUrl];
  if (!entry) return null;

  // Ensure pack binary is fetched
  const buf = await preloadAssetPack();
  if (!buf) return null;

  // Slice the asset's ArrayBuffer from the master pack
  return buf.slice(entry.offset, entry.offset + entry.size);
}

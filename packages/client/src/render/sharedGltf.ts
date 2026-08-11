import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

/**
 * Cross-GLTF texture dedupe by absolute URL.
 *
 * Three's GLTFParser keeps a per-document sourceCache and Texture.clone()s on
 * reuse -- each clone is a distinct WebGLTexture upload. Modular outfit parts
 * re-reference the same 4K maps across many GLTFs, so without this cache those
 * maps are uploaded once per part file.
 *
 * No downscaling: we only share the already-authored texture object.
 */

const WEBGL_FILTERS: Record<number, THREE.MagnificationTextureFilter | THREE.MinificationTextureFilter> = {
  9728: THREE.NearestFilter,
  9729: THREE.LinearFilter,
  9984: THREE.NearestMipmapNearestFilter,
  9985: THREE.LinearMipmapNearestFilter,
  9986: THREE.NearestMipmapLinearFilter,
  9987: THREE.LinearMipmapLinearFilter,
};

const WEBGL_WRAPPINGS: Record<number, THREE.Wrapping> = {
  33071: THREE.ClampToEdgeWrapping,
  33648: THREE.MirroredRepeatWrapping,
  10497: THREE.RepeatWrapping,
};

const urlTextureCache = new Map<string, Promise<THREE.Texture>>();

let activeRenderer: THREE.WebGLRenderer | null = null;
const knownQueuedTextures = new WeakSet<THREE.Texture>();
const uploadedTextures = new WeakSet<THREE.Texture>();

/**
 * Freshly-loaded textures awaiting a GPU pre-upload. External PNG maps upload
 * UNCOMPRESSED via texImage2D (+ mipmap generation) on the first render they
 * appear in -- a region's worth landing in one frame is a multi-hundred-ms
 * stall. The idle pump and render loop drain this in ~2ms slices so the cost
 * spreads across idle time / frames instead of freezing one.
 */
const gpuTextureUploadQueue: THREE.Texture[] = [];
let idleScheduled = false;

export function setSharedRenderer(renderer: THREE.WebGLRenderer): void {
  activeRenderer = renderer;
  if (sharedKtx2Loader && !(sharedKtx2Loader as any).hasDetector) {
    sharedKtx2Loader.detectSupport(renderer);
    (sharedKtx2Loader as any).hasDetector = true;
  }
  scheduleIdleTextureProcessing();
}

export function getSharedRenderer(): THREE.WebGLRenderer | null {
  return activeRenderer;
}

/** Enqueue a single Three.js texture for background GPU upload via renderer.initTexture. */
export function enqueueTextureForUpload(tex: THREE.Texture | null | undefined): void {
  if (!tex || !tex.isTexture || knownQueuedTextures.has(tex) || uploadedTextures.has(tex)) return;
  knownQueuedTextures.add(tex);
  gpuTextureUploadQueue.push(tex);
  scheduleIdleTextureProcessing();
}

/** Traverse an Object3D hierarchy and queue every texture found on its materials. */
export function enqueueModelTexturesForUpload(root: THREE.Object3D | null | undefined): void {
  if (!root) return;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && mesh.material) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        if (!m) continue;
        const mat = m as Record<string, any>;
        if (mat.map?.isTexture) enqueueTextureForUpload(mat.map);
        if (mat.normalMap?.isTexture) enqueueTextureForUpload(mat.normalMap);
        if (mat.roughnessMap?.isTexture) enqueueTextureForUpload(mat.roughnessMap);
        if (mat.metalnessMap?.isTexture) enqueueTextureForUpload(mat.metalnessMap);
        if (mat.aoMap?.isTexture) enqueueTextureForUpload(mat.aoMap);
        if (mat.emissiveMap?.isTexture) enqueueTextureForUpload(mat.emissiveMap);
        if (mat.specularMap?.isTexture) enqueueTextureForUpload(mat.specularMap);
        if (mat.alphaMap?.isTexture) enqueueTextureForUpload(mat.alphaMap);
      }
    }
  });
}

function processIdleTextureUploads(): void {
  idleScheduled = false;
  if (!activeRenderer || gpuTextureUploadQueue.length === 0) return;
  const start = performance.now();
  // Spend at most 2ms per idle time-slice uploading textures to GPU VRAM
  while (gpuTextureUploadQueue.length > 0 && performance.now() - start < 2.0) {
    const tex = gpuTextureUploadQueue.shift();
    if (!tex) break;
    if (uploadedTextures.has(tex)) continue;
    try {
      activeRenderer.initTexture(tex);
      uploadedTextures.add(tex);
    } catch {
      /* driver/context rejected texture; skip */
    }
  }
  if (gpuTextureUploadQueue.length > 0) {
    scheduleIdleTextureProcessing();
  }
}

export function scheduleIdleTextureProcessing(): void {
  if (idleScheduled || gpuTextureUploadQueue.length === 0 || !activeRenderer) return;
  idleScheduled = true;
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(() => processIdleTextureUploads(), { timeout: 30 });
  } else {
    setTimeout(processIdleTextureUploads, 0);
  }
}

/** Remove up to `max` freshly-loaded textures for the caller to initTexture().
 *  Called by the render loop; returns [] when nothing is pending. */
export function takePendingTextureUploads(max: number): THREE.Texture[] {
  if (gpuTextureUploadQueue.length === 0) return [];
  return gpuTextureUploadQueue.splice(0, max);
}

function applySampler(
  texture: THREE.Texture,
  sampler: { magFilter?: number; minFilter?: number; wrapS?: number; wrapT?: number },
): void {
  texture.magFilter = (WEBGL_FILTERS[sampler.magFilter ?? 9729] as THREE.MagnificationTextureFilter) ?? THREE.LinearFilter;
  texture.minFilter =
    (WEBGL_FILTERS[sampler.minFilter ?? 9987] as THREE.MinificationTextureFilter) ?? THREE.LinearMipmapLinearFilter;
  texture.wrapS = WEBGL_WRAPPINGS[sampler.wrapS ?? 10497] ?? THREE.RepeatWrapping;
  texture.wrapT = WEBGL_WRAPPINGS[sampler.wrapT ?? 10497] ?? THREE.RepeatWrapping;
  texture.generateMipmaps =
    !(texture as THREE.Texture & { isCompressedTexture?: boolean }).isCompressedTexture &&
    texture.minFilter !== THREE.NearestFilter &&
    texture.minFilter !== THREE.LinearFilter;
}

function loadImageAsTexture(url: string): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    const loader = new THREE.TextureLoader();
    loader.load(
      url,
      (tex) => {
        tex.flipY = false;
        tex.needsUpdate = true;
        resolve(tex);
      },
      undefined,
      reject,
    );
  });
}

/** Register the URL→Texture share plugin on a GLTFLoader instance. */
export function enableSharedGltfTextures(loader: GLTFLoader): void {
  loader.register((parser) => ({
    name: "RC_URL_TEXTURE_CACHE",
    loadTexture(textureIndex: number) {
      const json = parser.json as {
        textures: Array<{ source: number; sampler?: number; name?: string }>;
        images: Array<{ uri?: string; name?: string; bufferView?: number; mimeType?: string }>;
        samplers?: Array<{ magFilter?: number; minFilter?: number; wrapS?: number; wrapT?: number }>;
      };
      const textureDef = json.textures[textureIndex];
      if (!textureDef) return null;
      const sourceDef = json.images[textureDef.source];
      // Embedded bufferView / data-URI images stay on the default path.
      if (!sourceDef?.uri || sourceDef.uri.startsWith("data:")) return null;

      const resolved = THREE.LoaderUtils.resolveURL(sourceDef.uri, parser.options.path);
      const sampler = json.samplers?.[textureDef.sampler ?? -1] ?? {};

      let pending = urlTextureCache.get(resolved);
      if (!pending) {
        pending = loadImageAsTexture(resolved).then((tex) => {
          tex.name = textureDef.name || sourceDef.name || sourceDef.uri || "";
          applySampler(tex, sampler);
          // Pre-upload off the first render frame (spread by the render loop).
          gpuTextureUploadQueue.push(tex);
          return tex;
        });
        urlTextureCache.set(resolved, pending);
      }

      return pending.then((tex) => {
        parser.associations.set(tex, { textures: textureIndex });
        return tex;
      });
    },
  }));
}

import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";

let sharedKtx2Loader: KTX2Loader | null = null;
let sharedDracoLoader: DRACOLoader | null = null;

export function getSharedDracoLoader(): DRACOLoader {
  if (!sharedDracoLoader) {
    sharedDracoLoader = new DRACOLoader();
    sharedDracoLoader.setDecoderPath("/assets/draco/");
  }
  return sharedDracoLoader;
}

export function getSharedKtx2Loader(renderer?: THREE.WebGLRenderer): KTX2Loader {
  if (!sharedKtx2Loader) {
    sharedKtx2Loader = new KTX2Loader();
    sharedKtx2Loader.setTranscoderPath("/assets/basis/");
  }
  if (renderer && !(sharedKtx2Loader as any).hasDetector) {
    sharedKtx2Loader.detectSupport(renderer);
    (sharedKtx2Loader as any).hasDetector = true;
  }
  return sharedKtx2Loader;
}

/** Shared GLTFLoader used by character / settlement / nature / region loads. */
export function createSharedGltfLoader(renderer?: THREE.WebGLRenderer): GLTFLoader {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  loader.setDRACOLoader(getSharedDracoLoader());
  // Always attach the shared KTX2 loader (the singleton), even without a
  // renderer yet: the module-level loader in gltf.ts is created at import time
  // before any renderer exists, but our models use KTX2 (KHR_texture_basisu)
  // textures that would silently fail to decode without it. detectSupport()
  // runs as soon as a renderer is available (getSharedKtx2Loader(renderer),
  // called from Game/TitleScene setup) on this same singleton, so by the time
  // models actually load the transcoder knows the GPU's supported formats.
  loader.setKTX2Loader(getSharedKtx2Loader(renderer));
  enableSharedGltfTextures(loader);
  return loader;
}

export function sharedTextureCacheSize(): number {
  return urlTextureCache.size;
}

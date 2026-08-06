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

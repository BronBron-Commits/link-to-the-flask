import { GLTFLoader } from '/static/GLTFLoader.js';
import { DRACOLoader } from '/static/three-addons/loaders/DRACOLoader.js';
import { KTX2Loader } from '/static/three-addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from '/static/meshopt_decoder.module.js';

const SUPPORTED_FORMATS = new Set(['gltf', 'glb', 'fbx']);
const FBX_LOADER_CDN_URL = 'https://cdn.jsdelivr.net/npm/three@0.183.0/examples/jsm/loaders/FBXLoader.js';

let cachedFbxLoaderCtor = null;
let fbxLoaderImportPromise = null;

function safeToString(value) {
  return String(value == null ? '' : value).trim();
}

function toExtension(url, typeHint = '') {
  const hint = safeToString(typeHint).toLowerCase();
  if (SUPPORTED_FORMATS.has(hint)) return hint;

  const raw = safeToString(url).split('?')[0].split('#')[0];
  const dotIndex = raw.lastIndexOf('.');
  if (dotIndex < 0) return '';

  const ext = raw.slice(dotIndex + 1).toLowerCase();
  return SUPPORTED_FORMATS.has(ext) ? ext : '';
}

function loadWithLoader(loader, url) {
  return new Promise((resolve, reject) => {
    loader.load(url, resolve, undefined, reject);
  });
}

async function resolveFbxLoaderCtor() {
  if (cachedFbxLoaderCtor) {
    return cachedFbxLoaderCtor;
  }

  if (fbxLoaderImportPromise) {
    return fbxLoaderImportPromise;
  }

  fbxLoaderImportPromise = (async () => {
    try {
      const localModule = await import('/static/three-addons/loaders/FBXLoader.js');
      if (localModule && localModule.FBXLoader) {
        cachedFbxLoaderCtor = localModule.FBXLoader;
        return cachedFbxLoaderCtor;
      }
    } catch (_localImportError) {
      // Local loader is optional while we bootstrap FBX support.
    }

    const remoteModule = await import(FBX_LOADER_CDN_URL);
    if (!remoteModule || !remoteModule.FBXLoader) {
      throw new Error('fbx-loader-module-missing-export');
    }
    cachedFbxLoaderCtor = remoteModule.FBXLoader;
    return cachedFbxLoaderCtor;
  })();

  try {
    return await fbxLoaderImportPromise;
  } finally {
    fbxLoaderImportPromise = null;
  }
}

export function createAssetImporter({
  renderer = null,
  dracoDecoderPath = '/static/three-addons/libs/draco/gltf/',
  basisTranscoderPath = '/static/three-addons/libs/basis/',
} = {}) {
  const gltfLoader = new GLTFLoader();
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath(dracoDecoderPath);

  gltfLoader.setDRACOLoader(dracoLoader);
  gltfLoader.setMeshoptDecoder(MeshoptDecoder);

  if (renderer) {
    const ktx2Loader = new KTX2Loader();
    ktx2Loader.setTranscoderPath(basisTranscoderPath);
    ktx2Loader.detectSupport(renderer);
    gltfLoader.setKTX2Loader(ktx2Loader);
  }

  async function load(url, { typeHint = '' } = {}) {
    const normalizedUrl = safeToString(url);
    if (!normalizedUrl) {
      throw new Error('asset-url-required');
    }

    const ext = toExtension(normalizedUrl, typeHint);
    if (!ext) {
      throw new Error(`unsupported-asset-format:${normalizedUrl}`);
    }

    if (ext === 'gltf' || ext === 'glb') {
      const gltf = await loadWithLoader(gltfLoader, normalizedUrl);
      const scene = gltf?.scene || (Array.isArray(gltf?.scenes) ? gltf.scenes[0] : null);
      if (!scene) {
        throw new Error(`asset-scene-missing:${normalizedUrl}`);
      }
      return {
        format: ext,
        url: normalizedUrl,
        scene,
        animations: Array.isArray(gltf?.animations) ? gltf.animations : [],
        source: gltf,
      };
    }

    const FBXLoader = await resolveFbxLoaderCtor();
    const fbxLoader = new FBXLoader();
    const fbxRoot = await loadWithLoader(fbxLoader, normalizedUrl);
    if (!fbxRoot) {
      throw new Error(`asset-scene-missing:${normalizedUrl}`);
    }

    return {
      format: 'fbx',
      url: normalizedUrl,
      scene: fbxRoot,
      animations: Array.isArray(fbxRoot.animations) ? fbxRoot.animations : [],
      source: fbxRoot,
    };
  }

  return {
    load,
    supportedFormats: ['gltf', 'glb', 'fbx'],
  };
}

import * as THREE from '/static/three.module.js';
import { GLTFLoader } from '/static/GLTFLoader.js';

function makeRenderInstanceId(prefix = 'render') {
    const suffix = Math.random().toString(36).slice(2, 10);
    return `${prefix}_${suffix}`;
}

export function buildSpawnMarkerIndex(staticRoot) {
    const out = new Map();
    if (!staticRoot) return out;

    staticRoot.traverse((obj) => {
        if (!obj || !obj.name) return;
        const key = obj.name.trim().toLowerCase();
        if (!key.startsWith('spawn_')) return;
        out.set(key, obj);
    });
    return out;
}

export function resolveSpawnTransform(spawnContract, markerIndex) {
    const markerId = (spawnContract?.preferred_marker_id || '').trim().toLowerCase();
    const marker = markerId ? markerIndex.get(markerId) : null;

    if (marker) {
        const worldPos = new THREE.Vector3();
        const worldQuat = new THREE.Quaternion();
        const worldEuler = new THREE.Euler();
        marker.getWorldPosition(worldPos);
        marker.getWorldQuaternion(worldQuat);
        worldEuler.setFromQuaternion(worldQuat, 'YXZ');
        return {
            position: worldPos,
            rotation: new THREE.Vector3(worldEuler.x, worldEuler.y, worldEuler.z),
            source: marker.name,
        };
    }

    const p = spawnContract?.fallback_position || { x: 0, y: 0, z: 0 };
    const r = spawnContract?.fallback_rotation || { x: 0, y: 0, z: 0 };
    return {
        position: new THREE.Vector3(Number(p.x) || 0, Number(p.y) || 0, Number(p.z) || 0),
        rotation: new THREE.Vector3(Number(r.x) || 0, Number(r.y) || 0, Number(r.z) || 0),
        source: 'fallback',
    };
}

function createFallbackShell(entityId) {
    const geom = new THREE.CapsuleGeometry(0.22, 1.0, 4, 8);
    const mat = new THREE.MeshStandardMaterial({ color: 0x5dc0ff, roughness: 0.6, metalness: 0.1 });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.name = `entity_shell_${entityId || 'unknown'}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.entityId = entityId || null;
    return mesh;
}

function loadGltfAsShell(path, entityId) {
    return new Promise((resolve, reject) => {
        const loader = new GLTFLoader();
        loader.load(
            path,
            (gltf) => {
                const root = gltf.scene;
                root.name = `entity_shell_${entityId || 'unknown'}`;
                root.userData.entityId = entityId || null;
                root.traverse((child) => {
                    if (!child.isMesh) return;
                    child.castShadow = true;
                    child.receiveShadow = true;
                });
                resolve(root);
            },
            undefined,
            reject
        );
    });
}

export async function spawnEntityFromContracts(config) {
    const {
        templateRecord,
        runtimeRecord,
        staticRoot,
        scene,
        resolveAssetPath,
    } = config;

    const entityId = runtimeRecord?.character_id || templateRecord?.source?.character_id || null;
    const markerIndex = buildSpawnMarkerIndex(staticRoot);
    const spawn = resolveSpawnTransform(templateRecord?.spawn_markers, markerIndex);

    const assetKey = templateRecord?.asset_manifest_refs?.entity_asset_key || null;
    const assetSpec = assetKey && resolveAssetPath ? resolveAssetPath(assetKey) : null;
    const assetPath = typeof assetSpec === 'string' ? assetSpec : assetSpec?.path || null;
    const assetScale = typeof assetSpec === 'object' && typeof assetSpec?.scale === 'number' ? assetSpec.scale : 1;

    let shell;
    if (assetPath) {
        try {
            shell = await loadGltfAsShell(assetPath, entityId);
        } catch (_err) {
            shell = createFallbackShell(entityId);
        }
    } else {
        shell = createFallbackShell(entityId);
    }

    shell.position.copy(spawn.position);
    shell.rotation.set(spawn.rotation.x, spawn.rotation.y, spawn.rotation.z);
    shell.scale.setScalar(assetScale);
    scene.add(shell);

    const updatedRuntime = structuredClone(runtimeRecord || {});
    const binding = updatedRuntime.render_registry_binding || {};
    updatedRuntime.render_registry_binding = {
        ...binding,
        entity_id: entityId,
        render_instance_id: makeRenderInstanceId('entity'),
        attachments: Array.isArray(binding.attachments) ? binding.attachments : [],
        last_sync_tick: Number(binding.last_sync_tick) || 1,
    };

    return {
        shell,
        spawnSource: spawn.source,
        runtimeRecord: updatedRuntime,
    };
}

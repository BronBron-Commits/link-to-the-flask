export function createScenePersistenceManager(deps = {}) {
    const {
        THREE,
        scene,
        getSocket,
        getMaterialTextureAnim,
        setMaterialTextureAnimAxis,
        serializeLight,
        applyStateToLight,
        createUserPointLight,
        isSceneReadyForWorldState,
        traceDmPipeline,
        setPendingSceneState,
        updateInspectorMenu,
        hydrateWorld,
        getInspectorMenu,
    } = deps;

    const MATERIALS_STATE_SCHEMA_VERSION = 'materials.v1';

    function sanitizePersistToken(value) {
        return String(value || '')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9_\-]+/g, '_')
            .replace(/^_+|_+$/g, '');
    }

    function getMeshPersistentId(mesh) {
        const existing = mesh?.userData?.persistId;
        if (typeof existing === 'string' && existing.trim()) return existing.trim();
        return null;
    }

    function ensurePersistentMeshIds() {
        let autoIndex = 0;
        scene.traverse((obj) => {
            if (!obj || !obj.isMesh) return;
            const existing = getMeshPersistentId(obj);
            if (existing) return;
            const fromName = sanitizePersistToken(obj.name);
            const id = fromName || `mesh_auto_${autoIndex++}`;
            obj.userData.persistId = id;
        });
    }

    function getPersistableTextureMapUrl(mat) {
        const src = mat?.map?.image?.src;
        if (typeof src !== 'string') return null;
        const value = src.trim();
        if (!value) return null;
        if (value.startsWith('blob:') || value.startsWith('data:')) return null;
        return value;
    }

    function serializeMaterial(mat) {
        if (!mat) return null;
        const textureAnim = getMaterialTextureAnim(mat);
        return {
            type: mat.type,
            color: mat.color ? mat.color.getHex() : null,
            emissive: mat.emissive ? mat.emissive.getHex() : null,
            metalness: typeof mat.metalness === 'number' ? mat.metalness : undefined,
            roughness: typeof mat.roughness === 'number' ? mat.roughness : undefined,
            opacity: typeof mat.opacity === 'number' ? mat.opacity : undefined,
            wireframe: typeof mat.wireframe === 'boolean' ? mat.wireframe : undefined,
            map: getPersistableTextureMapUrl(mat),
            textureAnim,
        };
    }

    function emitMaterialChange(obj, materialIndex = 0) {
        const socket = getSocket();
        if (!socket || !obj || !obj.isMesh) return;
        const mat = Array.isArray(obj.material)
            ? obj.material[materialIndex]
            : obj.material;
        const objectId = getMeshPersistentId(obj) || (obj.name && obj.name.trim() ? obj.name : `${obj.type}_${obj.id}`);
        socket.emit('scene-update', {
            type: 'material',
            objectId,
            name: obj.name,
            materialIndex,
            materialState: serializeMaterial(mat),
        });
    }

    function findMeshByPersistentId(objectId) {
        let found = null;
        scene.traverse((obj) => {
            if (obj.isMesh && getMeshPersistentId(obj) === objectId) {
                found = obj;
            }
        });
        return found;
    }

    function findMeshByName(name) {
        let found = null;
        scene.traverse((obj) => {
            if (!obj.isMesh) return;
            const n = obj.name && obj.name.trim() ? obj.name : `${obj.type}_${obj.id}`;
            if (n === name) found = obj;
        });
        return found;
    }

    function serializeObject(obj) {
        if (!obj.isMesh) return null;
        const name = obj.name && obj.name.trim() ? obj.name : `${obj.type}_${obj.id}`;
        const objectId = getMeshPersistentId(obj) || name;
        let materials = null;
        if (Array.isArray(obj.material)) {
            materials = obj.material.map((m) => serializeMaterial(m));
        } else if (obj.material) {
            materials = [serializeMaterial(obj.material)];
        }
        return {
            objectId,
            name,
            position: { x: obj.position.x, y: obj.position.y, z: obj.position.z },
            rotation: { x: obj.rotation.x, y: obj.rotation.y, z: obj.rotation.z },
            scale: { x: obj.scale.x, y: obj.scale.y, z: obj.scale.z },
            materials,
        };
    }

    function serializeScene() {
        ensurePersistentMeshIds();
        const objects = {};
        const lights = {};
        scene.traverse((obj) => {
            const data = serializeObject(obj);
            if (data) objects[data.objectId] = data;

            const lightData = serializeLight(obj);
            if (lightData) lights[lightData.name] = lightData;
        });
        return { objects, lights };
    }

    function applyMaterialState(mat, state, mesh) {
        if (!mat || !state) return;
        if (mat.type !== state.type && THREE[state.type]) {
            const newMat = new THREE[state.type]();
            if (Array.isArray(mesh.material)) {
                const index = mesh.material.indexOf(mat);
                if (index !== -1) mesh.material[index] = newMat;
            } else {
                mesh.material = newMat;
            }
            mat = newMat;
        }
        if (state.color !== null && state.color !== undefined && mat.color) mat.color.setHex(state.color);
        if (state.emissive !== null && state.emissive !== undefined && mat.emissive) mat.emissive.setHex(state.emissive);
        if (typeof state.metalness === 'number') mat.metalness = state.metalness;
        if (typeof state.roughness === 'number') mat.roughness = state.roughness;
        if (typeof state.opacity === 'number') mat.opacity = state.opacity;
        if (typeof state.wireframe === 'boolean') mat.wireframe = state.wireframe;
        if (state.textureAnim) {
            setMaterialTextureAnimAxis(mat, 'x', state.textureAnim.x);
            setMaterialTextureAnimAxis(mat, 'y', state.textureAnim.y);
            setMaterialTextureAnimAxis(mat, 'z', state.textureAnim.z);
        }
        const mapUrl = typeof state.map === 'string' ? state.map.trim() : '';
        if (mapUrl && mapUrl !== 'undefined' && mapUrl !== 'null') {
            new THREE.TextureLoader().load(mapUrl, (tex) => {
                mat.map = tex;
                mat.needsUpdate = true;
            });
        }
        mat.needsUpdate = true;
    }

    function serializeMaterialOverrides() {
        ensurePersistentMeshIds();
        const materials = {};
        scene.traverse((obj) => {
            if (!obj || !obj.isMesh || !obj.material) return;
            const objectId = getMeshPersistentId(obj);
            if (!objectId) return;
            const rows = Array.isArray(obj.material)
                ? obj.material.map((mat, materialIndex) => ({ materialIndex, materialState: serializeMaterial(mat) }))
                : [{ materialIndex: 0, materialState: serializeMaterial(obj.material) }];
            materials[objectId] = {
                name: obj.name || '',
                materials: rows,
            };
        });
        return {
            schemaVersion: MATERIALS_STATE_SCHEMA_VERSION,
            updatedAt: new Date().toISOString(),
            worldId: 'map3d',
            materials,
        };
    }

    function applyMaterialOverrides(payload) {
        if (!payload || typeof payload !== 'object') return;
        const materials = payload.materials;
        if (!materials || typeof materials !== 'object') return;
        ensurePersistentMeshIds();

        for (const objectId in materials) {
            const row = materials[objectId];
            if (!row || typeof row !== 'object') continue;
            const mesh = findMeshByPersistentId(objectId) || (row.name ? findMeshByName(row.name) : null);
            if (!mesh || !mesh.material) continue;
            const entries = Array.isArray(row.materials) ? row.materials : [];
            for (const item of entries) {
                const idx = Number.isInteger(item?.materialIndex) ? item.materialIndex : 0;
                const state = item?.materialState;
                if (!state) continue;
                if (Array.isArray(mesh.material)) {
                    if (mesh.material[idx]) applyMaterialState(mesh.material[idx], state, mesh);
                } else if (idx === 0) {
                    applyMaterialState(mesh.material, state, mesh);
                }
            }
        }
    }

    function applyStateToObject(obj, state) {
        if (!obj.isMesh) return;
        if (state.position) obj.position.set(state.position.x, state.position.y, state.position.z);
        if (state.rotation) obj.rotation.set(state.rotation.x, state.rotation.y, state.rotation.z);
        if (state.scale) obj.scale.set(state.scale.x, state.scale.y, state.scale.z);
        if (state.materials && obj.material) {
            if (Array.isArray(obj.material)) {
                for (let i = 0; i < obj.material.length; i += 1) {
                    if (state.materials[i]) applyMaterialState(obj.material[i], state.materials[i], obj);
                }
            } else if (state.materials[0]) {
                applyMaterialState(obj.material, state.materials[0], obj);
            }
        }
    }

    function applySceneState(state) {
        if (!state || !state.objects) return;
        if (!isSceneReadyForWorldState()) {
            setPendingSceneState(state);
            traceDmPipeline('SCENE STATE QUEUED', {
                objectCount: Object.keys(state.objects || {}).length,
            });
            return;
        }
        ensurePersistentMeshIds();
        const meshById = {};
        const meshByName = {};
        scene.traverse((obj) => {
            if (obj.isMesh) {
                const name = obj.name && obj.name.trim() ? obj.name : `${obj.type}_${obj.id}`;
                const objectId = getMeshPersistentId(obj) || name;
                meshById[objectId] = obj;
                meshByName[name] = obj;
            }
        });
        for (const objectKey in state.objects) {
            const objectState = state.objects[objectKey];
            const objectId = objectState?.objectId || objectKey;
            const mesh = meshById[objectId] || (objectState?.name ? meshByName[objectState.name] : null);
            if (mesh) {
                applyStateToObject(mesh, objectState);
            }
        }

        const lightMap = {};
        scene.traverse((obj) => {
            if (obj.isPointLight && obj.userData.isUserLight) {
                lightMap[obj.name] = obj;
            }
        });
        if (state.lights) {
            for (const name in state.lights) {
                if (lightMap[name]) {
                    applyStateToLight(lightMap[name], state.lights[name]);
                } else {
                    const newLight = createUserPointLight(state.lights[name]);
                    scene.add(newLight);
                }
            }
        }

        updateInspectorMenu();
    }

    function addSaveLoadButtonsToInspector() {
        const inspectorMenu = getInspectorMenu();
        if (!inspectorMenu) return;

        const old = inspectorMenu.querySelector('.inspector-save-load');
        if (old) old.remove();
        const btnContainer = document.createElement('div');
        btnContainer.className = 'inspector-save-load';
        btnContainer.style.display = 'flex';
        btnContainer.style.flexDirection = 'column';
        btnContainer.style.gap = '12px';
        btnContainer.style.position = 'absolute';
        btnContainer.style.bottom = '24px';
        btnContainer.style.left = '0';
        btnContainer.style.width = '100%';
        btnContainer.style.alignItems = 'center';
        btnContainer.style.pointerEvents = 'auto';

        const saveBtn = document.createElement('button');
        saveBtn.textContent = 'Save Scene State';
        saveBtn.style.padding = '10px 18px';
        saveBtn.style.background = '#1976d2';
        saveBtn.style.color = '#fff';
        saveBtn.style.border = 'none';
        saveBtn.style.borderRadius = '6px';
        saveBtn.style.fontSize = '17px';
        saveBtn.style.cursor = 'pointer';
        saveBtn.style.width = '85%';
        saveBtn.onclick = () => {
            const state = serializeScene();
            const materialState = serializeMaterialOverrides();
            Promise.all([
                fetch('/scene_state', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(state),
                }),
                fetch('/materials_state', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(materialState),
                }),
            ])
                .then(async ([sceneRes, materialRes]) => {
                    const sceneData = await sceneRes.json();
                    const materialData = await materialRes.json();
                    if (sceneRes.ok && materialRes.ok && sceneData.ok && materialData.ok) {
                        alert('Scene and material state saved!');
                    } else {
                        alert('Failed to save scene/material state.');
                    }
                })
                .catch((err) => {
                    console.warn('Save failed:', err);
                    alert('Failed to save scene/material state.');
                });
        };
        btnContainer.appendChild(saveBtn);

        const loadBtn = document.createElement('button');
        loadBtn.textContent = 'Load Scene State';
        loadBtn.style.padding = '10px 18px';
        loadBtn.style.background = '#388e3c';
        loadBtn.style.color = '#fff';
        loadBtn.style.border = 'none';
        loadBtn.style.borderRadius = '6px';
        loadBtn.style.fontSize = '17px';
        loadBtn.style.cursor = 'pointer';
        loadBtn.style.width = '85%';
        loadBtn.onclick = () => {
            Promise.all([
                fetch('/scene_state').then((r) => {
                    if (!r.ok) throw new Error(`Scene state unavailable (${r.status})`);
                    const contentType = r.headers.get('content-type') || '';
                    if (!contentType.includes('application/json')) {
                        throw new Error('Scene state endpoint did not return JSON');
                    }
                    return r.json();
                }),
                fetch('/materials_state').then((r) => {
                    if (!r.ok) throw new Error(`Materials state unavailable (${r.status})`);
                    const contentType = r.headers.get('content-type') || '';
                    if (!contentType.includes('application/json')) {
                        throw new Error('Materials state endpoint did not return JSON');
                    }
                    return r.json();
                }),
            ])
                .then(([sceneState, materialState]) => {
                    hydrateWorld(sceneState);
                    applyMaterialOverrides(materialState);
                    alert('Scene and material state loaded!');
                })
                .catch((err) => {
                    console.warn('Could not load scene state from button:', err);
                    alert('Scene/material state is unavailable on this server.');
                });
        };
        btnContainer.appendChild(loadBtn);

        inspectorMenu.appendChild(btnContainer);
    }

    return {
        sanitizePersistToken,
        getMeshPersistentId,
        ensurePersistentMeshIds,
        getPersistableTextureMapUrl,
        serializeMaterial,
        emitMaterialChange,
        findMeshByPersistentId,
        findMeshByName,
        serializeObject,
        serializeScene,
        applyMaterialState,
        serializeMaterialOverrides,
        applyMaterialOverrides,
        applyStateToObject,
        applySceneState,
        addSaveLoadButtonsToInspector,
    };
}

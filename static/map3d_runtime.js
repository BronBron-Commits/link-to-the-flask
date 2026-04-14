import * as THREE from './three.module.js';
import { GLTFLoader } from './GLTFLoader.js';

const DEFAULT_TEAM_COLORS = {
    player: 0x4cc9f0,
    enemy: 0xff6b6b,
    neutral: 0xcfd8dc,
};

function clampNumber(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

export function createMap3dRuntime({ scene, camera, renderer }) {
    const canRenderActorLabels =
        typeof document !== 'undefined'
        && typeof document.createElement === 'function'
        && !!THREE.CanvasTexture
        && !!THREE.SpriteMaterial
        && !!THREE.Sprite;

    // actorMeshes stores THREE.Group containers; actorHitObjects stores their body children for raycasting
    const actorMeshes = new Map();
    const actorLabels = new Map();
    const actorLabelSprites = new Map();
    const intentListeners = new Set();
    const actorHitObjects = [];

    let playerModelUrl = null;
    let enemyModelUrl = null;
    const modelCache = new Map();   // url → THREE.Group (loaded GLB scene)
    const pendingLoads = new Set();
    let lastSnapshot = null;

    const gltfLoader = new GLTFLoader();

    let snapshotMeta = {
        canMove: true,
        canAttack: true,
        canEndTurn: true,
    };

    // ── GLB model loading ────────────────────────────────────────────────────

    function loadGlbModel(url) {
        if (pendingLoads.has(url) || modelCache.has(url)) return;
        pendingLoads.add(url);
        gltfLoader.load(url, (gltf) => {
            pendingLoads.delete(url);
            modelCache.set(url, gltf.scene);
            rebuildActorsForModelUrl(url);
            if (lastSnapshot) applySnapshot(lastSnapshot);
        }, undefined, (err) => {
            console.warn('[MAP3D] Failed to load model:', url, err);
            pendingLoads.delete(url);
        });
    }

    function normalizeModelScale(modelGroup) {
        const box = new THREE.Box3().setFromObject(modelGroup);
        const size = new THREE.Vector3();
        box.getSize(size);
        const height = size.y > 0 ? size.y : 1;
        modelGroup.scale.setScalar(1.4 / height);
        // Re-center so model is vertically centered at origin (matching box pivot)
        const box2 = new THREE.Box3().setFromObject(modelGroup);
        const center = new THREE.Vector3();
        box2.getCenter(center);
        modelGroup.position.x -= center.x;
        modelGroup.position.z -= center.z;
        modelGroup.position.y -= center.y;
    }

    function buildFallbackBody(team = 'neutral') {
        const isPlayer = String(team || '').toLowerCase() === 'player';
        const geometry = isPlayer
            ? new THREE.SphereGeometry(0.52, 20, 16)
            : new THREE.BoxGeometry(0.9, 1.4, 0.9);
        const mesh = new THREE.Mesh(
            geometry,
            new THREE.MeshStandardMaterial({ color: 0xcfd8dc, roughness: 0.7, metalness: 0.1 })
        );
        mesh.userData.isFallback = true;
        mesh.userData.fallbackShape = isPlayer ? 'sphere' : 'box';
        mesh.renderOrder = 160;
        return mesh;
    }

    function buildGlbBody(url) {
        const loaded = modelCache.get(url);
        if (!loaded) return null;
        const group = loaded.clone();
        normalizeModelScale(group);
        group.userData.isGlb = true;
        group.traverse((child) => {
            if (child.isMesh) child.renderOrder = 160;
        });
        return group;
    }

    function rebuildActorsForModelUrl(url) {
        for (const [, group] of actorMeshes) {
            if (group.userData.modelUrl === url) {
                replaceActorBody(group, url);
            }
        }
    }

    function replaceActorBody(group, wantUrl) {
        const oldBody = group.userData.bodyObject;
        if (oldBody) {
            group.remove(oldBody);
            const hitIdx = actorHitObjects.indexOf(oldBody);
            if (hitIdx >= 0) actorHitObjects.splice(hitIdx, 1);
            if (oldBody.userData.isFallback) {
                if (oldBody.geometry) oldBody.geometry.dispose();
                if (oldBody.material) oldBody.material.dispose();
            }
        }

        let newBody;
        const actorTeam = String(group?.userData?.team || 'neutral').toLowerCase();
        if (wantUrl && modelCache.has(wantUrl)) {
            newBody = buildGlbBody(wantUrl);
        }
        if (!newBody) {
            newBody = buildFallbackBody(actorTeam);
            if (wantUrl && !pendingLoads.has(wantUrl) && !modelCache.has(wantUrl)) {
                loadGlbModel(wantUrl);
            }
        }

        newBody.userData.actorId = group.userData.actorId;
        group.add(newBody);
        group.userData.bodyObject = newBody;
        group.userData.modelUrl = wantUrl || 'box';
        actorHitObjects.push(newBody);
    }

    // ── Intents ──────────────────────────────────────────────────────────────

    function emitIntent(type, payload) {
        const intent = {
            type,
            payload: payload || {},
            at: Date.now(),
        };
        for (const listener of intentListeners) {
            listener(intent);
        }
    }

    // ── Actor appearance ─────────────────────────────────────────────────────

    function getActorColor(actor) {
        const team = String(actor?.team || 'neutral').toLowerCase();
        return DEFAULT_TEAM_COLORS[team] || DEFAULT_TEAM_COLORS.neutral;
    }

    function setActorAppearance(group, actor) {
        group.userData.actorId = actor.id;
        group.userData.team = String(actor?.team || 'neutral').toLowerCase();
        // Tint box placeholders with team color; GLB models keep their own materials
        const body = group.userData.bodyObject;
        if (body && body.userData.isFallback && body.material && body.material.color) {
            body.material.color.setHex(getActorColor(actor));
        }
        if (body) body.userData.actorId = actor.id;
    }

    function drawActorLabel(sprite, actor) {
        const canvas = sprite?.userData?.canvas;
        const ctx = sprite?.userData?.ctx;
        if (!canvas || !ctx) return;

        const width = canvas.width;
        const height = canvas.height;
        const hp = clampNumber(actor?.hp, 0);
        const maxHp = Math.max(1, clampNumber(actor?.maxHp, hp || 1));
        const alive = hp > 0;
        const label = String(actor?.label || actor?.id || 'actor');

        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = 'rgba(8, 11, 20, 0.78)';
        ctx.fillRect(0, 0, width, height);
        ctx.strokeStyle = alive ? 'rgba(133, 180, 255, 0.95)' : 'rgba(255, 120, 120, 0.95)';
        ctx.lineWidth = 3;
        ctx.strokeRect(0, 0, width, height);

        ctx.fillStyle = '#f1f6ff';
        ctx.font = 'bold 22px monospace';
        ctx.textBaseline = 'top';
        ctx.fillText(label, 8, 6);

        ctx.fillStyle = alive ? '#9be48f' : '#ff8b8b';
        ctx.font = '18px monospace';
        ctx.fillText(`HP ${Math.max(0, Math.round(hp))}/${Math.round(maxHp)}`, 8, 34);

        if (sprite.material && sprite.material.map) {
            sprite.material.map.needsUpdate = true;
        }
    }

    function ensureActorLabelSprite(actorId) {
        if (!canRenderActorLabels) return null;

        let sprite = actorLabelSprites.get(actorId);
        if (sprite) return sprite;

        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 72;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;

        const texture = new THREE.CanvasTexture(canvas);
        if (THREE.LinearFilter) {
            texture.minFilter = THREE.LinearFilter;
            texture.magFilter = THREE.LinearFilter;
        }

        const material = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            depthWrite: false,
        });

        sprite = new THREE.Sprite(material);
        sprite.scale.set(3.6, 1.0, 1);
        sprite.position.set(0, 1.3, 0);
        // Keep stat labels above world overlays like the move-grid.
        sprite.renderOrder = 220;
        sprite.userData.canvas = canvas;
        sprite.userData.ctx = ctx;
        actorLabelSprites.set(actorId, sprite);
        return sprite;
    }

    function ensureActorMesh(actor) {
        const actorId = String(actor.id || '').trim();
        if (!actorId) return null;

        const team = String(actor?.team || 'neutral').toLowerCase();
        const wantUrl = team === 'player' ? playerModelUrl : (team === 'enemy' ? enemyModelUrl : null);

        let group = actorMeshes.get(actorId);

        // Rebuild body if model URL changed for this actor
        if (group && group.userData.modelUrl !== (wantUrl || 'box')) {
            replaceActorBody(group, wantUrl);
        }

        if (!group) {
            group = new THREE.Group();
            group.userData.actorId = actorId;
            group.userData.team = team;
            group.userData.modelUrl = wantUrl || 'box';
            scene.add(group);
            actorMeshes.set(actorId, group);

            let body;
            if (wantUrl && modelCache.has(wantUrl)) {
                body = buildGlbBody(wantUrl);
                if (!body) body = buildFallbackBody(team);
            } else {
                body = buildFallbackBody(team);
                if (wantUrl) loadGlbModel(wantUrl);
            }
            body.userData.actorId = actorId;
            group.add(body);
            group.userData.bodyObject = body;
            actorHitObjects.push(body);
        }

        const labelSprite = ensureActorLabelSprite(actorId);
        if (labelSprite && labelSprite.parent !== group) {
            group.add(labelSprite);
        }

        setActorAppearance(group, actor);
        if (labelSprite) {
            drawActorLabel(labelSprite, actor);
        }
        return group;
    }

    function updateActorFromState(actor) {
        const group = ensureActorMesh(actor);
        if (!group) return;

        group.position.set(
            clampNumber(actor?.position?.x, 0),
            clampNumber(actor?.position?.y, 0.7),
            clampNumber(actor?.position?.z, 0)
        );

        group.rotation.y = clampNumber(actor?.rotation?.y, 0);

        // HP-based scale only on box placeholders (GLB models stay at natural scale)
        const body = group.userData.bodyObject;
        if (body && body.userData.fallbackShape === 'box') {
            const hp = clampNumber(actor?.hp, 0);
            const maxHp = Math.max(1, clampNumber(actor?.maxHp, hp || 1));
            body.scale.y = 0.7 + Math.max(0.25, Math.min(1, hp / maxHp)) * 0.7;
        }
    }

    function removeActor(actorId) {
        const id = String(actorId || '').trim();
        if (!id) return;
        const group = actorMeshes.get(id);
        if (!group) return;

        const body = group.userData.bodyObject;
        if (body) {
            const hitIdx = actorHitObjects.indexOf(body);
            if (hitIdx >= 0) actorHitObjects.splice(hitIdx, 1);
            if (body.userData.isFallback) {
                if (body.geometry) body.geometry.dispose();
                if (body.material) body.material.dispose();
            }
        }

        scene.remove(group);
        actorMeshes.delete(id);
        actorLabels.delete(id);

        const sprite = actorLabelSprites.get(id);
        if (sprite) {
            if (sprite.parent) {
                sprite.parent.remove(sprite);
            }
            if (sprite.material && sprite.material.map) {
                sprite.material.map.dispose();
            }
            if (sprite.material) {
                sprite.material.dispose();
            }
            actorLabelSprites.delete(id);
        }
    }

    function applyActorHighlights() {
        const turnActorId = String(snapshotMeta.currentTurnActorId || '').trim();
        const targetActorId = String(snapshotMeta.selectedTargetId || '').trim();

        actorMeshes.forEach((group, actorId) => {
            const isTurnActor = !!turnActorId && actorId === turnActorId;
            const isTargetActor = !!targetActorId && actorId === targetActorId;

            let emissiveHex = 0x000000;
            let emissiveIntensity = 0;
            if (isTurnActor && isTargetActor) {
                emissiveHex = 0xffc107; emissiveIntensity = 0.95;
            } else if (isTurnActor) {
                emissiveHex = 0xffe082; emissiveIntensity = 0.8;
            } else if (isTargetActor) {
                emissiveHex = 0xff6f61; emissiveIntensity = 0.9;
            }

            group.traverse((child) => {
                if (child.isMesh && child.material && child.material.emissive) {
                    child.material.emissive.setHex(emissiveHex);
                    child.material.emissiveIntensity = emissiveIntensity;
                }
            });
        });
    }

    function applySnapshot(snapshot) {
        const safe = snapshot && typeof snapshot === 'object' ? snapshot : {};
        lastSnapshot = safe;
        const actors = Array.isArray(safe.actors) ? safe.actors : [];

        snapshotMeta = {
            canMove: safe.canMove !== false,
            canAttack: safe.canAttack !== false,
            canEndTurn: safe.canEndTurn !== false,
            currentTurnActorId: safe.currentTurnActorId || null,
            selectedTargetId: safe.selectedTargetId || null,
        };

        const aliveIds = new Set();
        for (const actor of actors) {
            if (!actor || !actor.id) continue;
            const id = String(actor.id);
            aliveIds.add(id);
            actorLabels.set(id, actor.label || id);
            updateActorFromState(actor);
        }

        for (const existingId of Array.from(actorMeshes.keys())) {
            if (!aliveIds.has(existingId)) {
                removeActor(existingId);
            }
        }

        applyActorHighlights();
    }

    function applyEvent(event) {
        if (!event || typeof event !== 'object') return;

        switch (event.type) {
            case 'actor:upsert':
                if (event.actor) updateActorFromState(event.actor);
                break;
            case 'actor:remove':
                removeActor(event.actorId);
                break;
            case 'state:flags':
                snapshotMeta = {
                    ...snapshotMeta,
                    ...(event.flags || {}),
                };
                break;
            default:
                break;
        }
    }

    function start() {
        // Runtime intentionally stays side-effect free for input wiring.
    }

    function stop() {
        // Runtime intentionally stays side-effect free for input wiring.
    }

    function setModelUrl(team, url) {
        const normalUrl = url || null;
        if (team === 'player') playerModelUrl = normalUrl;
        else if (team === 'enemy') enemyModelUrl = normalUrl;
        else return;

        // Mark existing actors of this team stale so next ensureActorMesh rebuilds their body
        for (const [, group] of actorMeshes) {
            if (group.userData.team === team) {
                group.userData.modelUrl = '__stale__';
            }
        }

        if (normalUrl && !modelCache.has(normalUrl)) {
            loadGlbModel(normalUrl);
        } else if (lastSnapshot) {
            // Model already in cache (or cleared) — re-apply to rebuild actors immediately
            applySnapshot(lastSnapshot);
        }
    }

    function onIntent(handler) {
        if (typeof handler !== 'function') {
            return () => {};
        }
        intentListeners.add(handler);
        return () => {
            intentListeners.delete(handler);
        };
    }

    return {
        start,
        stop,
        onIntent,
        emitIntent,
        applySnapshot,
        applyEvent,
        setModelUrl,
        getActorHitObjects() {
            return actorHitObjects;
        },
        getInputFlags() {
            return { ...snapshotMeta };
        },
        getDebugState() {
            return {
                actorCount: actorMeshes.size,
                flags: { ...snapshotMeta },
            };
        },
    };
}
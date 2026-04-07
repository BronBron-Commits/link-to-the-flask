import * as THREE from './three.module.js';

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
    const actorMeshes = new Map();
    const actorLabels = new Map();
    const intentListeners = new Set();
    const actorHitObjects = [];

    let snapshotMeta = {
        canMove: true,
        canAttack: true,
        canEndTurn: true,
    };

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

    function getActorColor(actor) {
        const team = String(actor?.team || 'neutral').toLowerCase();
        return DEFAULT_TEAM_COLORS[team] || DEFAULT_TEAM_COLORS.neutral;
    }

    function setActorAppearance(mesh, actor) {
        const color = getActorColor(actor);
        if (mesh.material && mesh.material.color) {
            mesh.material.color.setHex(color);
        }
        mesh.userData.actorId = actor.id;
    }

    function ensureActorMesh(actor) {
        const actorId = String(actor.id || '').trim();
        if (!actorId) return null;

        let mesh = actorMeshes.get(actorId);
        if (!mesh) {
            mesh = new THREE.Mesh(
                new THREE.BoxGeometry(0.9, 1.4, 0.9),
                new THREE.MeshStandardMaterial({ color: 0xcfd8dc, roughness: 0.7, metalness: 0.1 })
            );
            mesh.userData.actorId = actorId;
            scene.add(mesh);
            actorMeshes.set(actorId, mesh);
            actorHitObjects.push(mesh);
        }
        setActorAppearance(mesh, actor);
        return mesh;
    }

    function updateActorFromState(actor) {
        const mesh = ensureActorMesh(actor);
        if (!mesh) return;

        mesh.position.set(
            clampNumber(actor?.position?.x, 0),
            clampNumber(actor?.position?.y, 0.7),
            clampNumber(actor?.position?.z, 0)
        );

        mesh.rotation.y = clampNumber(actor?.rotation?.y, 0);

        const hp = clampNumber(actor?.hp, 0);
        const maxHp = Math.max(1, clampNumber(actor?.maxHp, hp || 1));
        mesh.scale.y = 0.7 + Math.max(0.25, Math.min(1, hp / maxHp)) * 0.7;
    }

    function removeActor(actorId) {
        const id = String(actorId || '').trim();
        if (!id) return;
        const mesh = actorMeshes.get(id);
        if (!mesh) return;

        const hitIndex = actorHitObjects.indexOf(mesh);
        if (hitIndex >= 0) {
            actorHitObjects.splice(hitIndex, 1);
        }

        scene.remove(mesh);
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material) mesh.material.dispose();
        actorMeshes.delete(id);
        actorLabels.delete(id);
    }

    function applySnapshot(snapshot) {
        const safe = snapshot && typeof snapshot === 'object' ? snapshot : {};
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
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
    const canRenderActorLabels =
        typeof document !== 'undefined'
        && typeof document.createElement === 'function'
        && !!THREE.CanvasTexture
        && !!THREE.SpriteMaterial
        && !!THREE.Sprite;

    const actorMeshes = new Map();
    const actorOverlays = new Map();
    const actorLabels = new Map();
    const actorLabelSprites = new Map();
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
        sprite.userData.canvas = canvas;
        sprite.userData.ctx = ctx;
        actorLabelSprites.set(actorId, sprite);
        return sprite;
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

        const labelSprite = ensureActorLabelSprite(actorId);
        if (labelSprite && labelSprite.parent !== mesh) {
            mesh.add(labelSprite);
        }

        setActorAppearance(mesh, actor);
        ensureActorOverlay(mesh, actor);
        if (labelSprite) {
            drawActorLabel(labelSprite, actor);
        }
        return mesh;
    }

    function ensureActorOverlay(mesh, actor) {
        if (!mesh || !mesh.geometry) return;
        const actorId = String(actor?.id || mesh.userData?.actorId || '').trim();
        if (!actorId) return;

        let overlay = actorOverlays.get(actorId);
        if (!overlay) {
            overlay = new THREE.LineSegments(
                new THREE.WireframeGeometry(mesh.geometry),
                new THREE.LineBasicMaterial({
                    color: 0x8fbfff,
                    transparent: true,
                    opacity: 0.3,
                    depthTest: false,
                    depthWrite: false,
                })
            );
            overlay.renderOrder = 60;
            mesh.add(overlay);
            actorOverlays.set(actorId, overlay);
        }

        const team = String(actor?.team || 'neutral').toLowerCase();
        if (overlay.material && overlay.material.color) {
            if (team === 'enemy') {
                overlay.material.color.setHex(0xff8f8f);
            } else if (team === 'player') {
                overlay.material.color.setHex(0x8fbfff);
            } else {
                overlay.material.color.setHex(0xbac6d3);
            }
        }
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

        const overlay = actorOverlays.get(id);
        if (overlay) {
            if (overlay.parent) {
                overlay.parent.remove(overlay);
            }
            if (overlay.geometry) {
                overlay.geometry.dispose();
            }
            if (overlay.material) {
                overlay.material.dispose();
            }
            actorOverlays.delete(id);
        }

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

        actorMeshes.forEach((mesh, actorId) => {
            if (!mesh.material) return;

            const isTurnActor = !!turnActorId && actorId === turnActorId;
            const isTargetActor = !!targetActorId && actorId === targetActorId;

            if (mesh.material.emissive && typeof mesh.material.emissive.setHex === 'function') {
                if (isTurnActor && isTargetActor) {
                    mesh.material.emissive.setHex(0xffc107);
                    mesh.material.emissiveIntensity = 0.95;
                } else if (isTurnActor) {
                    mesh.material.emissive.setHex(0xffe082);
                    mesh.material.emissiveIntensity = 0.8;
                } else if (isTargetActor) {
                    mesh.material.emissive.setHex(0xff6f61);
                    mesh.material.emissiveIntensity = 0.9;
                } else {
                    mesh.material.emissive.setHex(0x000000);
                    mesh.material.emissiveIntensity = 0;
                }
            }
        });
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
import * as THREE from './three.module.js';

export function createMap3dControls({
    camera,
    renderer,
    getActorHitObjects,
    getInputFlags,
    emitIntent,
}) {
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    function readFlags() {
        const flags = typeof getInputFlags === 'function' ? getInputFlags() : null;
        return {
            canMove: flags?.canMove !== false,
            canAttack: flags?.canAttack !== false,
            canEndTurn: flags?.canEndTurn !== false,
        };
    }

    function dispatch(type, payload) {
        if (typeof emitIntent === 'function') {
            emitIntent(type, payload || {});
        }
    }

    function onPointerDown(domEvent) {
        const flags = readFlags();
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.x = ((domEvent.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((domEvent.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointer, camera);

        const actorHitObjects = Array.isArray(getActorHitObjects?.()) ? getActorHitObjects() : [];
        const actorHits = raycaster.intersectObjects(actorHitObjects, false);

        if (actorHits.length > 0) {
            const picked = actorHits[0].object;
            const targetId = picked?.userData?.actorId;
            if (!targetId) return;

            dispatch('select-target', { targetId });
            if (flags.canAttack) {
                dispatch('attack', { targetId });
            }
            return;
        }

        const world = new THREE.Vector3();
        if (flags.canMove && raycaster.ray.intersectPlane(floorPlane, world)) {
            dispatch('move', {
                x: Number(world.x.toFixed(3)),
                y: 0,
                z: Number(world.z.toFixed(3)),
            });
        }
    }

    function onKeyDown(event) {
        if (event.repeat) return;

        const flags = readFlags();
        const moveDelta = 1;
        if (flags.canMove) {
            if (event.code === 'KeyW') dispatch('move-relative', { x: 0, z: -moveDelta });
            if (event.code === 'KeyS') dispatch('move-relative', { x: 0, z: moveDelta });
            if (event.code === 'KeyA') dispatch('move-relative', { x: -moveDelta, z: 0 });
            if (event.code === 'KeyD') dispatch('move-relative', { x: moveDelta, z: 0 });
        }

        if (flags.canEndTurn && (event.code === 'Enter' || event.code === 'NumpadEnter')) {
            dispatch('end-turn', {});
        }
    }

    function start() {
        renderer.domElement.addEventListener('pointerdown', onPointerDown);
        window.addEventListener('keydown', onKeyDown);
    }

    function stop() {
        renderer.domElement.removeEventListener('pointerdown', onPointerDown);
        window.removeEventListener('keydown', onKeyDown);
    }

    return {
        start,
        stop,
    };
}
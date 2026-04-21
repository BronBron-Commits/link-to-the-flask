// Screen shake functions
let screenShakeIntensity = 0;
let screenShakeStartTime = 0;
let screenShakeDuration = 0;

function shakeScreen(intensity, durationMs) {
    screenShakeIntensity = Math.max(0.02, intensity);
    screenShakeDuration = durationMs || 300;
    screenShakeStartTime = performance.now();
}

function updateScreenShake(delta) {
    if (screenShakeIntensity <= 0 || !camera) return;
    const elapsed = performance.now() - screenShakeStartTime;
    const progress = Math.min(1, elapsed / screenShakeDuration);
    if (progress >= 1) {
        screenShakeIntensity = 0;
        return;
    }
    const easeProgress = 1 - progress;
    const currentIntensity = screenShakeIntensity * easeProgress;
    camera.position.x += (Math.random() - 0.5) * currentIntensity * 2;
    camera.position.y += (Math.random() - 0.5) * currentIntensity * 2;
}

// Enemy AI functions
function canEnemySeePlayer(enemy, player) {
    if (!enemy || !player) return false;
    const dist = getEdgeDistanceFeet(player, enemy);
    if (dist > 60) return false;
    const direction = new THREE.Vector3().subVectors(player.position, enemy.position).normalize();
    const rayOrigin = enemy.position.clone();
    rayOrigin.y += 1;
    const raycaster = new THREE.Raycaster(rayOrigin, direction, 0, dist);
    const intersects = raycaster.intersectObjects(scene.children, true);
    for (const hit of intersects) {
        if (hit.object === player || (player.children && player.children.includes(hit.object))) continue;
        if (hit.object.userData && hit.object.userData.isTargetable) continue;
        return false;
    }
    const enemyForward = new THREE.Vector3(0, 0, -1);
    if (enemy.parent) {
        enemyForward.applyQuaternion(enemy.getWorldQuaternion(new THREE.Quaternion()));
    } else {
        enemyForward.applyQuaternion(enemy.quaternion);
    }
    const angleCos = direction.dot(enemyForward);
    const fovRadians = (120 * Math.PI) / 180;
    const fovCos = Math.cos(fovRadians / 2);
    return angleCos >= fovCos;
}

function moveEnemyTowardPlayer(enemy, player, moveDistFeet = 10) {
    if (!enemy || !player) return;
    const direction = new THREE.Vector3().subVectors(player.position, enemy.position).normalize();
    const moveDistance = moveDistFeet * 0.25;
    enemy.position.addScaledVector(direction, moveDistance);
    if (combatCenter && combatRadius) {
        const dist = enemy.position.distanceTo(combatCenter);
        if (dist > combatRadius) {
            const clampDir = new THREE.Vector3().subVectors(enemy.position, combatCenter).normalize();
            enemy.position.copy(combatCenter).addScaledVector(clampDir, combatRadius - 0.5);
        }
    }
}

export function createWorldHydrator(deps) {
    const required = [
        'getServerEntityNetworkIds',
        'setSessionGameState',
        'getSessionGameState',
        'setAuthoritativePlayerId',
        'updateClientRuntimeModeFromAuthority',
        'extractSceneStateFromWorldPayload',
        'isSceneReadyForWorldState',
        'setPendingWorldHydrationPayload',
        'setPendingSceneState',
        'traceDmPipeline',
        'applySceneState',
        'combatDomainStore',
        'combatDomainAction',
        'getScene',
        'getSocket',
        'getLocalPlayerId',
        'upsertPlayerAvatar',
        'purgeLocalEchoAvatars',
        'removePlayerAvatar',
        'getTrainingDummies',
        'removeTrainingDummy',
        'spawnTrainingDummy',
        'trainingDummyYOffset',
        'trainingDummyDamage',
    ];

    for (const key of required) {
        if (!(key in deps)) {
            throw new Error(`createWorldHydrator missing dependency: ${key}`);
        }
    }

    return function hydrateWorld(payload) {
        if (!payload || typeof payload !== 'object') return;

        const serverEntityNetworkIds = deps.getServerEntityNetworkIds();
        serverEntityNetworkIds.clear();
        if (payload.entities && typeof payload.entities === 'object') {
            Object.entries(payload.entities).forEach(([entityId, entity]) => {
                if (!entity || typeof entity !== 'object') return;
                const networkId = String(entity.networkId || entityId || '').trim();
                if (networkId) serverEntityNetworkIds.add(networkId);
            });
        }

        if (payload.session && typeof payload.session === 'object') {
            deps.setSessionGameState(String(payload.session.gameState || deps.getSessionGameState() || 'lobby'));
            if (typeof payload.session.authoritativePlayerId === 'string') {
                deps.setAuthoritativePlayerId(payload.session.authoritativePlayerId);
                deps.updateClientRuntimeModeFromAuthority();
            }
        }

        const sceneState = deps.extractSceneStateFromWorldPayload(payload);
        if (!deps.isSceneReadyForWorldState()) {
            deps.setPendingWorldHydrationPayload(payload);
            if (sceneState && sceneState.objects) {
                deps.setPendingSceneState(sceneState);
            }
            deps.traceDmPipeline('WORLD HYDRATE QUEUED', {
                hasSceneState: !!(sceneState && sceneState.objects),
            });
            return;
        }

        if (sceneState && sceneState.objects) {
            deps.applySceneState(sceneState);
        }

        // Domain state is authoritative; renderer sync happens in one transition path.
        deps.combatDomainStore.dispatch({
            type: deps.combatDomainAction.WORLD_SNAPSHOT,
            payload,
        });

        if (payload.players && typeof payload.players === 'object') {
            const players = payload.players;
            const seenIds = new Set();
            Object.values(players).forEach((player) => {
                if (!player || !player.id) return;
                seenIds.add(String(player.id));
                deps.upsertPlayerAvatar(player);
            });

            // Eliminate local echo avatars after each authoritative player snapshot.
            deps.purgeLocalEchoAvatars();

            const scene = deps.getScene();
            const socket = deps.getSocket();
            const localPlayerId = deps.getLocalPlayerId();
            if (scene.userData && scene.userData.playerAvatars) {
                const effectiveLocalId = (socket && socket.id) ? socket.id : localPlayerId;
                Object.keys(scene.userData.playerAvatars).forEach((id) => {
                    if (id === effectiveLocalId) return;
                    if (!seenIds.has(String(id))) {
                        deps.removePlayerAvatar(id);
                    }
                });
            }
        }

        // Sync training dummies with backend's authoritative enemies list
        if (Array.isArray(payload.enemies)) {
            const trainingDummies = deps.getTrainingDummies();
            const existingById = new Map(trainingDummies
                .filter((d) => d && d.userData?.actorId)
                .map((dummy) => [String(dummy.userData.actorId), dummy]));
            const authoritativeIds = new Set(payload.enemies
                .filter((e) => e && e.actorId)
                .map((enemy) => String(enemy.actorId)));
            // Remove dummies not in backend list
            for (const dummy of [...trainingDummies]) {
                const dummyActorId = dummy.userData?.actorId;
                if (!dummyActorId || !authoritativeIds.has(String(dummyActorId))) {
                    deps.removeTrainingDummy(dummy);
                }
            }
            // Sync dummies with backend state
            for (const enemyState of payload.enemies) {
                const actorId = String(enemyState.actorId || '').trim();
                if (!actorId) continue;
                let dummy = existingById.get(actorId);
                if (!dummy || !dummy.parent) {
                    dummy = deps.spawnTrainingDummy(
                        enemyState.position?.x || 0,
                        enemyState.position?.y || 0,
                        enemyState.position?.z || 0,
                        enemyState.name || 'Training Dummy'
                    );
                }
                // Sync with authoritative state
                dummy.userData.actorId = actorId;
                dummy.userData.networkId = enemyState.networkId || actorId;
                dummy.userData.name = enemyState.name || 'Training Dummy';
                dummy.position.set(
                    enemyState.position?.x || 0,
                    (enemyState.position?.y || 0) + deps.trainingDummyYOffset,
                    enemyState.position?.z || 0,
                );
                dummy.rotation.y = Number(enemyState.rotationY) || 0;

                // Always sync HP from authoritative server state so health bars never drift.
                dummy.userData.hp = Number(enemyState.hp) || 0;

                dummy.userData.maxHp = Number(enemyState.maxHp) || 50;
                dummy.userData.ac = Number(enemyState.ac) || 12;
                dummy.userData.attackBonus = Number(enemyState.attackBonus) || 4;
                dummy.userData.damageRoll = Number(enemyState.damageRoll) || deps.trainingDummyDamage;
                dummy.userData.damageBonus = Number(enemyState.damageBonus) || 0;
            }
        }
    };
}

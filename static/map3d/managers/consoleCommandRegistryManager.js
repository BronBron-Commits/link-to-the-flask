export function registerDefaultConsoleCommandsFromManager(deps = {}) {
    const {
        registerConsoleCommand,
        CONSOLE_MODE,
        MODE,
        GAME_MODE,
        SETTINGS,
        SIMULATION_AUTHORITY,
        DM_AUTHORITY_LAYER,
        THREE,
        getCamera,
        combatState,
        playerState,
        combatTimeline,
        combatActionHistory,
        getCombatActionHistoryCursor,
        getCombatActionAtCursor,
        modeManager,
        consoleCommands,
        consoleState,
        appendConsoleHistory,
        renderConsoleHistory,
        setQuality,
        isObserverClient,
        getForceObserverMode,
        setForceObserverMode,
        updateClientRuntimeModeFromAuthority,
        getClientModeFull,
        setClientMode,
        applySettings,
        getCurrentGameMode,
        setCurrentGameMode,
        requestTrainingDummySpawn,
        getSpectatorCombat,
        setSpectatorCombat,
        requestDmStartCombat,
        emitCombatStateEvent,
        getLocalPlayerId,
        getSocket,
        findCombatActorById,
        getSelectedCombatTarget,
        getCombatParticlesEnabled,
        setCombatParticlesEnabled,
        setGridVisibility,
        toggleGrid,
        getGridVisible,
        getYaw,
        setYaw,
        getPitch,
        setPitch,
        getLookSpeed,
        setLookSpeed,
        updatePlayerHealthHud,
        setCombatPhase,
        setCombatLock,
        deactivateCombatCamera,
        updateCombatUI,
        updateActionMenu,
        getDmAutoStepEnabled,
        setDmAutoStepEnabled,
        getSimulationAuthority,
        setSimulationAuthority,
        syncDmAuthorityLayerFromState,
        getDmAuthorityLayer,
        setDmAuthorityLayer,
        parseConsoleScalar,
        syncPlayerRigFromState,
        uxStartTelemetry,
        uxStopTelemetry,
        uxResetTelemetry,
        runUxMacro,
        uxTelemetry,
        uxFormatStats,
        uxComputeFeelScore,
    } = deps;

    registerConsoleCommand('help', {
        modes: [CONSOLE_MODE.DEV, CONSOLE_MODE.DM, CONSOLE_MODE.PLAYER],
        usage: 'help',
        description: 'List commands available in the current mode',
        execute: () => {
            const names = Object.keys(consoleCommands)
                .filter((name) => consoleCommands[name].modes.includes(modeManager.current))
                .sort();
            appendConsoleHistory(`Available commands (${modeManager.current}): ${names.join(', ')}`);
        },
    });

    registerConsoleCommand('clear', {
        modes: [CONSOLE_MODE.DEV, CONSOLE_MODE.DM, CONSOLE_MODE.PLAYER],
        usage: 'clear',
        description: 'Clear console scrollback',
        execute: () => {
            consoleState.history.length = 0;
            renderConsoleHistory();
        },
    });

    registerConsoleCommand('mode', {
        modes: [CONSOLE_MODE.DEV, CONSOLE_MODE.DM, CONSOLE_MODE.PLAYER],
        usage: 'mode <dev|dm|player>',
        description: 'Switch command mode',
        execute: (_ctx, args) => {
            const next = String(args[0] || '').toLowerCase();
            if (!Object.values(CONSOLE_MODE).includes(next)) {
                appendConsoleHistory('Usage: mode <dev|dm|player>', 'error');
                return;
            }
            if (!modeManager.setMode(next)) {
                appendConsoleHistory(`Failed to switch mode to ${next}`, 'error');
                return;
            }
            appendConsoleHistory(`Mode switched to ${next}`, 'ok');
        },
    });

    registerConsoleCommand('wireframe', {
        modes: [CONSOLE_MODE.DEV],
        usage: 'wireframe',
        description: 'Toggle mesh wireframe',
        execute: ({ scene: activeScene }) => {
            let toggledCount = 0;
            activeScene.traverse((obj) => {
                if (!obj || !obj.isMesh || !obj.material) return;
                if (Array.isArray(obj.material)) {
                    obj.material.forEach((mat) => {
                        if (mat && typeof mat.wireframe === 'boolean') {
                            mat.wireframe = !mat.wireframe;
                            toggledCount += 1;
                        }
                    });
                } else if (typeof obj.material.wireframe === 'boolean') {
                    obj.material.wireframe = !obj.material.wireframe;
                    toggledCount += 1;
                }
            });
            appendConsoleHistory(`Wireframe toggled on ${toggledCount} materials`, 'ok');
        },
    });

    registerConsoleCommand('audio', {
        modes: [CONSOLE_MODE.DEV],
        usage: 'audio <mute|unmute|play> [cue]',
        description: 'Audio debug controls',
        execute: ({ audioSystem }, args) => {
            const op = String(args[0] || '').toLowerCase();
            if (op === 'mute') {
                audioSystem.mute();
                appendConsoleHistory('Audio muted', 'ok');
                return;
            }
            if (op === 'unmute') {
                audioSystem.unmute();
                appendConsoleHistory('Audio unmuted', 'ok');
                return;
            }
            if (op === 'play') {
                const cueName = String(args[1] || 'melee-hit');
                audioSystem.play(cueName);
                appendConsoleHistory(`Audio cue played: ${cueName}`, 'ok');
                return;
            }
            appendConsoleHistory('Usage: audio <mute|unmute|play> [cue]', 'error');
        },
    });

    registerConsoleCommand('quality', {
        modes: [CONSOLE_MODE.DEV, CONSOLE_MODE.PLAYER],
        usage: 'quality <low|medium|high>',
        description: 'Switch runtime performance quality preset',
        execute: (_ctx, args) => {
            const level = String(args[0] || '').toLowerCase();
            if (!setQuality(level)) {
                appendConsoleHistory('Usage: quality <low|medium|high>', 'error');
                return;
            }
            appendConsoleHistory(`Quality set to ${SETTINGS.quality} (${SETTINGS.maxFPS} fps, scale ${SETTINGS.renderScale})`, 'ok');
        },
    });

    registerConsoleCommand('observer', {
        modes: [CONSOLE_MODE.DEV, CONSOLE_MODE.PLAYER],
        usage: 'observer <auto|on|off|status>',
        description: 'Force observer runtime mode for low-power multi-instance testing',
        execute: (_ctx, args) => {
            const op = String(args[0] || 'status').toLowerCase();
            if (op === 'status') {
                appendConsoleHistory(`Observer mode: ${isObserverClient() ? 'ON' : 'OFF'} (forced=${getForceObserverMode() ? 'yes' : 'no'})`, 'ok');
                return;
            }
            if (op === 'auto') {
                setForceObserverMode(false);
                updateClientRuntimeModeFromAuthority();
                appendConsoleHistory(`Observer mode auto (runtime=${isObserverClient() ? 'observer' : 'full'})`, 'ok');
                return;
            }
            if (op === 'on') {
                setForceObserverMode(true);
                updateClientRuntimeModeFromAuthority();
                appendConsoleHistory('Observer mode forced ON', 'ok');
                return;
            }
            if (op === 'off') {
                setForceObserverMode(false);
                setClientMode(getClientModeFull());
                applySettings();
                appendConsoleHistory('Observer mode forced OFF (full mode)', 'ok');
                return;
            }
            appendConsoleHistory('Usage: observer <auto|on|off|status>', 'error');
        },
    });

    registerConsoleCommand('spawn', {
        modes: [CONSOLE_MODE.DEV, CONSOLE_MODE.DM],
        usage: 'spawn [type] [count]',
        description: 'Spawn one or more enemies near player',
        execute: ({ combatSystem }, args) => {
            const type = String(args[0] || 'Training Dummy');
            const requestedCount = Number.parseInt(args[1], 10);
            const count = Number.isFinite(requestedCount)
                ? Math.max(1, Math.min(16, requestedCount))
                : 1;
            let okCount = 0;
            for (let i = 0; i < count; i++) {
                const spawned = combatSystem.spawnEnemy(type);
                if (spawned !== false) {
                    okCount += 1;
                }
            }
            if (okCount <= 0) {
                appendConsoleHistory(`Spawn failed for ${type}`, 'error');
                return;
            }
            if (modeManager.current === MODE.DM) {
                appendConsoleHistory(`Dispatched ${okCount} spawn command(s) for ${type}`, 'ok');
                return;
            }
            appendConsoleHistory(`Spawned ${okCount} ${type}`, 'ok');
        },
    });

    registerConsoleCommand('endturn', {
        modes: [CONSOLE_MODE.DEV, CONSOLE_MODE.DM],
        usage: 'endturn',
        description: 'End current player turn',
        execute: ({ combatSystem }) => {
            if (!combatSystem.endTurn()) {
                appendConsoleHistory('End turn unavailable right now', 'error');
                return;
            }
            appendConsoleHistory(modeManager.current === MODE.DM ? 'End turn command dispatched' : 'End turn requested', 'ok');
        },
    });

    registerConsoleCommand('stepturn', {
        modes: [CONSOLE_MODE.DEV, CONSOLE_MODE.DM],
        usage: 'stepturn',
        description: 'Advance combat to the next queued actor turn',
        execute: ({ combatSystem }) => {
            if (!combatSystem.stepTurn()) {
                appendConsoleHistory('Turn step unavailable right now', 'error');
                return;
            }
            appendConsoleHistory(modeManager.current === MODE.DM ? 'Step turn command dispatched' : 'Advanced to next queued actor', 'ok');
        },
    });

    registerConsoleCommand('brawl', {
        modes: [CONSOLE_MODE.DEV, CONSOLE_MODE.DM],
        usage: 'brawl [count]',
        description: 'Spawn dummies that fight each other while you spectate (player turns auto-skipped)',
        execute: (_ctx, args) => {
            if (getCurrentGameMode() === GAME_MODE.COMBAT) {
                appendConsoleHistory('End combat first before starting a brawl', 'error');
                return;
            }
            const count = Math.max(2, Math.min(8, Number.parseInt(args[0], 10) || 2));
            const BRAWL_RADIUS = 5;
            let spawned = 0;
            for (let i = 0; i < count; i++) {
                const angle = (i / count) * Math.PI * 2;
                const x = playerState.position.x + Math.cos(angle) * BRAWL_RADIUS;
                const z = playerState.position.z + Math.sin(angle) * BRAWL_RADIUS;
                const dummy = requestTrainingDummySpawn(x, playerState.position.y, z, `Dummy ${i + 1}`);
                if (dummy !== false) spawned += 1;
            }
            if (spawned === 0) {
                appendConsoleHistory('Failed to spawn brawl dummies', 'error');
                return;
            }
            setSpectatorCombat(true);
            setTimeout(() => {
                if (getCurrentGameMode() !== GAME_MODE.COMBAT) {
                    requestDmStartCombat(null) || emitCombatStateEvent(true, {
                        initiator: getLocalPlayerId() || (getSocket() ? getSocket().id : null),
                    });
                }
            }, 400);
            appendConsoleHistory(`Brawl started: ${spawned} dummies spawned. Your turns will be skipped automatically.`, 'ok');
        },
    });

    registerConsoleCommand('possess', {
        modes: [CONSOLE_MODE.DEV, CONSOLE_MODE.DM],
        usage: 'possess [actorId|selected]',
        description: 'Possess selected enemy or actor id for manual turn control',
        execute: ({ combatSystem }, args) => {
            let actor = null;
            const requested = String(args[0] || '').trim();
            if (requested.length > 0 && requested.toLowerCase() !== 'selected') {
                actor = findCombatActorById(requested);
                if (!actor && requested.toLowerCase() === 'player') {
                    actor = playerState;
                }
            } else {
                actor = getSelectedCombatTarget();
            }
            if (!actor) {
                appendConsoleHistory('No actor to possess (select a target or pass actorId)', 'error');
                return;
            }
            if (!combatSystem.possessActor(actor)) {
                appendConsoleHistory('Possession failed for requested actor', 'error');
                return;
            }
            const actorName = actor === playerState
                ? 'Player'
                : (actor.userData?.name || actor.userData?.actorId || 'Enemy');
            appendConsoleHistory(modeManager.current === MODE.DM ? `Possess command dispatched for ${actorName}` : `Possessing ${actorName}`, 'ok');
        },
    });

    registerConsoleCommand('release', {
        modes: [CONSOLE_MODE.DEV, CONSOLE_MODE.DM],
        usage: 'release',
        description: 'Release currently possessed actor',
        execute: ({ combatSystem }) => {
            if (!combatSystem.releasePossession()) {
                appendConsoleHistory('No possessed actor active', 'error');
                return;
            }
            appendConsoleHistory(modeManager.current === MODE.DM ? 'Release command dispatched' : 'Possession released', 'ok');
        },
    });

    registerConsoleCommand('rewind', {
        modes: [CONSOLE_MODE.DEV, CONSOLE_MODE.DM],
        usage: 'rewind',
        description: 'Rewind combat to the previous saved turn snapshot',
        execute: ({ combatSystem }) => {
            if (!combatSystem.rewindTurn()) {
                appendConsoleHistory('No earlier combat snapshot available', 'error');
                return;
            }
            appendConsoleHistory(modeManager.current === MODE.DM ? 'Rewind command dispatched' : 'Combat rewound to previous turn snapshot', 'ok');
        },
    });

    registerConsoleCommand('forcehit', {
        modes: [CONSOLE_MODE.DEV, CONSOLE_MODE.DM],
        usage: 'forcehit [damage]',
        description: 'Force the next attack resolution to hit',
        execute: ({ combatSystem }, args) => {
            const damage = Number.parseInt(args[0], 10);
            combatSystem.setDmOverride({
                hit: true,
                resultType: 'crit',
                damage: Number.isFinite(damage) ? Math.max(0, damage) : undefined,
            });
            appendConsoleHistory('Next attack forced to hit', 'ok');
        },
    });

    registerConsoleCommand('forcemiss', {
        modes: [CONSOLE_MODE.DEV, CONSOLE_MODE.DM],
        usage: 'forcemiss',
        description: 'Force the next attack resolution to miss',
        execute: ({ combatSystem }) => {
            combatSystem.setDmOverride({ hit: false, resultType: 'fumble', damage: 0 });
            appendConsoleHistory('Next attack forced to miss', 'ok');
        },
    });

    registerConsoleCommand('snapshot', {
        modes: [CONSOLE_MODE.DEV, CONSOLE_MODE.DM],
        usage: 'snapshot',
        description: 'Save a manual combat snapshot',
        execute: ({ combatSystem }) => {
            if (!combatSystem.saveSnapshot('manual')) {
                appendConsoleHistory('Combat snapshot unavailable outside combat', 'error');
                return;
            }
            appendConsoleHistory(`Combat snapshot saved (${combatTimeline.length} total)`, 'ok');
        },
    });

    registerConsoleCommand('replay', {
        modes: [CONSOLE_MODE.DEV, CONSOLE_MODE.DM],
        usage: 'replay',
        description: 'Replay the last recorded combat action',
        execute: ({ combatSystem }) => {
            void combatSystem.replayLastAction().then((ok) => {
                const successMessage = modeManager.current === MODE.DM
                    ? 'Replay command dispatched'
                    : 'Replaying last action';
                appendConsoleHistory(ok ? successMessage : 'No recorded action to replay', ok ? 'ok' : 'error');
            }).catch((err) => {
                appendConsoleHistory(`Replay failed: ${err && err.message ? err.message : String(err)}`, 'error');
            });
        },
    });

    registerConsoleCommand('replayprev', {
        modes: [CONSOLE_MODE.DEV, CONSOLE_MODE.DM],
        usage: 'replayprev',
        description: 'Move replay cursor to the previous recorded action and replay it',
        execute: ({ combatSystem }) => {
            if (!combatActionHistory.length) {
                appendConsoleHistory('No recorded action to replay', 'error');
                return;
            }
            getCombatActionAtCursor(-1);
            void combatSystem.replayLastAction().then((ok) => {
                appendConsoleHistory(ok ? `Replaying action ${getCombatActionHistoryCursor() + 1}/${combatActionHistory.length}` : 'Replay blocked while another timeline is active', ok ? 'ok' : 'error');
            }).catch((err) => {
                appendConsoleHistory(`Replay failed: ${err && err.message ? err.message : String(err)}`, 'error');
            });
        },
    });

    registerConsoleCommand('replaynext', {
        modes: [CONSOLE_MODE.DEV, CONSOLE_MODE.DM],
        usage: 'replaynext',
        description: 'Move replay cursor to the next recorded action and replay it',
        execute: ({ combatSystem }) => {
            if (!combatActionHistory.length) {
                appendConsoleHistory('No recorded action to replay', 'error');
                return;
            }
            getCombatActionAtCursor(1);
            void combatSystem.replayLastAction().then((ok) => {
                appendConsoleHistory(ok ? `Replaying action ${getCombatActionHistoryCursor() + 1}/${combatActionHistory.length}` : 'Replay blocked while another timeline is active', ok ? 'ok' : 'error');
            }).catch((err) => {
                appendConsoleHistory(`Replay failed: ${err && err.message ? err.message : String(err)}`, 'error');
            });
        },
    });

    registerConsoleCommand('attack', {
        modes: [CONSOLE_MODE.PLAYER, CONSOLE_MODE.DM],
        usage: 'attack',
        description: 'Run basic attack against selected or nearest target',
        execute: ({ combatSystem }) => {
            const attacked = combatSystem.basicAttack();
            if (attacked) {
                appendConsoleHistory('Attack preview opened. Confirm to execute.', 'ok');
            }
        },
    });

    registerConsoleCommand('particles', {
        modes: [CONSOLE_MODE.DEV],
        usage: 'particles <on|off|toggle>',
        description: 'Enable or disable combat burst particles',
        execute: (_ctx, args) => {
            const op = String(args[0] || 'toggle').toLowerCase();
            if (op === 'on') {
                setCombatParticlesEnabled(true);
            } else if (op === 'off') {
                setCombatParticlesEnabled(false);
            } else {
                setCombatParticlesEnabled(!getCombatParticlesEnabled());
            }
            appendConsoleHistory(`Particles ${getCombatParticlesEnabled() ? 'enabled' : 'disabled'}`, 'ok');
        },
    });

    registerConsoleCommand('grid', {
        modes: [CONSOLE_MODE.DEV],
        usage: 'grid <on|off|toggle>',
        description: 'Toggle world grid overlay',
        execute: (_ctx, args) => {
            const op = String(args[0] || 'toggle').toLowerCase();
            if (op === 'on') {
                setGridVisibility(true);
            } else if (op === 'off') {
                setGridVisibility(false);
            } else {
                toggleGrid();
            }
            appendConsoleHistory(`Grid ${getGridVisible() ? 'enabled' : 'disabled'}`, 'ok');
        },
    });

    const runtimeTunables = {
        'camera.fov': {
            get: () => Number(getCamera?.()?.fov) || 0,
            set: (value) => {
                const camera = getCamera?.();
                if (!camera) {
                    return 0;
                }
                const next = THREE.MathUtils.clamp(Number(value) || 58, 5, 120);
                camera.fov = next;
                camera.updateProjectionMatrix();
                return next;
            },
        },
        'camera.yaw': {
            get: () => Number(getYaw()) || 0,
            set: (value) => {
                const next = Number(value) || 0;
                setYaw(next);
                return next;
            },
        },
        'camera.pitch': {
            get: () => Number(getPitch()) || 0,
            set: (value) => {
                const next = THREE.MathUtils.clamp(Number(value) || 0, -Math.PI / 2, Math.PI / 2);
                setPitch(next);
                return next;
            },
        },
        'input.lookSpeed': {
            get: () => Number(getLookSpeed()) || 0,
            set: (value) => {
                const next = THREE.MathUtils.clamp(Number(value) || 0.0025, 0.0001, 0.02);
                setLookSpeed(next);
                return next;
            },
        },
        'player.hp': {
            get: () => Number(playerState?.hp) || 0,
            set: (value) => {
                const hp = Math.max(0, Number(value) || 0);
                const maxHp = Math.max(1, Number(playerState?.maxHp) || 1);
                playerState.hp = Math.min(maxHp, hp);
                updatePlayerHealthHud();
                return playerState.hp;
            },
        },
        'player.maxHp': {
            get: () => Number(playerState?.maxHp) || 0,
            set: (value) => {
                playerState.maxHp = Math.max(1, Number(value) || 1);
                playerState.hp = Math.min(Number(playerState.hp) || 0, playerState.maxHp);
                updatePlayerHealthHud();
                return playerState.maxHp;
            },
        },
        'player.speed': {
            get: () => Number(playerState?.speed) || 0,
            set: (value) => {
                playerState.speed = Math.max(0.1, Number(value) || 5);
                return playerState.speed;
            },
        },
        'combat.inCombat': {
            get: () => !!combatState?.inCombat,
            set: (value) => {
                const on = !!value;
                if (on) {
                    setCurrentGameMode(GAME_MODE.COMBAT);
                    combatState.inCombat = true;
                    setCombatPhase(combatState.phase || 'PLAYER');
                } else {
                    setCurrentGameMode(GAME_MODE.FREE);
                    combatState.inCombat = false;
                    setCombatPhase('TRANSITION');
                    setCombatLock(false);
                    deactivateCombatCamera();
                }
                updateCombatUI();
                updateActionMenu();
                return combatState.inCombat;
            },
        },
        'combat.round': {
            get: () => Number(combatState?.roundNumber) || 0,
            set: (value) => {
                combatState.roundNumber = Math.max(0, Math.floor(Number(value) || 0));
                updateCombatUI();
                return combatState.roundNumber;
            },
        },
        'combat.turnIndex': {
            get: () => Number(combatState?.currentTurnIndex) || 0,
            set: (value) => {
                combatState.currentTurnIndex = Math.max(0, Math.floor(Number(value) || 0));
                updateCombatUI();
                return combatState.currentTurnIndex;
            },
        },
        'combat.lock': {
            get: () => !!combatState?.lock,
            set: (value) => {
                setCombatLock(!!value);
                return !!combatState.lock;
            },
        },
        'dm.autostep': {
            get: () => !!getDmAutoStepEnabled(),
            set: (value) => {
                setDmAutoStepEnabled(!!value);
                return !!getDmAutoStepEnabled();
            },
        },
        'dm.authority': {
            get: () => String(getSimulationAuthority() || ''),
            set: (value) => {
                const next = String(value || '').toLowerCase();
                if (next === SIMULATION_AUTHORITY.SERVER || next === SIMULATION_AUTHORITY.LOCAL_DM) {
                    setSimulationAuthority(next);
                    syncDmAuthorityLayerFromState();
                }
                return String(getSimulationAuthority() || '');
            },
        },
        'dm.layer': {
            get: () => String(getDmAuthorityLayer() || ''),
            set: (value) => {
                const next = String(value || '').toLowerCase();
                if (Object.values(DM_AUTHORITY_LAYER).includes(next)) {
                    setDmAuthorityLayer(next);
                }
                return String(getDmAuthorityLayer() || '');
            },
        },
    };

    registerConsoleCommand('vars', {
        modes: [CONSOLE_MODE.DEV, CONSOLE_MODE.DM],
        usage: 'vars [filter]',
        description: 'List runtime variable keys that can be controlled via console',
        execute: (_ctx, args) => {
            const filter = String(args[0] || '').toLowerCase();
            const keys = Object.keys(runtimeTunables)
                .filter((k) => !filter || k.toLowerCase().includes(filter))
                .sort();
            appendConsoleHistory(keys.length ? `Vars: ${keys.join(', ')}` : 'No vars matched filter', keys.length ? 'ok' : 'error');
        },
    });

    registerConsoleCommand('get', {
        modes: [CONSOLE_MODE.DEV, CONSOLE_MODE.DM],
        usage: 'get <varKey>',
        description: 'Read a runtime variable from the control registry',
        execute: (_ctx, args) => {
            const key = String(args[0] || '').trim();
            const tunable = runtimeTunables[key];
            if (!tunable) {
                appendConsoleHistory(`Unknown var key: ${key}`, 'error');
                return;
            }
            const value = tunable.get();
            appendConsoleHistory(`${key} = ${String(value)}`, 'ok');
        },
    });

    registerConsoleCommand('set', {
        modes: [CONSOLE_MODE.DEV, CONSOLE_MODE.DM],
        usage: 'set <varKey> <value>',
        description: 'Set a runtime variable in the control registry',
        execute: (_ctx, args) => {
            const key = String(args[0] || '').trim();
            const tunable = runtimeTunables[key];
            if (!tunable) {
                appendConsoleHistory(`Unknown var key: ${key}`, 'error');
                return;
            }
            if (args.length < 2) {
                appendConsoleHistory('Usage: set <varKey> <value>', 'error');
                return;
            }
            const value = parseConsoleScalar(args.slice(1).join(' '));
            const updated = tunable.set(value);
            appendConsoleHistory(`${key} -> ${String(updated)}`, 'ok');
        },
    });

    registerConsoleCommand('inc', {
        modes: [CONSOLE_MODE.DEV, CONSOLE_MODE.DM],
        usage: 'inc <varKey> [delta]',
        description: 'Increment a numeric runtime variable by delta (default 1)',
        execute: (_ctx, args) => {
            const key = String(args[0] || '').trim();
            const tunable = runtimeTunables[key];
            if (!tunable) {
                appendConsoleHistory(`Unknown var key: ${key}`, 'error');
                return;
            }
            const current = Number(tunable.get());
            if (!Number.isFinite(current)) {
                appendConsoleHistory(`${key} is not numeric`, 'error');
                return;
            }
            const delta = Number(args[1]);
            const next = current + (Number.isFinite(delta) ? delta : 1);
            const updated = tunable.set(next);
            appendConsoleHistory(`${key} -> ${String(updated)}`, 'ok');
        },
    });

    registerConsoleCommand('tp', {
        modes: [CONSOLE_MODE.DEV, CONSOLE_MODE.DM, CONSOLE_MODE.PLAYER],
        usage: 'tp <x> <y> <z>',
        description: 'Teleport local player actor to world coordinates',
        execute: (_ctx, args) => {
            if (args.length < 3) {
                appendConsoleHistory('Usage: tp <x> <y> <z>', 'error');
                return;
            }
            const x = Number(args[0]);
            const y = Number(args[1]);
            const z = Number(args[2]);
            if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
                appendConsoleHistory('tp requires numeric x y z', 'error');
                return;
            }
            playerState.position.set(x, y, z);
            playerState.prevPosition.copy(playerState.position);
            syncPlayerRigFromState();
            appendConsoleHistory(`Teleported to (${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})`, 'ok');
        },
    });

    registerConsoleCommand('gamemode', {
        modes: [CONSOLE_MODE.DEV, CONSOLE_MODE.DM],
        usage: 'gamemode <combat|free>',
        description: 'Switch between combat and exploration mode quickly',
        execute: (_ctx, args) => {
            const mode = String(args[0] || '').toLowerCase();
            if (mode !== 'combat' && mode !== 'free') {
                appendConsoleHistory('Usage: gamemode <combat|free>', 'error');
                return;
            }
            runtimeTunables['combat.inCombat'].set(mode === 'combat');
            appendConsoleHistory(`Game mode set to ${mode}`, 'ok');
        },
    });

    registerConsoleCommand('phase', {
        modes: [CONSOLE_MODE.DEV, CONSOLE_MODE.DM],
        usage: 'phase <player|enemy|transition>',
        description: 'Set combat phase directly',
        execute: (_ctx, args) => {
            const phase = String(args[0] || '').toUpperCase();
            if (!['PLAYER', 'ENEMY', 'TRANSITION'].includes(phase)) {
                appendConsoleHistory('Usage: phase <player|enemy|transition>', 'error');
                return;
            }
            setCombatPhase(phase);
            updateCombatUI();
            appendConsoleHistory(`Combat phase set to ${phase}`, 'ok');
        },
    });

    registerConsoleCommand('authority', {
        modes: [CONSOLE_MODE.DEV, CONSOLE_MODE.DM],
        usage: 'authority <server|local-dm>',
        description: 'Set DM simulation authority source',
        execute: (_ctx, args) => {
            const next = String(args[0] || '').toLowerCase();
            if (next !== SIMULATION_AUTHORITY.SERVER && next !== SIMULATION_AUTHORITY.LOCAL_DM) {
                appendConsoleHistory('Usage: authority <server|local-dm>', 'error');
                return;
            }
            runtimeTunables['dm.authority'].set(next);
            appendConsoleHistory(`Authority set to ${getSimulationAuthority()}`, 'ok');
        },
    });

    registerConsoleCommand('autostep', {
        modes: [CONSOLE_MODE.DEV, CONSOLE_MODE.DM],
        usage: 'autostep <on|off|toggle|status>',
        description: 'Control DM auto-step timeline behavior',
        execute: (_ctx, args) => {
            const op = String(args[0] || 'status').toLowerCase();
            if (op === 'status') {
                appendConsoleHistory(`autostep: ${getDmAutoStepEnabled() ? 'ON' : 'OFF'}`, 'ok');
                return;
            }
            if (op === 'toggle') {
                setDmAutoStepEnabled(!getDmAutoStepEnabled());
                appendConsoleHistory(`autostep: ${getDmAutoStepEnabled() ? 'ON' : 'OFF'}`, 'ok');
                return;
            }
            if (op === 'on' || op === 'off') {
                setDmAutoStepEnabled(op === 'on');
                appendConsoleHistory(`autostep: ${getDmAutoStepEnabled() ? 'ON' : 'OFF'}`, 'ok');
                return;
            }
            appendConsoleHistory('Usage: autostep <on|off|toggle|status>', 'error');
        },
    });

    registerConsoleCommand('ux', {
        modes: [CONSOLE_MODE.DEV, CONSOLE_MODE.DM, CONSOLE_MODE.PLAYER],
        usage: 'ux <start|stop|report|reset|macro> [cycles]',
        description: 'Measure interaction feel with telemetry and optional scripted macro cycles',
        execute: (_ctx, args) => {
            const op = String(args[0] || 'report').toLowerCase();
            if (op === 'start') {
                uxStartTelemetry();
                appendConsoleHistory('UX telemetry started', 'ok');
                return;
            }
            if (op === 'stop') {
                uxStopTelemetry();
                appendConsoleHistory('UX telemetry stopped', 'ok');
                return;
            }
            if (op === 'reset') {
                uxResetTelemetry();
                appendConsoleHistory('UX telemetry reset', 'ok');
                return;
            }
            if (op === 'macro') {
                const cycles = Math.max(1, Math.min(12, Number.parseInt(args[1], 10) || 3));
                void runUxMacro(cycles);
                return;
            }
            const since = uxTelemetry.sessionStartedAt
                ? new Date(uxTelemetry.sessionStartedAt).toLocaleTimeString()
                : 'n/a';
            appendConsoleHistory(`UX report (started=${since}, enabled=${uxTelemetry.enabled ? 'yes' : 'no'})`, 'ok');
            appendConsoleHistory(uxFormatStats('confirm-ui', uxTelemetry.samples.confirmUiMs), 'ok');
            appendConsoleHistory(uxFormatStats('attack-rtt', uxTelemetry.samples.attackRttMs), 'ok');
            appendConsoleHistory(uxFormatStats('move-rtt', uxTelemetry.samples.moveRttMs), 'ok');
            appendConsoleHistory(uxFormatStats('endturn-rtt', uxTelemetry.samples.endTurnRttMs), 'ok');
            appendConsoleHistory(`feel-score: ${uxComputeFeelScore().toFixed(1)} / 100`, 'ok');
            appendConsoleHistory(`counters: confirms=${uxTelemetry.counters.confirms} cancels=${uxTelemetry.counters.cancels} timeouts=${uxTelemetry.counters.timeouts} macroRuns=${uxTelemetry.counters.macroRuns}`, 'ok');
        },
    });
}

export function createConsoleCommandRuntimeManager(deps = {}) {
    const {
        getScene,
        getRenderer,
        getPlayerState,
        requestTrainingDummySpawn,
        saveSnapshot,
        requestRewindTurn,
        requestReplayLastAction,
        getDmOverride,
        setDmOverride,
        requestEndTurn,
        requestStepTurn,
        requestPossessActor,
        requestReleasePossession,
        getControlledActor,
        getMode,
        modeDm,
        appendConsoleHistory,
        runPossessedEnemyAttack,
        getSelectedCombatTarget,
        getTrainingDummies,
        getEdgeDistanceFeet,
        setSelectedCombatTarget,
        selectMoveAndAttackAction,
        getConsoleAudioMuted,
        setConsoleAudioMuted,
        getCombatMixerMasterGain,
        getCombatAudioMasterGain,
        getCombatMusicMasterGain,
        getCombatMusicTargetGain,
        playCombatSfxCue,
        getEventBus,
        getConsoleCommands,
    } = deps;

    function tokenizeConsoleInput(raw) {
        if (!raw) return [];
        const tokens = [];
        const re = /"([^"]*)"|'([^']*)'|([^\s]+)/g;
        let match = null;
        while ((match = re.exec(raw)) !== null) {
            tokens.push(match[1] ?? match[2] ?? match[3]);
        }
        return tokens;
    }

    function buildConsoleContext() {
        const playerState = getPlayerState();
        return {
            scene: getScene(),
            renderer: getRenderer(),
            playerState,
            combatSystem: {
                spawnEnemy(type = 'dummy') {
                    const enemyName = type && String(type).trim().length > 0 ? String(type).trim() : 'Training Dummy';
                    const baseAngle = Math.random() * Math.PI * 2;
                    const spawnRadius = 2.8 + (Math.random() * 1.6);
                    const x = playerState.position.x + (Math.cos(baseAngle) * spawnRadius);
                    const z = playerState.position.z + (Math.sin(baseAngle) * spawnRadius);
                    const y = playerState.position.y;
                    return requestTrainingDummySpawn(x, y, z, enemyName);
                },
                saveSnapshot,
                rewindTurn: requestRewindTurn,
                replayLastAction: requestReplayLastAction,
                setDmOverride(override) {
                    const next = override ? { ...override } : null;
                    setDmOverride(next);
                    return getDmOverride();
                },
                endTurn: requestEndTurn,
                stepTurn: requestStepTurn,
                possessActor: requestPossessActor,
                releasePossession: requestReleasePossession,
                getControlledActor,
                basicAttack() {
                    const controlled = getControlledActor();
                    if (getMode() === modeDm && !controlled) {
                        appendConsoleHistory('DM must possess an actor before attacking', 'error');
                        return false;
                    }

                    const actor = controlled || playerState;
                    if (actor !== playerState) {
                        const acted = runPossessedEnemyAttack(actor);
                        if (!acted) {
                            appendConsoleHistory('Possessed actor cannot attack right now', 'error');
                        }
                        return acted;
                    }

                    let target = getSelectedCombatTarget();
                    if (!target || !target.parent || (target.userData?.hp || 0) <= 0) {
                        const alive = getTrainingDummies().filter((dummy) => dummy && dummy.parent && (dummy.userData?.hp || 0) > 0);
                        if (alive.length > 0) {
                            target = alive.sort((a, b) => getEdgeDistanceFeet(playerState, a) - getEdgeDistanceFeet(playerState, b))[0];
                        }
                    }
                    if (!target) {
                        appendConsoleHistory('No valid target for attack', 'error');
                        return false;
                    }
                    setSelectedCombatTarget(target);
                    selectMoveAndAttackAction(target);
                    return true;
                },
            },
            audioSystem: {
                mute() {
                    setConsoleAudioMuted(true);
                    const mixerGain = getCombatMixerMasterGain();
                    if (mixerGain && mixerGain.gain) mixerGain.gain.value = 0;
                    const audioGain = getCombatAudioMasterGain();
                    if (audioGain && audioGain.gain) audioGain.gain.value = 0;
                    const musicGain = getCombatMusicMasterGain();
                    if (musicGain && musicGain.gain) musicGain.gain.value = 0.0001;
                },
                unmute() {
                    setConsoleAudioMuted(false);
                    const mixerGain = getCombatMixerMasterGain();
                    if (mixerGain && mixerGain.gain) mixerGain.gain.value = 0.6;
                    const audioGain = getCombatAudioMasterGain();
                    if (audioGain && audioGain.gain) audioGain.gain.value = 0.6;
                    const musicGain = getCombatMusicMasterGain();
                    if (musicGain && musicGain.gain) musicGain.gain.value = getCombatMusicTargetGain();
                },
                play(cueName = 'melee-hit') {
                    playCombatSfxCue(cueName);
                },
                get muted() {
                    return getConsoleAudioMuted();
                },
            },
            eventBus: getEventBus(),
        };
    }

    function runConsoleCommand(input) {
        const trimmed = (input || '').trim();
        if (!trimmed) return;
        appendConsoleHistory(`> ${trimmed}`);

        const tokens = tokenizeConsoleInput(trimmed);
        if (tokens.length === 0) return;
        const rawName = String(tokens[0] || '').toLowerCase();
        const name = rawName.startsWith('/') ? rawName.slice(1) : rawName;
        const args = tokens.slice(1);
        const command = getConsoleCommands()[name];

        if (!command) {
            appendConsoleHistory(`Unknown command: ${name}`, 'error');
            return;
        }

        if (!command.modes.includes(getMode())) {
            appendConsoleHistory(`Command not allowed in ${getMode()} mode`, 'error');
            return;
        }

        try {
            const ctx = buildConsoleContext();
            command.execute(ctx, args);
        } catch (err) {
            appendConsoleHistory(`Command failed: ${err && err.message ? err.message : String(err)}`, 'error');
        }
    }

    function parseConsoleScalar(raw) {
        const text = String(raw ?? '').trim();
        if (!text.length) return '';
        const lower = text.toLowerCase();
        if (lower === 'true' || lower === 'on' || lower === 'yes') return true;
        if (lower === 'false' || lower === 'off' || lower === 'no') return false;
        if (lower === 'null') return null;
        const numeric = Number(text);
        if (Number.isFinite(numeric)) return numeric;
        return text;
    }

    return {
        tokenizeConsoleInput,
        buildConsoleContext,
        runConsoleCommand,
        parseConsoleScalar,
    };
}

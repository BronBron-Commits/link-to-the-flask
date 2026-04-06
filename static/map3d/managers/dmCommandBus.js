export function createDmCommandBus(deps = {}) {
    const {
        getMode,
        modeDm,
        canIssueDmCommand,
        getDmAuthorityLayer,
        showFloatingText,
        appendConsoleHistory,
        getSimulationAuthority,
        simulationAuthorityLocalDm,
        getSocket,
        getNetStats,
        netLog,
        traceDmPipeline,
        applyDmCommandFromServer,
        addDmEvent,
        getWindow,
    } = deps;

    function logDmCommandAction(command) {
        if (!command || !command.type) return;
        const type = String(command.type).toLowerCase();
        const payload = command.payload || {};

        let message = null;
        switch (type) {
        case 'spawn-entity':
            message = `Spawn request: ${String(payload.entityType || 'training-dummy')}`;
            break;
        case 'spawn-training-dummy':
            message = 'Spawn request: training dummy';
            break;
        case 'possess-actor':
            message = `Possess request: ${String(payload.actorId || 'unknown')}`;
            break;
        case 'release-possession':
            message = 'Released possession';
            break;
        case 'apply-damage':
            message = `Damage applied: ${Math.max(0, Math.round(Number(payload.amount) || 0))}`;
            break;
        case 'set-hp':
            message = `HP set: ${Math.max(0, Math.round(Number(payload.value) || 0))}`;
            break;
        case 'despawn-actor':
            message = `Despawn request: ${String(payload.actorId || 'unknown')}`;
            break;
        case 'rewind-turn':
            message = 'Timeline rewind requested';
            break;
        default:
            break;
        }

        if (message) {
            addDmEvent(message, 'system');
        }
    }

    function applyDmCommandLocally(command) {
        if (!command || !command.type) return false;
        traceDmPipeline('RECEIVED DM COMMAND', { from: 'local', command });
        applyDmCommandFromServer({ command });
        return true;
    }

    function dispatchDmCommand(command) {
        if (!command || !command.type) return false;

        traceDmPipeline('ISSUE DM COMMAND', {
            type: command.type,
            payload: command.payload || {},
            mode: getMode(),
            authority: getSimulationAuthority(),
            layer: getDmAuthorityLayer(),
            hasSocket: !!getSocket(),
        });

        const windowObj = getWindow();
        const forceLocal = windowObj.__DM_FORCE_LOCAL_DM_COMMANDS__ === true;
        const skipSocket = windowObj.__DM_SKIP_SOCKET_DM_COMMANDS__ === true;
        const shouldExecuteLocalFirst = forceLocal || getSimulationAuthority() === simulationAuthorityLocalDm;

        const socket = getSocket();
        if (!socket || shouldExecuteLocalFirst) {
            const applied = applyDmCommandLocally(command);
            if (socket && !skipSocket) {
                const netStats = getNetStats();
                netStats.dmCommandsOut += 1;
                netLog(`dm-command OUT  type=${command.type}  out#=${netStats.dmCommandsOut}`);
                socket.emit('dm-command', { command });
            }
            if (applied) {
                logDmCommandAction(command);
            }
            return applied;
        }

        const netStats = getNetStats();
        netStats.dmCommandsOut += 1;
        netLog(`dm-command OUT  type=${command.type}  out#=${netStats.dmCommandsOut}`);
        socket.emit('dm-command', { command });
        logDmCommandAction(command);
        return true;
    }

    function issueDmCommand(type, payload = {}) {
        if (getMode() !== modeDm) return false;

        let normalizedType = String(type || '').trim().toLowerCase();
        if (normalizedType === 'possess') normalizedType = 'possess-actor';
        if (!normalizedType) return false;

        if (!canIssueDmCommand(normalizedType)) {
            const layerText = String(getDmAuthorityLayer() || '').toUpperCase();
            console.warn(`[issueDmCommand] Blocked: ${normalizedType} not available in ${layerText} mode`);
            showFloatingText(`Mode ${layerText} cannot run ${normalizedType}`, '#ff8a8a', true);
            appendConsoleHistory(`DM capability blocked: ${normalizedType} (requires SIMULATOR mode for spawn commands)`, 'error');
            return false;
        }

        const command = {
            type: normalizedType,
            payload,
            issuedAt: Date.now(),
            authority: getSimulationAuthority(),
            layer: getDmAuthorityLayer(),
        };

        traceDmPipeline('SENDING DM COMMAND', command);

        const windowObj = getWindow();
        const forceLocal = windowObj.__DM_FORCE_LOCAL_DM_COMMANDS__ === true;
        const skipSocket = windowObj.__DM_SKIP_SOCKET_DM_COMMANDS__ === true;
        const shouldExecuteLocalFirst = forceLocal || getSimulationAuthority() === simulationAuthorityLocalDm;

        const socket = getSocket();
        if (!socket || shouldExecuteLocalFirst) {
            const applied = applyDmCommandLocally(command);
            if (socket && !skipSocket) {
                const netStats = getNetStats();
                netStats.dmCommandsOut += 1;
                netLog(`dm-command OUT  type=${command.type}  out#=${netStats.dmCommandsOut}`);
                socket.emit('dm-command', { command });
            }
            return applied;
        }

        const netStats = getNetStats();
        netStats.dmCommandsOut += 1;
        netLog(`dm-command OUT  type=${command.type}  out#=${netStats.dmCommandsOut}`);
        socket.emit('dm-command', { command });
        return true;
    }

    function emitDmCommand(command) {
        if (!command || typeof command !== 'object') return false;
        return issueDmCommand(command.type, command.payload || {});
    }

    return {
        dispatchDmCommand,
        logDmCommandAction,
        issueDmCommand,
        emitDmCommand,
        applyDmCommandLocally,
    };
}

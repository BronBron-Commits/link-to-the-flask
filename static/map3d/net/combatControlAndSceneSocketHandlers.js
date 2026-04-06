export function registerCombatControlAndSceneSocketHandlers(config) {
    const {
        socket,
        modeManager,
        mode,
        findCombatActorById,
        getCombatActorLabel,
        addDmEvent,
        notifyPendingDmApproval,
        getPendingCombatStartRequest,
        setPendingCombatStartRequest,
        showFloatingText,
        appendConsoleHistory,
        netStats,
        netLog,
        findMeshByPersistentId,
        findMeshByName,
        applyMaterialState,
        applySceneState,
        traceDmPipeline,
        applyDmCommandFromServer,
        netWarn,
        alignNetworkCombatTimeline,
        recordCombatAction,
        isDmObserverMode,
        getCombatActorLabelById,
        queueNetworkCombatAction,
    } = config || {};

    if (!socket) return;

    socket.on('combat-start-request', (packet) => {
        if (modeManager.current !== mode.DM || !socket) return;
        if (!packet || typeof packet !== 'object') return;
        const requestId = String(packet.requestId || '').trim();
        if (!requestId) return;
        const targetId = String(packet.targetId || '').trim();
        const requester = String(packet.from || '').trim();
        const target = targetId ? findCombatActorById(targetId) : null;
        const targetLabel = target ? getCombatActorLabel(target) : (targetId || 'unknown target');
        const approve = window.confirm(`Combat request from ${requester ? requester.slice(0, 6) : 'player'} for ${targetLabel}. Approve?`);
        socket.emit('combat-start-decision', {
            requestId,
            approved: approve,
        });
        addDmEvent(`Combat request ${approve ? 'approved' : 'rejected'}: ${targetLabel}`, approve ? 'ok' : 'system');
    });

    socket.on('combat-start-result', (packet) => {
        if (!packet || typeof packet !== 'object') return;
        const requestId = String(packet.requestId || '').trim();
        const approved = packet.approved === true;
        const status = String(packet.status || '').toLowerCase();
        const targetId = String(packet.targetId || '').trim();

        if (status === 'pending') {
            notifyPendingDmApproval('combat', targetId || 'target');
            return;
        }

        const pendingRequest = getPendingCombatStartRequest();
        if (!pendingRequest || pendingRequest.requestId !== requestId) return;
        if (!approved) {
            setPendingCombatStartRequest(null);
            showFloatingText('Combat request rejected by DM', '#ff8a8a', true);
            appendConsoleHistory('Combat request rejected by DM', 'error');
            return;
        }
        // Server is authoritative for combat mode and presentation. Wait for
        // broadcast world/combat events instead of switching locally.
        appendConsoleHistory('Combat request approved. Waiting for server state...', 'ok');
        setPendingCombatStartRequest(null);
    });

    socket.on('scene-update', (data) => {
        netStats.sceneUpdatesIn += 1;
        netLog(`scene-update  type=${data && data.type}  in#=${netStats.sceneUpdatesIn}`);
        if (data.type === 'material') {
            const mesh = findMeshByPersistentId(data.objectId) || findMeshByName(data.name);
            if (!mesh) return;
            if (Array.isArray(mesh.material)) {
                applyMaterialState(mesh.material[data.materialIndex], data.materialState, mesh);
            } else {
                applyMaterialState(mesh.material, data.materialState, mesh);
            }
            return;
        }
        // Apply incoming scene update (e.g., object positions)
        if (data && data.objects) {
            applySceneState(data);
        }
    });

    socket.on('scene-state', (data) => {
        const objCount = data && Array.isArray(data.objects) ? data.objects.length : 0;
        netLog(`scene-state (initial)  objects=${objCount}`);
        // Initial full scene state — always apply on connect.
        if (data && data.objects) {
            applySceneState(data);
        }
    });

    socket.on('dm-command', (packet) => {
        netStats.dmCommandsIn += 1;
        netLog(`dm-command IN  type=${packet && packet.command && packet.command.type}  from=${packet && packet.from}  in#=${netStats.dmCommandsIn}`);
        traceDmPipeline('RECEIVED DM COMMAND', packet);
        applyDmCommandFromServer(packet);
    });

    socket.on('dm-command-denied', (info) => {
        const reason = info && info.reason ? String(info.reason) : 'denied';
        netWarn(`dm-command-denied  reason=${reason}`);
        appendConsoleHistory(`DM command denied: ${reason}`, 'error');
    });

    socket.on('timeline-start', (packet) => {
        if (!packet || typeof packet !== 'object') return;
        alignNetworkCombatTimeline(packet);
    });

    socket.on('combat-action-record', (packet) => {
        const record = packet && packet.record ? packet.record : null;
        if (!record) return;
        const startTimeMs = Number(packet && packet.startTimeMs);

        // Keep action history aligned across clients and replay remotely for observers.
        recordCombatAction(record, { broadcast: false, replayRemote: false });

        if (modeManager.current === mode.DM || isDmObserverMode()) {
            const attackType = String(record.attackType || record.type || 'action').toUpperCase();
            const actor = getCombatActorLabelById(record.actorId);
            const target = getCombatActorLabelById(record.targetId);
            const result = String(record.result || 'pending').toUpperCase();
            const dmg = Number.isFinite(Number(record.damage)) ? Number(record.damage) : null;
            const dmgText = dmg !== null ? ` DMG ${dmg}` : '';
            addDmEvent(`${attackType}: ${actor} -> ${target} ${result}${dmgText}`, result === 'HIT' ? 'hit' : result === 'MISS' ? 'miss' : 'system');
            queueNetworkCombatAction(record, startTimeMs);
        }
    });
}

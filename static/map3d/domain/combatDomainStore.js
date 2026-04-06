export const COMBAT_DOMAIN_ACTION = {
    WORLD_SNAPSHOT: 'WORLD_SNAPSHOT',
    COMBAT_PACKET: 'COMBAT_PACKET',
};

function extractSeq(value) {
    const seq = Number(value);
    return Number.isFinite(seq) ? seq : null;
}

export function computeCombatTruthFromWorldPayload(payload, fallbackInCombat, options = {}) {
    const combatModeValue = String(options.combatModeValue || 'combat');
    const explorationModeValue = String(options.explorationModeValue || 'free');

    const modeRaw = String((payload && payload.mode) || '').toLowerCase();
    const modeFromWorld = modeRaw === 'combat' ? combatModeValue : (modeRaw === 'exploration' ? explorationModeValue : null);
    const combatFromPayload = (payload && payload.combat && typeof payload.combat === 'object') ? payload.combat : null;
    const combatStateFromPayload = combatFromPayload && typeof combatFromPayload.state === 'object'
        ? combatFromPayload.state
        : null;
    const inCombatFlag = !!(combatStateFromPayload && combatStateFromPayload.inCombat === true);

    const shouldBeInCombat = modeFromWorld === combatModeValue
        ? true
        : (modeFromWorld === explorationModeValue
            ? (inCombatFlag ? true : false)
            : (inCombatFlag ? true : !!fallbackInCombat));

    const initiatorSid = String(
        (combatStateFromPayload && combatStateFromPayload.initiator)
        || (payload && payload.initiator)
        || ''
    ).trim() || null;
    const targetId = String(
        (combatStateFromPayload && combatStateFromPayload.targetId)
        || (payload && payload.targetId)
        || ''
    ).trim() || null;

    return {
        shouldBeInCombat,
        modeFromWorld,
        initiatorSid,
        targetId,
    };
}

function defaultCombatPacketState(packet, options = {}) {
    const combatModeValue = String(options.combatModeValue || 'combat');
    const packetMode = String((packet && packet.mode) || '').toLowerCase();
    const inCombat = packetMode ? packetMode === 'combat' : !!(packet && packet.active);
    const initiatorSid = String((packet && packet.initiator) || '').trim() || null;
    const targetId = String((packet && packet.targetId) || '').trim() || null;
    return {
        inCombat,
        initiatorSid,
        targetId,
        combatModeValue,
    };
}

export function reduceCombatDomainState(prevState, action, options = {}) {
    if (!action || typeof action !== 'object') return prevState;

    const computeWorldTruth = typeof options.computeWorldTruth === 'function'
        ? options.computeWorldTruth
        : (payload, fallbackInCombat) => computeCombatTruthFromWorldPayload(payload, fallbackInCombat, options);
    const parseCombatPacket = typeof options.parseCombatPacket === 'function'
        ? options.parseCombatPacket
        : (packet) => defaultCombatPacketState(packet, options);

    if (action.type === COMBAT_DOMAIN_ACTION.WORLD_SNAPSHOT) {
        const payload = action.payload && typeof action.payload === 'object' ? action.payload : {};
        const seq = extractSeq(payload.serverSeq);
        if (seq !== null && seq <= prevState.lastServerSeq) {
            return prevState;
        }
        const worldTruth = computeWorldTruth(payload, prevState.inCombat);
        return {
            ...prevState,
            lastServerSeq: seq !== null ? seq : prevState.lastServerSeq,
            inCombat: !!worldTruth.shouldBeInCombat,
            initiatorSid: worldTruth.initiatorSid || prevState.initiatorSid,
            targetId: worldTruth.targetId || prevState.targetId,
        };
    }

    if (action.type === COMBAT_DOMAIN_ACTION.COMBAT_PACKET) {
        const packet = action.packet && typeof action.packet === 'object' ? action.packet : {};
        const seq = extractSeq(packet.serverSeq);
        if (seq !== null && seq <= prevState.lastServerSeq) {
            return prevState;
        }
        const packetState = parseCombatPacket(packet);
        return {
            ...prevState,
            lastServerSeq: seq !== null ? seq : prevState.lastServerSeq,
            inCombat: !!packetState.inCombat,
            initiatorSid: packetState.initiatorSid || prevState.initiatorSid,
            targetId: packetState.targetId || prevState.targetId,
        };
    }

    return prevState;
}

export function createCombatDomainStore(config = {}) {
    const initialState = config.initialState && typeof config.initialState === 'object' ? config.initialState : {};
    const onTransition = typeof config.onTransition === 'function' ? config.onTransition : null;
    const reducerOptions = {
        ...config,
        initialState: undefined,
        onTransition: undefined,
    };

    let state = {
        inCombat: false,
        initiatorSid: null,
        targetId: null,
        lastServerSeq: -1,
        ...initialState,
    };

    return {
        getState() {
            return state;
        },
        dispatch(action) {
            const prevState = state;
            const nextState = reduceCombatDomainState(prevState, action, reducerOptions);
            state = nextState;
            if (onTransition) {
                onTransition(prevState, nextState, action);
            }
            return state;
        },
    };
}

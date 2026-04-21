export function registerCombatStateSocketHandlers(config) {
    const {
        socket,
        netLog,
        hydrateWorld,
        combatDomainStore,
        combatDomainAction,
    } = config || {};

    if (!socket) return;
    if (typeof netLog !== 'function') throw new Error('registerCombatStateSocketHandlers requires netLog');
    if (typeof hydrateWorld !== 'function') throw new Error('registerCombatStateSocketHandlers requires hydrateWorld');
    if (!combatDomainStore || typeof combatDomainStore.dispatch !== 'function') {
        throw new Error('registerCombatStateSocketHandlers requires combatDomainStore');
    }
    if (!combatDomainAction || typeof combatDomainAction !== 'object') {
        throw new Error('registerCombatStateSocketHandlers requires combatDomainAction');
    }

    socket.on('world-init', (world) => {
        netLog('world-init received');
        hydrateWorld(world);
    });

    socket.on('world-update', (world) => {
        hydrateWorld(world);
    });

    socket.on('combat-state', (packet) => {
        const packetMode = String(packet && packet.mode ? packet.mode : '').toLowerCase();
        const inCombat = packetMode
            ? packetMode === 'combat'
            : !!(packet && packet.active);
        console.log('[NET] combat-state received', {
            active: inCombat,
            mode: packet && packet.mode,
            initiator: packet && packet.initiator,
        });
        combatDomainStore.dispatch({
            type: combatDomainAction.COMBAT_PACKET,
            packet,
        });
    });
}

export function createDmAuthorityManager(deps = {}) {
    const {
        SIMULATION_AUTHORITY,
        DM_AUTHORITY_LAYER,
        modeDm,
        getSimulationAuthority,
        setSimulationAuthorityState,
        getDmAuthorityLayer,
        setDmAuthorityLayerState,
        getCurrentGameMode,
        gameModeCombat,
        beginLocalCombatTimeline,
        getControlledActor,
        releasePossession,
        getModeManager,
        traceDmPipeline,
        appendConsoleHistory,
    } = deps;

    function startLocalSimulation() {
        setSimulationAuthorityState(SIMULATION_AUTHORITY.LOCAL_DM);
        setDmAuthorityLayerState(DM_AUTHORITY_LAYER.SIMULATOR);
        if (getCurrentGameMode() === gameModeCombat) {
            beginLocalCombatTimeline();
        }
        return true;
    }

    function setSimulationAuthority(authority) {
        const normalized = String(authority || '').toLowerCase();
        if (!Object.values(SIMULATION_AUTHORITY).includes(normalized)) return false;
        setSimulationAuthorityState(normalized);
        if (normalized === SIMULATION_AUTHORITY.LOCAL_DM && getCurrentGameMode() === gameModeCombat) {
            beginLocalCombatTimeline();
        }
        return true;
    }

    function syncDmAuthorityLayerFromState() {
        if (getSimulationAuthority() === SIMULATION_AUTHORITY.LOCAL_DM) {
            setDmAuthorityLayerState(DM_AUTHORITY_LAYER.SIMULATOR);
            return getDmAuthorityLayer();
        }

        if (getDmAuthorityLayer() === DM_AUTHORITY_LAYER.SIMULATOR) {
            setDmAuthorityLayerState(DM_AUTHORITY_LAYER.OBSERVER);
        }
        if (getControlledActor() && getDmAuthorityLayer() === DM_AUTHORITY_LAYER.OBSERVER) {
            setDmAuthorityLayerState(DM_AUTHORITY_LAYER.PUPPETEER);
        }
        if (!Object.values(DM_AUTHORITY_LAYER).includes(getDmAuthorityLayer())) {
            setDmAuthorityLayerState(DM_AUTHORITY_LAYER.OBSERVER);
        }
        return getDmAuthorityLayer();
    }

    function setDmAuthorityLayer(nextLayer) {
        const normalized = String(nextLayer || '').toLowerCase();
        if (!Object.values(DM_AUTHORITY_LAYER).includes(normalized)) return false;

        setDmAuthorityLayerState(normalized);
        if (normalized === DM_AUTHORITY_LAYER.SIMULATOR) {
            setSimulationAuthority(SIMULATION_AUTHORITY.LOCAL_DM);
        } else {
            setSimulationAuthority(SIMULATION_AUTHORITY.SERVER);
            if (normalized === DM_AUTHORITY_LAYER.OBSERVER) {
                releasePossession();
            }
        }
        return true;
    }

    function forceGodModeForDiagnostics() {
        const modeManager = getModeManager();
        modeManager.setMode(modeDm);
        setDmAuthorityLayer(DM_AUTHORITY_LAYER.SIMULATOR);
        setSimulationAuthority(SIMULATION_AUTHORITY.LOCAL_DM);
        startLocalSimulation();
        traceDmPipeline('FORCED GOD MODE', {
            mode: modeManager.current,
            layer: getDmAuthorityLayer(),
            authority: getSimulationAuthority(),
        });
        appendConsoleHistory('DM diagnostics: forced GOD simulator + local command execution', 'ok');
    }

    return {
        startLocalSimulation,
        setSimulationAuthority,
        syncDmAuthorityLayerFromState,
        setDmAuthorityLayer,
        forceGodModeForDiagnostics,
    };
}

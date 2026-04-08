const FALLBACK_PARTY = [
    { id: 'bronson', name: 'Bronson', role: 'Vanguard', hp: 842, maxHp: 999, mp: 36, maxMp: 48, position: { x: -4, y: 0, z: -5 } },
    { id: 'sarah', name: 'Sarah', role: 'Invoker', hp: 601, maxHp: 730, mp: 88, maxMp: 112, position: { x: 0, y: 0, z: -5 } },
    { id: 'tat', name: 'Tat', role: 'Breaker', hp: 1124, maxHp: 1275, mp: 18, maxMp: 28, position: { x: 4, y: 0, z: -5 } },
];

const FALLBACK_ENEMIES = [
    { id: 'blimp', name: 'Blimp', hp: 480, maxHp: 640, position: { x: -4, y: 0, z: 6 } },
    { id: 'eclipse', name: '6Eclipse', hp: 910, maxHp: 910, position: { x: 0, y: 0, z: 6 } },
    { id: 'clover', name: 'Clover', hp: 320, maxHp: 470, position: { x: 4, y: 0, z: 6 } },
];

const COMMANDS = [
    { id: 'attack', label: 'Attack', kind: 'target-enemy' },
    { id: 'move', label: 'Move', kind: 'move', stepFt: 5 },
    { id: 'dash', label: 'Dash', kind: 'move', stepFt: 10 },
    { id: 'disengage', label: 'Disengage', kind: 'move', stepFt: 5 },
    { id: 'dodge', label: 'Dodge', kind: 'instant' },
    { id: 'end-turn', label: 'End Turn', kind: 'end-turn' },
];

const MOVE_CHOICES = [
    { id: 'north', label: 'North 5ft', dx: 0, dz: -1 },
    { id: 'south', label: 'South 5ft', dx: 0, dz: 1 },
    { id: 'west', label: 'West 5ft', dx: -1, dz: 0 },
    { id: 'east', label: 'East 5ft', dx: 1, dz: 0 },
];

const root = document.getElementById('combat-ui-root');
if (!root) throw new Error('Missing #combat-ui-root');
root.style.display = 'none';

const PLAYER_NAME = (typeof window.__COMBAT_PLAYER_NAME__ === 'string' && window.__COMBAT_PLAYER_NAME__.trim())
    || null;
const PLAYER_SIDE = (typeof window.__COMBAT_PLAYER_SIDE__ === 'string' && window.__COMBAT_PLAYER_SIDE__.trim())
    || null;

const liveState = {
    connected: false,
    localSid: null,
    inCombat: false,
    currentTurn: null,
    playersById: new Map(),
    enemiesById: new Map(),
};

const uiState = {
    commandIndex: 0,
    stage: 'command',
    selectedTargetId: null,
    selectedMoveId: null,
    pendingAction: false,
    preview: null,
    previewDenied: null,
    actionCommittedActorId: null,
    guidedOverride: null,
    status: 'Connecting to combat state...',
    log: [
        PLAYER_NAME ? `Joined as ${PLAYER_NAME}${PLAYER_SIDE ? ` · ${PLAYER_SIDE}` : ''}.` : 'Combat UI attached.',
        'Waiting for live combat state.',
    ],
    previewRequestId: null,
};

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function numberOr(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function pct(current, max) {
    if (!max) return 0;
    return clamp((current / max) * 100, 0, 100);
}

function nextId(prefix) {
    return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

function pushLog(message) {
    if (!message) return;
    uiState.log.unshift(message);
    uiState.log = uiState.log.slice(0, 8);
}

function toPlayerActor(entry, fallbackId) {
    if (!entry || typeof entry !== 'object') return null;
    const actorId = String(entry.actorId || entry.networkId || entry.id || fallbackId || '').trim();
    if (!actorId) return null;
    const pos = (entry.position && typeof entry.position === 'object') ? entry.position : {};
    const maxHp = numberOr(entry.maxHp ?? entry.max_hp, numberOr(entry.hp ?? entry.currentHp ?? entry.current_hp, 20));
    const hp = numberOr(entry.hp ?? entry.currentHp ?? entry.current_hp, maxHp);
    return {
        id: actorId,
        type: 'player',
        ownerSid: fallbackId || null,
        name: String(entry.name || entry.label || actorId),
        role: String(entry.class || entry.role || 'Player'),
        hp,
        maxHp,
        mp: numberOr(entry.mp, 0),
        maxMp: numberOr(entry.maxMp, numberOr(entry.mp, 0)),
        position: {
            x: numberOr(pos.x, 0),
            y: numberOr(pos.y, 0),
            z: numberOr(pos.z, 0),
        },
    };
}

function toEnemyActor(entry, fallbackId) {
    if (!entry || typeof entry !== 'object') return null;
    const actorId = String(entry.actorId || entry.networkId || entry.id || fallbackId || '').trim();
    if (!actorId) return null;
    const pos = (entry.position && typeof entry.position === 'object') ? entry.position : {};
    const maxHp = numberOr(entry.maxHp, numberOr(entry.hp, 30));
    const hp = numberOr(entry.hp, maxHp);
    return {
        id: actorId,
        type: 'enemy',
        name: String(entry.name || entry.label || actorId),
        hp,
        maxHp,
        ac: numberOr(entry.ac, 10),
        position: {
            x: numberOr(pos.x, 0),
            y: numberOr(pos.y, 0),
            z: numberOr(pos.z, 0),
        },
    };
}

function getTurnPacketFromCombatFullState(packet) {
    const safe = packet && typeof packet === 'object' ? packet : {};
    const order = Array.isArray(safe.order) ? safe.order : [];
    const idxRaw = safe.turn;
    const idx = Number.isFinite(Number(idxRaw)) ? Number(idxRaw) : 0;
    return {
        order,
        turnIndex: order.length ? clamp(idx, 0, order.length - 1) : 0,
        roundNumber: numberOr(safe.state?.roundNumber, 1),
        currentActor: order.length ? order[clamp(idx, 0, order.length - 1)] : null,
    };
}

function getOrderedActors(type) {
    const map = type === 'player' ? liveState.playersById : liveState.enemiesById;
    const fallback = type === 'player' ? FALLBACK_PARTY : FALLBACK_ENEMIES;
    const ordered = [];
    const seen = new Set();
    const turnOrder = Array.isArray(liveState.currentTurn?.order) ? liveState.currentTurn.order : [];

    turnOrder.forEach((entry) => {
        if (!entry || String(entry.type || '').toLowerCase() !== type) return;
        const actorId = String(entry.id || '').trim();
        if (!actorId || seen.has(actorId)) return;
        const actor = map.get(actorId);
        ordered.push(actor ? { ...actor, ...entry } : {
            id: actorId,
            type,
            ownerSid: entry.ownerSid || null,
            name: String(entry.name || actorId),
            role: type === 'player' ? 'Player' : 'Enemy',
            hp: type === 'player' ? 20 : 30,
            maxHp: type === 'player' ? 20 : 30,
            mp: 0,
            maxMp: 0,
            position: { x: 0, y: 0, z: 0 },
        });
        seen.add(actorId);
    });

    map.forEach((actor, actorId) => {
        if (seen.has(actorId)) return;
        ordered.push(actor);
        seen.add(actorId);
    });

    if (!ordered.length) {
        return fallback.map((entry) => ({ ...entry, type }));
    }
    return ordered;
}

function getCurrentActor() {
    const current = liveState.currentTurn?.currentActor;
    if (!current || typeof current !== 'object') return null;
    const actorId = String(current.id || '').trim();
    if (!actorId) return current;
    const map = String(current.type || '').toLowerCase() === 'enemy' ? liveState.enemiesById : liveState.playersById;
    return map.get(actorId) || current;
}

function isLocalPlayersTurn() {
    const current = liveState.currentTurn?.currentActor;
    if (!current || typeof current !== 'object') return false;
    if (String(current.type || '').toLowerCase() !== 'player') return false;
    const ownerSid = String(current.ownerSid || '').trim();
    if (!ownerSid) return true;
    if (!liveState.localSid) return false;
    return ownerSid === liveState.localSid;
}

function getSelectedCommand() {
    return COMMANDS[clamp(uiState.commandIndex, 0, COMMANDS.length - 1)] || COMMANDS[0];
}

function currentActorChanged() {
    const current = getCurrentActor();
    const actorId = String(current?.id || '');
    if (!actorId) return;
    if (uiState.actionCommittedActorId && uiState.actionCommittedActorId !== actorId) {
        uiState.actionCommittedActorId = null;
        uiState.stage = 'command';
        uiState.selectedTargetId = null;
        uiState.selectedMoveId = null;
        uiState.preview = null;
        uiState.previewDenied = null;
        uiState.pendingAction = false;
    }
}

function selectCommand(index) {
    uiState.commandIndex = clamp(index, 0, COMMANDS.length - 1);
    const command = getSelectedCommand();
    uiState.preview = null;
    uiState.previewDenied = null;
    uiState.guidedOverride = null;
    if (command.kind === 'target-enemy') {
        const enemies = getOrderedActors('enemy');
        uiState.stage = 'target';
        uiState.selectedTargetId = enemies[0]?.id || null;
        if (uiState.selectedTargetId) requestAttackPreview(uiState.selectedTargetId);
    } else if (command.kind === 'move') {
        uiState.stage = 'move';
        uiState.selectedMoveId = uiState.selectedMoveId || MOVE_CHOICES[0].id;
    } else {
        uiState.stage = 'command';
        uiState.selectedTargetId = null;
        uiState.selectedMoveId = null;
    }
}

function requestAttackPreview(targetId) {
    if (!socket || !socket.connected || !targetId) return;
    const requestId = nextId('preview');
    uiState.previewRequestId = requestId;
    socket.emit('combat-action-preview', {
        requestId,
        type: 'attack',
        targetId,
    });
}

function submitCombatAction(payload) {
    if (!socket || !socket.connected || uiState.pendingAction) return;
    uiState.pendingAction = true;
    uiState.guidedOverride = 'status';
    socket.emit('combat-action', {
        id: nextId(payload.type || 'action'),
        ...payload,
    });
}

function submitEndTurn() {
    if (!socket || !socket.connected || uiState.pendingAction) return;
    uiState.pendingAction = true;
    uiState.guidedOverride = 'status';
    socket.emit('end-turn', { source: 'combat-ui' });
}

function confirmSelection() {
    const command = getSelectedCommand();
    if (!isLocalPlayersTurn() || !liveState.inCombat || !command) return;

    if (command.kind === 'target-enemy') {
        if (!uiState.selectedTargetId) return;
        submitCombatAction({ type: 'attack', targetId: uiState.selectedTargetId });
        return;
    }

    if (command.kind === 'move') {
        const actor = getCurrentActor();
        const choice = MOVE_CHOICES.find((entry) => entry.id === uiState.selectedMoveId) || MOVE_CHOICES[0];
        if (!actor || !actor.position || !choice) return;
        const distance = numberOr(command.stepFt, 5);
        submitCombatAction({
            type: command.id,
            position: {
                x: Number((numberOr(actor.position.x, 0) + (choice.dx * distance)).toFixed(3)),
                y: numberOr(actor.position.y, 0),
                z: Number((numberOr(actor.position.z, 0) + (choice.dz * distance)).toFixed(3)),
            },
        });
        return;
    }

    if (command.kind === 'instant') {
        submitCombatAction({ type: command.id });
        return;
    }

    if (command.kind === 'end-turn') {
        submitEndTurn();
    }
}

function cancelSelection() {
    uiState.guidedOverride = null;
    uiState.previewDenied = null;
    if (uiState.stage === 'target' || uiState.stage === 'move') {
        uiState.stage = 'command';
        return;
    }
    uiState.commandIndex = 0;
}

function moveSelection(direction) {
    if (uiState.stage === 'target') {
        const enemies = getOrderedActors('enemy');
        if (!enemies.length) return;
        const currentIndex = Math.max(0, enemies.findIndex((enemy) => enemy.id === uiState.selectedTargetId));
        const nextIndex = (currentIndex + direction + enemies.length) % enemies.length;
        uiState.selectedTargetId = enemies[nextIndex].id;
        requestAttackPreview(uiState.selectedTargetId);
        return;
    }

    if (uiState.stage === 'move') {
        const currentIndex = Math.max(0, MOVE_CHOICES.findIndex((choice) => choice.id === uiState.selectedMoveId));
        const nextIndex = (currentIndex + direction + MOVE_CHOICES.length) % MOVE_CHOICES.length;
        uiState.selectedMoveId = MOVE_CHOICES[nextIndex].id;
        return;
    }

    selectCommand(uiState.commandIndex + direction);
}

function getGuidance() {
    if (uiState.guidedOverride) {
        return uiState.guidedOverride;
    }
    if (!liveState.connected) return 'status';
    if (!liveState.inCombat) return 'status';
    if (!liveState.currentTurn?.currentActor) return 'turn';
    if (!isLocalPlayersTurn()) return 'turn';
    if (uiState.pendingAction) return 'status';
    if (uiState.actionCommittedActorId && uiState.actionCommittedActorId === String(getCurrentActor()?.id || '')) {
        return 'end-turn';
    }
    if (uiState.stage === 'target' || uiState.stage === 'move') return 'targets';
    return 'commands';
}

function getStatusText() {
    if (!liveState.connected) return 'Connecting to Socket.IO...';
    if (!liveState.inCombat) return 'Waiting for active combat. Start a combat encounter to drive this UI live.';
    if (!liveState.currentTurn?.currentActor) return 'Combat is active, waiting for turn payload.';
    if (!isLocalPlayersTurn()) {
        const actor = getCurrentActor();
        return `${actor?.name || 'Another actor'} is acting. Watch the turn rail until control returns to you.`;
    }
    if (uiState.pendingAction) return 'Action sent to server. Waiting for authoritative result...';
    if (uiState.actionCommittedActorId === String(getCurrentActor()?.id || '')) {
        return 'Your action resolved. End your turn when you are done.';
    }
    if (uiState.stage === 'target') return 'Pick the enemy to attack next.';
    if (uiState.stage === 'move') return 'Pick the direction to move next.';
    return 'Choose a combat action from the command box.';
}

function getCommandHint() {
    const command = getSelectedCommand();
    if (!command) return 'No command selected.';
    if (command.id === 'attack') {
        const preview = uiState.preview?.preview;
        if (preview) {
            const disadvantage = preview.disadvantage ? ' with disadvantage' : '';
            return `${preview.weapon?.name || 'Weapon'} ${preview.rangeBand || 'range'} attack${disadvantage}. ${preview.hitChancePct}% hit, ${preview.damageMin}-${preview.damageMax} damage.`;
        }
        if (uiState.previewDenied?.reason === 'target-out-of-range') {
            return `Target is out of range at ${uiState.previewDenied.distanceFt}ft. Move first.`;
        }
        return 'Attack a selected enemy with server-authoritative preview.';
    }
    if (command.id === 'move') return 'Move 5ft in one direction.';
    if (command.id === 'dash') return 'Move farther using your Dash action.';
    if (command.id === 'disengage') return 'Reposition without provoking melee reactions.';
    if (command.id === 'dodge') return 'Apply Dodge until your next turn.';
    if (command.id === 'end-turn') return 'Advance combat to the next actor.';
    return `${command.label} ready.`;
}

function renderPartyCards() {
    const players = getOrderedActors('player');
    const currentActorId = String(getCurrentActor()?.id || '');
    return players.map((actor, index) => {
        const active = String(actor.id) === currentActorId;
        const owned = String(actor.ownerSid || '') === String(liveState.localSid || '');
        return `
            <article class="party-card ${active ? 'is-active' : ''}">
                <div class="party-portrait" style="--portrait-hue:${(index * 53) + 18}deg"></div>
                <div class="party-main">
                    <div class="party-head">
                        <div>
                            <h3>${actor.name}</h3>
                            <p>${owned ? 'You' : actor.role || 'Ally'}</p>
                        </div>
                        <div class="atb-ring ${active ? 'is-ready' : ''}"><span>${active ? 'ACT' : 'RDY'}</span></div>
                    </div>
                    <div class="meter-label"><span>HP</span><strong>${Math.round(numberOr(actor.hp, 0))}/${Math.round(numberOr(actor.maxHp, 1))}</strong></div>
                    <div class="meter"><div class="meter-fill hp" style="width:${pct(actor.hp, actor.maxHp)}%"></div></div>
                    <div class="meter-label"><span>MP</span><strong>${Math.round(numberOr(actor.mp, 0))}/${Math.round(numberOr(actor.maxMp, Math.max(1, actor.mp || 0)))} </strong></div>
                    <div class="meter"><div class="meter-fill mp" style="width:${pct(actor.mp, actor.maxMp || Math.max(1, actor.mp || 0))}%"></div></div>
                </div>
            </article>
        `;
    }).join('');
}

function renderEnemies() {
    const enemies = getOrderedActors('enemy');
    const currentActorId = String(getCurrentActor()?.id || '');
    return enemies.map((enemy) => {
        const targeted = uiState.stage === 'target' && enemy.id === uiState.selectedTargetId;
        const active = String(enemy.id) === currentActorId;
        return `
            <article class="enemy-card ${targeted ? 'is-targeted' : ''} ${active ? 'is-active-turn' : ''}" data-enemy-id="${enemy.id}">
                <div class="enemy-shell"></div>
                <div class="enemy-meta">
                    <h3>${enemy.name}</h3>
                    <p>AC ${Math.round(numberOr(enemy.ac, 10))}</p>
                    <div class="enemy-hp"><div class="enemy-hp-fill" style="width:${pct(enemy.hp, enemy.maxHp)}%"></div></div>
                </div>
            </article>
        `;
    }).join('');
}

function renderTurnOrder() {
    const order = Array.isArray(liveState.currentTurn?.order) && liveState.currentTurn.order.length
        ? liveState.currentTurn.order
        : [...getOrderedActors('player'), ...getOrderedActors('enemy')];
    const turnIndex = numberOr(liveState.currentTurn?.turnIndex, 0);
    return order.slice(0, 8).map((entry, index) => {
        const isCurrent = index === turnIndex;
        const label = String(entry.name || entry.id || `slot-${index + 1}`);
        return `<div class="turn-pill ${isCurrent ? 'is-current' : ''}">${label}</div>`;
    }).join('');
}

function renderCommandMenu(guidance) {
    return COMMANDS.map((command, index) => {
        const selected = index === uiState.commandIndex && uiState.stage === 'command';
        const guided = guidance === 'commands' && index === uiState.commandIndex;
        const nextMarker = command.kind === 'end-turn' ? '>>' : command.kind === 'instant' ? '!' : '•';
        return `
            <button class="command-btn ${selected ? 'is-selected' : ''} ${guided ? 'guide-pulse' : ''}" data-command-index="${index}" type="button">
                <span>${command.label}</span>
                <small>${nextMarker}</small>
            </button>
        `;
    }).join('');
}

function renderTargetStrip(guidance) {
    if (uiState.stage === 'target') {
        return getOrderedActors('enemy').map((target) => {
            const active = target.id === uiState.selectedTargetId;
            return `
                <button class="target-chip ${active ? 'is-selected' : ''} ${(guidance === 'targets' && active) ? 'guide-pulse' : ''}" data-target-id="${target.id}" type="button">
                    <span>${target.name}</span>
                    <small>${Math.round(numberOr(target.hp, 0))}/${Math.round(numberOr(target.maxHp, 1))} HP</small>
                </button>
            `;
        }).join('');
    }

    if (uiState.stage === 'move') {
        const command = getSelectedCommand();
        const distance = numberOr(command.stepFt, 5);
        return MOVE_CHOICES.map((choice) => {
            const active = choice.id === uiState.selectedMoveId;
            return `
                <button class="target-chip ${active ? 'is-selected' : ''} ${(guidance === 'targets' && active) ? 'guide-pulse' : ''}" data-move-id="${choice.id}" type="button">
                    <span>${choice.label.replace('5ft', `${distance}ft`)}</span>
                    <small>${command.id}</small>
                </button>
            `;
        }).join('');
    }

    return '<div class="target-strip muted">No target or direction step active.</div>';
}

function renderPreview() {
    const command = getSelectedCommand();
    const preview = uiState.preview?.preview;
    if (command.id === 'attack' && preview) {
        return `
            <div class="panel-kicker">Preview</div>
            <div class="preview-title">${preview.weapon?.name || 'Attack'}</div>
            <p>${preview.hitChancePct}% hit chance, ${preview.damageMin}-${preview.damageMax} damage, ${preview.distanceFt}ft away.</p>
        `;
    }
    if (uiState.previewDenied) {
        return `
            <div class="panel-kicker">Preview</div>
            <div class="preview-title">Denied</div>
            <p>${String(uiState.previewDenied.reason || 'Action unavailable').replace(/-/g, ' ')}.</p>
        `;
    }
    return `
        <div class="panel-kicker">Preview</div>
        <div class="preview-title">${command.label}</div>
        <p>${getCommandHint()}</p>
    `;
}

function renderLog() {
    return uiState.log.map((entry, index) => `<li class="log-row ${index === 0 ? 'is-fresh' : ''}">${entry}</li>`).join('');
}

function render() {
    if (!liveState.inCombat) {
        root.style.display = 'none';
        return;
    }
    root.style.display = 'block';
    currentActorChanged();
    const currentActor = getCurrentActor();
    const guidance = getGuidance();
    const round = numberOr(liveState.currentTurn?.roundNumber, 1);

    root.innerHTML = `
        <div class="combat-stage">
            <div class="stage-backdrop"></div>
            <div class="stage-aurora stage-aurora-a"></div>
            <div class="stage-aurora stage-aurora-b"></div>
            <div class="stage-horizon"></div>
            <div class="stage-foam"></div>

            <header class="combat-header">
                <div class="header-badge ${guidance === 'status' ? 'guide-pulse' : ''}">Combat UI Live Dock</div>
                <div class="turn-track ${guidance === 'turn' ? 'guide-pulse' : ''}">${renderTurnOrder()}</div>
            </header>

            <section class="enemy-rail ${guidance === 'targets' && uiState.stage === 'target' ? 'guide-zone' : ''}">${renderEnemies()}</section>

            <aside class="battle-log-panel ${guidance === 'status' ? 'guide-pulse' : ''}">
                <div class="panel-kicker">Combat Log</div>
                <div class="status-banner">${getStatusText()}</div>
                <ol class="battle-log">${renderLog()}</ol>
            </aside>

            <section class="party-rail">${renderPartyCards()}</section>

            <section class="command-dock">
                <div class="command-frame">
                    <div class="command-topline">
                        <div>
                            <div class="panel-kicker">Round ${Math.max(1, round)}</div>
                            <h2>${currentActor?.name || 'No Active Actor'}</h2>
                        </div>
                        <div class="command-mode">${isLocalPlayersTurn() ? 'YOUR TURN' : 'OBSERVE'}</div>
                    </div>

                    <div class="command-hint">${getCommandHint()}</div>

                    <div class="target-zone ${guidance === 'targets' ? 'guide-zone' : ''}">${renderTargetStrip(guidance)}</div>

                    <div class="command-list ${guidance === 'commands' ? 'guide-zone' : ''}">${renderCommandMenu(guidance)}</div>

                    <div class="command-preview">${renderPreview()}</div>

                    <div class="command-footer">
                        <button class="footer-btn" data-action="confirm" type="button">Confirm</button>
                        <button class="footer-btn" data-action="cancel" type="button">Back</button>
                        <button class="footer-btn ${guidance === 'end-turn' ? 'guide-pulse' : ''}" data-action="end-turn" type="button">End Turn</button>
                    </div>
                </div>
            </section>

            <footer class="help-bar">
                <span>Up/Down: Navigate</span>
                <span>Left/Right: Cycle target or direction</span>
                <span>Enter: Confirm</span>
                <span>Esc: Back</span>
            </footer>
        </div>
    `;

    bindInteractions();
}

function bindInteractions() {
    root.querySelectorAll('[data-command-index]').forEach((button) => {
        button.addEventListener('click', () => {
            if (!isLocalPlayersTurn()) return;
            selectCommand(Number(button.dataset.commandIndex));
            render();
        });
    });

    root.querySelectorAll('[data-target-id]').forEach((button) => {
        button.addEventListener('click', () => {
            if (!isLocalPlayersTurn()) return;
            uiState.selectedTargetId = String(button.dataset.targetId || '');
            requestAttackPreview(uiState.selectedTargetId);
            render();
        });
    });

    root.querySelectorAll('[data-move-id]').forEach((button) => {
        button.addEventListener('click', () => {
            if (!isLocalPlayersTurn()) return;
            uiState.selectedMoveId = String(button.dataset.moveId || '');
            render();
        });
    });

    root.querySelectorAll('[data-enemy-id]').forEach((card) => {
        card.addEventListener('click', () => {
            if (!isLocalPlayersTurn() || uiState.stage !== 'target') return;
            uiState.selectedTargetId = String(card.dataset.enemyId || '');
            requestAttackPreview(uiState.selectedTargetId);
            render();
        });
    });

    root.querySelectorAll('[data-action]').forEach((button) => {
        button.addEventListener('click', () => {
            const action = String(button.dataset.action || '');
            if (action === 'confirm') confirmSelection();
            if (action === 'cancel') cancelSelection();
            if (action === 'end-turn') submitEndTurn();
            render();
        });
    });
}

function handleKeydown(event) {
    if (event.key === 'ArrowUp') {
        event.preventDefault();
        moveSelection(-1);
        render();
        return;
    }
    if (event.key === 'ArrowDown') {
        event.preventDefault();
        moveSelection(1);
        render();
        return;
    }
    if (event.key === 'ArrowLeft') {
        event.preventDefault();
        if (uiState.stage === 'target' || uiState.stage === 'move') {
            moveSelection(-1);
            render();
        }
        return;
    }
    if (event.key === 'ArrowRight') {
        event.preventDefault();
        if (uiState.stage === 'target' || uiState.stage === 'move') {
            moveSelection(1);
            render();
        }
        return;
    }
    if (event.key === 'Enter') {
        event.preventDefault();
        confirmSelection();
        render();
        return;
    }
    if (event.key === 'Escape' || event.key === 'Backspace') {
        event.preventDefault();
        cancelSelection();
        render();
    }
}

function syncPlayers(playersPayload) {
    liveState.playersById.clear();
    const safe = playersPayload && typeof playersPayload === 'object' ? playersPayload : {};
    Object.entries(safe).forEach(([sid, entry]) => {
        const actor = toPlayerActor(entry, sid);
        if (!actor) return;
        liveState.playersById.set(actor.id, actor);
    });
}

function syncWorld(worldPayload) {
    const safe = worldPayload && typeof worldPayload === 'object' ? worldPayload : {};
    syncPlayers(safe.players || {});
    liveState.enemiesById.clear();
    const enemies = Array.isArray(safe.enemies) ? safe.enemies : [];
    enemies.forEach((entry, index) => {
        const actor = toEnemyActor(entry, `enemy-${index}`);
        if (!actor) return;
        liveState.enemiesById.set(actor.id, actor);
    });
    const combatMeta = safe.combat?.state && typeof safe.combat.state === 'object' ? safe.combat.state : {};
    liveState.inCombat = !!combatMeta.inCombat;
}

function resetForNewTurn() {
    uiState.pendingAction = false;
    uiState.preview = null;
    uiState.previewDenied = null;
    uiState.guidedOverride = null;
    uiState.selectedTargetId = null;
    uiState.selectedMoveId = null;
    uiState.stage = 'command';
    if (!uiState.actionCommittedActorId || uiState.actionCommittedActorId !== String(getCurrentActor()?.id || '')) {
        uiState.commandIndex = 0;
    }
}

const socket = window.__LOBBY_SOCKET__ || (typeof window.io === 'function' ? window.io() : null);

if (socket) {
    socket.on('connect', () => {
        liveState.connected = true;
        liveState.localSid = socket.id || null;
        uiState.status = 'Connected.';
        pushLog('Connected to combat socket.');
        socket.emit('request-combat-state', {});
        render();
    });

    socket.on('disconnect', () => {
        liveState.connected = false;
        pushLog('Disconnected from combat socket.');
        render();
    });

    socket.on('player-id', (payload) => {
        if (payload && typeof payload === 'object' && payload.id) {
            liveState.localSid = String(payload.id);
            render();
        }
    });

    socket.on('world-init', (payload) => {
        syncWorld(payload);
        render();
    });

    socket.on('world-update', (payload) => {
        syncWorld(payload);
        render();
    });

    socket.on('players-state', (payload) => {
        syncPlayers(payload);
        render();
    });

    socket.on('player-update', (entry) => {
        const actor = toPlayerActor(entry, entry?.id);
        if (actor) liveState.playersById.set(actor.id, actor);
        render();
    });

    socket.on('player-joined', (entry) => {
        const actor = toPlayerActor(entry, entry?.id);
        if (actor) liveState.playersById.set(actor.id, actor);
        render();
    });

    socket.on('player-left', (payload) => {
        const value = String(payload?.id || '').trim();
        for (const [actorId, actor] of liveState.playersById.entries()) {
            if (actorId === value || String(actor.ownerSid || '') === value) {
                liveState.playersById.delete(actorId);
            }
        }
        render();
    });

    socket.on('entity-move', (packet) => {
        const actorId = String(packet?.id || '').trim();
        const pos = packet?.position;
        if (!actorId || !pos) return;
        const actor = liveState.playersById.get(actorId) || liveState.enemiesById.get(actorId);
        if (!actor) return;
        actor.position = {
            x: numberOr(pos.x, numberOr(actor.position?.x, 0)),
            y: numberOr(pos.y, numberOr(actor.position?.y, 0)),
            z: numberOr(pos.z, numberOr(actor.position?.z, 0)),
        };
        render();
    });

    socket.on('combat-state', (packet) => {
        liveState.inCombat = !!packet?.active;
        if (!liveState.inCombat) {
            liveState.currentTurn = null;
            resetForNewTurn();
        }
        render();
    });

    socket.on('combat-full-state', (packet) => {
        liveState.inCombat = !!packet?.state?.inCombat;
        liveState.currentTurn = getTurnPacketFromCombatFullState(packet);
        resetForNewTurn();
        render();
    });

    socket.on('combat-turn', (packet) => {
        liveState.currentTurn = packet && typeof packet === 'object' ? packet : null;
        resetForNewTurn();
        const actor = getCurrentActor();
        if (actor) {
            pushLog(`Turn: ${actor.name}`);
        }
        render();
    });

    socket.on('combat-reset', () => {
        liveState.inCombat = false;
        liveState.currentTurn = null;
        uiState.actionCommittedActorId = null;
        resetForNewTurn();
        pushLog('Combat reset.');
        render();
    });

    socket.on('combat-action-preview', (packet) => {
        if (packet?.requestId && uiState.previewRequestId && packet.requestId !== uiState.previewRequestId) return;
        uiState.preview = packet;
        uiState.previewDenied = null;
        render();
    });

    socket.on('combat-preview-denied', (packet) => {
        if (packet?.requestId && uiState.previewRequestId && packet.requestId !== uiState.previewRequestId) return;
        uiState.preview = null;
        uiState.previewDenied = packet || { reason: 'preview-denied' };
        if (packet?.reason === 'target-out-of-range') {
            uiState.commandIndex = COMMANDS.findIndex((entry) => entry.id === 'move');
            uiState.stage = 'command';
            uiState.guidedOverride = 'commands';
        }
        render();
    });

    socket.on('combat-action-result', (packet) => {
        uiState.pendingAction = false;
        uiState.preview = null;
        uiState.previewDenied = null;
        const actorId = String(packet?.attacker || '');
        const currentActorId = String(getCurrentActor()?.id || '');
        if (actorId && actorId === currentActorId && isLocalPlayersTurn()) {
            uiState.actionCommittedActorId = actorId;
            uiState.stage = 'command';
            uiState.guidedOverride = 'end-turn';
        }
        if (packet?.type === 'attack') {
            const hitText = packet.hit ? `hit for ${packet.damage}` : 'missed';
            pushLog(`${packet.attacker} attacked ${packet.targetId}: ${hitText}.`);
        } else if (packet?.type) {
            pushLog(`${packet.attacker} used ${packet.type}.`);
        }
        render();
    });

    socket.on('combat-action-denied', (packet) => {
        uiState.pendingAction = false;
        uiState.guidedOverride = null;
        uiState.previewDenied = packet || { reason: 'action-denied' };
        const reason = String(packet?.reason || 'action-denied').replace(/-/g, ' ');
        pushLog(`Denied: ${reason}.`);
        if (packet?.reason === 'missing-target') {
            uiState.stage = 'target';
            uiState.guidedOverride = 'targets';
        } else if (packet?.reason === 'not-your-turn') {
            uiState.guidedOverride = 'turn';
        } else if (packet?.reason === 'target-out-of-range') {
            uiState.commandIndex = COMMANDS.findIndex((entry) => entry.id === 'move');
            uiState.stage = 'command';
            uiState.guidedOverride = 'commands';
        }
        render();
    });

    socket.on('combat-error', (packet) => {
        uiState.pendingAction = false;
        pushLog(`Combat error: ${String(packet?.reason || 'unknown')}`);
        render();
    });

    socket.on('end-turn-accepted', () => {
        uiState.pendingAction = true;
        pushLog('End turn accepted.');
        render();
    });

    socket.on('end-turn-denied', (packet) => {
        uiState.pendingAction = false;
        pushLog(`End turn denied: ${String(packet?.reason || 'unknown')}`);
        uiState.guidedOverride = packet?.reason === 'not-your-turn' ? 'turn' : 'status';
        render();
    });

    // Reused socket (e.g. from fireplace lobby) is already connected — bootstrap immediately
    if (socket.connected) {
        liveState.connected = true;
        liveState.localSid = socket.id || null;
        uiState.status = 'Connected.';
        socket.emit('request-combat-state', {});
        render();
    }
} else {
    liveState.connected = false;
    liveState.inCombat = false;
    pushLog('Socket.IO unavailable. Running in visual fallback mode only.');
}

const style = document.createElement('style');
style.textContent = `
    :root {
        --ink: #f3e8ca;
        --sand: #b9a177;
        --gold: #d9b870;
        --gold-bright: #f3d79a;
        --sea: #0c3550;
        --sea-bright: #2e90b1;
        --panel: rgba(9, 13, 22, 0.88);
        --panel-soft: rgba(17, 24, 34, 0.72);
        --line: rgba(232, 206, 142, 0.26);
        --danger: #ff8777;
        --hp: linear-gradient(90deg, #48b077, #83e87f);
        --mp: linear-gradient(90deg, #3578d1, #6bd7ff);
        --od: linear-gradient(90deg, #e06d42, #ffcf68);
    }

    * {
        box-sizing: border-box;
    }

    body {
        color: var(--ink);
    }

    .combat-stage {
        position: relative;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: transparent;
    }

    .stage-backdrop,
    .stage-aurora,
    .stage-horizon,
    .stage-foam {
        display: none;
    }

    .combat-header {
        position: absolute;
        top: 20px;
        left: 22px;
        right: 22px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 18px;
        z-index: 2;
    }

    .header-badge,
    .turn-track,
    .battle-log-panel,
    .party-card,
    .command-frame,
    .help-bar {
        backdrop-filter: blur(12px);
    }

    .header-badge {
        padding: 10px 14px;
        border: 1px solid var(--line);
        background: linear-gradient(180deg, rgba(20, 25, 34, 0.86), rgba(9, 12, 18, 0.75));
        text-transform: uppercase;
        letter-spacing: 0.18em;
        font-size: 11px;
        color: var(--gold-bright);
    }

    .turn-track {
        display: flex;
        gap: 8px;
        padding: 10px;
        border: 1px solid var(--line);
        background: rgba(7, 11, 18, 0.74);
    }

    .turn-pill {
        min-width: 100px;
        padding: 9px 12px;
        border: 1px solid rgba(243, 215, 154, 0.12);
        background: rgba(255, 255, 255, 0.03);
        font-size: 12px;
        text-align: center;
        color: rgba(255, 245, 225, 0.72);
    }

    .turn-pill.is-current {
        color: #091018;
        background: linear-gradient(180deg, var(--gold-bright), var(--gold));
        border-color: rgba(255, 245, 225, 0.5);
        font-weight: 700;
    }

    .enemy-rail {
        position: absolute;
        top: 112px;
        left: 50%;
        transform: translateX(-50%);
        width: min(1100px, calc(100vw - 64px));
        display: flex;
        justify-content: center;
        gap: 22px;
        z-index: 2;
    }

    .enemy-card {
        width: 220px;
        padding: 18px 16px 14px;
        border: 1px solid rgba(152, 202, 224, 0.18);
        background: linear-gradient(180deg, rgba(8, 16, 26, 0.7), rgba(6, 12, 20, 0.9));
        box-shadow: 0 18px 42px rgba(0, 0, 0, 0.28);
        transition: transform 160ms ease, border-color 160ms ease, box-shadow 160ms ease;
    }

    .enemy-card.is-targeted {
        transform: translateY(-10px) scale(1.03);
        border-color: rgba(243, 215, 154, 0.58);
        box-shadow: 0 0 0 1px rgba(243, 215, 154, 0.2), 0 24px 52px rgba(0, 0, 0, 0.4);
    }

    .enemy-card.is-active-turn {
        border-color: rgba(111, 201, 242, 0.42);
    }

    .enemy-shell {
        height: 120px;
        border-radius: 46% 54% 58% 42% / 44% 40% 60% 56%;
        background:
            radial-gradient(circle at 34% 28%, rgba(227, 240, 255, 0.2), transparent 12%),
            radial-gradient(circle at 54% 38%, rgba(97, 198, 255, 0.36), transparent 18%),
            linear-gradient(180deg, rgba(38, 102, 128, 0.85), rgba(6, 26, 42, 0.95));
        border: 1px solid rgba(143, 219, 255, 0.2);
        margin-bottom: 12px;
    }

    .enemy-meta h3,
    .party-head h3,
    .command-topline h2,
    .preview-title {
        margin: 0;
        font-weight: 400;
        letter-spacing: 0.03em;
    }

    .enemy-meta p,
    .party-head p,
    .command-hint,
    .command-preview p,
    .log-row,
    .target-chip small,
    .command-btn small,
    .meter-label span,
    .meter-label strong,
    .command-mode,
    .panel-kicker {
        font-family: 'Courier New', monospace;
    }

    .enemy-meta p,
    .party-head p,
    .command-preview p,
    .command-hint {
        color: rgba(235, 240, 245, 0.66);
    }

    .enemy-hp,
    .meter {
        width: 100%;
        height: 10px;
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.06);
        overflow: hidden;
    }

    .enemy-hp {
        margin-top: 10px;
    }

    .enemy-hp-fill,
    .meter-fill {
        height: 100%;
    }

    .enemy-hp-fill,
    .meter-fill.hp {
        background: var(--hp);
    }

    .meter-fill.mp {
        background: var(--mp);
    }

    .meter-fill.od {
        background: var(--od);
    }

    .battle-log-panel {
        position: absolute;
        left: 22px;
        top: 72px;
        width: 320px;
        max-height: calc(100vh - 320px);
        padding: 16px;
        border: 1px solid var(--line);
        background: linear-gradient(180deg, rgba(12, 16, 23, 0.84), rgba(7, 10, 16, 0.68));
        display: flex;
        flex-direction: column;
        overflow: hidden;
        z-index: 2;
    }

    .panel-kicker {
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.22em;
        color: var(--sand);
        margin-bottom: 10px;
    }

    .battle-log {
        margin: 0;
        padding-left: 18px;
        display: grid;
        gap: 8px;
        overflow-y: auto;
        padding-right: 8px;
    }

    .status-banner {
        font-family: 'Courier New', monospace;
        font-size: 11px;
        line-height: 1.5;
        color: rgba(247, 236, 213, 0.72);
        margin-bottom: 12px;
        flex: 0 0 auto;
    }

    .log-row {
        color: rgba(255, 244, 222, 0.72);
        font-size: 12px;
        line-height: 1.45;
    }

    .log-row.is-fresh {
        color: var(--gold-bright);
    }

    .party-rail {
        position: absolute;
        left: 22px;
        right: 420px;
        bottom: 76px;
        display: flex;
        gap: 14px;
        z-index: 2;
    }

    .party-card {
        flex: 1;
        min-width: 0;
        display: grid;
        grid-template-columns: 78px 1fr;
        gap: 12px;
        padding: 14px;
        border: 1px solid rgba(226, 197, 135, 0.14);
        background: linear-gradient(180deg, rgba(12, 17, 27, 0.88), rgba(8, 12, 19, 0.76));
        transition: transform 160ms ease, border-color 160ms ease, box-shadow 160ms ease;
    }

    .party-card.is-active {
        transform: translateY(-6px);
        border-color: rgba(243, 215, 154, 0.44);
        box-shadow: 0 0 0 1px rgba(243, 215, 154, 0.14), 0 16px 38px rgba(0, 0, 0, 0.34);
    }

    .party-portrait {
        height: 100%;
        min-height: 104px;
        background:
            radial-gradient(circle at 42% 24%, rgba(255, 255, 255, 0.14), transparent 16%),
            linear-gradient(180deg, hsla(var(--portrait-hue), 60%, 62%, 0.5), hsla(var(--portrait-hue), 70%, 18%, 0.92));
        border: 1px solid rgba(255, 255, 255, 0.1);
        clip-path: polygon(0 10%, 86% 0, 100% 18%, 100% 100%, 14% 100%, 0 84%);
    }

    .party-head {
        display: flex;
        justify-content: space-between;
        align-items: start;
        gap: 10px;
        margin-bottom: 10px;
    }

    .atb-ring {
        min-width: 46px;
        height: 46px;
        display: grid;
        place-items: center;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.04);
        color: rgba(255, 242, 215, 0.8);
        font-size: 11px;
    }

    .atb-ring.is-ready {
        border-color: rgba(243, 215, 154, 0.5);
        box-shadow: 0 0 20px rgba(243, 215, 154, 0.18);
        color: var(--gold-bright);
    }

    .meter-label {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-top: 7px;
        margin-bottom: 4px;
        font-size: 11px;
    }

    .command-dock {
        position: absolute;
        right: 22px;
        bottom: 22px;
        width: 380px;
        z-index: 3;
    }

    .command-frame {
        border: 1px solid rgba(236, 201, 129, 0.32);
        background:
            linear-gradient(180deg, rgba(10, 15, 24, 0.94), rgba(5, 9, 14, 0.88));
        box-shadow: 0 24px 60px rgba(0, 0, 0, 0.38);
        padding: 18px;
    }

    .command-topline {
        display: flex;
        justify-content: space-between;
        align-items: start;
        gap: 10px;
        margin-bottom: 12px;
    }

    .command-mode {
        font-size: 10px;
        letter-spacing: 0.18em;
        color: var(--gold);
        padding-top: 4px;
    }

    .command-hint {
        min-height: 38px;
        font-size: 12px;
        line-height: 1.45;
        margin-bottom: 12px;
    }

    .target-zone {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 14px;
        min-height: 42px;
    }

    .target-strip.muted {
        font-family: 'Courier New', monospace;
        color: rgba(228, 234, 242, 0.4);
        font-size: 11px;
        padding: 10px 0 2px;
    }

    .target-chip {
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.04);
        color: var(--ink);
        padding: 8px 10px;
        min-width: 108px;
        text-align: left;
        cursor: pointer;
        transition: border-color 140ms ease, background 140ms ease, transform 140ms ease;
    }

    .target-chip.is-selected {
        border-color: rgba(243, 215, 154, 0.55);
        background: rgba(243, 215, 154, 0.08);
        transform: translateY(-2px);
    }

    .target-chip span,
    .command-btn span {
        display: block;
    }

    .target-chip small,
    .command-btn small {
        color: rgba(234, 239, 244, 0.5);
        font-size: 10px;
        margin-top: 4px;
    }

    .command-list {
        display: grid;
        gap: 8px;
    }

    .command-btn,
    .footer-btn {
        border: 1px solid rgba(255, 255, 255, 0.1);
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.02));
        color: var(--ink);
        cursor: pointer;
        transition: transform 140ms ease, border-color 140ms ease, background 140ms ease;
    }

    .command-btn {
        width: 100%;
        padding: 12px 14px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        text-align: left;
    }

    .command-btn.is-selected,
    .command-btn:hover,
    .footer-btn:hover {
        transform: translateX(-3px);
        border-color: rgba(243, 215, 154, 0.48);
        background: linear-gradient(180deg, rgba(243, 215, 154, 0.14), rgba(243, 215, 154, 0.05));
    }

    .guide-zone {
        border-radius: 12px;
        box-shadow: 0 0 0 1px rgba(243, 215, 154, 0.22), 0 0 34px rgba(243, 215, 154, 0.08);
    }

    .guide-pulse {
        animation: guide-pulse 1.15s ease-in-out infinite;
    }

    .command-preview {
        margin-top: 14px;
        padding: 12px 0 2px;
        border-top: 1px solid rgba(255, 255, 255, 0.08);
        min-height: 88px;
    }

    .preview-title {
        font-size: 24px;
        margin-bottom: 6px;
    }

    .command-footer {
        margin-top: 14px;
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 8px;
    }

    .footer-btn {
        padding: 10px 8px;
        font-family: 'Courier New', monospace;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
    }

    .help-bar {
        position: absolute;
        left: 50%;
        bottom: 16px;
        transform: translateX(-50%);
        display: flex;
        gap: 18px;
        padding: 10px 14px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(7, 10, 16, 0.68);
        color: rgba(240, 244, 248, 0.65);
        font-family: 'Courier New', monospace;
        font-size: 11px;
        z-index: 2;
    }

    @keyframes drift {
        from { transform: translate3d(-1.5%, 0, 0) scale(1); }
        to { transform: translate3d(1.5%, 1%, 0) scale(1.04); }
    }

    @keyframes guide-pulse {
        0%, 100% {
            box-shadow: 0 0 0 0 rgba(243, 215, 154, 0.0), 0 0 0 1px rgba(243, 215, 154, 0.18);
        }
        50% {
            box-shadow: 0 0 0 8px rgba(243, 215, 154, 0.08), 0 0 0 1px rgba(243, 215, 154, 0.52), 0 0 28px rgba(243, 215, 154, 0.18);
        }
    }

    @media (max-width: 1200px) {
        .battle-log-panel {
            width: 280px;
            top: 72px;
            max-height: 290px;
        }

        .party-rail {
            right: 22px;
            bottom: 356px;
        }
    }

    @media (max-width: 900px) {
        .combat-header {
            flex-direction: column;
            align-items: stretch;
        }

        .enemy-rail {
            top: 148px;
            width: calc(100vw - 28px);
            gap: 10px;
        }

        .enemy-card {
            width: 30%;
            min-width: 0;
            padding: 12px;
        }

        .battle-log-panel {
            display: none;
        }

        .party-rail {
            left: 12px;
            right: 12px;
            bottom: 376px;
            flex-direction: column;
        }

        .command-dock {
            left: 12px;
            right: 12px;
            bottom: 72px;
            width: auto;
        }

        .help-bar {
            left: 12px;
            right: 12px;
            bottom: 12px;
            transform: none;
            flex-wrap: wrap;
            gap: 8px 14px;
            justify-content: center;
        }
    }
`;

document.head.appendChild(style);
window.addEventListener('keydown', handleKeydown);
render();
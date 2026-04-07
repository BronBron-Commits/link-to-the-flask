const SAMPLE_PARTY = [
    {
        id: 'tidus',
        name: 'Tidus',
        role: 'Vanguard',
        hp: 842,
        maxHp: 999,
        mp: 36,
        maxMp: 48,
        atb: 0.94,
        overdrive: 0.42,
        portraitHue: 195,
        commands: ['Attack', 'Skills', 'Items', 'Defend'],
    },
    {
        id: 'yuna',
        name: 'Yuna',
        role: 'White Mage',
        hp: 601,
        maxHp: 730,
        mp: 88,
        maxMp: 112,
        atb: 0.72,
        overdrive: 0.85,
        portraitHue: 28,
        commands: ['Attack', 'Magic', 'Items', 'Defend'],
    },
    {
        id: 'auron',
        name: 'Auron',
        role: 'Breaker',
        hp: 1124,
        maxHp: 1275,
        mp: 18,
        maxMp: 28,
        atb: 0.58,
        overdrive: 0.93,
        portraitHue: 8,
        commands: ['Attack', 'Skills', 'Guard', 'Items'],
    },
];

const SAMPLE_ENEMIES = [
    { id: 'e1', name: 'Deep Warden', hp: 480, maxHp: 640, weakness: 'Lightning' },
    { id: 'e2', name: 'Mire Shell', hp: 910, maxHp: 910, weakness: 'Pierce' },
    { id: 'e3', name: 'Storm Eye', hp: 320, maxHp: 470, weakness: 'Silence' },
];

const COMMAND_TREE = {
    root: [
        { id: 'attack', label: 'Attack', type: 'target' },
        { id: 'skills', label: 'Skills', type: 'submenu', next: 'skills' },
        { id: 'magic', label: 'Magic', type: 'submenu', next: 'magic' },
        { id: 'items', label: 'Items', type: 'submenu', next: 'items' },
        { id: 'defend', label: 'Defend', type: 'instant', log: 'Tightens stance and braces for impact.' },
    ],
    skills: [
        { id: 'delay', label: 'Delay Strike', type: 'target', detail: 'Delay a single enemy turn.' },
        { id: 'pierce', label: 'Piercing Arc', type: 'target', detail: 'Armor-breaking crescent slash.' },
        { id: 'cheer', label: 'Cheer', type: 'instant', log: 'Raises party morale and attack.' },
    ],
    magic: [
        { id: 'cure', label: 'Cure', type: 'ally' },
        { id: 'watera', label: 'Watera', type: 'target', detail: 'Heavy water damage to one foe.' },
        { id: 'shell', label: 'Shell', type: 'ally' },
    ],
    items: [
        { id: 'potion', label: 'Potion x12', type: 'ally' },
        { id: 'phoenix', label: 'Phoenix Down x3', type: 'ally' },
        { id: 'grenade', label: 'Grenade x4', type: 'target' },
    ],
};

const root = document.getElementById('combat-ui-root');

if (!root) {
    throw new Error('Missing #combat-ui-root');
}

const state = {
    activeActorIndex: 0,
    menuKey: 'root',
    menuIndex: 0,
    targetIndex: 0,
    targetMode: false,
    allyTargetMode: false,
    log: [
        'Deep Warden surges from the surf.',
        'Party formation locked.',
        'Tidus is ready to act.',
    ],
};

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function pct(current, max) {
    if (!max) return 0;
    return clamp((current / max) * 100, 0, 100);
}

function getActiveActor() {
    return SAMPLE_PARTY[state.activeActorIndex];
}

function getMenuEntries() {
    const actor = getActiveActor();
    const baseEntries = COMMAND_TREE[state.menuKey] || COMMAND_TREE.root;
    if (state.menuKey !== 'root') return baseEntries;
    return baseEntries.filter((entry) => actor.commands.includes(entry.label));
}

function getCurrentSelection() {
    const entries = getMenuEntries();
    return entries[state.menuIndex] || entries[0] || null;
}

function getTargetPool() {
    return state.allyTargetMode ? SAMPLE_PARTY : SAMPLE_ENEMIES;
}

function resetMenuPosition() {
    state.menuIndex = 0;
}

function pushLog(message) {
    if (!message) return;
    state.log.unshift(message);
    state.log = state.log.slice(0, 8);
}

function cycleActor(direction) {
    state.activeActorIndex = (state.activeActorIndex + direction + SAMPLE_PARTY.length) % SAMPLE_PARTY.length;
    state.menuKey = 'root';
    state.targetMode = false;
    state.allyTargetMode = false;
    resetMenuPosition();
    pushLog(`${getActiveActor().name} steps into command focus.`);
}

function commitAction(selection, target) {
    const actor = getActiveActor();
    const targetLabel = target ? target.name : 'the field';
    pushLog(`${actor.name}: ${selection.label} -> ${targetLabel}`);

    if (selection.id === 'attack' && target) {
        target.hp = clamp(target.hp - 118, 0, target.maxHp);
    }
    if (selection.id === 'watera' && target) {
        target.hp = clamp(target.hp - 182, 0, target.maxHp);
    }
    if (selection.id === 'grenade' && target) {
        target.hp = clamp(target.hp - 140, 0, target.maxHp);
    }
    if (selection.id === 'cure' && target) {
        target.hp = clamp(target.hp + 180, 0, target.maxHp);
    }
    if (selection.id === 'potion' && target) {
        target.hp = clamp(target.hp + 120, 0, target.maxHp);
    }
    if (selection.id === 'phoenix' && target && target.hp <= 0) {
        target.hp = Math.round(target.maxHp * 0.34);
    }

    state.targetMode = false;
    state.allyTargetMode = false;
    state.menuKey = 'root';
    resetMenuPosition();
    cycleActor(1);
}

function activateSelection() {
    const selection = getCurrentSelection();
    if (!selection) return;

    if (selection.type === 'submenu') {
        state.menuKey = selection.next;
        resetMenuPosition();
        render();
        return;
    }

    if (selection.type === 'instant') {
        pushLog(`${getActiveActor().name}: ${selection.log || selection.label}`);
        state.menuKey = 'root';
        resetMenuPosition();
        cycleActor(1);
        render();
        return;
    }

    if (selection.type === 'target' || selection.type === 'ally') {
        state.targetMode = true;
        state.allyTargetMode = selection.type === 'ally';
        state.targetIndex = 0;
        render();
    }
}

function cancelSelection() {
    if (state.targetMode) {
        state.targetMode = false;
        state.allyTargetMode = false;
        render();
        return;
    }
    if (state.menuKey !== 'root') {
        state.menuKey = 'root';
        resetMenuPosition();
        render();
    }
}

function moveMenu(direction) {
    if (state.targetMode) {
        const pool = getTargetPool();
        state.targetIndex = (state.targetIndex + direction + pool.length) % pool.length;
        render();
        return;
    }

    const entries = getMenuEntries();
    if (!entries.length) return;
    state.menuIndex = (state.menuIndex + direction + entries.length) % entries.length;
    render();
}

function confirmTarget() {
    const selection = getCurrentSelection();
    const pool = getTargetPool();
    const target = pool[state.targetIndex] || null;
    if (!selection || !target) return;
    commitAction(selection, target);
    render();
}

function getSelectionHint() {
    const selection = getCurrentSelection();
    if (!selection) return 'No command selected.';
    if (state.targetMode) {
        const target = getTargetPool()[state.targetIndex];
        return state.allyTargetMode
            ? `Choose an ally for ${selection.label}.`
            : `Choose a target for ${selection.label}. ${target?.weakness ? `Weak: ${target.weakness}.` : ''}`;
    }
    return selection.detail || `${selection.label} ready.`;
}

function renderPartyCards() {
    return SAMPLE_PARTY.map((actor, index) => {
        const active = index === state.activeActorIndex;
        return `
            <article class="party-card ${active ? 'is-active' : ''}">
                <div class="party-portrait" style="--portrait-hue:${actor.portraitHue}deg"></div>
                <div class="party-main">
                    <div class="party-head">
                        <div>
                            <h3>${actor.name}</h3>
                            <p>${actor.role}</p>
                        </div>
                        <div class="atb-ring ${actor.atb >= 0.9 ? 'is-ready' : ''}">
                            <span>${Math.round(actor.atb * 100)}</span>
                        </div>
                    </div>
                    <div class="meter-label"><span>HP</span><strong>${actor.hp}/${actor.maxHp}</strong></div>
                    <div class="meter"><div class="meter-fill hp" style="width:${pct(actor.hp, actor.maxHp)}%"></div></div>
                    <div class="meter-label"><span>MP</span><strong>${actor.mp}/${actor.maxMp}</strong></div>
                    <div class="meter"><div class="meter-fill mp" style="width:${pct(actor.mp, actor.maxMp)}%"></div></div>
                    <div class="meter-label"><span>OD</span><strong>${Math.round(actor.overdrive * 100)}%</strong></div>
                    <div class="meter"><div class="meter-fill od" style="width:${pct(actor.overdrive, 1)}%"></div></div>
                </div>
            </article>
        `;
    }).join('');
}

function renderEnemies() {
    return SAMPLE_ENEMIES.map((enemy, index) => {
        const targeted = state.targetMode && !state.allyTargetMode && index === state.targetIndex;
        return `
            <article class="enemy-card ${targeted ? 'is-targeted' : ''}">
                <div class="enemy-shell"></div>
                <div class="enemy-meta">
                    <h3>${enemy.name}</h3>
                    <p>Weak: ${enemy.weakness}</p>
                    <div class="enemy-hp"><div class="enemy-hp-fill" style="width:${pct(enemy.hp, enemy.maxHp)}%"></div></div>
                </div>
            </article>
        `;
    }).join('');
}

function renderTurnOrder() {
    const order = [
        ...SAMPLE_PARTY.map((actor) => actor.name),
        ...SAMPLE_ENEMIES.map((enemy) => enemy.name),
    ];
    return order.slice(0, 6).map((name, index) => {
        const current = index === 0;
        return `<div class="turn-pill ${current ? 'is-current' : ''}">${name}</div>`;
    }).join('');
}

function renderCommandMenu() {
    const entries = getMenuEntries();
    return entries.map((entry, index) => {
        const selected = index === state.menuIndex && !state.targetMode;
        return `
            <button class="command-btn ${selected ? 'is-selected' : ''}" data-command-index="${index}" type="button">
                <span>${entry.label}</span>
                <small>${entry.type === 'submenu' ? '>' : entry.type === 'instant' ? '!' : '•'}</small>
            </button>
        `;
    }).join('');
}

function renderTargetStrip() {
    if (!state.targetMode) {
        return '<div class="target-strip muted">No target selection active.</div>';
    }

    return getTargetPool().map((target, index) => {
        const active = index === state.targetIndex;
        const hpText = target.maxHp ? `${target.hp}/${target.maxHp}` : '';
        return `
            <button class="target-chip ${active ? 'is-selected' : ''}" data-target-index="${index}" type="button">
                <span>${target.name}</span>
                <small>${hpText}</small>
            </button>
        `;
    }).join('');
}

function renderLog() {
    return state.log.map((entry, index) => {
        return `<li class="log-row ${index === 0 ? 'is-fresh' : ''}">${entry}</li>`;
    }).join('');
}

function render() {
    const actor = getActiveActor();
    const selection = getCurrentSelection();

    root.innerHTML = `
        <div class="combat-stage">
            <div class="stage-backdrop"></div>
            <div class="stage-aurora stage-aurora-a"></div>
            <div class="stage-aurora stage-aurora-b"></div>
            <div class="stage-horizon"></div>
            <div class="stage-foam"></div>

            <header class="combat-header">
                <div class="header-badge">Combat UI Playground</div>
                <div class="turn-track">${renderTurnOrder()}</div>
            </header>

            <section class="enemy-rail">${renderEnemies()}</section>

            <aside class="battle-log-panel">
                <div class="panel-kicker">Combat Log</div>
                <ol class="battle-log">${renderLog()}</ol>
            </aside>

            <section class="party-rail">${renderPartyCards()}</section>

            <section class="command-dock">
                <div class="command-frame">
                    <div class="command-topline">
                        <div>
                            <div class="panel-kicker">Active Unit</div>
                            <h2>${actor.name}</h2>
                        </div>
                        <div class="command-mode">${state.targetMode ? 'Targeting' : state.menuKey.toUpperCase()}</div>
                    </div>

                    <div class="command-hint">${getSelectionHint()}</div>

                    <div class="target-zone">${renderTargetStrip()}</div>

                    <div class="command-list">${renderCommandMenu()}</div>

                    <div class="command-preview">
                        <div class="panel-kicker">Preview</div>
                        <div class="preview-title">${selection ? selection.label : 'None'}</div>
                        <p>${getSelectionHint()}</p>
                    </div>

                    <div class="command-footer">
                        <button class="footer-btn" data-action="prev-actor" type="button">Prev Actor</button>
                        <button class="footer-btn" data-action="confirm" type="button">Confirm</button>
                        <button class="footer-btn" data-action="cancel" type="button">Back</button>
                        <button class="footer-btn" data-action="next-actor" type="button">Next Actor</button>
                    </div>
                </div>
            </section>

            <footer class="help-bar">
                <span>Up/Down: Navigate</span>
                <span>Left/Right: Change actor or target</span>
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
            state.menuIndex = Number(button.dataset.commandIndex);
            if (!state.targetMode) {
                activateSelection();
            }
        });
    });

    root.querySelectorAll('[data-target-index]').forEach((button) => {
        button.addEventListener('click', () => {
            state.targetIndex = Number(button.dataset.targetIndex);
            confirmTarget();
        });
    });

    root.querySelectorAll('[data-action]').forEach((button) => {
        button.addEventListener('click', () => {
            const action = button.dataset.action;
            if (action === 'prev-actor') cycleActor(-1);
            if (action === 'next-actor') cycleActor(1);
            if (action === 'confirm') {
                if (state.targetMode) confirmTarget();
                else activateSelection();
            }
            if (action === 'cancel') cancelSelection();
            render();
        });
    });
}

function handleKeydown(event) {
    if (event.key === 'ArrowUp') {
        event.preventDefault();
        moveMenu(-1);
        return;
    }
    if (event.key === 'ArrowDown') {
        event.preventDefault();
        moveMenu(1);
        return;
    }
    if (event.key === 'ArrowLeft') {
        event.preventDefault();
        if (state.targetMode) moveMenu(-1);
        else {
            cycleActor(-1);
            render();
        }
        return;
    }
    if (event.key === 'ArrowRight') {
        event.preventDefault();
        if (state.targetMode) moveMenu(1);
        else {
            cycleActor(1);
            render();
        }
        return;
    }
    if (event.key === 'Enter') {
        event.preventDefault();
        if (state.targetMode) confirmTarget();
        else activateSelection();
        return;
    }
    if (event.key === 'Escape' || event.key === 'Backspace') {
        event.preventDefault();
        cancelSelection();
    }
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
        background:
            radial-gradient(circle at 50% 68%, rgba(50, 105, 128, 0.35), transparent 28%),
            radial-gradient(circle at 18% 20%, rgba(20, 124, 170, 0.22), transparent 22%),
            linear-gradient(180deg, #07101a 0%, #0a1420 44%, #081018 100%);
    }

    .stage-backdrop,
    .stage-aurora,
    .stage-horizon,
    .stage-foam {
        position: absolute;
        inset: 0;
        pointer-events: none;
    }

    .stage-backdrop {
        background:
            radial-gradient(circle at 50% 20%, rgba(255, 249, 214, 0.08), transparent 18%),
            linear-gradient(180deg, rgba(22, 46, 77, 0.2), transparent 48%),
            radial-gradient(circle at 80% 82%, rgba(27, 97, 126, 0.24), transparent 16%);
    }

    .stage-aurora {
        filter: blur(28px);
        opacity: 0.75;
        animation: drift 9s ease-in-out infinite alternate;
    }

    .stage-aurora-a {
        background: radial-gradient(circle at 28% 34%, rgba(69, 146, 185, 0.34), transparent 20%);
    }

    .stage-aurora-b {
        background: radial-gradient(circle at 66% 28%, rgba(232, 179, 92, 0.18), transparent 18%);
        animation-duration: 12s;
    }

    .stage-horizon {
        top: auto;
        bottom: 18%;
        height: 24%;
        background:
            linear-gradient(180deg, transparent 0%, rgba(20, 62, 88, 0.35) 35%, rgba(4, 9, 16, 0.8) 100%);
        clip-path: polygon(0 60%, 14% 54%, 24% 58%, 39% 45%, 49% 52%, 62% 39%, 72% 44%, 85% 34%, 100% 46%, 100% 100%, 0 100%);
        border-top: 1px solid rgba(255, 255, 255, 0.04);
    }

    .stage-foam {
        top: auto;
        bottom: 13%;
        height: 8%;
        background:
            radial-gradient(circle at 8% 42%, rgba(173, 227, 255, 0.38), transparent 7%),
            radial-gradient(circle at 27% 50%, rgba(173, 227, 255, 0.22), transparent 8%),
            radial-gradient(circle at 55% 38%, rgba(173, 227, 255, 0.28), transparent 7%),
            radial-gradient(circle at 82% 47%, rgba(173, 227, 255, 0.23), transparent 9%);
        opacity: 0.85;
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
        bottom: 116px;
        width: 290px;
        padding: 16px;
        border: 1px solid var(--line);
        background: linear-gradient(180deg, rgba(12, 16, 23, 0.84), rgba(7, 10, 16, 0.68));
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
        bottom: 22px;
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
        bottom: 22px;
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

    @media (max-width: 1200px) {
        .party-rail {
            right: 22px;
            bottom: 356px;
        }

        .battle-log-panel {
            width: 250px;
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
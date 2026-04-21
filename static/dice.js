// dice.js — on-screen dice roller, bottom-left overlay.
// Drop-in: imported by map3d.js. No dependencies.

(function () {
  // ── Styles ──────────────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    @keyframes dice-pop {
      0%   { transform: scale(0.7) translateY(10px); opacity: 0; }
      60%  { transform: scale(1.08) translateY(-3px); opacity: 1; }
      100% { transform: scale(1) translateY(0);    opacity: 1; }
    }
    @keyframes dice-crit {
      0%,100% { text-shadow: 0 0 10px #ffd700, 0 0 28px #ffd700; }
      50%      { text-shadow: 0 0 22px #fff,    0 0 48px #ffd700; }
    }
    @keyframes dice-fumble {
      0%,100% { text-shadow: 0 0 10px #e05c5c, 0 0 24px #e05c5c; }
      50%      { text-shadow: 0 0 22px #fff,    0 0 44px #e05c5c; }
    }
    @keyframes toast-in {
      from { opacity: 0; transform: translateY(12px) scale(0.9); }
      to   { opacity: 1; transform: translateY(0)    scale(1);   }
    }
    @keyframes toast-out {
      from { opacity: 1; }
      to   { opacity: 0; transform: translateY(-8px); }
    }

    /* ── tray ── */
    #dice-tray {
      position: fixed;
      top: 78px;
      left: 12px;
      z-index: 9400;
      font-family: Consolas, 'Courier New', monospace;
      color: #eef2ff;
      font-size: 12px;
      pointer-events: auto;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 7px;
      background: rgba(10, 10, 14, 0.78);
      border: 1px solid rgba(130, 150, 180, 0.55);
      border-radius: 6px;
      padding: 8px 10px;
      max-width: 85vw;
      max-height: 60vh;
      overflow-y: auto;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    }

    /* ── history log ── */
    #dice-history {
      width: 100%;
      min-width: 200px;
      max-height: 110px;
      overflow-y: auto;
      background: rgba(10,12,22,0.78);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 10px;
      padding: 6px 8px;
      font-size: 11px;
      line-height: 1.5;
      backdrop-filter: blur(4px);
      scrollbar-width: thin;
      scrollbar-color: #3b4566 transparent;
    }
    #dice-history:empty { display: none; }
    .dice-hist-row {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      border-bottom: 1px solid rgba(255,255,255,0.04);
      padding: 1px 0;
    }
    .dice-hist-row:last-child { border-bottom: none; }
    .dice-hist-label { color: #6366f1; }
    .dice-hist-val   { color: #c7d2fe; font-weight: 700; }
    .dice-hist-crit  { color: #ffd700; }
    .dice-hist-fumble{ color: #e05c5c; }

    /* ── die buttons container ── */
    #dice-buttons {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      width: 100%;
      min-width: 200px;
    }

    /* individual die button */
    .die-btn {
      flex: 1 1 calc(25% - 5px);
      min-width: 40px;
      background: linear-gradient(145deg, rgba(26,30,52,0.95), rgba(16,18,36,0.95));
      border: 1px solid rgba(99,102,241,0.35);
      border-radius: 8px;
      color: #c7d2fe;
      font-family: inherit;
      font-size: 12px;
      font-weight: 700;
      padding: 7px 2px;
      cursor: pointer;
      text-align: center;
      transition: background 0.15s, border-color 0.15s, transform 0.1s, box-shadow 0.15s;
      user-select: none;
    }
    .die-btn:hover {
      background: linear-gradient(145deg, rgba(60,66,120,0.95), rgba(40,44,90,0.95));
      border-color: #818cf8;
      box-shadow: 0 0 10px rgba(99,102,241,0.4);
      transform: translateY(-2px);
    }
    .die-btn:active { transform: translateY(0) scale(0.95); }

    /* modifier row */
    #dice-mod-row {
      display: flex;
      gap: 5px;
      width: 100%;
      min-width: 200px;
      align-items: center;
    }
    #dice-mod-label {
      font-size: 10px;
      color: #6366f1;
      white-space: nowrap;
      letter-spacing: 0.06em;
    }
    #dice-mod-input {
      flex: 1;
      background: rgba(10,12,22,0.85);
      border: 1px solid rgba(99,102,241,0.3);
      border-radius: 6px;
      color: #eef2ff;
      font-family: inherit;
      font-size: 12px;
      padding: 5px 7px;
      text-align: center;
      outline: none;
    }
    #dice-mod-input:focus { border-color: #818cf8; }
    #dice-clear-mod {
      background: transparent;
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 6px;
      color: #555b80;
      font-family: inherit;
      font-size: 11px;
      padding: 5px 7px;
      cursor: pointer;
    }
    #dice-clear-mod:hover { border-color: rgba(255,255,255,0.25); color: #eef2ff; }

    /* ── result toast ── */
    #dice-toast {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%,-50%);
      text-align: center;
      pointer-events: none;
      z-index: 99999;
      display: none;
    }
    #dice-toast.show { display: block; animation: toast-in 0.25s ease forwards; }
    #dice-toast.hide { animation: toast-out 0.3s ease forwards; }

    #dice-toast-die  { font-size: 15px; color: #818cf8; letter-spacing: 0.1em; text-transform: uppercase; }
    #dice-toast-roll {
      font-size: 96px;
      font-weight: 900;
      line-height: 1;
      font-family: Consolas, monospace;
      color: #e0e7ff;
      animation: dice-pop 0.35s ease forwards;
    }
    #dice-toast-roll.crit   { color: #ffd700; animation: dice-pop 0.35s ease forwards, dice-crit 1s ease-in-out 0.35s infinite; }
    #dice-toast-roll.fumble { color: #e05c5c; animation: dice-pop 0.35s ease forwards, dice-fumble 1s ease-in-out 0.35s infinite; }
    #dice-toast-label { font-size: 14px; color: #6366f1; margin-top: 4px; letter-spacing: 0.06em; }
    #dice-toast-detail { font-size: 12px; color: #555b80; margin-top: 2px; }
  `;
  document.head.appendChild(style);

  // ── DOM ─────────────────────────────────────────────────────────────────
  const tray = document.createElement('div');
  tray.id = 'dice-tray';
  tray.innerHTML = `
    <div id="dice-history"></div>
    <div id="dice-buttons">
      <button class="die-btn" data-sides="4">d4</button>
      <button class="die-btn" data-sides="6">d6</button>
      <button class="die-btn" data-sides="8">d8</button>
      <button class="die-btn" data-sides="10">d10</button>
      <button class="die-btn" data-sides="12">d12</button>
      <button class="die-btn" data-sides="20">d20</button>
      <button class="die-btn" data-sides="100">d%</button>
    </div>
    <div id="dice-mod-row">
      <span id="dice-mod-label">MOD</span>
      <input id="dice-mod-input" type="number" value="0" min="-20" max="20" title="Modifier added to every roll" />
      <button id="dice-clear-mod" title="Reset modifier">✕</button>
    </div>
  `;
  document.body.appendChild(tray);

  const toast = document.createElement('div');
  toast.id = 'dice-toast';
  toast.innerHTML = `
    <div id="dice-toast-die"></div>
    <div id="dice-toast-roll"></div>
    <div id="dice-toast-label"></div>
    <div id="dice-toast-detail"></div>
  `;
  document.body.appendChild(toast);

  // ── State ────────────────────────────────────────────────────────────────
  const history = document.getElementById('dice-history');
  const modInput = document.getElementById('dice-mod-input');
  let toastTimer = null;

  // ── Helpers ──────────────────────────────────────────────────────────────
  function randInt(n) { return Math.floor(Math.random() * n) + 1; }

  function roll(sides, label, mod, options = {}) {
    const forcedRaw = Number.isFinite(options.raw) ? Number(options.raw) : null;
    const forcedTotal = Number.isFinite(options.total) ? Number(options.total) : null;
    const raw   = forcedRaw !== null ? forcedRaw : randInt(sides);
    const total = forcedTotal !== null ? forcedTotal : (raw + mod);
    const isCrit   = sides === 20 && raw === 20;
    const isFumble = sides === 20 && raw === 1;

    showToast(sides, raw, total, mod, label, isCrit, isFumble);
    addHistory(label || `d${sides}`, total, isCrit, isFumble);
  }

  function showToast(sides, raw, total, mod, label, isCrit, isFumble) {
    const dieEl    = document.getElementById('dice-toast-die');
    const rollEl   = document.getElementById('dice-toast-roll');
    const labelEl  = document.getElementById('dice-toast-label');
    const detailEl = document.getElementById('dice-toast-detail');

    dieEl.textContent   = label || `d${sides}`;
    rollEl.textContent  = total;
    rollEl.className    = isCrit ? 'crit' : isFumble ? 'fumble' : '';
    labelEl.textContent = isCrit ? '✦ CRITICAL ✦' : isFumble ? '☠ FUMBLE' : '';
    detailEl.textContent = mod !== 0 ? `${raw} ${mod >= 0 ? '+' : ''}${mod} = ${total}` : '';

    // reset animation
    toast.className = '';
    void toast.offsetWidth;
    toast.className = 'show';

    if (toastTimer) clearTimeout(toastTimer);
    const duration = (isCrit || isFumble) ? 2800 : 1800;
    toastTimer = setTimeout(() => {
      toast.className = 'hide';
      toast.addEventListener('animationend', () => { toast.className = ''; }, { once: true });
    }, duration);
  }

  function addHistory(label, total, isCrit, isFumble) {
    const row = document.createElement('div');
    row.className = 'dice-hist-row';
    const cls = isCrit ? 'dice-hist-crit' : isFumble ? 'dice-hist-fumble' : 'dice-hist-val';
    row.innerHTML = `<span class="dice-hist-label">${label}</span><span class="${cls}">${total}${isCrit ? ' ✦' : isFumble ? ' ☠' : ''}</span>`;
    history.prepend(row);
    // keep last 8 entries
    while (history.children.length > 8) history.removeChild(history.lastChild);
  }

  // ── Die button clicks ────────────────────────────────────────────────────
  document.getElementById('dice-buttons').addEventListener('click', (e) => {
    const btn = e.target.closest('.die-btn');
    if (!btn) return;
    const sides = parseInt(btn.dataset.sides, 10);
    const mod   = parseInt(modInput.value, 10) || 0;
    roll(sides, `d${sides === 100 ? '%' : sides}`, mod);
  });

  document.getElementById('dice-clear-mod').addEventListener('click', () => {
    modInput.value = 0;
  });

  // ── Public API ───────────────────────────────────────────────────────────
  // Other modules can call window.diceRoll({ sides, label, mod }) directly.
  window.diceRoll = function ({ sides = 20, label = null, mod = 0, raw = null, total = null } = {}) {
    roll(sides, label, mod, { raw, total });
  };

  // ── Listen for quick-roll events from HUD (future) ───────────────────────
  document.addEventListener('quickroll', (e) => {
    const { sides = 20, label = '', mod = 0 } = e.detail || {};
    roll(sides, label, mod);
  });
})();

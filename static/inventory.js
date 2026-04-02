// inventory.js — press I to open/close the inventory panel.
// Reads from /api/player-info (master.inventory). Listens for hud:refresh.

(function () {
  // ── Styles ──────────────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    #inv-overlay {
      position: fixed;
      inset: 0;
      background: rgba(4, 5, 14, 0.65);
      backdrop-filter: blur(3px);
      z-index: 9800;
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.2s ease;
    }
    #inv-overlay.open {
      opacity: 1;
      pointer-events: auto;
    }
    #inv-panel {
      width: 580px;
      max-width: calc(100vw - 32px);
      max-height: 78vh;
      display: flex;
      flex-direction: column;
      background: linear-gradient(160deg, rgba(16,18,36,0.98) 0%, rgba(10,12,26,0.99) 100%);
      border: 1px solid rgba(99,102,241,0.4);
      border-radius: 16px;
      box-shadow: 0 24px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(99,102,241,0.1);
      font-family: Consolas, 'Courier New', monospace;
      color: #eef2ff;
      transform: translateY(18px) scale(0.97);
      transition: transform 0.22s ease;
      overflow: hidden;
    }
    #inv-overlay.open #inv-panel {
      transform: translateY(0) scale(1);
    }

    /* header */
    #inv-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 18px 12px;
      border-bottom: 1px solid rgba(99,102,241,0.2);
      flex-shrink: 0;
    }
    #inv-title {
      font-size: 15px;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      background: linear-gradient(90deg, #c7d2fe, #818cf8);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    #inv-hint {
      font-size: 10px;
      color: #3b4566;
      letter-spacing: 0.06em;
    }
    #inv-close {
      all: unset;
      cursor: pointer;
      font-size: 18px;
      color: #4b5280;
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 6px;
      transition: color 0.15s, background 0.15s;
    }
    #inv-close:hover { color: #eef2ff; background: rgba(255,255,255,0.08); }

    /* currency bar */
    #inv-currency {
      display: flex;
      gap: 10px;
      padding: 10px 18px;
      border-bottom: 1px solid rgba(255,255,255,0.06);
      flex-shrink: 0;
    }
    .inv-coin {
      display: flex;
      align-items: center;
      gap: 5px;
      font-size: 12px;
    }
    .inv-coin-dot {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .inv-coin-val { font-weight: 700; color: #e0e7ff; }
    .inv-coin-lbl { color: #4b5280; font-size: 10px; }

    /* weight bar */
    #inv-weight {
      padding: 6px 18px 8px;
      border-bottom: 1px solid rgba(255,255,255,0.06);
      flex-shrink: 0;
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 10px;
      color: #6366f1;
      letter-spacing: 0.06em;
    }
    #inv-weight-track {
      flex: 1;
      height: 5px;
      background: rgba(255,255,255,0.07);
      border-radius: 3px;
      overflow: hidden;
    }
    #inv-weight-fill {
      height: 100%;
      border-radius: 3px;
      background: linear-gradient(90deg, #4caf7d, #6366f1);
      transition: width 0.4s ease;
    }
    #inv-weight-text { color: #8892b0; white-space: nowrap; }

    /* item list */
    #inv-list {
      overflow-y: auto;
      flex: 1;
      padding: 8px 10px 12px;
      scrollbar-width: thin;
      scrollbar-color: #3b4566 transparent;
    }
    #inv-empty {
      text-align: center;
      color: #3b4566;
      font-size: 12px;
      padding: 32px 0;
    }

    /* table header */
    .inv-list-header {
      display: grid;
      grid-template-columns: 1fr 52px 72px 80px;
      padding: 4px 10px;
      font-size: 9px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: #3b4566;
      border-bottom: 1px solid rgba(255,255,255,0.05);
      margin-bottom: 4px;
    }

    /* item row */
    .inv-item {
      display: grid;
      grid-template-columns: 1fr 52px 72px 80px;
      align-items: center;
      padding: 7px 10px;
      border-radius: 8px;
      font-size: 12px;
      transition: background 0.15s;
      cursor: default;
      border: 1px solid transparent;
    }
    .inv-item:hover {
      background: rgba(99,102,241,0.08);
      border-color: rgba(99,102,241,0.2);
    }
    .inv-item-name {
      font-weight: 600;
      color: #c7d2fe;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .inv-item-qty  { color: #8892b0; text-align: center; }
    .inv-item-wt   { color: #555b80; text-align: center; font-size: 11px; }
    .inv-item-equip {
      text-align: center;
      font-size: 10px;
      letter-spacing: 0.04em;
    }
    .inv-equip-yes {
      color: #4caf7d;
      background: rgba(76,175,125,0.12);
      border: 1px solid rgba(76,175,125,0.3);
      border-radius: 4px;
      padding: 2px 6px;
    }
    .inv-equip-no { color: #3b4566; }
  `;
  document.head.appendChild(style);

  // ── DOM ─────────────────────────────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.id = 'inv-overlay';
  overlay.innerHTML = `
    <div id="inv-panel">
      <div id="inv-header">
        <span id="inv-title">&#127920; Inventory</span>
        <span id="inv-hint">Press I to close</span>
        <button id="inv-close" title="Close">&#10005;</button>
      </div>
      <div id="inv-currency"></div>
      <div id="inv-weight">
        <span>WEIGHT</span>
        <div id="inv-weight-track"><div id="inv-weight-fill" style="width:0%"></div></div>
        <span id="inv-weight-text">— lb.</span>
      </div>
      <div id="inv-list">
        <div class="inv-list-header">
          <span>Item</span><span style="text-align:center">Qty</span>
          <span style="text-align:center">Weight</span><span style="text-align:center">Equipped</span>
        </div>
        <div id="inv-empty">No inventory loaded.</div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  // ── State ────────────────────────────────────────────────────────────────
  let isOpen = false;
  let cachedInventory = null;

  // ── Helpers ──────────────────────────────────────────────────────────────
  const COIN_COLORS = { cp: '#b87333', sp: '#aaa9ad', ep: '#d4a0c7', gp: '#ffd700', pp: '#e5e4e2' };
  const COIN_NAMES  = { cp: 'CP', sp: 'SP', ep: 'EP', gp: 'GP', pp: 'PP' };

  function parseWeight(str) {
    if (!str || str === '--') return 0;
    return parseFloat(str) || 0;
  }

  function render(inventory) {
    if (!inventory) return;
    cachedInventory = inventory;

    // currency
    const currEl = document.getElementById('inv-currency');
    const cur = inventory.currency || {};
    currEl.innerHTML = Object.entries(COIN_COLORS).map(([k, col]) => `
      <div class="inv-coin">
        <div class="inv-coin-dot" style="background:${col};box-shadow:0 0 6px ${col}55;"></div>
        <span class="inv-coin-val">${cur[k] ?? 0}</span>
        <span class="inv-coin-lbl">${COIN_NAMES[k]}</span>
      </div>
    `).join('');

    // weight
    const cap = inventory.capacity || {};
    const carried = parseWeight(cap.weight_carried);
    const encumbered = parseWeight(cap.encumbered) || 100;
    const pct = Math.min(1, carried / encumbered) * 100;
    document.getElementById('inv-weight-fill').style.width = `${pct.toFixed(1)}%`;
    document.getElementById('inv-weight-text').textContent =
      `${cap.weight_carried || '—'} / ${cap.encumbered || '—'}`;

    // items
    const listEl = document.getElementById('inv-list');
    const items = inventory.items || [];
    // remove old rows (keep header)
    listEl.querySelectorAll('.inv-item').forEach(el => el.remove());
    const emptyEl = document.getElementById('inv-empty');

    if (!items.length) {
      emptyEl.style.display = 'block';
      return;
    }
    emptyEl.style.display = 'none';

    for (const item of items) {
      const row = document.createElement('div');
      row.className = 'inv-item';
      row.innerHTML = `
        <span class="inv-item-name" title="${item.name}">${item.name}</span>
        <span class="inv-item-qty">${item.quantity ?? 1}</span>
        <span class="inv-item-wt">${item.weight || '—'}</span>
        <span class="inv-item-equip">${item.equipped
          ? '<span class="inv-equip-yes">Equipped</span>'
          : '<span class="inv-equip-no">—</span>'}</span>
      `;
      listEl.appendChild(row);
    }
  }

  // ── Load data ─────────────────────────────────────────────────────────────
  async function load() {
    try {
      const res = await fetch('/api/player-info');
      if (!res.ok) return;
      const data = await res.json();
      if (data.ok && data.master?.inventory) render(data.master.inventory);
    } catch (_) {}
  }

  // ── Open / close ──────────────────────────────────────────────────────────
  function open() {
    isOpen = true;
    overlay.classList.add('open');
  }

  function close() {
    isOpen = false;
    overlay.classList.remove('open');
  }

  function toggle() {
    isOpen ? close() : open();
  }

  // ── Key binding ───────────────────────────────────────────────────────────
  document.addEventListener('keydown', (e) => {
    if (e.key === 'i' || e.key === 'I') {
      // Don't fire when typing in an input
      if (document.activeElement.tagName === 'INPUT' ||
          document.activeElement.tagName === 'TEXTAREA') return;
      e.preventDefault();
      toggle();
    }
    if (e.key === 'Escape' && isOpen) close();
  });

  document.getElementById('inv-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  // ── Init ─────────────────────────────────────────────────────────────────
  load();
  document.addEventListener('hud:refresh', load);
})();

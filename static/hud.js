// hud.js — character stats overlay, anchored bottom-center.
// Populates from /api/player-info. Stays hidden until data is available.
// Listens for 'hud:refresh' custom event (fired by player_ui.js after import).

(function () {
  // ── Styles ────────────────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    @keyframes hud-pulse {
      0%, 100% { box-shadow: 0 0 18px rgba(99,102,241,0.25), 0 12px 48px rgba(0,0,0,0.65); }
      50%       { box-shadow: 0 0 32px rgba(99,102,241,0.45), 0 12px 48px rgba(0,0,0,0.65); }
    }

    #hud {
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%) translateY(16px);
      width: 640px;
      max-width: calc(100vw - 24px);
      z-index: 9500;
      font-family: Consolas, 'Courier New', monospace;
      color: #eef2ff;
      font-size: 13px;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.4s ease, transform 0.4s ease;
    }
    #hud.visible {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
    #hud-card {
      background: linear-gradient(160deg, rgba(16,18,32,0.94) 0%, rgba(10,12,24,0.97) 100%);
      border: 1px solid rgba(99,102,241,0.35);
      border-radius: 16px;
      padding: 14px 18px 15px;
      animation: hud-pulse 4s ease-in-out infinite;
      backdrop-filter: blur(8px);
      display: grid;
      grid-template-columns: auto 1fr;
      grid-template-rows: auto auto auto;
      column-gap: 18px;
      row-gap: 10px;
    }

    /* ── identity column ── */
    #hud-identity {
      grid-column: 1;
      grid-row: 1 / span 1;
      display: flex;
      flex-direction: column;
      justify-content: center;
      min-width: 130px;
    }
    #hud-name {
      font-size: 15px;
      font-weight: 800;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      background: linear-gradient(90deg, #c7d2fe, #818cf8);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      letter-spacing: 0.02em;
    }
    #hud-class {
      font-size: 11px;
      color: #6366f1;
      margin-top: 2px;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    /* ── hp bar (spans right column) ── */
    #hud-hp-row {
      grid-column: 2;
      grid-row: 1;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    #hud-hp-label {
      font-size: 10px;
      font-weight: 700;
      color: #6366f1;
      letter-spacing: 0.08em;
      flex-shrink: 0;
    }
    #hud-hp-track {
      flex: 1;
      height: 10px;
      background: rgba(255,255,255,0.07);
      border-radius: 5px;
      overflow: hidden;
      border: 1px solid rgba(255,255,255,0.08);
    }
    #hud-hp-fill {
      height: 100%;
      border-radius: 5px;
      transition: width 0.5s cubic-bezier(.4,0,.2,1), background 0.5s ease;
      box-shadow: 0 0 8px currentColor;
    }
    #hud-hp-text {
      width: 64px;
      text-align: right;
      flex-shrink: 0;
      font-size: 13px;
      font-weight: 700;
      color: #c7d2fe;
    }

    /* ── badges row (spans full width) ── */
    #hud-badges {
      grid-column: 1 / span 2;
      grid-row: 2;
      display: flex;
      gap: 8px;
    }
    .hud-badge {
      flex: 1;
      background: linear-gradient(160deg, rgba(99,102,241,0.12), rgba(99,102,241,0.04));
      border: 1px solid rgba(99,102,241,0.28);
      border-radius: 10px;
      text-align: center;
      padding: 7px 4px 8px;
      transition: border-color 0.2s;
    }
    .hud-badge-val {
      font-size: 18px;
      font-weight: 800;
      line-height: 1;
      color: #e0e7ff;
    }
    .hud-badge-lbl {
      font-size: 9px;
      color: #6366f1;
      margin-top: 3px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
    }

    /* ── ability pills row ── */
    #hud-abilities {
      grid-column: 1 / span 2;
      grid-row: 3;
      display: flex;
      gap: 8px;
    }
    .hud-ability {
      flex: 1;
      background: rgba(255,255,255,0.03);
      border: 1px solid rgba(255,255,255,0.09);
      border-radius: 10px;
      text-align: center;
      padding: 6px 4px 7px;
    }
    .hud-ability-mod {
      font-size: 16px;
      font-weight: 800;
      line-height: 1;
      color: #a5b4fc;
    }
    .hud-ability-score {
      font-size: 10px;
      color: #555b80;
      line-height: 1;
      margin-top: 2px;
    }
    .hud-ability-lbl {
      font-size: 9px;
      color: #4b5280;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      margin-top: 2px;
    }

    /* divider between sections */
    #hud-div-1, #hud-div-2 {
      grid-column: 1 / span 2;
      height: 1px;
      background: linear-gradient(90deg, transparent, rgba(99,102,241,0.3), transparent);
      margin: -4px 0;
    }
    #hud-div-1 { grid-row: 2; align-self: start; margin-bottom: 0; }
  `;
  document.head.appendChild(style);

  // ── DOM ───────────────────────────────────────────────────────────────────
  const hud = document.createElement('div');
  hud.id = 'hud';
  hud.innerHTML = `
    <div id="hud-card">
      <div id="hud-identity">
        <div id="hud-name">—</div>
        <div id="hud-class">—</div>
      </div>

      <div id="hud-hp-row">
        <div id="hud-hp-label">HP</div>
        <div id="hud-hp-track">
          <div id="hud-hp-fill" style="width:100%;background:#4caf7d;"></div>
        </div>
        <div id="hud-hp-text">— / —</div>
      </div>

      <div id="hud-badges">
        <div class="hud-badge"><div class="hud-badge-val" id="hud-ac">—</div><div class="hud-badge-lbl">Armor Class</div></div>
        <div class="hud-badge"><div class="hud-badge-val" id="hud-spd">—</div><div class="hud-badge-lbl">Speed (ft)</div></div>
        <div class="hud-badge"><div class="hud-badge-val" id="hud-init">—</div><div class="hud-badge-lbl">Initiative</div></div>
        <div class="hud-badge"><div class="hud-badge-val" id="hud-prof">—</div><div class="hud-badge-lbl">Proficiency</div></div>
      </div>

      <div id="hud-abilities">
        <div class="hud-ability"><div class="hud-ability-mod" id="hud-str-mod">—</div><div class="hud-ability-score" id="hud-str-score"></div><div class="hud-ability-lbl">STR</div></div>
        <div class="hud-ability"><div class="hud-ability-mod" id="hud-dex-mod">—</div><div class="hud-ability-score" id="hud-dex-score"></div><div class="hud-ability-lbl">DEX</div></div>
        <div class="hud-ability"><div class="hud-ability-mod" id="hud-con-mod">—</div><div class="hud-ability-score" id="hud-con-score"></div><div class="hud-ability-lbl">CON</div></div>
        <div class="hud-ability"><div class="hud-ability-mod" id="hud-int-mod">—</div><div class="hud-ability-score" id="hud-int-score"></div><div class="hud-ability-lbl">INT</div></div>
        <div class="hud-ability"><div class="hud-ability-mod" id="hud-wis-mod">—</div><div class="hud-ability-score" id="hud-wis-score"></div><div class="hud-ability-lbl">WIS</div></div>
        <div class="hud-ability"><div class="hud-ability-mod" id="hud-cha-mod">—</div><div class="hud-ability-score" id="hud-cha-score"></div><div class="hud-ability-lbl">CHA</div></div>
      </div>
    </div>
  `;
  document.body.appendChild(hud);

  // ── Helpers ───────────────────────────────────────────────────────────────
  function signedMod(n) {
    if (n == null) return '—';
    return n >= 0 ? `+${n}` : `${n}`;
  }

  function hpColor(pct) {
    if (pct > 0.5) return '#4caf7d';   // green
    if (pct > 0.25) return '#f0b429';  // amber
    return '#e05c5c';                   // red
  }

  // ── Render ────────────────────────────────────────────────────────────────
  function render(summary, abilities) {
    document.getElementById('hud-name').textContent = summary.name ?? '—';
    document.getElementById('hud-class').textContent = summary.class_level ?? '—';

    const cur = summary.current_hp ?? summary.max_hp ?? 0;
    const max = summary.max_hp ?? 0;
    const pct = max > 0 ? Math.max(0, Math.min(1, cur / max)) : 0;
    document.getElementById('hud-hp-fill').style.width = `${(pct * 100).toFixed(1)}%`;
    document.getElementById('hud-hp-fill').style.background = hpColor(pct);
    document.getElementById('hud-hp-text').textContent = `${cur} / ${max}`;

    document.getElementById('hud-ac').textContent = summary.armor_class ?? '—';
    document.getElementById('hud-spd').textContent = summary.speed_ft != null ? `${summary.speed_ft}` : '—';
    document.getElementById('hud-init').textContent = signedMod(summary.initiative_bonus);
    document.getElementById('hud-prof').textContent = signedMod(summary.proficiency_bonus);

    const abs = abilities ?? {};
    for (const key of ['STR','DEX','CON','INT','WIS','CHA']) {
      const id = key.toLowerCase();
      const ab = abs[key] ?? {};
      document.getElementById(`hud-${id}-mod`).textContent = signedMod(ab.modifier);
      document.getElementById(`hud-${id}-score`).textContent = ab.score ?? '';
    }

    hud.classList.add('visible');
  }

  // ── Fetch + populate ──────────────────────────────────────────────────────
  async function load() {
    try {
      const res = await fetch('/api/player-info');
      if (!res.ok) return;
      const data = await res.json();
      if (!data.ok || !data.summary) return;
      render(data.summary, data.master?.abilities);
    } catch (_) {
      // no player data yet — HUD stays hidden
    }
  }

  // Load on startup (works if a character was already imported previously)
  load();

  // Re-populate when the entry modal finishes an import.
  // If the event carries detail.summary (from the import API response),
  // use it directly instead of a second fetch so the HUD always populates.
  document.addEventListener('hud:refresh', (e) => {
    if (e && e.detail && e.detail.summary) {
      render(e.detail.summary, e.detail.abilities ?? {});
    } else {
      load();
    }
  });
})();

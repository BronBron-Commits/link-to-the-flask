// Entry prompt — shown once when the scene loads.
// Resolves with { mode: 'player' | 'explore' } after the user chooses.

const style = document.createElement('style');
style.textContent = `
  #entry-overlay {
    position: fixed;
    inset: 0;
    background: rgba(8, 10, 18, 0.88);
    backdrop-filter: blur(6px);
    z-index: 10000;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: opacity 0.3s ease;
  }
  #entry-overlay.fade-out {
    opacity: 0;
    pointer-events: none;
  }
  #entry-card {
    background: rgba(18, 20, 34, 0.97);
    border: 1px solid rgba(255,255,255,0.14);
    border-radius: 14px;
    padding: 36px 40px 32px;
    width: 420px;
    max-width: calc(100vw - 40px);
    box-shadow: 0 20px 60px rgba(0,0,0,0.6);
    font-family: Consolas, 'Courier New', monospace;
    color: #eef2ff;
    text-align: center;
  }
  #entry-card h1 {
    font-size: 20px;
    font-weight: 700;
    margin: 0 0 6px;
    letter-spacing: 0.03em;
  }
  #entry-card p {
    font-size: 12px;
    color: #8892b0;
    margin: 0 0 28px;
    line-height: 1.5;
  }
  .entry-btn {
    display: block;
    width: 100%;
    box-sizing: border-box;
    padding: 13px 16px;
    border-radius: 8px;
    border: 1px solid #3b4566;
    background: #1c2233;
    color: #eef2ff;
    font-family: inherit;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s, transform 0.1s;
    margin-bottom: 12px;
  }
  .entry-btn:last-child {
    margin-bottom: 0;
  }
  .entry-btn:hover {
    background: #26304a;
    border-color: #6677cc;
    transform: translateY(-1px);
  }
  .entry-btn:active {
    transform: translateY(0);
  }
  .entry-btn.primary {
    background: #2a3a7a;
    border-color: #5566cc;
  }
  .entry-btn.primary:hover {
    background: #354899;
    border-color: #7788ee;
  }
  .entry-btn.ghost {
    background: transparent;
    border-color: rgba(255,255,255,0.1);
    color: #8892b0;
    font-weight: 400;
  }
  .entry-btn.ghost:hover {
    background: rgba(255,255,255,0.05);
    border-color: rgba(255,255,255,0.2);
    color: #eef2ff;
  }
  #entry-library-row {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-bottom: 12px;
  }
  #entry-library-row.hidden {
    display: none;
  }
  #entry-file-row {
    display: none;
    flex-direction: column;
    gap: 10px;
    margin-bottom: 12px;
  }
  #entry-file-row.visible {
    display: flex;
  }
  #entry-pdf-input {
    background: #111626;
    color: #eef2ff;
    border: 1px solid #3b4566;
    border-radius: 6px;
    padding: 8px;
    font-family: inherit;
    font-size: 12px;
    width: 100%;
    box-sizing: border-box;
  }
  #entry-sheet-select {
    background: #111626;
    color: #eef2ff;
    border: 1px solid #3b4566;
    border-radius: 6px;
    padding: 8px;
    font-family: inherit;
    font-size: 12px;
    width: 100%;
    box-sizing: border-box;
  }
  #entry-status {
    font-size: 11px;
    min-height: 16px;
    color: #b8c7ff;
    margin-top: -4px;
    margin-bottom: 10px;
  }
  #entry-status.error {
    color: #ff9b9b;
  }
`;
document.head.appendChild(style);

const overlay = document.createElement('div');
overlay.id = 'entry-overlay';
overlay.innerHTML = `
  <div id="entry-card">
    <h1>Enter the Scene</h1>
    <p>Load your character sheet to play with full mechanics,<br>or explore the world freely.</p>

    <div id="entry-library-row" class="hidden">
      <select id="entry-sheet-select"></select>
    </div>

    <div id="entry-status"></div>

    <button class="entry-btn primary" id="entry-btn-sheet">Load Selected Character</button>

    <div id="entry-file-row">
      <input id="entry-pdf-input" type="file" accept="application/pdf,.pdf" />
    </div>

    <button class="entry-btn" id="entry-btn-pdf">Upload New Player Sheet</button>
    <button class="entry-btn ghost" id="entry-btn-explore">Explore Without Mechanics</button>
  </div>
`;
document.body.appendChild(overlay);

const libraryRow = document.getElementById('entry-library-row');
const sheetSelect = document.getElementById('entry-sheet-select');
const fileRow = document.getElementById('entry-file-row');
const pdfInput = document.getElementById('entry-pdf-input');
const statusEl = document.getElementById('entry-status');
const btnSheet = document.getElementById('entry-btn-sheet');
const btnPdf = document.getElementById('entry-btn-pdf');
const btnExplore = document.getElementById('entry-btn-explore');

let uploadMode = false;
let availableSheets = [];

function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle('error', isError);
}

function setBusy(isBusy) {
  btnSheet.disabled = isBusy || availableSheets.length === 0;
  btnPdf.disabled = isBusy;
  btnExplore.disabled = isBusy;
}

function dismiss() {
  overlay.classList.add('fade-out');
  overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
}

function applyImportedCharacter(data) {
  setStatus(`Loaded: ${data.source_file}`);

  if (window.socket) {
    const ch = data.character || {};
    const engineEntity = data.engine_entity || {};
    window.socket.emit('player-character-stats', {
      ac: ch.armor_class ?? null,
      maxHp: ch.hit_points ?? null,
      initiativeBonus: ch.initiative_bonus ?? null,
      speedFt: ch.speed ?? null,
      inventory: engineEntity.inventory ?? null,
    });
  }

  if (data.master) {
    const m = data.master;
    const hp = m.hit_points ?? {};
    const maxHp = hp.max_hp ?? null;
    const currentHp = hp.current_hp ?? maxHp;
    document.dispatchEvent(new CustomEvent('hud:refresh', {
      detail: {
        summary: {
          name: m.identity?.character_name ?? null,
          class_level: m.identity?.class_level ?? null,
          armor_class: m.core_stats?.armor_class ?? null,
          max_hp: maxHp,
          current_hp: currentHp,
          speed_ft: m.core_stats?.speed_ft ?? null,
          proficiency_bonus: m.core_stats?.proficiency_bonus ?? null,
          initiative_bonus: m.core_stats?.initiative_bonus ?? null,
        },
        abilities: m.abilities ?? {},
      },
    }));
  } else {
    document.dispatchEvent(new CustomEvent('hud:refresh'));
  }

  setTimeout(dismiss, 800);
}

async function loadRepoSheetOptions() {
  try {
    const res = await fetch('/api/character-sheets');
    const data = await res.json();
    if (!res.ok || !data.ok || !Array.isArray(data.sheets) || data.sheets.length === 0) {
      libraryRow.classList.add('hidden');
      btnSheet.disabled = true;
      btnSheet.textContent = 'No Repo Sheets Found';
      return;
    }

    availableSheets = data.sheets;
    sheetSelect.innerHTML = '';
    for (const sheet of availableSheets) {
      const option = document.createElement('option');
      option.value = sheet.sheetId;
      option.textContent = sheet.relativePath === sheet.filename
        ? sheet.label
        : `${sheet.label} (${sheet.relativePath})`;
      sheetSelect.appendChild(option);
    }
    libraryRow.classList.remove('hidden');
    btnSheet.disabled = false;
  } catch (err) {
    libraryRow.classList.add('hidden');
    btnSheet.disabled = true;
    setStatus(`Could not load repo sheets: ${err}`, true);
  }
}

btnSheet.addEventListener('click', async () => {
  const sheetId = sheetSelect.value;
  if (!sheetId) {
    setStatus('Choose a repo PDF first.', true);
    return;
  }

  setBusy(true);
  setStatus('Loading selected sheet...');

  try {
    const res = await fetch('/api/import-character-sheet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sheetId }),
    });
    const data = await res.json();

    if (!res.ok || !data.ok) {
      setStatus(data.error || 'Import failed.', true);
      setBusy(false);
      return;
    }

    applyImportedCharacter(data);
  } catch (err) {
    setStatus(`Error: ${err}`, true);
    setBusy(false);
  }
});

btnPdf.addEventListener('click', async () => {
  if (!uploadMode) {
    // First click — reveal file picker
    uploadMode = true;
    fileRow.classList.add('visible');
    btnPdf.textContent = 'Import';
    return;
  }

  // Second click — do the upload
  const file = pdfInput.files && pdfInput.files[0];
  if (!file) {
    setStatus('Choose a PDF first.', true);
    return;
  }

  setBusy(true);
  setStatus('Importing\u2026');

  try {
    const form = new FormData();
    form.append('pdf', file);
    const res = await fetch('/api/import-pdf', { method: 'POST', body: form });
    const data = await res.json();

    if (!res.ok || !data.ok) {
      setStatus(data.error || 'Import failed.', true);
      setBusy(false);
      return;
    }

    applyImportedCharacter(data);
  } catch (err) {
    setStatus(`Error: ${err}`, true);
    setBusy(false);
  }
});

btnExplore.addEventListener('click', dismiss);

loadRepoSheetOptions();

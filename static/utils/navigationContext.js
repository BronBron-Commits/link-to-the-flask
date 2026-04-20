const NAV_CONTEXT_KEY = 'paraval_nav_context';
const SELECTED_CHARACTER_STORAGE_KEY = 'paraval_selected_character';
const SELECTED_MODEL_STORAGE_KEY = 'paraval_selected_model_url';

function safeReadJson(key) {
  try {
    const raw = String(localStorage.getItem(key) || '').trim();
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function readNavContext() {
  const parsed = safeReadJson(NAV_CONTEXT_KEY);
  if (!parsed || typeof parsed !== 'object') {
    return {};
  }
  return parsed;
}

export function writeNavContext(patch) {
  const current = readNavContext();
  const next = {
    ...current,
    ...(patch && typeof patch === 'object' ? patch : {}),
    updatedAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(NAV_CONTEXT_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage failures so navigation still works.
  }
  return next;
}

export function routeFromEntry(entry) {
  const value = String(entry || '').trim().toLowerCase();
  if (value === 'library') return '/paraval-library';
  if (value === 'open-world') return '/world-select';
  if (value === 'dev-playground') return '/world-select';
  return '/account-hub';
}

export function readEntryFromSearch(search) {
  try {
    const params = new URLSearchParams(String(search || ''));
    return String(params.get('entry') || '').trim().toLowerCase();
  } catch {
    return '';
  }
}

export function getSelectionContext() {
  const character = safeReadJson(SELECTED_CHARACTER_STORAGE_KEY);
  let characterId = '';
  if (character && typeof character === 'object' && character.id) {
    characterId = String(character.id).trim();
  }

  let modelUrl = '';
  try {
    modelUrl = String(localStorage.getItem(SELECTED_MODEL_STORAGE_KEY) || '').trim();
  } catch {
    modelUrl = '';
  }

  return { characterId, modelUrl };
}

export function buildHubResumeLinks() {
  const { characterId, modelUrl } = getSelectionContext();
  const encodedCharacter = encodeURIComponent(characterId || '');
  const encodedModel = encodeURIComponent(modelUrl || '');

  const modelHref = characterId
    ? `/model-select?characterId=${encodedCharacter}${modelUrl ? `&modelUrl=${encodedModel}` : ''}`
    : '/model-select';

  const worldHref = characterId
    ? `/world-select?characterId=${encodedCharacter}${modelUrl ? `&modelUrl=${encodedModel}` : ''}`
    : '/world-select';

  const links = [
    { key: 'character', label: 'Resume Character Hub', href: '/hub' },
    { key: 'models', label: 'Resume Model Select', href: modelHref },
    { key: 'worlds', label: 'Resume World Select', href: worldHref },
    { key: 'library', label: 'Open Library', href: '/paraval-library' },
  ];

  if (modelUrl) {
    links.push({ key: 'open-world', label: 'Enter Open World', href: '/map3d' });
  }

  return links;
}

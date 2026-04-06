function createEventBus() {
    const listeners = new Map();
    return {
        on(eventName, handler) {
            if (!listeners.has(eventName)) listeners.set(eventName, new Set());
            listeners.get(eventName).add(handler);
            return () => this.off(eventName, handler);
        },
        off(eventName, handler) {
            const handlers = listeners.get(eventName);
            if (!handlers) return;
            handlers.delete(handler);
            if (handlers.size === 0) listeners.delete(eventName);
        },
        emit(eventName, payload) {
            const handlers = listeners.get(eventName);
            if (!handlers || handlers.size === 0) return;
            handlers.forEach((handler) => {
                try {
                    handler(payload);
                } catch (err) {
                    console.error('Console event handler failed', eventName, err);
                }
            });
        },
    };
}

export function createCommandConsoleUiManager(deps = {}) {
    const {
        consoleState,
        getCurrentMode = () => 'dev',
        getAvailableCommandNames = () => [],
        runConsoleCommand = () => {},
        isTextInputTarget = () => false,
        onRootElChanged = () => {},
    } = deps;

    const eventBus = createEventBus();

    let consoleRootEl = null;
    let consoleModeEl = null;
    let consoleLogEl = null;
    let consoleInputEl = null;
    let consoleSuggestionsEl = null;

    function getEventBus() {
        return eventBus;
    }

    function notifyRootChanged() {
        onRootElChanged(consoleRootEl);
    }

    function appendConsoleHistory(text, tone = 'info') {
        const line = `[${getCurrentMode()}] ${text}`;
        consoleState.history.push({ line, tone });
        if (consoleState.history.length > 300) {
            consoleState.history.splice(0, consoleState.history.length - 300);
        }
        console.log('[CONSOLE]', text);
        renderConsoleHistory();
    }

    function renderConsoleHistory() {
        if (!consoleLogEl) return;
        consoleLogEl.innerHTML = '';
        const start = Math.max(0, consoleState.history.length - 80);
        for (let i = start; i < consoleState.history.length; i++) {
            const entry = consoleState.history[i];
            const row = document.createElement('div');
            row.textContent = entry.line;
            row.style.padding = '2px 0';
            row.style.color = entry.tone === 'error'
                ? '#ff9b9b'
                : entry.tone === 'ok'
                    ? '#9ff0b2'
                    : '#d5e3ff';
            consoleLogEl.appendChild(row);
        }
        consoleLogEl.scrollTop = consoleLogEl.scrollHeight;
    }

    function updateConsoleModeBadge() {
        if (!consoleModeEl) return;
        consoleModeEl.textContent = `mode: ${getCurrentMode()}`;
        renderConsoleSuggestions();
    }

    function renderConsoleSuggestions() {
        if (!consoleSuggestionsEl || !consoleInputEl) return;

        const raw = String(consoleInputEl.value || '');
        const trimmedStart = raw.trimStart();
        if (!trimmedStart.startsWith('/')) {
            consoleState.suggestionMatches = [];
            consoleState.suggestionIndex = 0;
            consoleSuggestionsEl.style.display = 'none';
            consoleSuggestionsEl.innerHTML = '';
            return;
        }

        const token = String(trimmedStart.split(/\s+/)[0] || '').slice(1).toLowerCase();
        const all = getAvailableCommandNames();
        const matches = all.filter((name) => name.includes(token)).slice(0, 12);

        if (matches.length <= 0) {
            consoleState.suggestionMatches = [];
            consoleState.suggestionIndex = 0;
            consoleSuggestionsEl.style.display = 'none';
            consoleSuggestionsEl.innerHTML = '';
            return;
        }

        if (consoleState.suggestionMatches.join('|') !== matches.join('|')) {
            consoleState.suggestionIndex = 0;
        }
        consoleState.suggestionMatches = matches;
        const activeIdx = Math.max(0, Math.min(consoleState.suggestionIndex, matches.length - 1));
        consoleState.suggestionIndex = activeIdx;

        consoleSuggestionsEl.innerHTML = '';
        matches.forEach((name, idx) => {
            const row = document.createElement('button');
            row.type = 'button';
            row.textContent = `/${name}`;
            row.style.textAlign = 'left';
            row.style.background = idx === activeIdx ? 'rgba(40, 74, 122, 0.96)' : 'rgba(8, 14, 28, 0.92)';
            row.style.color = '#d9e8ff';
            row.style.border = idx === activeIdx ? '1px solid rgba(120, 200, 255, 0.75)' : '1px solid rgba(120, 168, 255, 0.34)';
            row.style.borderRadius = '6px';
            row.style.padding = '6px 8px';
            row.style.cursor = 'pointer';
            row.style.fontFamily = 'Consolas, "Segoe UI", monospace';
            row.style.fontSize = '12px';
            row.addEventListener('mousedown', (event) => {
                event.preventDefault();
                consoleState.suggestionIndex = idx;
                consoleInputEl.value = `/${name} `;
                renderConsoleSuggestions();
                requestAnimationFrame(() => {
                    consoleInputEl.focus();
                    consoleInputEl.setSelectionRange(consoleInputEl.value.length, consoleInputEl.value.length);
                });
            });
            consoleSuggestionsEl.appendChild(row);
        });
        consoleSuggestionsEl.style.display = 'grid';
    }

    function ensureConsoleUi() {
        if (consoleRootEl) return;
        if (!document.body) return;

        consoleRootEl = document.createElement('div');
        consoleRootEl.id = 'console-root';
        consoleRootEl.style.position = 'fixed';
        consoleRootEl.style.left = '14px';
        consoleRootEl.style.bottom = '14px';
        consoleRootEl.style.width = 'min(720px, calc(100vw - 28px))';
        consoleRootEl.style.height = '300px';
        consoleRootEl.style.display = 'none';
        consoleRootEl.style.flexDirection = 'column';
        consoleRootEl.style.padding = '10px';
        consoleRootEl.style.border = '1px solid rgba(125, 175, 255, 0.6)';
        consoleRootEl.style.borderRadius = '8px';
        consoleRootEl.style.background = 'rgba(6, 10, 20, 0.9)';
        consoleRootEl.style.backdropFilter = 'blur(3px)';
        consoleRootEl.style.boxShadow = '0 12px 30px rgba(0, 0, 0, 0.5)';
        consoleRootEl.style.zIndex = '131520';
        consoleRootEl.addEventListener('mousedown', (event) => event.stopPropagation());

        const topRow = document.createElement('div');
        topRow.style.display = 'flex';
        topRow.style.justifyContent = 'space-between';
        topRow.style.alignItems = 'center';
        topRow.style.fontFamily = 'Consolas, "Segoe UI", monospace';
        topRow.style.fontSize = '13px';
        topRow.style.color = '#a9c8ff';
        topRow.style.marginBottom = '6px';

        const titleEl = document.createElement('div');
        titleEl.textContent = 'map3d command console';
        titleEl.style.textTransform = 'uppercase';
        titleEl.style.letterSpacing = '0.8px';
        topRow.appendChild(titleEl);

        consoleModeEl = document.createElement('div');
        consoleModeEl.style.color = '#ffd58c';
        topRow.appendChild(consoleModeEl);

        consoleLogEl = document.createElement('div');
        consoleLogEl.style.flex = '1';
        consoleLogEl.style.overflowY = 'auto';
        consoleLogEl.style.padding = '6px';
        consoleLogEl.style.border = '1px solid rgba(120, 150, 220, 0.28)';
        consoleLogEl.style.background = 'rgba(5, 9, 18, 0.7)';
        consoleLogEl.style.borderRadius = '6px';
        consoleLogEl.style.fontFamily = 'Consolas, "Segoe UI", monospace';
        consoleLogEl.style.fontSize = '13px';
        consoleLogEl.style.lineHeight = '1.45';

        consoleInputEl = document.createElement('input');
        consoleInputEl.type = 'text';
        consoleInputEl.autocapitalize = 'off';
        consoleInputEl.autocomplete = 'off';
        consoleInputEl.spellcheck = false;
        consoleInputEl.placeholder = 'type a command, press Enter';
        consoleInputEl.style.marginTop = '8px';
        consoleInputEl.style.padding = '8px 10px';
        consoleInputEl.style.border = '1px solid rgba(125, 175, 255, 0.55)';
        consoleInputEl.style.borderRadius = '6px';
        consoleInputEl.style.background = 'rgba(5, 9, 18, 0.95)';
        consoleInputEl.style.color = '#e6f0ff';
        consoleInputEl.style.outline = 'none';
        consoleInputEl.style.fontFamily = 'Consolas, "Segoe UI", monospace';
        consoleInputEl.style.fontSize = '14px';
        consoleInputEl.addEventListener('input', () => {
            renderConsoleSuggestions();
        });
        consoleInputEl.addEventListener('keydown', (event) => {
            event.stopPropagation();

            if (event.key === 'Tab') {
                renderConsoleSuggestions();
                const suggestions = Array.isArray(consoleState.suggestionMatches)
                    ? consoleState.suggestionMatches
                    : [];
                if (suggestions.length > 0) {
                    const step = event.shiftKey ? -1 : 1;
                    if (event.shiftKey || suggestions.length > 1) {
                        const nextIdx = (consoleState.suggestionIndex + step + suggestions.length) % suggestions.length;
                        consoleState.suggestionIndex = nextIdx;
                    }
                    const selectedName = suggestions[consoleState.suggestionIndex] || suggestions[0];
                    if (selectedName) {
                        consoleInputEl.value = `/${selectedName} `;
                        renderConsoleSuggestions();
                        requestAnimationFrame(() => {
                            consoleInputEl.setSelectionRange(consoleInputEl.value.length, consoleInputEl.value.length);
                        });
                    }
                }
                event.preventDefault();
                return;
            }

            if (event.key === 'Enter') {
                const commandText = (consoleInputEl.value || '').trim();
                if (commandText.length > 0) {
                    runConsoleCommand(commandText);
                    consoleState.commandHistory.push(commandText);
                    if (consoleState.commandHistory.length > 120) {
                        consoleState.commandHistory.shift();
                    }
                    consoleState.commandHistoryIndex = consoleState.commandHistory.length;
                }
                consoleInputEl.value = '';
                event.preventDefault();
                return;
            }

            if (event.key === 'ArrowUp') {
                if (consoleState.commandHistory.length === 0) {
                    event.preventDefault();
                    return;
                }
                consoleState.commandHistoryIndex = Math.max(0, consoleState.commandHistoryIndex - 1);
                consoleInputEl.value = consoleState.commandHistory[consoleState.commandHistoryIndex] || '';
                requestAnimationFrame(() => {
                    consoleInputEl.setSelectionRange(consoleInputEl.value.length, consoleInputEl.value.length);
                });
                event.preventDefault();
                return;
            }

            if (event.key === 'ArrowDown') {
                if (consoleState.commandHistory.length === 0) {
                    event.preventDefault();
                    return;
                }
                consoleState.commandHistoryIndex = Math.min(consoleState.commandHistory.length, consoleState.commandHistoryIndex + 1);
                consoleInputEl.value = consoleState.commandHistory[consoleState.commandHistoryIndex] || '';
                requestAnimationFrame(() => {
                    consoleInputEl.setSelectionRange(consoleInputEl.value.length, consoleInputEl.value.length);
                });
                event.preventDefault();
                return;
            }

            if (event.key === 'Escape') {
                setConsoleOpen(false);
                event.preventDefault();
            }
        });

        consoleRootEl.appendChild(topRow);
        consoleRootEl.appendChild(consoleLogEl);
        consoleRootEl.appendChild(consoleInputEl);

        consoleSuggestionsEl = document.createElement('div');
        consoleSuggestionsEl.style.display = 'none';
        consoleSuggestionsEl.style.marginTop = '6px';
        consoleSuggestionsEl.style.maxHeight = '150px';
        consoleSuggestionsEl.style.overflowY = 'auto';
        consoleSuggestionsEl.style.gap = '6px';
        consoleSuggestionsEl.style.padding = '6px';
        consoleSuggestionsEl.style.border = '1px solid rgba(120, 168, 255, 0.34)';
        consoleSuggestionsEl.style.borderRadius = '6px';
        consoleSuggestionsEl.style.background = 'rgba(4, 8, 16, 0.9)';
        consoleRootEl.appendChild(consoleSuggestionsEl);

        document.body.appendChild(consoleRootEl);
        notifyRootChanged();

        updateConsoleModeBadge();
        renderConsoleHistory();
    }

    function setConsoleOpen(open) {
        ensureConsoleUi();
        if (!consoleRootEl) return;
        if (!consoleRootEl.parentNode && document.body) {
            document.body.appendChild(consoleRootEl);
            consoleRootEl.__dmDetachedLegacy = false;
        }
        consoleState.open = !!open;
        consoleRootEl.style.display = consoleState.open ? 'flex' : 'none';
        if (!consoleState.open && consoleSuggestionsEl) {
            consoleSuggestionsEl.style.display = 'none';
        }
        updateConsoleModeBadge();
        if (consoleState.open) {
            if (document.pointerLockElement) {
                document.exitPointerLock();
            }
            requestAnimationFrame(() => {
                if (!consoleInputEl) return;
                consoleInputEl.focus();
                consoleInputEl.select();
                renderConsoleSuggestions();
            });
        } else if (consoleInputEl) {
            consoleInputEl.blur();
        }
    }

    function toggleConsoleOpen() {
        setConsoleOpen(!consoleState.open);
    }

    return {
        getEventBus,
        appendConsoleHistory,
        renderConsoleHistory,
        updateConsoleModeBadge,
        renderConsoleSuggestions,
        ensureConsoleUi,
        setConsoleOpen,
        toggleConsoleOpen,
    };
}

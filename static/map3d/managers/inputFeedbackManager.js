export function createInputFeedbackManager(deps = {}) {
    const {
        maxEntries = 250,
        now = () => Date.now(),
        setIntentStatus = () => {},
        showFloatingText = () => {},
        appendConsoleHistory = () => {},
        pushTimeline = () => {},
        presentFeedback = () => {},
        getHistoryStore = null,
    } = deps;

    const fallbackStore = {
        history: [],
        lastByKind: {},
    };

    function getStore() {
        const external = typeof getHistoryStore === 'function' ? getHistoryStore() : null;
        if (external && Array.isArray(external.history) && external.lastByKind && typeof external.lastByKind === 'object') {
            return external;
        }
        return fallbackStore;
    }

    function getIntentKey(kind) {
        const normalized = String(kind || '').toLowerCase();
        if (normalized.includes('attack')) return 'attack';
        if (normalized.includes('move')) return 'move';
        if (normalized === 'endturn' || normalized === 'end-turn') return 'endTurn';
        return null;
    }

    function getTone(outcome) {
        const normalized = String(outcome || '').toLowerCase();
        if (normalized === 'accepted' || normalized === 'resolved') return { color: '#8dd694', tone: 'ok' };
        if (normalized === 'queued' || normalized === 'pending') return { color: '#ffd166', tone: 'system' };
        return { color: '#ff8a8a', tone: 'error' };
    }

    function buildMessage(kind, outcome, reason) {
        const label = String(kind || 'input')
            .replace(/([a-z])([A-Z])/g, '$1 $2')
            .replace(/-/g, ' ')
            .trim()
            .replace(/^./, (char) => char.toUpperCase());
        const normalizedOutcome = String(outcome || 'accepted').toLowerCase();
        const normalizedReason = String(reason || '').trim().replace(/-/g, ' ');
        if (!normalizedReason) return `${label} ${normalizedOutcome}`;
        return `${label} ${normalizedOutcome}: ${normalizedReason}`;
    }

    function record(kind, outcome, reason = '', options = {}) {
        const entry = {
            kind: String(kind || 'input'),
            outcome: String(outcome || 'accepted'),
            reason: String(reason || ''),
            device: String(options.device || '').trim() || null,
            source: String(options.source || '').trim() || null,
            timestampMs: Number(options.timestampMs) || now(),
            message: String(options.message || '').trim() || buildMessage(kind, outcome, reason),
            presentation: options.presentation && typeof options.presentation === 'object'
                ? { ...options.presentation }
                : null,
        };

        const store = getStore();
        store.history.push(entry);
        if (store.history.length > maxEntries) {
            store.history.splice(0, store.history.length - maxEntries);
        }
        store.lastByKind[entry.kind] = entry;

        const intentKey = getIntentKey(entry.kind);
        if (intentKey) {
            setIntentStatus(intentKey, entry.outcome, entry.reason || entry.kind);
        }

        const tone = getTone(entry.outcome);
        if (options.showFloating !== false) {
            showFloatingText(entry.message, tone.color, options.force === true, options.floatingOptions || null);
        }
        if (options.logConsole !== false) {
            appendConsoleHistory(`[INPUT] ${entry.message}`, tone.tone);
        }
        if (options.pushTimeline !== false) {
            pushTimeline({
                type: 'input:ack',
                kind: entry.kind,
                outcome: entry.outcome,
                reason: entry.reason,
                device: entry.device,
                source: entry.source,
                timestampMs: entry.timestampMs,
                message: entry.message,
            });
        }

        presentFeedback(entry, entry.presentation);

        return entry;
    }

    function getLast(kind) {
        const store = getStore();
        return store.lastByKind[String(kind || '')] || null;
    }

    function clear() {
        const store = getStore();
        store.history.length = 0;
        Object.keys(store.lastByKind).forEach((key) => {
            delete store.lastByKind[key];
        });
    }

    return {
        record,
        getLast,
        clear,
    };
}

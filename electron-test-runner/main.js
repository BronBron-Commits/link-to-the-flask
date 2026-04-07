const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');

let mainWindow = null;
let activeChild = null;
let liveInspectorTimer = null;
let inspectorTick = 0;

function getWorkspaceRoot() {
    // `electron-test-runner` lives directly under workspace root.
    return path.resolve(__dirname, '..');
}

function getDefaultLiveStatePath() {
    return path.join(getWorkspaceRoot(), 'artifacts', 'live-sim-state.json');
}

function getTimelineArtifactPath() {
    return path.join(getWorkspaceRoot(), 'artifacts', 'timeline-debug.json');
}

function compareTimelineArtifacts(pathA, pathB) {
    if (!fs.existsSync(pathA) || !fs.existsSync(pathB)) {
        return {
            ok: false,
            error: 'One or both artifact files were not found.',
        };
    }

    const a = JSON.parse(fs.readFileSync(pathA, 'utf8'));
    const b = JSON.parse(fs.readFileSync(pathB, 'utf8'));

    const eventsA = Array.isArray(a.events) ? a.events : [];
    const eventsB = Array.isArray(b.events) ? b.events : [];
    const len = Math.max(eventsA.length, eventsB.length);

    for (let i = 0; i < len; i += 1) {
        const ea = eventsA[i];
        const eb = eventsB[i];
        if (!ea || !eb) {
            return {
                ok: true,
                equal: false,
                divergence: {
                    type: 'event-count-mismatch',
                    index: i,
                    tick: ea ? ea.tick : eb ? eb.tick : null,
                },
            };
        }

        if (ea.tick !== eb.tick || ea.type !== eb.type || ea.source !== eb.source || ea.targetId !== eb.targetId) {
            return {
                ok: true,
                equal: false,
                divergence: {
                    type: 'event-sequence-mismatch',
                    index: i,
                    tick: ea.tick,
                    expected: {
                        tick: ea.tick,
                        type: ea.type,
                        source: ea.source,
                        targetId: ea.targetId || null,
                    },
                    actual: {
                        tick: eb.tick,
                        type: eb.type,
                        source: eb.source,
                        targetId: eb.targetId || null,
                    },
                },
            };
        }
    }

    const snapshotsA = Array.isArray(a.stateByTick) ? a.stateByTick : [];
    const snapshotsB = Array.isArray(b.stateByTick) ? b.stateByTick : [];
    const sLen = Math.max(snapshotsA.length, snapshotsB.length);
    for (let i = 0; i < sLen; i += 1) {
        const sa = snapshotsA[i];
        const sb = snapshotsB[i];
        if (!sa || !sb) {
            return {
                ok: true,
                equal: false,
                divergence: {
                    type: 'state-count-mismatch',
                    index: i,
                },
            };
        }
        const actorsA = sa.actors || {};
        const actorsB = sb.actors || {};
        const actorIds = Array.from(new Set([...Object.keys(actorsA), ...Object.keys(actorsB)])).sort();
        for (let k = 0; k < actorIds.length; k += 1) {
            const id = actorIds[k];
            const aa = actorsA[id];
            const bb = actorsB[id];
            if (!aa || !bb || aa.hp !== bb.hp || aa.alive !== bb.alive) {
                return {
                    ok: true,
                    equal: false,
                    divergence: {
                        type: 'actor-state-mismatch',
                        tick: sa.tick,
                        actorId: id,
                        expected: aa || null,
                        actual: bb || null,
                    },
                };
            }
        }
    }

    return {
        ok: true,
        equal: true,
    };
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1240,
        height: 860,
        minWidth: 980,
        minHeight: 680,
        backgroundColor: '#0f1720',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

function getShellAndArgs(command, args) {
    if (process.platform === 'win32') {
        return {
            shell: 'powershell.exe',
            shellArgs: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `${command} ${args.join(' ')}`],
        };
    }

    return {
        shell: process.env.SHELL || '/bin/bash',
        shellArgs: ['-lc', `${command} ${args.join(' ')}`],
    };
}

function send(channel, payload) {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send(channel, payload);
}

function parseSummary(text) {
    const summary = {
        testSuites: null,
        tests: null,
        failed: false,
        passed: false,
    };

    const suiteMatch = text.match(/Test Suites:\s*(.+)/i);
    const testsMatch = text.match(/Tests:\s*(.+)/i);

    if (suiteMatch) summary.testSuites = suiteMatch[1].trim();
    if (testsMatch) summary.tests = testsMatch[1].trim();

    summary.failed = /\bfailed\b/i.test(text);
    summary.passed = /\bpass(?:ed)?\b/i.test(text) && !summary.failed;

    return summary;
}

function buildSyntheticInspectorSnapshot() {
    inspectorTick += 1;
    const authority = inspectorTick % 12 < 6 ? 'server' : 'local-dm';
    const queueDepth = Math.max(0, Math.floor(8 + (Math.sin(inspectorTick / 3) * 5)));
    const pending = Math.max(0, Math.floor(2 + (Math.cos(inspectorTick / 4) * 3)));
    const timelineEvents = inspectorTick * 3;

    return {
        source: 'synthetic',
        tick: inspectorTick,
        authority,
        queueDepth,
        pendingNetworkEvents: pending,
        timelineEvents,
        mode: authority === 'local-dm' ? 'dm' : 'player',
        updatedAt: Date.now(),
    };
}

function readInspectorSnapshot(filePath) {
    try {
        if (!filePath || !fs.existsSync(filePath)) return null;
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        return {
            source: 'file',
            ...parsed,
            updatedAt: Date.now(),
        };
    } catch (_err) {
        return null;
    }
}

function safeReadLines(filePath) {
    try {
        if (!filePath || !fs.existsSync(filePath)) return null;
        const raw = fs.readFileSync(filePath, 'utf8');
        return raw.split(/\r?\n/);
    } catch (_err) {
        return null;
    }
}

function findTestStartLine(lines, aroundLine) {
    if (!Array.isArray(lines) || !Number.isFinite(aroundLine)) return null;
    const idx = Math.max(0, aroundLine - 1);
    const start = Math.max(0, idx - 40);
    const pattern = /^\s*(it|test)\s*\(/;
    for (let i = idx; i >= start; i -= 1) {
        if (pattern.test(lines[i] || '')) return i;
    }
    return idx;
}

function extractTestBlock(lines, startIdx) {
    if (!Array.isArray(lines) || startIdx == null) return [];

    let openBraces = 0;
    let sawBodyStart = false;
    const out = [];

    for (let i = startIdx; i < lines.length; i += 1) {
        const line = lines[i] || '';
        out.push(line);

        for (let c = 0; c < line.length; c += 1) {
            const ch = line[c];
            if (ch === '{') {
                openBraces += 1;
                sawBodyStart = true;
            } else if (ch === '}') {
                openBraces = Math.max(0, openBraces - 1);
            }
        }

        const closesTest = /^\s*\}\)\s*;?\s*$/.test(line) || /^\s*\}\)\)\s*;?\s*$/.test(line);
        if (sawBodyStart && openBraces === 0 && closesTest) {
            return out;
        }

        if (out.length > 120) {
            return out;
        }
    }

    return out;
}

function extractTestSnippet(filePath, location) {
    const line = location && Number.isFinite(location.line) ? location.line : null;
    const lines = safeReadLines(filePath);
    if (!lines || !line) return null;

    const startIdx = findTestStartLine(lines, line);
    const block = extractTestBlock(lines, startIdx);
    if (block.length > 0) {
        return {
            startLine: startIdx + 1,
            snippet: block.join('\n'),
        };
    }

    const fallbackStart = Math.max(0, line - 4);
    const fallbackEnd = Math.min(lines.length, line + 4);
    return {
        startLine: fallbackStart + 1,
        snippet: lines.slice(fallbackStart, fallbackEnd).join('\n'),
    };
}

function emitDetailedTestInfo(jsonPath) {
    try {
        if (!jsonPath || !fs.existsSync(jsonPath)) {
            return false;
        }

        const raw = fs.readFileSync(jsonPath, 'utf8');
        const parsed = JSON.parse(raw);
        const suites = Array.isArray(parsed.testResults) ? parsed.testResults : [];
        if (!suites.length) {
            return false;
        }

        send('tests:output', {
            stream: 'stdout',
            text: '\n=== Detailed Test Cases ===\n',
        });

        suites.forEach((suite) => {
            const suiteName = path.relative(process.cwd(), String(suite.name || '')).replace(/\\/g, '/');
            send('tests:output', {
                stream: 'stdout',
                text: `\n[SUITE] ${suiteName || 'unknown-suite'}\n`,
            });

            const assertions = Array.isArray(suite.assertionResults) ? suite.assertionResults : [];
            assertions.forEach((assertion) => {
                const status = String(assertion.status || 'unknown').toUpperCase();
                const fullName = [
                    ...(Array.isArray(assertion.ancestorTitles) ? assertion.ancestorTitles : []),
                    String(assertion.title || ''),
                ]
                    .filter(Boolean)
                    .join(' > ');
                const duration = Number.isFinite(assertion.duration) ? `${assertion.duration} ms` : '-';
                const location = assertion.location
                    ? ` @ ${assertion.location.line}:${assertion.location.column}`
                    : '';

                send('tests:output', {
                    stream: status === 'FAILED' ? 'stderr' : 'stdout',
                    text: ` - [${status}] ${fullName} (${duration})${location}\n`,
                });

                const snippetInfo = extractTestSnippet(suite.name, assertion.location);
                if (snippetInfo && snippetInfo.snippet) {
                    send('tests:output', {
                        stream: 'stdout',
                        text: `   [TEST CODE @ line ${snippetInfo.startLine}]\n${snippetInfo.snippet}\n`,
                    });
                }

                if (status === 'FAILED' && Array.isArray(assertion.failureMessages) && assertion.failureMessages.length > 0) {
                    const firstMessage = String(assertion.failureMessages[0] || '').replace(/\u001b\[[0-9;]*m/g, '');
                    send('tests:output', {
                        stream: 'stderr',
                        text: `   ${firstMessage.split('\n')[0]}\n`,
                    });
                }
            });
        });

        return true;
    } catch (_err) {
        return false;
    }
}

ipcMain.handle('tests:run', async (_event, payload = {}) => {
    if (activeChild) {
        return { ok: false, error: 'A test run is already in progress.' };
    }

    const mode = String(payload.mode || 'all').toLowerCase();
    const testPath = String(payload.testPath || '').trim();
    const jsonOutputFile = path.join(os.tmpdir(), `ltf-jest-${Date.now()}-${Math.floor(Math.random() * 1e6)}.json`);

    const args = [];
    if (mode === 'watch') {
        args.push('run', 'test:watch', '--', '--verbose', '--testLocationInResults');
    } else if (mode === 'file' && testPath) {
        args.push('test', '--', testPath, '--verbose', '--testLocationInResults', '--json', `--outputFile=${jsonOutputFile}`);
    } else {
        args.push('test', '--', '--verbose', '--testLocationInResults', '--json', `--outputFile=${jsonOutputFile}`);
    }

    const { shell, shellArgs } = getShellAndArgs('npm', args);

    const runText = `npm ${args.join(' ')}`;
    const child = spawn(shell, shellArgs, {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
    });

    activeChild = child;
    send('tests:status', { state: 'running', command: runText });

    let combined = '';

    child.stdout.on('data', (chunk) => {
        const text = chunk.toString();
        combined += text;
        send('tests:output', { stream: 'stdout', text });
    });

    child.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        combined += text;
        send('tests:output', { stream: 'stderr', text });
    });

    return await new Promise((resolve) => {
        child.on('close', (code) => {
            activeChild = null;
            if (mode !== 'watch') {
                emitDetailedTestInfo(jsonOutputFile);
                try {
                    if (fs.existsSync(jsonOutputFile)) {
                        fs.unlinkSync(jsonOutputFile);
                    }
                } catch (_err) {
                    // Ignore cleanup failures for temp output.
                }
            }
            const summary = parseSummary(combined);
            send('tests:status', {
                state: code === 0 ? 'passed' : 'failed',
                code,
                summary,
            });
            resolve({ ok: true, code, summary });
        });

        child.on('error', (err) => {
            activeChild = null;
            send('tests:status', { state: 'failed', code: -1, error: err.message });
            resolve({ ok: false, error: err.message });
        });
    });
});

ipcMain.handle('tests:stop', async () => {
    if (!activeChild) return { ok: true, stopped: false };

    if (process.platform === 'win32') {
        const killer = spawn('taskkill', ['/pid', String(activeChild.pid), '/t', '/f'], { windowsHide: true });
        await new Promise((resolve) => killer.on('close', resolve));
    } else {
        activeChild.kill('SIGTERM');
    }

    activeChild = null;
    send('tests:status', { state: 'stopped' });
    return { ok: true, stopped: true };
});

ipcMain.handle('timeline:load', async () => {
    const artifactPath = getTimelineArtifactPath();
    try {
        if (!fs.existsSync(artifactPath)) {
            return { ok: false, error: 'Timeline artifact not found. Generate it first.' };
        }
        const parsed = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
        return { ok: true, artifactPath, data: parsed };
    } catch (err) {
        return { ok: false, error: err.message };
    }
});

ipcMain.handle('timeline:generate', async () => {
    const workspaceRoot = getWorkspaceRoot();
    const scriptPath = path.join(workspaceRoot, 'scripts', 'generate_timeline_artifact.js');
    if (!fs.existsSync(scriptPath)) {
        return { ok: false, error: 'Timeline generator script missing.' };
    }

    const child = spawn(process.execPath, [scriptPath], {
        cwd: workspaceRoot,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    let out = '';
    let errOut = '';

    child.stdout.on('data', (chunk) => { out += chunk.toString(); });
    child.stderr.on('data', (chunk) => { errOut += chunk.toString(); });

    return await new Promise((resolve) => {
        child.on('close', (code) => {
            if (code === 0) {
                resolve({ ok: true, output: out.trim(), artifactPath: getTimelineArtifactPath() });
            } else {
                resolve({ ok: false, error: (errOut || out || 'Unknown generator failure').trim() });
            }
        });

        child.on('error', (err) => resolve({ ok: false, error: err.message }));
    });
});

ipcMain.handle('timeline:compare', async (_event, payload = {}) => {
    try {
        const defaultPath = getTimelineArtifactPath();
        const pathA = String(payload.pathA || defaultPath).trim();
        const pathB = String(payload.pathB || defaultPath).trim();
        const result = compareTimelineArtifacts(pathA, pathB);
        return {
            ...result,
            pathA,
            pathB,
        };
    } catch (err) {
        return { ok: false, error: err.message };
    }
});

ipcMain.handle('inspector:start', async (_event, payload = {}) => {
    const intervalMs = Number.isFinite(payload.intervalMs) ? Math.max(250, payload.intervalMs) : 750;
    const requestedPath = String(payload.stateFilePath || '').trim();
    const stateFilePath = requestedPath || getDefaultLiveStatePath();

    if (liveInspectorTimer) {
        clearInterval(liveInspectorTimer);
        liveInspectorTimer = null;
    }

    const pushSnapshot = () => {
        const fromFile = readInspectorSnapshot(stateFilePath);
        const snapshot = fromFile || buildSyntheticInspectorSnapshot();
        send('inspector:update', {
            ...snapshot,
            stateFilePath,
        });
    };

    pushSnapshot();
    liveInspectorTimer = setInterval(pushSnapshot, intervalMs);
    send('inspector:status', { state: 'running', intervalMs, stateFilePath });

    return { ok: true, intervalMs, stateFilePath };
});

ipcMain.handle('inspector:stop', async () => {
    if (liveInspectorTimer) {
        clearInterval(liveInspectorTimer);
        liveInspectorTimer = null;
    }
    send('inspector:status', { state: 'stopped' });
    return { ok: true };
});

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (liveInspectorTimer) {
        clearInterval(liveInspectorTimer);
        liveInspectorTimer = null;
    }
    if (process.platform !== 'darwin') app.quit();
});

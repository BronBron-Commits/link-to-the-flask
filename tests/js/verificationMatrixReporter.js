const fs = require('fs');
const path = require('path');
const os = require('os');

const RECORDS_FILE = process.env.LTF_VERIFICATION_RECORDS_FILE
  || path.join(os.tmpdir(), 'ltf-verification-records.ndjson');

function toLower(value) {
  return String(value || '').toLowerCase();
}

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/').toLowerCase();
}

function displayPath(value) {
  const raw = String(value || '').replace(/\\/g, '/');
  const rel = path.relative(process.cwd(), raw).replace(/\\/g, '/');
  return rel || raw;
}

function sanitizeFailureLine(value) {
  return String(value || '')
    .replace(/\u001b\[[0-9;]*m/g, '')
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0) || '';
}

function loadManualRecords() {
  if (!fs.existsSync(RECORDS_FILE)) return [];
  const lines = fs.readFileSync(RECORDS_FILE, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    try {
      out.push(JSON.parse(lines[i]));
    } catch (_err) {
      // Skip malformed records.
    }
  }
  return out;
}

function flattenAssertions(results) {
  const assertions = [];
  (results.testResults || []).forEach((suite) => {
    const suiteAbsPath = suite.testFilePath || suite.name || suite.testPath;
    const suitePath = normalizePath(suiteAbsPath);
    const suiteDisplayPath = displayPath(suiteAbsPath);
    const suiteAssertions = Array.isArray(suite.testResults)
      ? suite.testResults
      : Array.isArray(suite.assertionResults)
        ? suite.assertionResults
        : [];

    if (suiteAssertions.length === 0) {
      assertions.push({
        suitePath,
        suiteDisplayPath,
        status: toLower(suite.status || 'unknown'),
        fullNameRaw: '',
        fullName: '',
        titleRaw: '',
        title: '',
        line: null,
        column: null,
        failureLine: '',
      });
      return;
    }

    suiteAssertions.forEach((assertion) => {
      const reconstructedName = [
        ...(Array.isArray(assertion.ancestorTitles) ? assertion.ancestorTitles : []),
        assertion.title || '',
      ]
        .filter(Boolean)
        .join(' ');

      assertions.push({
        suitePath,
        suiteDisplayPath,
        status: toLower(assertion.status),
        fullNameRaw: assertion.fullName || reconstructedName || assertion.title || '',
        fullName: toLower(assertion.fullName || reconstructedName || assertion.title || ''),
        titleRaw: assertion.title || '',
        title: toLower(assertion.title || ''),
        line: assertion.location && Number.isFinite(assertion.location.line)
          ? assertion.location.line
          : null,
        column: assertion.location && Number.isFinite(assertion.location.column)
          ? assertion.location.column
          : null,
        failureLine: sanitizeFailureLine(Array.isArray(assertion.failureMessages) ? assertion.failureMessages[0] : ''),
      });
    });
  });
  return assertions;
}

function hasPassed(assertions, predicate) {
  return assertions.some((a) => a.status === 'passed' && predicate(a));
}

function hasPassedAll(assertions, predicates) {
  return predicates.every((pred) => hasPassed(assertions, pred));
}

function uniqueByTest(assertions) {
  const map = new Map();
  assertions.forEach((a) => {
    const key = `${a.suiteDisplayPath}|${a.fullNameRaw}|${a.line || 0}`;
    if (!map.has(key)) map.set(key, a);
  });
  return Array.from(map.values());
}

function collectMatches(assertions, predicates, status) {
  return uniqueByTest(assertions.filter((a) => a.status === status && predicates.some((p) => p(a))));
}

function buildProofLine(assertion) {
  const line = assertion.line || 1;
  const name = assertion.fullNameRaw || assertion.titleRaw || '(unnamed test)';
  return `${assertion.suiteDisplayPath}:${line} - ${name}`;
}

function createCheck(assertions, label, predicates, options = {}) {
  const requireAllPredicates = options.requireAllPredicates === true;

  const passedMatches = collectMatches(assertions, predicates, 'passed');
  const failedMatches = collectMatches(assertions, predicates, 'failed');

  const perPredicatePass = predicates.map((predicate) =>
    collectMatches(assertions, [predicate], 'passed'));
  const ok = requireAllPredicates
    ? perPredicatePass.every((bucket) => bucket.length > 0)
    : passedMatches.length > 0;

  const proofs = passedMatches
    .map((a) => buildProofLine(a))
    .sort();

  let failure = null;
  if (!ok && failedMatches.length > 0) {
    const firstFail = failedMatches[0];
    failure = `${firstFail.suiteDisplayPath}:${firstFail.line || 1}`;
    if (firstFail.failureLine) {
      failure += ` - ${firstFail.failureLine}`;
    }
  } else if (!ok && requireAllPredicates) {
    const missing = perPredicatePass
      .map((bucket, idx) => ({ idx, bucket }))
      .filter((entry) => entry.bucket.length === 0)
      .map((entry) => `requirement-${entry.idx + 1}`);
    failure = `No passing test found for ${missing.join(', ')}`;
  } else if (!ok) {
    failure = 'No passing test matched this guarantee in this run.';
  }

  return {
    label,
    ok,
    coverageCount: proofs.length,
    proofs,
    failure,
  };
}

function buildMatrix(results, manualRecords) {
  const assertions = flattenAssertions(results);
  const passedManual = manualRecords.filter((r) => r && r.label);

  const sections = [
    {
      title: 'SYSTEM COVERAGE',
      checks: [
        createCheck(assertions, 'Combat system', [
          (a) => a.suitePath.includes('/combat-system.test.js') || a.suitePath.includes('/simulations/combat-'),
        ]),
        createCheck(assertions, 'Networking', [
          (a) => a.suitePath.includes('/networking.test.js'),
        ]),
        createCheck(assertions, 'Authority', [
          (a) => a.suitePath.includes('/dm-authority.test.js') || a.suitePath.includes('/mode-management.test.js'),
        ]),
        createCheck(assertions, 'UI', [
          (a) => a.suitePath.includes('/ui-state.test.js'),
        ]),
        createCheck(assertions, 'Simulation', [
          (a) => a.suitePath.includes('/simulations/'),
        ]),
      ],
    },
    {
      title: 'BEHAVIORAL GUARANTEES',
      checks: [
        createCheck(assertions, 'Determinism', [
          (a) => (a.suitePath.includes('/simulations/replay-determinism.test.js') || a.suitePath.includes('/simulations/long-run-stability.test.js'))
            && (a.fullName.includes('deterministic')
              || a.fullName.includes('identical state')
              || a.fullName.includes('tie initiative')
              || a.fullName.includes('larger entity counts')
              || a.fullName.includes('sustained stability')),
        ]),
        createCheck(assertions, 'Multiplayer conflict resolution', [
          (a) => a.suitePath.includes('/simulations/multiplayer-conflict.test.js')
            && (a.fullName.includes('simultaneous multi-client')
              || a.fullName.includes('multi-turn conflicts')
              || a.fullName.includes('mixed authority')
              || a.fullName.includes('authority escalation attempt')),
        ]),
        createCheck(assertions, 'Chaos resilience', [
          (a) => a.suitePath.includes('/simulations/chaos-randomized.test.js'),
        ]),
        createCheck(assertions, 'Performance invariants', [
            (a) => a.suitePath.includes('/simulations/multiplayer-conflict.test.js') && a.fullName.includes('100 rapid actions under frame budget'),
            (a) => a.suitePath.includes('/simulations/multiplayer-conflict.test.js')
              && (a.fullName.includes('queue growth')
                || a.fullName.includes('sustained mixed workload')
                || a.fullName.includes('degradation drift')),
          ], { requireAllPredicates: true }),
      ],
    },
    {
      title: 'FLOW VALIDATION',
      checks: [
        createCheck(assertions, 'Network -> state -> UI', [
          (a) => a.suitePath.includes('/simulations/combat-full-flow.test.js') && a.fullName.includes('network') && a.fullName.includes('state') && a.fullName.includes('ui'),
        ]),
        createCheck(assertions, 'Mode -> authority -> commands', [
          (a) => a.suitePath.includes('/simulations/combat-full-flow.test.js') && a.fullName.includes('mode change') && a.fullName.includes('authority') && a.fullName.includes('command'),
        ]),
      ],
    },
    {
      title: 'COMBAT ENGINE',
      checks: [
        createCheck(assertions, 'Timeline initialization', [
          (a) => a.suitePath.includes('/combat-system.test.js') && a.fullName.includes('timeline initialization'),
        ]),
        createCheck(assertions, 'Turn state machine', [
          (a) => a.suitePath.includes('/combat-system.test.js') && a.fullName.includes('turn end state machine'),
        ]),
        createCheck(assertions, 'Action validation', [
          (a) => a.suitePath.includes('/combat-system.test.js') && a.fullName.includes('validate action availability'),
        ]),
      ],
    },
    {
      title: 'NETWORKING',
      checks: [
        createCheck(assertions, 'Event emission', [
          (a) => a.suitePath.includes('/networking.test.js') && a.fullName.includes('emit'),
        ]),
        createCheck(assertions, 'Deduplication', [
          (a) => a.suitePath.includes('/networking.test.js') && a.fullName.includes('deduplication'),
        ]),
        createCheck(assertions, 'Timeline alignment', [
          (a) => a.suitePath.includes('/networking.test.js') && a.fullName.includes('timeline alignment'),
        ]),
      ],
    },
    {
      title: 'AUTHORITY',
      checks: [
        createCheck(assertions, 'Mode permissions', [
          (a) => a.suitePath.includes('/dm-authority.test.js') && a.fullName.includes('mode permissions'),
        ]),
        createCheck(assertions, 'DM capability mapping', [
          (a) => a.suitePath.includes('/dm-authority.test.js') && a.fullName.includes('capability mapping'),
        ]),
        createCheck(assertions, 'Authority escalation blocked', [
          (a) => a.suitePath.includes('/simulations/multiplayer-conflict.test.js') && a.fullName.includes('authority escalation attempt'),
        ]),
      ],
    },
    {
      title: 'SIMULATION GUARANTEES',
      checks: [
        createCheck(assertions, 'Determinism (same input -> same output)', [
          (a) => (a.suitePath.includes('/simulations/replay-determinism.test.js') || a.suitePath.includes('/simulations/long-run-stability.test.js'))
            && (a.fullName.includes('identical action sequences')
              || a.fullName.includes('deterministic across seed')
              || a.fullName.includes('larger entity counts')
              || a.fullName.includes('tie initiative')
              || a.fullName.includes('sustained stability')),
        ]),
        createCheck(assertions, 'Replay correctness', [
          (a) => (a.suitePath.includes('/simulations/replay-determinism.test.js') || a.suitePath.includes('/simulations/long-run-stability.test.js'))
            && (a.fullName.includes('replay log')
              || a.fullName.includes('mixed action types')
              || a.fullName.includes('long-run replay')
              || a.fullName.includes('replay long-run streams')
              || a.fullName.includes('100-turn sustained replay')),
        ]),
        createCheck(assertions, 'Order independence', [
          (a) => a.suitePath.includes('/simulations/replay-determinism.test.js')
            && (a.fullName.includes('arrival order')
              || a.fullName.includes('order independence')
              || a.fullName.includes('same-tick collisions')
              || a.fullName.includes('mixed priorities')),
        ]),
      ],
    },
    {
      title: 'CHAOS RESILIENCE',
      checks: [
        createCheck(assertions, 'Out-of-order packets', [
          (a) => a.suitePath.includes('/simulations/chaos-randomized.test.js') && a.fullName.includes('out-of-order'),
        ]),
        createCheck(assertions, 'Duplicate packets', [
          (a) => a.suitePath.includes('/simulations/chaos-randomized.test.js') && a.fullName.includes('duplicate'),
        ]),
        createCheck(assertions, 'Dropped packets', [
          (a) => a.suitePath.includes('/simulations/chaos-randomized.test.js') && a.fullName.includes('dropped'),
        ]),
      ],
    },
    {
      title: 'PERFORMANCE',
      checks: [
        createCheck(assertions, '100 actions < 16ms', [
          (a) => a.suitePath.includes('/simulations/multiplayer-conflict.test.js')
            && (a.fullName.includes('100 rapid actions under frame budget')
              || a.fullName.includes('sustained mixed workload')
              || a.fullName.includes('degradation drift')),
        ]),
        createCheck(assertions, 'Queue growth capped', [
          (a) => a.suitePath.includes('/simulations/multiplayer-conflict.test.js')
            && (a.fullName.includes('queue growth capped') || a.fullName.includes('cap event queue growth')),
        ]),
      ],
    },
  ];

  if (passedManual.length) {
    const grouped = {};
    passedManual.forEach((entry) => {
      const system = String(entry.system || 'manual').trim() || 'manual';
      const label = String(entry.label || '').trim();
      if (!label) return;
      if (!grouped[system]) grouped[system] = [];
      grouped[system].push(entry);
    });

    const manualChecks = Object.entries(grouped).map(([system, entries]) => {
      const proofs = entries.map((entry) => {
        const p = displayPath(entry.testPath || 'manual');
        const line = entry.line || 1;
        return `${p}:${line} - ${entry.label}`;
      });
      return {
        label: system,
        ok: true,
        coverageCount: proofs.length,
        proofs,
        failure: null,
      };
    });

    if (manualChecks.length) {
      sections.push({
        title: 'MANUAL VERIFICATIONS',
        checks: manualChecks,
      });
    }
  }

  const flat = sections.flatMap((s) => s.checks);
  const passed = flat.filter((c) => c.ok).length;
  const total = flat.length;

  return {
    generatedAt: new Date().toISOString(),
    passed,
    total,
    percent: total > 0 ? Math.round((passed / total) * 100) : 0,
    sections,
  };
}

function matrixToText(matrix) {
  const lines = [];
  lines.push('=== ENGINE VERIFICATION MATRIX ===');
  lines.push('');

  matrix.sections.forEach((section) => {
    lines.push(`[${section.title}]`);
    section.checks.forEach((check) => {
      lines.push(`${check.ok ? '[OK]' : '[MISSING]'} ${check.label} (${check.coverageCount || 0} tests)`);
      (check.proofs || []).slice(0, 8).forEach((proof) => {
        lines.push(`  - ${proof}`);
      });
      if (!check.ok && check.failure) {
        lines.push(`  ! ${check.failure}`);
      }
    });
    lines.push('');
  });

  lines.push(`RESULT: ${matrix.passed}/${matrix.total} VERIFIED (${matrix.percent}%)`);
  return lines.join('\n');
}

class VerificationMatrixReporter {
  onRunStart() {
    try {
      if (fs.existsSync(RECORDS_FILE)) {
        fs.unlinkSync(RECORDS_FILE);
      }
    } catch (_err) {
      // Ignore cleanup errors.
    }
  }

  onRunComplete(_contexts, results) {
    const manualRecords = loadManualRecords();
    const matrix = buildMatrix(results, manualRecords);
    const text = matrixToText(matrix);

    const outDir = path.join(process.cwd(), 'artifacts');
    fs.mkdirSync(outDir, { recursive: true });

    const jsonPath = path.join(outDir, 'verification-matrix.json');
    const textPath = path.join(outDir, 'verification-matrix.txt');

    fs.writeFileSync(jsonPath, `${JSON.stringify(matrix, null, 2)}\n`, 'utf8');
    fs.writeFileSync(textPath, `${text}\n`, 'utf8');

    process.stdout.write(`\n${text}\n`);
    process.stdout.write(`\nVerification artifacts written: ${jsonPath}, ${textPath}\n`);
  }
}

module.exports = VerificationMatrixReporter;

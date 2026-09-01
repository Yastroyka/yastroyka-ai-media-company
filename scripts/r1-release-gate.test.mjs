import assert from 'node:assert/strict';
import test from 'node:test';
import {
  renderReleaseGateSummary,
  runReleaseGate,
  validateReleaseGateManifest,
} from './r1-release-gate-lib.mjs';

function makeManifest() {
  return {
    schemaVersion: 1,
    release: 'R1',
    hardGates: [
      {
        id: 'GATE_ONE',
        title: 'First hard gate',
        authority: ['CONTROL-01'],
        commands: [
          {
            id: 'COMMAND_ONE',
            label: 'First command',
            argv: ['node', '--version'],
          },
          {
            id: 'COMMAND_TWO',
            label: 'Second command',
            argv: ['pnpm', '--version'],
          },
          {
            id: 'COMMAND_THREE',
            label: 'Third command',
            argv: ['node', '--version'],
          },
        ],
      },
      {
        id: 'GATE_TWO',
        title: 'Second hard gate',
        authority: ['DATA-01'],
        commands: [
          {
            id: 'COMMAND_FOUR',
            label: 'Fourth command',
            argv: ['node', '--version'],
          },
        ],
      },
    ],
  };
}

function makeClock() {
  let tick = Date.parse('2026-09-01T12:00:00.000Z');
  return () => {
    const value = tick;
    tick += 10;
    return value;
  };
}

test('manifest validation is exact, unique and shell-free', () => {
  assert.equal(validateReleaseGateManifest(makeManifest()).release, 'R1');

  const duplicate = makeManifest();
  duplicate.hardGates[1].id = 'GATE_ONE';
  assert.throws(() => validateReleaseGateManifest(duplicate), /Duplicate gate id/u);

  const unsafeExecutable = makeManifest();
  unsafeExecutable.hardGates[0].commands[0].argv = ['bash', '-c', 'exit 0'];
  assert.throws(
    () => validateReleaseGateManifest(unsafeExecutable),
    /unapproved executable/u,
  );

  const unknownField = makeManifest();
  unknownField.hardGates[0].extra = true;
  assert.throws(
    () => validateReleaseGateManifest(unknownField),
    /unexpected or missing keys/u,
  );
});

test('all passing hard gates emit PASS evidence bound to the revision', () => {
  const executed = [];
  const evidence = runReleaseGate(makeManifest(), {
    revision: '0123456789abcdef0123456789abcdef01234567',
    now: makeClock(),
    execute(command) {
      executed.push(command.id);
      return { exitCode: 0, rawSecret: 'must-never-enter-evidence' };
    },
  });

  assert.equal(evidence.status, 'PASS');
  assert.equal(evidence.gates.length, 2);
  assert.deepEqual(
    evidence.gates.map((gate) => gate.status),
    ['PASS', 'PASS'],
  );
  assert.deepEqual(executed, [
    'COMMAND_ONE',
    'COMMAND_TWO',
    'COMMAND_THREE',
    'COMMAND_FOUR',
  ]);
  assert.doesNotMatch(JSON.stringify(evidence), /must-never-enter-evidence/u);
  assert.doesNotMatch(JSON.stringify(evidence), /argv/u);
});

test('failed command emits NOT_RUN evidence and fails the release', () => {
  const executed = [];
  const evidence = runReleaseGate(makeManifest(), {
    now: makeClock(),
    execute(command) {
      executed.push(command.id);
      if (command.id === 'COMMAND_TWO') {
        return {
          exitCode: 7,
          errorCode: 'COMMAND_FAILED',
          rawSecret: 'do-not-copy',
        };
      }
      return { exitCode: 0 };
    },
  });

  assert.equal(evidence.status, 'FAIL');
  assert.equal(evidence.gates[0].status, 'FAIL');
  assert.equal(evidence.gates[0].commands[1].status, 'FAIL');
  assert.equal(evidence.gates[0].commands[1].exitCode, 7);
  assert.equal(evidence.gates[0].commands[2].status, 'NOT_RUN');
  assert.equal(
    evidence.gates[0].commands[2].errorCode,
    'PREREQUISITE_COMMAND_FAILED',
  );
  assert.equal(evidence.gates[1].status, 'PASS');
  assert.deepEqual(executed, ['COMMAND_ONE', 'COMMAND_TWO', 'COMMAND_FOUR']);
  assert.doesNotMatch(JSON.stringify(evidence), /do-not-copy/u);
});

test('executor exceptions are sanitized and cannot produce PASS', () => {
  const evidence = runReleaseGate(makeManifest(), {
    now: makeClock(),
    execute() {
      throw new Error('token=super-secret-runtime-value');
    },
  });

  assert.equal(evidence.status, 'FAIL');
  assert.equal(evidence.gates[0].commands[0].errorCode, 'EXECUTOR_ERROR');
  assert.doesNotMatch(JSON.stringify(evidence), /super-secret-runtime-value/u);
});

test('markdown summary contains only revision and hard-gate outcomes', () => {
  const evidence = runReleaseGate(makeManifest(), {
    now: makeClock(),
    execute() {
      return { exitCode: 0 };
    },
  });
  const summary = renderReleaseGateSummary(evidence);

  assert.match(summary, /R1 Golden Evals Release Gate/u);
  assert.match(summary, /GATE_ONE/u);
  assert.match(summary, /GATE_TWO/u);
  assert.doesNotMatch(summary, /COMMAND_ONE/u);
  assert.doesNotMatch(summary, /--version/u);
});

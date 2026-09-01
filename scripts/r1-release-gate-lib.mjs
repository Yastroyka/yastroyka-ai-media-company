import { spawnSync } from 'node:child_process';

const IDENTIFIER_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/u;
const ALLOWED_EXECUTABLES = new Set(['node', 'pnpm']);
const COMMAND_TIMEOUT_MS = 10 * 60 * 1000;

function requireRecord(value, field) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} must be an object.`);
  }
  return value;
}

function requireExactKeys(value, allowedKeys, field) {
  const keys = Object.keys(value).sort();
  const expected = [...allowedKeys].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new Error(`${field} has unexpected or missing keys.`);
  }
}

function requireIdentifier(value, field) {
  if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value)) {
    throw new Error(`${field} must be an uppercase stable identifier.`);
  }
}

function requireNonEmptyString(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 256) {
    throw new Error(`${field} must be a non-empty bounded string.`);
  }
}

function requireRevision(value) {
  if (value === 'LOCAL') {
    return;
  }
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/u.test(value)) {
    throw new Error('revision must be LOCAL or an exact lowercase 40-character Git SHA.');
  }
}

export function validateReleaseGateManifest(manifest) {
  const root = requireRecord(manifest, 'manifest');
  requireExactKeys(root, ['schemaVersion', 'release', 'hardGates'], 'manifest');

  if (root.schemaVersion !== 1) {
    throw new Error('manifest.schemaVersion must be 1.');
  }
  if (root.release !== 'R1') {
    throw new Error('manifest.release must be R1.');
  }
  if (!Array.isArray(root.hardGates) || root.hardGates.length === 0) {
    throw new Error('manifest.hardGates must be a non-empty array.');
  }

  const gateIds = new Set();
  const commandIds = new Set();

  for (const [gateIndex, rawGate] of root.hardGates.entries()) {
    const gate = requireRecord(rawGate, `manifest.hardGates[${gateIndex}]`);
    requireExactKeys(gate, ['id', 'title', 'authority', 'commands'], `gate ${gateIndex}`);
    requireIdentifier(gate.id, `gate ${gateIndex}.id`);
    requireNonEmptyString(gate.title, `gate ${gate.id}.title`);

    if (gateIds.has(gate.id)) {
      throw new Error(`Duplicate gate id: ${gate.id}`);
    }
    gateIds.add(gate.id);

    if (!Array.isArray(gate.authority) || gate.authority.length === 0) {
      throw new Error(`gate ${gate.id}.authority must be non-empty.`);
    }
    for (const [authorityIndex, authority] of gate.authority.entries()) {
      requireNonEmptyString(authority, `gate ${gate.id}.authority[${authorityIndex}]`);
    }

    if (!Array.isArray(gate.commands) || gate.commands.length === 0) {
      throw new Error(`gate ${gate.id}.commands must be non-empty.`);
    }

    for (const [commandIndex, rawCommand] of gate.commands.entries()) {
      const command = requireRecord(rawCommand, `gate ${gate.id}.commands[${commandIndex}]`);
      requireExactKeys(command, ['id', 'label', 'argv'], `command ${gate.id}/${commandIndex}`);
      requireIdentifier(command.id, `command ${gate.id}/${commandIndex}.id`);
      requireNonEmptyString(command.label, `command ${command.id}.label`);

      if (commandIds.has(command.id)) {
        throw new Error(`Duplicate command id: ${command.id}`);
      }
      commandIds.add(command.id);

      if (!Array.isArray(command.argv) || command.argv.length === 0) {
        throw new Error(`command ${command.id}.argv must be non-empty.`);
      }
      for (const [argumentIndex, argument] of command.argv.entries()) {
        requireNonEmptyString(argument, `command ${command.id}.argv[${argumentIndex}]`);
        if (argument.includes('\n') || argument.includes('\r') || argument.includes('\0')) {
          throw new Error(`command ${command.id}.argv contains unsafe control characters.`);
        }
      }
      if (!ALLOWED_EXECUTABLES.has(command.argv[0])) {
        throw new Error(`command ${command.id} uses an unapproved executable.`);
      }
    }
  }

  return manifest;
}

function resolveExecutable(executable) {
  if (process.platform === 'win32' && executable === 'pnpm') {
    return 'pnpm.cmd';
  }
  return executable;
}

export function executeReleaseGateCommand(command, { env = process.env } = {}) {
  const [executable, ...args] = command.argv;
  const result = spawnSync(resolveExecutable(executable), args, {
    env,
    shell: false,
    stdio: 'inherit',
    timeout: COMMAND_TIMEOUT_MS,
  });

  if (result.error !== undefined) {
    return {
      exitCode: 1,
      errorCode: result.error.code === 'ETIMEDOUT' ? 'TIMEOUT' : 'SPAWN_ERROR',
    };
  }

  return {
    exitCode: Number.isInteger(result.status) ? result.status : 1,
    errorCode: result.signal === null ? null : 'TERMINATED_BY_SIGNAL',
  };
}

export function runReleaseGate(
  manifest,
  {
    execute = executeReleaseGateCommand,
    env = process.env,
    now = () => Date.now(),
    revision = 'LOCAL',
  } = {},
) {
  validateReleaseGateManifest(manifest);
  requireRevision(revision);

  const generatedAt = new Date(now()).toISOString();
  const gateEvidence = [];

  for (const gate of manifest.hardGates) {
    let gateFailed = false;
    const commandEvidence = [];

    for (const command of gate.commands) {
      if (gateFailed) {
        commandEvidence.push({
          id: command.id,
          label: command.label,
          status: 'NOT_RUN',
          exitCode: null,
          errorCode: 'PREREQUISITE_COMMAND_FAILED',
          durationMs: 0,
        });
        continue;
      }

      const startedAt = now();
      let result;
      try {
        result = execute(command, { env });
      } catch {
        result = { exitCode: 1, errorCode: 'EXECUTOR_ERROR' };
      }
      const durationMs = Math.max(0, now() - startedAt);
      const passed = result.exitCode === 0;

      commandEvidence.push({
        id: command.id,
        label: command.label,
        status: passed ? 'PASS' : 'FAIL',
        exitCode: Number.isInteger(result.exitCode) ? result.exitCode : 1,
        errorCode: passed ? null : (result.errorCode ?? 'COMMAND_FAILED'),
        durationMs,
      });

      if (!passed) {
        gateFailed = true;
      }
    }

    gateEvidence.push({
      id: gate.id,
      title: gate.title,
      authority: [...gate.authority],
      status: gateFailed ? 'FAIL' : 'PASS',
      commands: commandEvidence,
    });
  }

  const status = gateEvidence.every((gate) => gate.status === 'PASS') ? 'PASS' : 'FAIL';

  return {
    schemaVersion: 1,
    release: manifest.release,
    revision,
    generatedAt,
    status,
    gates: gateEvidence,
  };
}

export function renderReleaseGateSummary(evidence) {
  const lines = [
    '# R1 Golden Evals Release Gate',
    '',
    `- Revision: \`${evidence.revision}\``,
    `- Result: **${evidence.status}**`,
    '',
    '| Hard gate | Result |',
    '| --- | --- |',
  ];

  for (const gate of evidence.gates) {
    lines.push(`| \`${gate.id}\` | **${gate.status}** |`);
  }

  return `${lines.join('\n')}\n`;
}

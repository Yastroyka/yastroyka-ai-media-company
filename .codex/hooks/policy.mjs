const secretPathPattern = /(^|[/\\])\.env(?:\.[^/\\]+)?$|\.(?:pem|key|p12|pfx)$/i;

const bashDenials = [
  {
    id: 'destructive-delete',
    pattern: /(?:^|[;&|]\s*)(?:sudo\s+)?rm\s+(?:-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\b/i,
  },
  {
    id: 'powershell-destructive-delete',
    pattern:
      /\bRemove-Item\b[^\n;]*(?:(?:-Recurse\b[^\n;]*-Force\b)|(?:-Force\b[^\n;]*-Recurse\b))/i,
  },
  {
    id: 'cmd-destructive-delete',
    pattern: /\b(?:rmdir|rd)\b[^\n&|]*\/s\b[^\n&|]*\/q\b/i,
  },
  { id: 'git-reset-hard', pattern: /\bgit\s+reset\s+--hard\b/i },
  { id: 'git-clean-force', pattern: /\bgit\s+clean\s+-[^\s]*f/i },
  { id: 'git-force-push', pattern: /\bgit\s+push\b[^\n]*(?:--force|-f\b)/i },
  {
    id: 'protected-branch-push',
    pattern: /\bgit\s+push\b[^\n]*(?:\s|:)(?:main|master)(?:\s|$)/i,
  },
  { id: 'direct-pr-merge', pattern: /\bgh\s+pr\s+merge\b/i },
  { id: 'database-destructive', pattern: /\b(?:DROP\s+DATABASE|TRUNCATE\s+TABLE)\b/i },
  { id: 'infrastructure-destroy', pattern: /\bterraform\s+destroy\b/i },
  { id: 'cluster-delete', pattern: /\bkubectl\s+delete\b/i },
];

function extractPatchPaths(command) {
  return [...command.matchAll(/^\*\*\*\s+(?:Add|Update|Delete)\s+File:\s*(.+)$/gim)].map(
    ([, filePath]) => filePath.trim(),
  );
}

function commandReferencesSecret(command) {
  const candidates = command
    .split(/[\s"'`;|&<>]+/)
    .map((candidate) => candidate.replace(/^[([{]+|[\])},:]+$/g, ''))
    .filter(Boolean);

  return candidates.some((candidate) => secretPathPattern.test(candidate));
}

function deny(reason) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  };
}

export function evaluatePreToolUse(input) {
  if (!input || typeof input !== 'object') {
    return deny('Invalid hook input; fail-closed policy applied.');
  }

  const toolName = input.tool_name;
  const command = input.tool_input?.command;

  if (typeof command !== 'string') {
    return deny('Missing tool command; fail-closed policy applied.');
  }

  if (toolName === 'apply_patch') {
    const secretTarget = extractPatchPaths(command).find((filePath) =>
      secretPathPattern.test(filePath),
    );

    if (secretTarget) {
      return deny(`Secret-bearing file is outside the agent boundary: ${secretTarget}`);
    }

    return null;
  }

  if (toolName !== 'Bash') {
    return null;
  }

  if (commandReferencesSecret(command)) {
    return deny('Reading or writing secret-bearing files is denied.');
  }

  const blocked = bashDenials.find(({ pattern }) => pattern.test(command));

  if (blocked) {
    return deny(`Command denied by YASTROYKA policy: ${blocked.id}`);
  }

  return null;
}

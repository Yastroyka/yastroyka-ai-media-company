import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];

function read(relativePath) {
  const absolutePath = resolve(root, relativePath);

  if (!existsSync(absolutePath)) {
    failures.push(`Missing required file: ${relativePath}`);
    return '';
  }

  return readFileSync(absolutePath, 'utf8');
}

function requireMatch(content, pattern, message) {
  if (!pattern.test(content)) {
    failures.push(message);
  }
}

const constitution = read('docs/PROJECT_CONSTITUTION.md');
const agents = read('AGENTS.md');
const contract = read('docs/agentic/AGENT_EXECUTION_CONTRACT.md');
const config = read('.codex/config.toml');
const hooksText = read('.codex/hooks.json');
const milestone = read('.ai/tasks/MILESTONE-02-codex-base-setup.md');

requireMatch(
  constitution,
  /AGENT-01: conflicts return BLOCKED\/CONFLICT/,
  'Constitution conflict rule is missing.',
);
requireMatch(agents, /Authority Order/, 'AGENTS.md authority order is missing.');
requireMatch(
  contract,
  /Required task envelope/,
  'Agent Execution Contract task envelope is missing.',
);
requireMatch(
  milestone,
  /571d58642a10f4d8d7ce97882a615b6feeba7887/,
  'Source baseline marker is missing.',
);
requireMatch(
  config,
  /approval_policy\s*=\s*"on-request"/,
  'Approval policy must be on-request.',
);
requireMatch(
  config,
  /default_permissions\s*=\s*"yastroyka-repo"/,
  'YASTROYKA permission profile is not selected.',
);
requireMatch(
  config,
  /extends\s*=\s*":workspace"/,
  'Permission profile must extend :workspace.',
);
requireMatch(
  config,
  /\[permissions\.yastroyka-repo\.network\]\s*enabled\s*=\s*false/s,
  'Project command network must be disabled.',
);
requireMatch(
  config,
  /^"\.env"\s*=\s*"deny"$/m,
  'Root .env access must be denied.',
);
requireMatch(
  config,
  /\[mcp_servers\.yastroyka_owned\][\s\S]*?enabled\s*=\s*false/,
  'MCP placeholder must be disabled.',
);

if (/danger-full-access|approval_policy\s*=\s*"never"/.test(config)) {
  failures.push('Unsafe Codex permission or approval setting detected.');
}

try {
  const hooks = JSON.parse(hooksText);
  const preToolUse = hooks.hooks?.PreToolUse;

  if (!Array.isArray(preToolUse) || preToolUse.length !== 1) {
    failures.push('Exactly one project PreToolUse hook group is required.');
  }
} catch (error) {
  failures.push(`Invalid .codex/hooks.json: ${error.message}`);
}

const skillsRoot = resolve(root, '.agents/skills');
const skillDirectories = existsSync(skillsRoot)
  ? readdirSync(skillsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory())
  : [];
const skillNames = new Set();

for (const directory of skillDirectories) {
  const skill = read(`.agents/skills/${directory.name}/SKILL.md`);
  const frontmatter = skill.match(/^---\n([\s\S]*?)\n---/);
  const name = frontmatter?.[1].match(/^name:\s*(.+)$/m)?.[1]?.trim();
  const description = frontmatter?.[1].match(/^description:\s*(.+)$/m)?.[1]?.trim();

  if (!name || !description) {
    failures.push(`Skill ${directory.name} requires name and description frontmatter.`);
    continue;
  }

  if (skillNames.has(name)) {
    failures.push(`Duplicate skill name: ${name}`);
  }

  skillNames.add(name);

  if (skill.split('\n').length > 500) {
    failures.push(`Skill ${name} exceeds 500 lines.`);
  }
}

if (skillNames.size !== 3) {
  failures.push(`Expected 3 initial YASTROYKA skills, found ${skillNames.size}.`);
}

console.log('');
console.log('YASTROYKA Codex Base Setup — Smoke Test');
console.log('-----------------------------------------');
console.log('Baseline:    571d58642a10f4d8d7ce97882a615b6feeba7887');
console.log(`Skills:      ${skillNames.size}`);
console.log('MCP:         disabled');
console.log('Network:     disabled');
console.log('Approvals:   on-request');
console.log('');

if (failures.length > 0) {
  console.error('CODEX BOOTSTRAP FAILED');

  for (const failure of failures) {
    console.error(`- ${failure}`);
  }

  process.exit(1);
}

console.log('CODEX BOOTSTRAP OK');

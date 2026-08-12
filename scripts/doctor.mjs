import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const root = new URL('../', import.meta.url);

const packageJson = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));

const expectedNode = readFileSync(new URL('.node-version', root), 'utf8').trim();

const expectedNodeMajor = expectedNode.split('.')[0];

const expectedPnpm = packageJson.packageManager?.match(/^pnpm@(.+)$/)?.[1];

const expectedTypeScript = packageJson.devDependencies?.typescript;

const actualNode = process.versions.node;

const actualPnpm = execSync('pnpm --version', {
  encoding: 'utf8',
}).trim();

const actualTypeScript = execSync('pnpm exec tsc --version', {
  encoding: 'utf8',
})
  .trim()
  .replace(/^Version\s+/, '');

const failures = [];

if (actualNode.split('.')[0] !== expectedNodeMajor) {
  failures.push(`Node.js major mismatch: expected ${expectedNodeMajor}.x, got ${actualNode}`);
}

if (!expectedPnpm) {
  failures.push('packageManager must declare an exact pnpm version.');
} else if (actualPnpm !== expectedPnpm) {
  failures.push(`pnpm mismatch: expected ${expectedPnpm}, got ${actualPnpm}`);
}

if (!expectedTypeScript) {
  failures.push('TypeScript is not declared in devDependencies.');
} else if (actualTypeScript !== expectedTypeScript) {
  failures.push(`TypeScript mismatch: expected ${expectedTypeScript}, got ${actualTypeScript}`);
}

if (!existsSync(new URL('pnpm-lock.yaml', root))) {
  failures.push('pnpm-lock.yaml is missing.');
}

console.log('');
console.log('YASTROYKA AI MEDIA COMPANY — Toolchain Doctor');
console.log('------------------------------------------------');
console.log(`Node.js:    ${actualNode} (target ${expectedNodeMajor}.x)`);
console.log(`pnpm:       ${actualPnpm} (expected ${expectedPnpm})`);
console.log(`TypeScript: ${actualTypeScript} (expected ${expectedTypeScript})`);
console.log('');

if (failures.length > 0) {
  console.error('TOOLCHAIN FAILED');
  console.error('');

  for (const failure of failures) {
    console.error(`- ${failure}`);
  }

  process.exit(1);
}

console.log('TOOLCHAIN OK');

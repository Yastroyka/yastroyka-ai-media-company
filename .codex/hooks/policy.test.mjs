import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluatePreToolUse } from './policy.mjs';

function bash(command) {
  return evaluatePreToolUse({ tool_name: 'Bash', tool_input: { command } });
}

function patch(command) {
  return evaluatePreToolUse({ tool_name: 'apply_patch', tool_input: { command } });
}

function denialId(result) {
  return result?.hookSpecificOutput?.permissionDecisionReason;
}

test('allows a repository quality check', () => {
  assert.equal(bash('pnpm run quality:check'), null);
});

test('allows a normal source patch', () => {
  assert.equal(patch('*** Begin Patch\n*** Update File: src/index.ts\n*** End Patch'), null);
});

test('denies reading an environment file', () => {
  assert.match(denialId(bash('cat services/api/.env')), /secret-bearing/i);
});

test('denies patching an environment file', () => {
  assert.match(
    denialId(patch('*** Begin Patch\n*** Update File: .env.production\n*** End Patch')),
    /secret-bearing/i,
  );
});

test('denies destructive git reset', () => {
  assert.match(denialId(bash('git reset --hard HEAD~1')), /git-reset-hard/);
});

test('denies destructive PowerShell removal', () => {
  assert.match(
    denialId(bash('Remove-Item C:\\work\\project -Recurse -Force')),
    /powershell-destructive-delete/,
  );
});

test('denies force push', () => {
  assert.match(denialId(bash('git push --force origin feature')), /git-force-push/);
});

test('denies a direct protected-branch push', () => {
  assert.match(denialId(bash('git push origin HEAD:main')), /protected-branch-push/);
});

test('denies direct pull request merge', () => {
  assert.match(denialId(bash('gh pr merge 4 --merge')), /direct-pr-merge/);
});

test('fails closed for invalid hook input', () => {
  assert.match(denialId(evaluatePreToolUse(null)), /fail-closed/i);
});

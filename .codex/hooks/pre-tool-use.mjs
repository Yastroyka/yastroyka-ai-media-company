import process from 'node:process';

import { evaluatePreToolUse } from './policy.mjs';

let rawInput = '';

for await (const chunk of process.stdin) {
  rawInput += chunk;
}

let input;

try {
  input = JSON.parse(rawInput);
} catch {
  input = null;
}

const decision = evaluatePreToolUse(input);

if (decision) {
  process.stdout.write(`${JSON.stringify(decision)}\n`);
}

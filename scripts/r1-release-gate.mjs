import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderReleaseGateSummary, runReleaseGate } from './r1-release-gate-lib.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(repositoryRoot, 'evals', 'r1', 'release-gates.json');
const evidenceDirectory = path.join(repositoryRoot, '.tmp', 'release-gate');
const evidencePath = path.join(evidenceDirectory, 'r1-evidence.json');

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const revision = process.env.YASTROYKA_RELEASE_GATE_REVISION ?? 'LOCAL';
const evidence = runReleaseGate(manifest, { revision });
const summary = renderReleaseGateSummary(evidence);

await mkdir(evidenceDirectory, { recursive: true });
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');

if (process.env.GITHUB_STEP_SUMMARY !== undefined && process.env.GITHUB_STEP_SUMMARY.length > 0) {
  await appendFile(process.env.GITHUB_STEP_SUMMARY, summary, 'utf8');
}

process.stdout.write(summary);
process.stdout.write(`Evidence: ${path.relative(repositoryRoot, evidencePath)}\n`);

if (evidence.status !== 'PASS') {
  process.exitCode = 1;
}

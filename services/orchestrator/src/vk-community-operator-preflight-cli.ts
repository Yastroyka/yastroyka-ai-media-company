import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  preflightVkCommunityProductionActivation,
  type VkCommunityProductionPreflightInput,
} from './vk-community-production-preflight.ts';

export type VkCommunityOperatorPreflightExitCode = 0 | 2 | 64 | 65;

export interface VkCommunityOperatorPreflightIo {
  readonly readTextFile: (path: string) => Promise<string>;
  readonly writeStdout: (text: string) => void;
  readonly writeStderr: (text: string) => void;
}

export class VkCommunityOperatorManifestError extends Error {
  constructor() {
    super('VK production preflight manifest invalid');
    this.name = 'VkCommunityOperatorManifestError';
  }
}

const MAX_MANIFEST_LENGTH = 65_536;
const MAX_PATH_LENGTH = 4_096;
const ALLOWED_MANIFEST_KEYS = new Set([
  'communityId',
  'ownerApprovalPublicKey',
  'publishingIdentitySecretReference',
  'vkCredentialSecretReference',
]);

function failManifest(): never {
  throw new VkCommunityOperatorManifestError();
}

function expectManifestObject(value: unknown): Record<string, unknown> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    failManifest();
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    failManifest();
  }

  return value as Record<string, unknown>;
}

function requireAllowedKeys(value: Record<string, unknown>): void {
  for (const key of Object.keys(value)) {
    if (!ALLOWED_MANIFEST_KEYS.has(key)) {
      failManifest();
    }
  }
}

export function parseVkCommunityOperatorManifest(
  text: string,
): VkCommunityProductionPreflightInput {
  if (
    typeof text !== 'string' ||
    text.length === 0 ||
    text.length > MAX_MANIFEST_LENGTH ||
    text.includes('\u0000')
  ) {
    failManifest();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    failManifest();
  }

  const manifest = expectManifestObject(parsed);
  requireAllowedKeys(manifest);

  return Object.freeze({
    communityId: manifest.communityId,
    ownerApprovalPublicKey: manifest.ownerApprovalPublicKey,
    vkCredentialSecretReference: manifest.vkCredentialSecretReference,
    publishingIdentitySecretReference: manifest.publishingIdentitySecretReference,
  });
}

function requireManifestPath(value: string | undefined): string {
  if (
    value === undefined ||
    value.length === 0 ||
    value.length > MAX_PATH_LENGTH ||
    value.includes('\u0000')
  ) {
    failManifest();
  }
  return value;
}

export async function runVkCommunityOperatorPreflightCli(
  args: readonly string[],
  io: VkCommunityOperatorPreflightIo,
): Promise<VkCommunityOperatorPreflightExitCode> {
  if (args.length !== 2 || args[0] !== 'preflight') {
    io.writeStderr('Usage: vk:preflight <non-secret-manifest.json>\n');
    return 64;
  }

  try {
    const manifestPath = requireManifestPath(args[1]);
    const text = await io.readTextFile(manifestPath);
    const manifest = parseVkCommunityOperatorManifest(text);
    const result = preflightVkCommunityProductionActivation(manifest);

    io.writeStdout(JSON.stringify(result, null, 2) + '\n');
    return result.status === 'READY' ? 0 : 2;
  } catch {
    io.writeStderr('VK production preflight manifest invalid\n');
    return 65;
  }
}

async function main(): Promise<void> {
  const exitCode = await runVkCommunityOperatorPreflightCli(process.argv.slice(2), {
    async readTextFile(path) {
      return await readFile(path, 'utf8');
    },
    writeStdout(text) {
      process.stdout.write(text);
    },
    writeStderr(text) {
      process.stderr.write(text);
    },
  });

  process.exitCode = exitCode;
}

const entrypoint = process.argv[1];
if (entrypoint !== undefined && resolve(entrypoint) === fileURLToPath(import.meta.url)) {
  await main();
}

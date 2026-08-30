import {
  createHash,
  createPrivateKey,
  createPublicKey,
  randomUUID,
  type KeyObject,
} from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  VkCommunityOwnerGrantError,
  computeVkCommunityPreviewFingerprint,
  createVkCommunityOwnerGrantAssertion,
  inspectVkCommunityOwnerApprovalPublicKey,
  parseVkCommunityOperatorManifest,
  preflightVkCommunityProductionActivation,
  signVkCommunityOwnerGrant,
  verifyVkCommunityOwnerGrant,
  type VkCommunityApprovalPacket,
  type VkCommunityOwnerGrantEnvelope,
  type VkCommunityPublishingPreview,
} from '@yastroyka/orchestrator';

export type VkCommunityOwnerGrantCliExitCode = 0 | 2 | 64 | 65;

export interface VkCommunityOwnerGrantCliDependencies {
  readonly readTextFile: (path: string) => Promise<string>;
  readonly clock?: () => Date;
  readonly grantIdFactory?: () => string;
}

export interface VkCommunityOwnerGrantCliIo {
  readonly writeStdout: (text: string) => void;
  readonly writeStderr: (text: string) => void;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const HEX_64_PATTERN = /^[0-9a-f]{64}$/u;
const MAX_TEXT_FILE_LENGTH = 65_536;
const MAX_PRIVATE_KEY_LENGTH = 16_384;
const GRANT_LIFETIME_MS = 2 * 60 * 1_000;

class VkCommunityOwnerSignerInputError extends Error {
  constructor() {
    super('VK owner signer input invalid');
    this.name = 'VkCommunityOwnerSignerInputError';
  }
}

function failInput(): never {
  throw new VkCommunityOwnerSignerInputError();
}

function expectPlainObject(value: unknown): Record<string, unknown> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    failInput();
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    failInput();
  }
  return value as Record<string, unknown>;
}

function requireExactKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length) {
    failInput();
  }
  for (let index = 0; index < actual.length; index += 1) {
    if (actual[index] !== wanted[index]) {
      failInput();
    }
  }
}

function parseJson(text: string): unknown {
  if (text.length === 0 || text.length > MAX_TEXT_FILE_LENGTH || text.includes('\u0000')) {
    failInput();
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    failInput();
  }
}

function parsePreview(value: unknown): VkCommunityPublishingPreview {
  const preview = expectPlainObject(value);
  requireExactKeys(preview, [
    'publicationId',
    'platform',
    'ownerId',
    'fromGroup',
    'message',
    'idempotencyKey',
  ]);

  if (
    typeof preview.publicationId !== 'string' ||
    !UUID_PATTERN.test(preview.publicationId) ||
    preview.platform !== 'VK_COMMUNITY' ||
    typeof preview.ownerId !== 'number' ||
    !Number.isSafeInteger(preview.ownerId) ||
    preview.ownerId >= 0 ||
    preview.ownerId < -2_147_483_647 ||
    preview.fromGroup !== true ||
    typeof preview.message !== 'string' ||
    preview.message.length === 0 ||
    typeof preview.idempotencyKey !== 'string' ||
    !HEX_64_PATTERN.test(preview.idempotencyKey) ||
    preview.idempotencyKey !==
      createHash('sha256').update(preview.publicationId, 'utf8').digest('hex')
  ) {
    failInput();
  }

  return Object.freeze({
    publicationId: preview.publicationId,
    platform: 'VK_COMMUNITY' as const,
    ownerId: preview.ownerId,
    fromGroup: true as const,
    message: preview.message,
    idempotencyKey: preview.idempotencyKey,
  });
}

export function parseVkCommunityApprovalPacketOutput(text: string): VkCommunityApprovalPacket {
  const output = expectPlainObject(parseJson(text));
  requireExactKeys(output, ['status', 'approvalPacket']);
  if (output.status !== 'READY') {
    failInput();
  }

  const packet = expectPlainObject(output.approvalPacket);
  requireExactKeys(packet, ['preview', 'previewFingerprint']);
  const preview = parsePreview(packet.preview);

  if (
    typeof packet.previewFingerprint !== 'string' ||
    !HEX_64_PATTERN.test(packet.previewFingerprint) ||
    computeVkCommunityPreviewFingerprint(preview) !== packet.previewFingerprint
  ) {
    failInput();
  }

  return Object.freeze({
    preview,
    previewFingerprint: packet.previewFingerprint,
  });
}

function parseOwnerPrivateKey(text: string): KeyObject {
  if (
    text.length === 0 ||
    text.length > MAX_PRIVATE_KEY_LENGTH ||
    text.includes('\u0000') ||
    !text.includes('-----BEGIN PRIVATE KEY-----') ||
    !text.includes('-----END PRIVATE KEY-----')
  ) {
    failInput();
  }

  try {
    const key = createPrivateKey(text.trim());
    if (key.type !== 'private' || key.asymmetricKeyType !== 'ed25519') {
      failInput();
    }
    return key;
  } catch (error) {
    if (error instanceof VkCommunityOwnerSignerInputError) {
      throw error;
    }
    failInput();
  }
}

function ownerPublicKeyFingerprintFromPrivateKey(privateKey: KeyObject): string {
  const publicKey = createPublicKey(privateKey);
  const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  return inspectVkCommunityOwnerApprovalPublicKey(pem).fingerprint;
}

function requireClockNow(clock: () => Date): Date {
  const now = clock();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    failInput();
  }
  return now;
}

function genericInputError(io: VkCommunityOwnerGrantCliIo): VkCommunityOwnerGrantCliExitCode {
  io.writeStderr('VK owner grant signer input invalid\n');
  return 65;
}

export async function runVkCommunityOwnerGrantCli(
  args: readonly string[],
  dependencies: VkCommunityOwnerGrantCliDependencies,
  io: VkCommunityOwnerGrantCliIo,
): Promise<VkCommunityOwnerGrantCliExitCode> {
  if (args.length !== 4 || args[0] !== 'sign-grant') {
    io.writeStderr(
      'Usage: vk:sign-grant <approval-packet.json> <non-secret-manifest.json> <private-key.pem>\n',
    );
    return 64;
  }

  const approvalPacketPath = args[1];
  const manifestPath = args[2];
  const privateKeyPath = args[3];
  if (
    approvalPacketPath === undefined ||
    manifestPath === undefined ||
    privateKeyPath === undefined ||
    approvalPacketPath.length === 0 ||
    manifestPath.length === 0 ||
    privateKeyPath.length === 0
  ) {
    return genericInputError(io);
  }

  let preflight: ReturnType<typeof preflightVkCommunityProductionActivation>;
  let ownerApprovalPublicKey: unknown;
  try {
    const manifest = parseVkCommunityOperatorManifest(
      await dependencies.readTextFile(manifestPath),
    );
    ownerApprovalPublicKey = manifest.ownerApprovalPublicKey;
    preflight = preflightVkCommunityProductionActivation(manifest);
  } catch {
    return genericInputError(io);
  }

  if (preflight.status === 'BLOCKED') {
    io.writeStdout(
      JSON.stringify({
        status: 'BLOCKED',
        stage: 'PRODUCTION_PREFLIGHT',
        reasons: preflight.reasons,
      }) + '\n',
    );
    return 2;
  }

  let approvalPacket: VkCommunityApprovalPacket;
  try {
    approvalPacket = parseVkCommunityApprovalPacketOutput(
      await dependencies.readTextFile(approvalPacketPath),
    );
    if (approvalPacket.preview.ownerId !== preflight.ownerId) {
      failInput();
    }
  } catch {
    return genericInputError(io);
  }

  let grant: VkCommunityOwnerGrantEnvelope;
  try {
    const privateKey = parseOwnerPrivateKey(await dependencies.readTextFile(privateKeyPath));
    if (
      ownerPublicKeyFingerprintFromPrivateKey(privateKey) !== preflight.ownerPublicKeyFingerprint
    ) {
      failInput();
    }

    const now = requireClockNow(dependencies.clock ?? (() => new Date()));
    const expiresAt = new Date(now.getTime() + GRANT_LIFETIME_MS);
    const grantId = (dependencies.grantIdFactory ?? randomUUID)();

    const assertion = createVkCommunityOwnerGrantAssertion({
      grantId,
      publicationId: approvalPacket.preview.publicationId,
      ownerId: approvalPacket.preview.ownerId,
      previewFingerprint: approvalPacket.previewFingerprint,
      issuedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });

    grant = signVkCommunityOwnerGrant(assertion, privateKey);

    verifyVkCommunityOwnerGrant({
      grant,
      ownerApprovalPublicKey,
      publicationId: approvalPacket.preview.publicationId,
      ownerId: approvalPacket.preview.ownerId,
      previewFingerprint: approvalPacket.previewFingerprint,
      now,
    });
  } catch (error) {
    if (
      error instanceof VkCommunityOwnerSignerInputError ||
      error instanceof VkCommunityOwnerGrantError
    ) {
      return genericInputError(io);
    }
    return genericInputError(io);
  }

  io.writeStdout(JSON.stringify(grant) + '\n');
  return 0;
}

async function main(): Promise<void> {
  const exitCode = await runVkCommunityOwnerGrantCli(
    process.argv.slice(2),
    {
      async readTextFile(path) {
        return await readFile(path, 'utf8');
      },
    },
    {
      writeStdout(text) {
        process.stdout.write(text);
      },
      writeStderr(text) {
        process.stderr.write(text);
      },
    },
  );
  process.exitCode = exitCode;
}

const entrypoint = process.argv[1];
if (entrypoint !== undefined && resolve(entrypoint) === fileURLToPath(import.meta.url)) {
  await main();
}

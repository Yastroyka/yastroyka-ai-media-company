import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  VkCommunityApprovalPacketReader,
  VkCommunityOwnerGrantError,
  VkCommunityPublishingError,
  parseVkCommunityOperatorManifest,
  preflightVkCommunityProductionActivation,
  verifyVkCommunityOwnerGrant,
} from '@yastroyka/orchestrator';

import {
  openPostgresVkCommunityReadOnlyState,
  type VkCommunityReadOnlyPublicationStateLease,
} from './vk-community-read-only-state.ts';

export type VkCommunityExecutionVerifierExitCode = 0 | 2 | 64 | 65 | 70;

export interface VkCommunityExecutionVerifierDependencies {
  readonly readTextFile: (path: string) => Promise<string>;
  readonly openPublicationState: () => Promise<VkCommunityReadOnlyPublicationStateLease>;
  readonly clock?: () => Date;
}

export interface VkCommunityExecutionVerifierIo {
  readonly writeStdout: (text: string) => void;
  readonly writeStderr: (text: string) => void;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAX_PATH_LENGTH = 4_096;
const MAX_GRANT_LENGTH = 65_536;

class VkCommunityExecutionVerifierInputError extends Error {
  constructor() {
    super('VK execution verifier input invalid');
    this.name = 'VkCommunityExecutionVerifierInputError';
  }
}

function failInput(): never {
  throw new VkCommunityExecutionVerifierInputError();
}

function jsonLine(value: unknown): string {
  return JSON.stringify(value) + '\n';
}

function requirePublicationId(value: string | undefined): string {
  if (value === undefined || !UUID_PATTERN.test(value)) {
    failInput();
  }
  return value;
}

function requirePath(value: string | undefined): string {
  if (
    value === undefined ||
    value.length === 0 ||
    value.length > MAX_PATH_LENGTH ||
    value.includes('\u0000')
  ) {
    failInput();
  }
  return value;
}

function parseGrantJson(text: string): unknown {
  if (text.length === 0 || text.length > MAX_GRANT_LENGTH || text.includes('\u0000')) {
    failInput();
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    failInput();
  }
}

function requireNow(clock: () => Date): Date {
  const now = clock();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    failInput();
  }
  return now;
}

async function closeLeaseOrFail(
  lease: VkCommunityReadOnlyPublicationStateLease,
  io: VkCommunityExecutionVerifierIo,
): Promise<boolean> {
  try {
    await lease.close();
    return true;
  } catch {
    io.writeStderr('VK execution verifier failed\n');
    return false;
  }
}

export async function runVkCommunityExecutionVerifier(
  args: readonly string[],
  dependencies: VkCommunityExecutionVerifierDependencies,
  io: VkCommunityExecutionVerifierIo,
): Promise<VkCommunityExecutionVerifierExitCode> {
  if (args.length !== 4 || args[0] !== 'verify-execution') {
    io.writeStderr(
      'Usage: vk:verify-execution <publication-id> <owner-grant.json> <non-secret-manifest.json>\n',
    );
    return 64;
  }

  let publicationId: string;
  let grantPath: string;
  let manifestPath: string;
  let ownerApprovalPublicKey: unknown;
  let preflight: ReturnType<typeof preflightVkCommunityProductionActivation>;

  try {
    publicationId = requirePublicationId(args[1]);
    grantPath = requirePath(args[2]);
    manifestPath = requirePath(args[3]);
    const manifest = parseVkCommunityOperatorManifest(
      await dependencies.readTextFile(manifestPath),
    );
    ownerApprovalPublicKey = manifest.ownerApprovalPublicKey;
    preflight = preflightVkCommunityProductionActivation(manifest);
  } catch {
    io.writeStderr('VK execution verifier input invalid\n');
    return 65;
  }

  if (preflight.status === 'BLOCKED') {
    io.writeStdout(
      jsonLine({
        status: 'BLOCKED',
        stage: 'PRODUCTION_PREFLIGHT',
        reasons: preflight.reasons,
      }),
    );
    return 2;
  }

  let ownerGrant: unknown;
  let now: Date;
  try {
    ownerGrant = parseGrantJson(await dependencies.readTextFile(grantPath));
    now = requireNow(dependencies.clock ?? (() => new Date()));
  } catch {
    io.writeStderr('VK execution verifier input invalid\n');
    return 65;
  }

  let lease: VkCommunityReadOnlyPublicationStateLease;
  try {
    lease = await dependencies.openPublicationState();
  } catch {
    io.writeStderr('VK execution verifier failed\n');
    return 70;
  }

  let result:
    | {
        readonly status: 'READY';
        readonly executionBinding: {
          readonly publicationId: string;
          readonly ownerId: number;
          readonly previewFingerprint: string;
          readonly grantId: string;
          readonly grantExpiresAt: string;
        };
      }
    | {
        readonly status: 'BLOCKED';
        readonly stage: 'PUBLICATION' | 'OWNER_GRANT';
        readonly reason: string;
      };

  try {
    const approvalPacket = await new VkCommunityApprovalPacketReader({
      communityId: preflight.communityId,
      publicationState: lease.publicationState,
    }).prepare(publicationId);

    const verifiedGrant = verifyVkCommunityOwnerGrant({
      grant: ownerGrant,
      ownerApprovalPublicKey,
      publicationId,
      ownerId: preflight.ownerId,
      previewFingerprint: approvalPacket.previewFingerprint,
      now,
    });

    result = {
      status: 'READY',
      executionBinding: {
        publicationId,
        ownerId: preflight.ownerId,
        previewFingerprint: approvalPacket.previewFingerprint,
        grantId: verifiedGrant.assertion.grant_id,
        grantExpiresAt: verifiedGrant.assertion.expires_at,
      },
    };
  } catch (error) {
    if (error instanceof VkCommunityPublishingError) {
      result = {
        status: 'BLOCKED',
        stage: 'PUBLICATION',
        reason: error.code,
      };
    } else if (error instanceof VkCommunityOwnerGrantError) {
      result = {
        status: 'BLOCKED',
        stage: 'OWNER_GRANT',
        reason: 'VK_OWNER_GRANT_INVALID',
      };
    } else {
      try {
        await lease.close();
      } catch {
        // Keep operational failures generic.
      }
      io.writeStderr('VK execution verifier failed\n');
      return 70;
    }
  }

  if (!(await closeLeaseOrFail(lease, io))) {
    return 70;
  }

  io.writeStdout(jsonLine(result));
  return result.status === 'READY' ? 0 : 2;
}

async function main(): Promise<void> {
  const exitCode = await runVkCommunityExecutionVerifier(
    process.argv.slice(2),
    {
      async readTextFile(path) {
        return await readFile(path, 'utf8');
      },
      openPublicationState: openPostgresVkCommunityReadOnlyState,
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

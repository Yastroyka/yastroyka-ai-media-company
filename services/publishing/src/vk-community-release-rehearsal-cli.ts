import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  VkCommunityApprovalPacketReader,
  VkCommunityOperatorManifestError,
  VkCommunityPublishingError,
  parseVkCommunityOperatorManifest,
  preflightVkCommunityProductionActivation,
} from '@yastroyka/orchestrator';

import {
  VK_COMMUNITY_ACCESS_TOKEN_ENVIRONMENT_VARIABLE,
  VK_COMMUNITY_PUBLISHING_IDENTITY_ENVIRONMENT_VARIABLE,
  VK_LIVE_CONFIRMATION_PREFIX,
} from './vk-community-live-execution-cli.ts';
import {
  openPostgresVkCommunityReadOnlyState,
  type VkCommunityReadOnlyPublicationStateLease,
} from './vk-community-read-only-state.ts';

export type VkCommunityReleaseRehearsalExitCode = 0 | 2 | 64 | 65 | 70;

export interface VkCommunityReleaseRehearsalDependencies {
  readonly readTextFile: (path: string) => Promise<string>;
  readonly openPublicationState: () => Promise<VkCommunityReadOnlyPublicationStateLease>;
}

export interface VkCommunityReleaseRehearsalIo {
  readonly writeStdout: (text: string) => void;
  readonly writeStderr: (text: string) => void;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAX_PATH_LENGTH = 4_096;

function jsonLine(value: unknown): string {
  return JSON.stringify(value) + '\n';
}

function requirePublicationId(value: string | undefined): string {
  if (value === undefined || !UUID_PATTERN.test(value)) {
    throw new VkCommunityOperatorManifestError();
  }
  return value;
}

function requireManifestPath(value: string | undefined): string {
  if (
    value === undefined ||
    value.length === 0 ||
    value.length > MAX_PATH_LENGTH ||
    value.includes('\u0000')
  ) {
    throw new VkCommunityOperatorManifestError();
  }
  return value;
}

async function closeLease(
  lease: VkCommunityReadOnlyPublicationStateLease,
  io: VkCommunityReleaseRehearsalIo,
): Promise<boolean> {
  try {
    await lease.close();
    return true;
  } catch {
    io.writeStderr('VK release rehearsal failed\n');
    return false;
  }
}

export async function runVkCommunityReleaseRehearsal(
  args: readonly string[],
  dependencies: VkCommunityReleaseRehearsalDependencies,
  io: VkCommunityReleaseRehearsalIo,
): Promise<VkCommunityReleaseRehearsalExitCode> {
  if (args.length !== 3 || args[0] !== 'release-rehearsal') {
    io.writeStderr('Usage: vk:release-rehearsal <publication-id> <non-secret-manifest.json>\n');
    return 64;
  }

  let publicationId: string;
  let preflight: ReturnType<typeof preflightVkCommunityProductionActivation>;

  try {
    publicationId = requirePublicationId(args[1]);
    const manifestPath = requireManifestPath(args[2]);
    const manifest = parseVkCommunityOperatorManifest(
      await dependencies.readTextFile(manifestPath),
    );
    preflight = preflightVkCommunityProductionActivation(manifest);
  } catch {
    io.writeStderr('VK release rehearsal input invalid\n');
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

  if (
    preflight.vkCredentialSecretReference.provider !== 'env' ||
    preflight.publishingIdentitySecretReference.provider !== 'env'
  ) {
    io.writeStdout(
      jsonLine({
        status: 'BLOCKED',
        stage: 'SECRET_PROVIDER',
        reason: 'ENVIRONMENT_SECRET_PROVIDER_REQUIRED',
      }),
    );
    return 2;
  }

  let lease: VkCommunityReadOnlyPublicationStateLease;
  try {
    lease = await dependencies.openPublicationState();
  } catch {
    io.writeStderr('VK release rehearsal failed\n');
    return 70;
  }

  let result:
    | {
        readonly status: 'READY';
        readonly communityId: number;
        readonly ownerId: number;
        readonly publicationId: string;
        readonly approvalPacket: Awaited<ReturnType<VkCommunityApprovalPacketReader['prepare']>>;
        readonly liveConfirmation: string;
        readonly requiredEnvironmentVariables: readonly string[];
        readonly guarantees: {
          readonly secretMaterialAccess: false;
          readonly networkAccess: false;
        };
      }
    | {
        readonly status: 'BLOCKED';
        readonly stage: 'PUBLICATION';
        readonly reason: string;
      };

  try {
    const reader = new VkCommunityApprovalPacketReader({
      communityId: preflight.communityId,
      publicationState: lease.publicationState,
    });
    const approvalPacket = await reader.prepare(publicationId);
    result = {
      status: 'READY',
      communityId: preflight.communityId,
      ownerId: preflight.ownerId,
      publicationId,
      approvalPacket,
      liveConfirmation: `${VK_LIVE_CONFIRMATION_PREFIX}${preflight.ownerId}`,
      requiredEnvironmentVariables: Object.freeze([
        VK_COMMUNITY_ACCESS_TOKEN_ENVIRONMENT_VARIABLE,
        VK_COMMUNITY_PUBLISHING_IDENTITY_ENVIRONMENT_VARIABLE,
      ]),
      guarantees: {
        secretMaterialAccess: false,
        networkAccess: false,
      },
    };
  } catch (error) {
    if (error instanceof VkCommunityPublishingError) {
      result = {
        status: 'BLOCKED',
        stage: 'PUBLICATION',
        reason: error.code,
      };
    } else {
      await closeLease(lease, io);
      io.writeStderr('VK release rehearsal failed\n');
      return 70;
    }
  }

  if (!(await closeLease(lease, io))) {
    return 70;
  }

  io.writeStdout(jsonLine(result));
  return result.status === 'READY' ? 0 : 2;
}

async function main(): Promise<void> {
  const exitCode = await runVkCommunityReleaseRehearsal(
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

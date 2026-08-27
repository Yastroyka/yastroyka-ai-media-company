import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  VkCommunityApprovalPacketReader,
  VkCommunityOperatorManifestError,
  VkCommunityPublishingError,
  parseVkCommunityOperatorManifest,
  preflightVkCommunityProductionActivation,
  type VkCommunityPublicationStatePort,
} from '@yastroyka/orchestrator';
import {
  PostgresPlatformWorkspaceStore,
  createReadOnlyDatabaseConnection,
} from '@yastroyka/db';

export type VkCommunityApprovalPacketOperatorExitCode = 0 | 2 | 64 | 65 | 70;

export interface VkCommunityApprovalPacketStateLease {
  readonly publicationState: VkCommunityPublicationStatePort;
  readonly close: () => Promise<void>;
}

export interface VkCommunityApprovalPacketOperatorDependencies {
  readonly readTextFile: (path: string) => Promise<string>;
  readonly openPublicationState: () => Promise<VkCommunityApprovalPacketStateLease>;
}

export interface VkCommunityApprovalPacketOperatorIo {
  readonly writeStdout: (text: string) => void;
  readonly writeStderr: (text: string) => void;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
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

export async function runVkCommunityApprovalPacketOperator(
  args: readonly string[],
  dependencies: VkCommunityApprovalPacketOperatorDependencies,
  io: VkCommunityApprovalPacketOperatorIo,
): Promise<VkCommunityApprovalPacketOperatorExitCode> {
  if (args.length !== 3 || args[0] !== 'approval-packet') {
    io.writeStderr(
      'Usage: vk:approval-packet <publication-id> <non-secret-manifest.json>\n',
    );
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
    io.writeStderr('VK approval packet operator input invalid\n');
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

  let lease: VkCommunityApprovalPacketStateLease;
  try {
    lease = await dependencies.openPublicationState();
  } catch {
    io.writeStderr('VK approval packet operator failed\n');
    return 70;
  }

  let result:
    | {
        readonly status: 'READY';
        readonly approvalPacket: Awaited<
          ReturnType<VkCommunityApprovalPacketReader['prepare']>
        >;
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
    result = {
      status: 'READY',
      approvalPacket: await reader.prepare(publicationId),
    };
  } catch (error) {
    if (error instanceof VkCommunityPublishingError) {
      result = {
        status: 'BLOCKED',
        stage: 'PUBLICATION',
        reason: error.code,
      };
    } else {
      try {
        await lease.close();
      } catch {
        // Keep the operator response generic.
      }
      io.writeStderr('VK approval packet operator failed\n');
      return 70;
    }
  }

  try {
    await lease.close();
  } catch {
    io.writeStderr('VK approval packet operator failed\n');
    return 70;
  }

  io.writeStdout(jsonLine(result));
  return result.status === 'READY' ? 0 : 2;
}

async function openPostgresPublicationState(): Promise<VkCommunityApprovalPacketStateLease> {
  const database = createReadOnlyDatabaseConnection();

  try {
    await database.authenticate();
    return {
      publicationState: new PostgresPlatformWorkspaceStore(database),
      async close() {
        await database.close();
      },
    };
  } catch {
    try {
      await database.close();
    } catch {
      // Keep connection failures sanitized.
    }
    throw new Error('VK approval packet PostgreSQL state unavailable');
  }
}

async function main(): Promise<void> {
  const exitCode = await runVkCommunityApprovalPacketOperator(
    process.argv.slice(2),
    {
      async readTextFile(path) {
        return await readFile(path, 'utf8');
      },
      openPublicationState: openPostgresPublicationState,
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

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { inspectVkCommunityActivationReadiness } from './vk-community-activation-readiness.ts';
import {
  openPostgresVkCommunityPublicationDiscovery,
  type VkCommunityReadOnlyPublicationDiscoveryLease,
} from './vk-community-read-only-state.ts';

export type VkCommunityActivationReadinessExitCode = 0 | 2 | 64 | 70;

export interface VkCommunityActivationReadinessDependencies {
  readonly openPublicationDiscovery: () => Promise<VkCommunityReadOnlyPublicationDiscoveryLease>;
}

export interface VkCommunityActivationReadinessIo {
  readonly writeStdout: (text: string) => void;
  readonly writeStderr: (text: string) => void;
}

function jsonLine(value: unknown): string {
  return JSON.stringify(value) + '\n';
}

export async function runVkCommunityActivationReadiness(
  args: readonly string[],
  dependencies: VkCommunityActivationReadinessDependencies,
  io: VkCommunityActivationReadinessIo,
): Promise<VkCommunityActivationReadinessExitCode> {
  if (args.length !== 1 || args[0] !== 'activation-readiness') {
    io.writeStderr('Usage: vk:activation-readiness\n');
    return 64;
  }

  let lease: VkCommunityReadOnlyPublicationDiscoveryLease;
  try {
    lease = await dependencies.openPublicationDiscovery();
  } catch {
    io.writeStderr('VK activation readiness failed\n');
    return 70;
  }

  let result: Awaited<ReturnType<typeof inspectVkCommunityActivationReadiness>>;
  try {
    result = await inspectVkCommunityActivationReadiness(lease.publicationDiscovery);
  } catch {
    try {
      await lease.close();
    } catch {
      // Keep close errors sanitized below.
    }
    io.writeStderr('VK activation readiness failed\n');
    return 70;
  }

  try {
    await lease.close();
  } catch {
    io.writeStderr('VK activation readiness failed\n');
    return 70;
  }

  io.writeStdout(jsonLine(result));
  return result.status === 'CANDIDATE_FOUND' ? 0 : 2;
}

async function main(): Promise<void> {
  const exitCode = await runVkCommunityActivationReadiness(
    process.argv.slice(2),
    {
      openPublicationDiscovery: openPostgresVkCommunityPublicationDiscovery,
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

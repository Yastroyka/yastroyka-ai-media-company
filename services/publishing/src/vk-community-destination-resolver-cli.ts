import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createEnvironmentSecretProvider } from '@yastroyka/auth';
import {
  VkCommunityScreenNameResolver,
  VkCommunityScreenNameResolverError,
  type VkCommunityScreenNameResolution,
} from '@yastroyka/orchestrator';

export type VkCommunityDestinationResolverExitCode = 0 | 2 | 64 | 65 | 70;

export const VK_COMMUNITY_DESTINATION_RESOLVER_SECRET_KEY =
  'publishing/vk-community/destination-resolver' as const;
export const VK_COMMUNITY_ACCESS_TOKEN_ENVIRONMENT_VARIABLE =
  'YASTROYKA_VK_COMMUNITY_ACCESS_TOKEN' as const;

export interface VkCommunityDestinationResolverDependencies {
  readonly withAccessToken: <T>(consumer: (accessToken: string) => Promise<T>) => Promise<T>;
  readonly resolveScreenName: (
    screenName: string,
    accessToken: string,
  ) => Promise<VkCommunityScreenNameResolution>;
}

export interface VkCommunityDestinationResolverIo {
  readonly writeStdout: (text: string) => void;
  readonly writeStderr: (text: string) => void;
}

const SCREEN_NAME_PATTERN = /^[A-Za-z0-9_.]{1,64}$/u;

function jsonLine(value: unknown): string {
  return JSON.stringify(value) + '\n';
}

function parseVkCommunityUrl(value: string | undefined): {
  readonly suppliedUrl: string;
  readonly screenName: string;
  readonly canonicalUrl: string;
} {
  if (value === undefined || value.length === 0 || value.length > 2_048) {
    throw new Error('invalid input');
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('invalid input');
  }

  if (
    url.protocol !== 'https:' ||
    (url.hostname !== 'vk.ru' && url.hostname !== 'vk.com') ||
    url.port !== '' ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new Error('invalid input');
  }

  const path = url.pathname.replace(/^\/+|\/+$/gu, '');
  if (!SCREEN_NAME_PATTERN.test(path) || path.includes('/')) {
    throw new Error('invalid input');
  }

  return Object.freeze({
    suppliedUrl: value,
    screenName: path,
    canonicalUrl: `https://vk.ru/${path}`,
  });
}

const DEFAULT_DEPENDENCIES: VkCommunityDestinationResolverDependencies = Object.freeze({
  async withAccessToken<T>(consumer: (accessToken: string) => Promise<T>): Promise<T> {
    const provider = createEnvironmentSecretProvider({
      bindings: [
        {
          key: VK_COMMUNITY_DESTINATION_RESOLVER_SECRET_KEY,
          environmentVariable: VK_COMMUNITY_ACCESS_TOKEN_ENVIRONMENT_VARIABLE,
        },
      ],
    });

    return await provider.withSecret(
      {
        provider: 'env',
        key: VK_COMMUNITY_DESTINATION_RESOLVER_SECRET_KEY,
      },
      consumer,
    );
  },
  async resolveScreenName(screenName: string, accessToken: string) {
    return await new VkCommunityScreenNameResolver().resolve(screenName, accessToken);
  },
});

export async function runVkCommunityDestinationResolverOperator(
  args: readonly string[],
  dependencies: VkCommunityDestinationResolverDependencies,
  io: VkCommunityDestinationResolverIo,
): Promise<VkCommunityDestinationResolverExitCode> {
  if (args.length !== 2 || args[0] !== 'resolve-community') {
    io.writeStderr('Usage: vk:resolve-community <https://vk.ru/screen-name>\n');
    return 64;
  }

  let input: ReturnType<typeof parseVkCommunityUrl>;
  try {
    input = parseVkCommunityUrl(args[1]);
  } catch {
    io.writeStderr('VK community destination input invalid\n');
    return 65;
  }

  let result: VkCommunityScreenNameResolution;
  try {
    result = await dependencies.withAccessToken(async (accessToken) => {
      return await dependencies.resolveScreenName(input.screenName, accessToken);
    });
  } catch (error) {
    if (error instanceof VkCommunityScreenNameResolverError) {
      io.writeStderr('VK community destination resolution failed\n');
      return 70;
    }

    io.writeStdout(
      jsonLine({
        status: 'BLOCKED',
        stage: 'SECRET',
        reason: 'VK_ACCESS_TOKEN_UNAVAILABLE',
        requiredEnvironmentVariable: VK_COMMUNITY_ACCESS_TOKEN_ENVIRONMENT_VARIABLE,
      }),
    );
    return 2;
  }

  io.writeStdout(
    jsonLine({
      status: 'RESOLVED',
      suppliedUrl: input.suppliedUrl,
      canonicalUrl: input.canonicalUrl,
      screenName: result.screenName,
      objectType: result.objectType,
      communityId: result.communityId,
      ownerId: result.ownerId,
    }),
  );
  return 0;
}

async function main(): Promise<void> {
  const exitCode = await runVkCommunityDestinationResolverOperator(
    process.argv.slice(2),
    DEFAULT_DEPENDENCIES,
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

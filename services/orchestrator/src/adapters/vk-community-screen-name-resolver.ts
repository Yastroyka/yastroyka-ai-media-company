import { VK_API_VERSION } from './vk-community-http-transport.ts';

export const VK_RESOLVE_SCREEN_NAME_ENDPOINT =
  'https://api.vk.com/method/utils.resolveScreenName' as const;

export type VkCommunityResolvedObjectType = 'group' | 'page';

export interface VkCommunityScreenNameResolution {
  readonly screenName: string;
  readonly objectType: VkCommunityResolvedObjectType;
  readonly communityId: number;
  readonly ownerId: number;
}

export class VkCommunityScreenNameResolverError extends Error {
  constructor() {
    super('VK community screen-name resolution failed');
    this.name = 'VkCommunityScreenNameResolverError';
  }
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface VkCommunityScreenNameResolverOptions {
  readonly fetchImplementation?: FetchLike;
  readonly timeoutMilliseconds?: number;
}

const SCREEN_NAME_PATTERN = /^[A-Za-z0-9_.]{1,64}$/u;
const MAX_SECRET_LENGTH = 8_192;
const MAX_RESPONSE_LENGTH = 65_536;
const DEFAULT_TIMEOUT_MS = 10_000;

function fail(): never {
  throw new VkCommunityScreenNameResolverError();
}

function requireTimeout(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1_000 || value > 30_000) {
    throw new Error('timeoutMilliseconds must be an integer between 1000 and 30000.');
  }
  return value;
}

function requireScreenName(screenName: string): void {
  if (!SCREEN_NAME_PATTERN.test(screenName)) {
    fail();
  }
}

function requireAccessToken(accessToken: string): void {
  if (
    typeof accessToken !== 'string' ||
    accessToken.length === 0 ||
    accessToken.length > MAX_SECRET_LENGTH ||
    accessToken.includes('\u0000')
  ) {
    fail();
  }
}

function expectPlainObject(value: unknown): Record<string, unknown> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    fail();
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail();
  }
  return value as Record<string, unknown>;
}

function parseResolution(text: string, screenName: string): VkCommunityScreenNameResolution {
  if (text.length === 0 || text.length > MAX_RESPONSE_LENGTH) {
    fail();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    fail();
  }

  const root = expectPlainObject(parsed);
  if ('error' in root) {
    fail();
  }

  const response = expectPlainObject(root.response);
  const objectType = response.type;
  const communityId = response.object_id;

  if (
    (objectType !== 'group' && objectType !== 'page') ||
    typeof communityId !== 'number' ||
    !Number.isSafeInteger(communityId) ||
    communityId < 1 ||
    communityId > 2_147_483_647
  ) {
    fail();
  }

  return Object.freeze({
    screenName,
    objectType,
    communityId,
    ownerId: -communityId,
  });
}

export class VkCommunityScreenNameResolver {
  readonly #fetch: FetchLike;
  readonly #timeoutMilliseconds: number;

  constructor(options: VkCommunityScreenNameResolverOptions = {}) {
    this.#fetch = options.fetchImplementation ?? globalThis.fetch.bind(globalThis);
    this.#timeoutMilliseconds = requireTimeout(options.timeoutMilliseconds ?? DEFAULT_TIMEOUT_MS);
  }

  async resolve(screenName: string, accessToken: string): Promise<VkCommunityScreenNameResolution> {
    requireScreenName(screenName);
    requireAccessToken(accessToken);

    const body = new URLSearchParams({
      screen_name: screenName,
      access_token: accessToken,
      v: VK_API_VERSION,
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMilliseconds);

    try {
      const response = await this.#fetch(VK_RESOLVE_SCREEN_NAME_ENDPOINT, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
        },
        body,
        redirect: 'error',
        signal: controller.signal,
      });
      if (!response.ok) {
        fail();
      }
      return parseResolution(await response.text(), screenName);
    } catch (error) {
      if (error instanceof VkCommunityScreenNameResolverError) {
        throw error;
      }
      fail();
    } finally {
      clearTimeout(timeout);
    }
  }
}
